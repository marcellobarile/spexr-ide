> **What is this file.** Implementation contract for **codebase-map v2** — the
> redesign of AI file descriptions after the v1 (0.5B batched) approach failed on a
> real workspace. It supersedes the generation/storage parts of
> `2026-06-29-codebase-map-design.md` (v1); the v1 job orchestrator, UI, commands,
> and status bar are reused.
> **Audience:** engineers implementing the change, reviewers.
> **Owner:** marcello.barile.
> **Companion files:** v1 spec (`2026-06-29-codebase-map-design.md`) for the parts
> still in force; the implementation plan (under `docs/superpowers/plans/`) is the
> build order.

# Codebase Map v2 — per-file 0.5B for search, Claude for the map

## Status legend

- **Shipped** — merged, available to users.
- **Planned** — designed here, not built.

Everything below is **Planned**. The v1 codebase-map (0.5B batched) is **Shipped**
on `feat/smart-search` but defective at scale (see Root causes); v2 replaces its
generation engine.

## Root causes that triggered v2 (confirmed on a 8226-file workspace)

Verified by worker instrumentation against the real model:

- **RC1 — parse failure.** The 0.5B model echoes the prompt's one-shot example
  (`src/db/pool.ts`) and **prepends `src/`** to the requested paths in its output
  (`src/frontend/…` vs requested `frontend/…`). `parseBatchOutput` matches paths by
  exact line-start prefix → no match → `null`. Evidence: `parsed=[null,null,null,null,"…"]`
  where only the one line the model left un-prefixed matched.
- **RC2 — quality collapse.** Even when parsed, the 0.5B in batch **parrots the
  example sentence** for unrelated files (one request returned the identical
  "Manages a pool of reusable database connections" for five different AuthService
  files). Batched 0.5B descriptions are worse than the deterministic static ones.
- **RC3 — scale.** Each `WorkspaceIndexer.save()` does a synchronous
  `JSON.stringify` of the whole index (thousands of records × 384-float vectors).
  The mass job saved every few batches → blocked the backend event loop → Theia
  showed **"Offline"** and progress froze at `0/8226`.

## Decision

Split the two consumers, which have opposite constraints, and use a fit-for-purpose
engine for each:

| Flow | Consumer | Engine | Why |
|------|----------|--------|-----|
| **A. On-demand** | search result display (top-N) | **per-file single 0.5B** | reliable file-specific prose; no batch pathologies (RC1/RC2 vanish) |
| **B. Map** | agent-orientation export (whole repo) | **local Claude CLI, batched, with pre-flight token estimate + user confirmation** | high quality, reliable batching; not latency-sensitive |

Search display prefers the best available description: **Claude store → 0.5B
on-demand → static**.

## Flow A — On-demand per-file 0.5B (revert the batch)

Revert the batched path; describe one file per inference.

- **Worker protocol** returns to single-item: request `{ id, relPath, content }` →
  response `{ id, type: "done", text }` / `{ id, type: "error" }`.
- **`DescriptionGenerator`**: `generate(relPath, content): Promise<string | null>`
  (drop `generateBatch`). `buildPrompt(relPath, content)` describes ONE file from its
  `buildSymbolSummary`; no one-shot example, no path-keying, no `parseBatchOutput`.
- **`describeFiles`** in the backend: for each of the top-N requested paths still
  needing a description, run `generate` sequentially, emitting each result as it
  completes (the widget already renders progressively). Keep the cached/static-prose
  short-circuits. Cap N at the existing `AI_TOP_N`.
- Removes `buildBatchPrompt`, `parseBatchOutput`, `MAX_TOKENS_PER_FILE`/`MAX_BATCH_TOKENS`,
  and the `(items.length + 2)` budget logic.
- The temporary worker diagnostics added during debugging are removed.

This restores the pre-batch behavior whose quality was acceptable, with the latency
mitigated by the low cap and progressive streaming.

## Flow B — Map via local Claude CLI

### B1. Invocation

A new node module `claude-batch-describer.ts` resolves the `claude` executable
(reuse `claude-profile-detector` / the agent service's resolution) and runs it
**headless**: `claude -p` (print/non-interactive mode) with the prompt on stdin,
`cwd` = workspace root, capturing stdout. One child process per chunk, run
**sequentially** (no fan-out of 100+ processes). Each call has a timeout; the exact
flags (stdin vs arg, `--output-format json`) are pinned at implementation against the
installed CLI version.

### B2. Batching and prompt

- Assemble `buildSymbolSummary(relPath, content)` for **~75 files per call**
  (8226 → ~110 calls). Chunk size is a tunable constant.
- Prompt: "Describe what each file does in one short sentence. Reply with a JSON
  object mapping each given path to its description, nothing else." Provide the files
  as `path` + summary blocks.
- Parse the JSON object; map descriptions by exact path key (Claude reproduces the
  given paths faithfully — no `src/` prepend, no scrambling). A path missing from the
  response is left without a Claude description (retry the chunk once on a parse
  failure; otherwise skip those files).

### B3. Pre-flight token estimate + confirmation (user requirement)

Before any `claude` process is spawned:

- Compute `fileCount`, `chunkCount`, **estimated input tokens** (≈ total prompt
  characters / 4, summed across chunks, incl. per-prompt overhead) and **estimated
  output tokens** (≈ `fileCount × 20`).
- Show a **Theia modal dialog**: *"Map this codebase will send N files to Claude in
  ~C calls — estimated ~X input + ~Y output tokens. Proceed?"* with **Proceed /
  Cancel**. The job starts only on Proceed. The estimate is labeled as approximate.

### B4. Descriptions store (resolves RC3)

Claude descriptions are written to a **dedicated store**, separate from the vector
index, so no save touches the giant vectorized index:

- `<root>/.spexr/descriptions.json` — `{ [path]: { description, category } }`.
- `<root>/.spexr/codebase-map.md` — grouped by folder/category (existing
  `CodebaseMapWriter` output).

Both are written **incrementally per chunk** (text-only, small) — no event-loop
block. `.spexr/` artifacts stay git-ignored.

### B5. Progress, pause, resume

Reuse the v1 `DescriptionJob` orchestrator, with the unit of work = one chunk and the
engine = the Claude batch describer (not the 0.5B generator). Progress
(`done/total` files), pause between chunks, and resume (restart from files not yet in
the store) work as in v1. The status-bar mirror and header CTA are unchanged. The
existing fire-and-forget start + the live-index getter fix still apply, but the job no
longer writes to the vector index.

## Search display priority

`describeFiles` / search result rendering resolves a file's description as:

1. **Claude store** (`.spexr/descriptions.json`, loaded per workspace) if present;
2. else **0.5B `aiDescription`** on the index (generated on-demand);
3. else the **static** symbol/comment description.

The store is loaded lazily and refreshed when the Map job writes it.

## Error handling

- `claude` executable not found → the Map job fails fast with a clear message
  ("Claude CLI not found"); the confirmation dialog should ideally pre-check
  availability and disable Proceed.
- A `claude` call errors/times out → retry the chunk once; on repeated failure mark
  the job `error`, persist progress so far, surface the message. Already-written
  chunks remain in the store (resume-safe).
- Malformed JSON from a chunk → retry once with a stricter instruction; else skip that
  chunk's files (they remain for a later run).
- On-demand 0.5B unavailable/null → unchanged (emit failed, fall back to static).

## Testing

- **Flow A**: per-file `generate` path in `describeFiles` (fake generator) — sequential
  emit, cached/static short-circuits, cap respected; worker host single-item protocol.
- **`claude-batch-describer`** (fake spawn): chunking (75/call), JSON parse + path
  mapping, retry-once on bad JSON, executable-missing error, timeout handling.
- **Token estimator** (pure): char/4 input estimate + `N×20` output over fixed inputs.
- **Descriptions store**: incremental per-chunk write + read; search priority
  resolution (Claude > 0.5B > static).
- **`DescriptionJob`** v1 tests adapted to the chunk/Claude engine (pause/resume,
  progress, the store is written incrementally per chunk and the markdown is
  (re)generated on completion; the job never saves the vector index).

## Delivery slices

- **Slice 1 — On-demand revert (Flow A).** Single-item worker protocol, `generate`,
  `buildPrompt`, `describeFiles` sequential; remove batch helpers + worker
  diagnostics. Independently shippable: restores working search descriptions.
- **Slice 2 — Claude Map engine (Flow B).** `claude-batch-describer`, token estimator,
  descriptions store, confirmation dialog, re-point `DescriptionJob` to the Claude
  engine + store (off the vector index), search priority resolution.

## Out of scope (YAGNI)

- Concurrency/fan-out of Claude processes (sequential is enough at ~110 calls).
- Sending file content (symbol summary only).
- A dollar-cost estimate (token estimate only, per the request).
- Storing the description `source` provenance in the store (not needed by consumers).
