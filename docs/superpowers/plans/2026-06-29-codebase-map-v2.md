# Codebase Map v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the failed 0.5B batched descriptions with two fit-for-purpose engines: per-file single 0.5B for on-demand search display, and the local Claude CLI (with a pre-flight token estimate + confirmation) for the whole-repo "Map this codebase" export.

**Architecture:** Slice 1 reverts the worker/generator/backend to single-file 0.5B inference (removing all batch helpers). Slice 2 adds a headless `claude --print` batch describer, a token estimator, a descriptions store separate from the vector index, a confirmation dialog, and re-points the existing `DescriptionJob` at the Claude engine. Search display prefers Claude store → 0.5B `aiDescription` → static.

**Tech Stack:** TypeScript, Theia extensions, inversify DI, `@huggingface/transformers` (0.5B worker), `child_process` (claude CLI), vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-29-codebase-map-v2-design.md` is the contract.
- **`root`** to backend methods is an absolute filesystem path, never a `file://` URI.
- **Per-task commits on `feat/smart-search`** (no push). Conventional Commits ending with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit only each task's files.
- **The Map job must never block the backend event loop** — no synchronous `JSON.stringify` of the vector index; Claude calls use async `child_process` (never `spawnSync`); the descriptions store is text-only and written incrementally.
- **Claude headless invocation pattern (already used in `spexr-agent-backend-service.ts:486`):** `resolveClaudeExecutable()` from `./claude-profile-detector.js`; spawn `claude` with `["--print","--output-format","json","--input-format","text"]`, prompt on stdin, `cwd` = workspace; stdout is a JSON envelope `{ result?: string; is_error?: boolean }` where `result` is Claude's text.
- **Chunk size = 75 files/Claude call.**
- Tests run from `packages/theia-extensions`: `npx vitest run <file>`; typecheck `npx tsc --noEmit -p .`.

---

## File structure

**Slice 1 — revert on-demand to single-file 0.5B:**
- Modify `src/node/search/description-format.ts` — single-item types + `buildPrompt` + `generate`; remove batch helpers.
- Modify `src/node/search/worker-description-generator.ts` — `generate` single.
- Modify `src/node/search/description-worker.ts` — single-item handle.
- Modify `src/node/search/spexr-search-backend-service.ts` — `describeFiles` sequential per-file.
- Update tests: `description-format.test.ts`, `worker-description-generator.test.ts`, `spexr-search-backend-service.test.ts`.

**Slice 2 — Claude Map engine:**
- Create `src/node/search/claude-batch-describer.ts` — headless Claude chunk describer.
- Create `src/node/search/map-token-estimator.ts` — pure token estimate.
- Create `src/node/search/descriptions-store.ts` — `.spexr/descriptions.json` read/merge/lookup.
- Modify `src/node/search/description-job.ts` — engine = Claude chunks + store (off the index).
- Modify `src/node/search/spexr-search-backend-service.ts` — store-first search priority; `getMapEstimate` RPC; job wiring to Claude engine.
- Modify `src/common/search-protocol.ts` — `MapEstimate` type + `getMapEstimate` method.
- Modify `src/browser/search/smart-search-widget.tsx` — CTA → estimate → confirm dialog → start.
- Update tests accordingly.

---

# SLICE 1 — On-demand per-file 0.5B (revert the batch)

## Task 1: Revert worker/generator/backend to single-file inference

This is one cohesive task: the worker protocol, the generator interface, the worker, and the backend caller all revert together so the build stays green. The previous batch helpers are deleted.

**Files:**
- Modify: `src/node/search/description-format.ts`
- Modify: `src/node/search/worker-description-generator.ts`
- Modify: `src/node/search/description-worker.ts`
- Modify: `src/node/search/spexr-search-backend-service.ts`
- Test: `src/node/search/description-format.test.ts`, `worker-description-generator.test.ts`, `spexr-search-backend-service.test.ts`

**Interfaces produced:**
- `DescriptionGenerator.generate(relPath: string, content: string): Promise<string | null>` (drop `generateBatch`)
- `WorkerRequest { id: number; relPath: string; content: string }`
- `WorkerResponse = { id; type:"done"; text: string | null } | { id; type:"error" }`
- `buildPrompt(relPath: string, content: string): string`
- `MAX_NEW_TOKENS = 32`

- [ ] **Step 1: Rewrite `description-format.ts` types/helpers**

In `description-format.ts`: remove `BatchItem`, `MAX_TOKENS_PER_FILE`, `MAX_BATCH_TOKENS`, `buildBatchPrompt`, `parseBatchOutput`. Keep `GEN_MODEL_ID`, `MAX_DESC_CHARS`, `buildSymbolSummary`, `cleanGenerated`. Replace the interface/types/prompt with:

```ts
export const MAX_NEW_TOKENS = 32;

/** Produces a one-sentence, whole-file description, or null if unavailable. */
export interface DescriptionGenerator {
  generate(relPath: string, content: string): Promise<string | null>;
  isAvailable(): boolean;
  dispose?(): void;
}

export const DescriptionGeneratorToken = Symbol("DescriptionGenerator");

/** host → worker */
export interface WorkerRequest {
  id: number;
  relPath: string;
  content: string;
}

/** worker → host */
export type WorkerResponse =
  | { id: number; type: "done"; text: string | null }
  | { id: number; type: "error" };
```

And restore the single-file prompt (place where `buildBatchPrompt` was):

```ts
export function buildPrompt(relPath: string, content: string): string {
  const summary = buildSymbolSummary(relPath, content);
  return (
    `File: ${relPath}\n${summary}\n\n` +
    `In one short sentence (max 15 words), describe what this file does. ` +
    `Reply with only the sentence, no preamble.`
  );
}
```

- [ ] **Step 2: Update `description-format.test.ts`**

Replace the `buildBatchPrompt`/`parseBatchOutput` describe blocks with a `buildPrompt` block; keep the `buildSymbolSummary` and `cleanGenerated` blocks unchanged. Update the import line to `import { buildPrompt, buildSymbolSummary, cleanGenerated } from "./description-format.js";`.

```ts
describe("buildPrompt", () => {
  it("includes the path and extracted symbol names", () => {
    const p = buildPrompt("src/a.ts", "export const x = 1;\nexport function foo() {}");
    expect(p).toContain("src/a.ts");
    expect(p).toContain("foo");
    expect(p).toContain("one short sentence");
  });
});
```

- [ ] **Step 3: Rewrite `worker-description-generator.ts` to single-item**

Replace `generateBatch` with `generate`, and the `Pending`/`onMessage`/`fail` to resolve a single `string | null`:

```ts
import type {
  DescriptionGenerator,
  WorkerRequest,
  WorkerResponse,
} from "./description-format.js";
// (keep the existing WorkerLike, defaultWorkerFactory, class scaffold)

interface Pending {
  resolve: (value: string | null) => void;
}
```

Method + handlers:

```ts
  generate(relPath: string, content: string): Promise<string | null> {
    const worker = this.ensureWorker();
    if (!worker) return Promise.resolve(null);
    const id = ++this.seq;
    return new Promise<string | null>((resolve) => {
      this.pending.set(id, { resolve });
      worker.postMessage({ id, relPath, content });
    });
  }

  private onMessage(msg: WorkerResponse): void {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    entry.resolve(msg.type === "done" ? msg.text : null);
  }

  private fail(): void {
    this.failed = true;
    for (const entry of this.pending.values()) entry.resolve(null);
    this.pending.clear();
    this.worker = undefined;
  }
```

- [ ] **Step 4: Update `worker-description-generator.test.ts`**

Replace the `generateBatch` cases with single-item `generate` cases:

```ts
it("resolves with the text from the done message", async () => {
  const fake = new FakeWorker();
  const gen = new WorkerDescriptionGenerator(() => fake);
  const p = gen.generate("a.ts", "code");
  fake.emit({ id: fake.requests[0]!.id, type: "done", text: "Handles auth." });
  expect(await p).toBe("Handles auth.");
});

it("resolves null on an error response", async () => {
  const fake = new FakeWorker();
  const gen = new WorkerDescriptionGenerator(() => fake);
  const p = gen.generate("a.ts", "x");
  fake.emit({ id: fake.requests[0]!.id, type: "error" });
  expect(await p).toBeNull();
});

it("becomes unavailable and resolves pending to null on crash", async () => {
  const fake = new FakeWorker();
  const gen = new WorkerDescriptionGenerator(() => fake);
  const p = gen.generate("a.ts", "x");
  fake.crash();
  expect(await p).toBeNull();
  expect(gen.isAvailable()).toBe(false);
  expect(await gen.generate("b.ts", "y")).toBeNull();
});

it("returns null without spawning when the factory throws", async () => {
  const gen = new WorkerDescriptionGenerator(() => { throw new Error("spawn failed"); });
  expect(await gen.generate("a.ts", "x")).toBeNull();
  expect(gen.isAvailable()).toBe(false);
});
```

Keep the "spawns the worker only once" test but change both `generateBatch([...])` calls to `generate("a.ts","x")` / `generate("b.ts","y")` and the emits to `{ ..., type:"done", text:"one"|"two" }`, asserting `await p1 === "one"`.

- [ ] **Step 5: Rewrite `description-worker.ts` handle() to single-item**

```ts
import { parentPort, workerData } from "node:worker_threads";
import { env, pipeline } from "@huggingface/transformers";
import {
  GEN_MODEL_ID,
  MAX_NEW_TOKENS,
  buildPrompt,
  cleanGenerated,
  type WorkerRequest,
  type WorkerResponse,
} from "./description-format.js";
// (keep port, modelsDir, TextGenPipeline, pipePromise, getPipe, post unchanged)

async function handle(req: WorkerRequest): Promise<void> {
  const { id, relPath, content } = req;
  try {
    const pipe = await getPipe();
    const out = await pipe(
      [{ role: "user", content: buildPrompt(relPath, content) }],
      { max_new_tokens: MAX_NEW_TOKENS, do_sample: false },
    );
    const msgs = out[0]?.generated_text;
    const last = Array.isArray(msgs) ? msgs[msgs.length - 1] : undefined;
    const raw = typeof last?.content === "string" ? last.content : "";
    const text = cleanGenerated(raw);
    post({ id, type: "done", text: text.length > 0 ? text : null });
  } catch {
    post({ id, type: "error" });
  }
}
// (keep the serialize-requests chain at the bottom unchanged)
```

- [ ] **Step 6: Revert `describeFiles` to sequential per-file in `spexr-search-backend-service.ts`**

Replace the batch body (the `toGenerate` collection + `generateBatch` call) with a sequential loop that reuses `resolveOrCollect` then calls `generate` per file:

```ts
  async describeFiles(root: string, paths: string[]): Promise<void> {
    const ws = this.workspaces.get(root);
    if (!ws) return;
    const seq = (this.descBatchSeq.get(root) ?? 0) + 1;
    this.descBatchSeq.set(root, seq);
    for (const path of paths) {
      if (this.descBatchSeq.get(root) !== seq) return; // newer query arrived
      const need = await this.resolveOrCollect(ws, root, path);
      if (!need) continue;
      if (!this.generator.isAvailable()) {
        this.emit({ path, text: "", done: true, failed: true });
        continue;
      }
      const text = await this.generator.generate(need.path, need.content);
      if (this.descBatchSeq.get(root) !== seq) return;
      if (!text) {
        this.emit({ path, text: "", done: true, failed: true });
        continue;
      }
      ws.indexer.index.setAiDescription(path, text);
      await ws.indexer.save();
      this.emit({ path, text, done: true });
    }
  }
```

Keep `resolveOrCollect` and `emit` as-is. (`getJob` and the job methods keep their v1 shape in Slice 1; Slice 2 Task 5 re-points them.)

- [ ] **Step 7: Convert `description-job.ts` from `generateBatch` to a per-file `generate` loop**

The v1 `DescriptionJob.run()` calls `this.deps.generator.generateBatch(items)`, which no longer exists after Step 1 — that would break the build. Keep the `DescriptionJobDeps` shape unchanged (`{ index, generator, readContent, save, writeArtifacts, emit }`); only replace the inner batch call. In the `run()` loop, replace the batch block (build `items`, `generateBatch`, `forEach setAiDescription`) with a per-file loop over the same `batch` slice:

```ts
      for (const relPath of batch) {
        let content: string;
        try { content = await this.deps.readContent(relPath); }
        catch { continue; } // unreadable: skip; cursor still advances below
        const text = await this.deps.generator.generate(relPath, content);
        if (text) this.deps.index.setAiDescription(relPath, text);
      }
      this.cursor += batch.length;
      this.done = this.cursor;
```

Keep `BATCH_SIZE`, the pause/availability checks, the periodic `save`, the completion `writeArtifacts`, and the try/catch resilience exactly as v1. (This keeps the 0.5B Map working — slower, per-file — and green; Slice 2 Task 5 replaces the whole engine with Claude.)

- [ ] **Step 8: Update both affected tests**

In `spexr-search-backend-service.test.ts`, replace `FakeGenerator.generateBatch` with `generate` and drop the `BatchItem` import:

```ts
class FakeGenerator implements DescriptionGenerator {
  constructor(private readonly fn: (path: string) => string | null = () => "desc.") {}
  available = true;
  isAvailable(): boolean { return this.available; }
  async generate(relPath: string, _content: string): Promise<string | null> {
    return this.fn(relPath);
  }
}
```

Keep all existing `describeFiles` and "description job" assertions (still valid — the job now uses per-file `generate`, reaching `complete`).

In `description-job.test.ts`, its `FakeGen` currently has `generateBatch`; change it to `generate(relPath, content): Promise<string|null>` returning `desc:${relPath}`. Update any per-batch expectations (e.g. `gen.calls`) to per-file accordingly; the state-machine, pause/resume, save-cadence, and error-path assertions stay.

- [ ] **Step 9: Verify + commit**

Run: `npx vitest run src/node/search/` → expect green.
Run: `npx tsc --noEmit -p .` → exit 0.
Run: `npx eslint src/node/search/description-format.ts src/node/search/description-worker.ts src/node/search/worker-description-generator.ts src/node/search/spexr-search-backend-service.ts` → exit 0.

```bash
git add packages/theia-extensions/src/node/search/description-format.ts \
  packages/theia-extensions/src/node/search/description-format.test.ts \
  packages/theia-extensions/src/node/search/worker-description-generator.ts \
  packages/theia-extensions/src/node/search/worker-description-generator.test.ts \
  packages/theia-extensions/src/node/search/description-worker.ts \
  packages/theia-extensions/src/node/search/description-job.ts \
  packages/theia-extensions/src/node/search/description-job.test.ts \
  packages/theia-extensions/src/node/search/spexr-search-backend-service.ts \
  packages/theia-extensions/src/node/search/spexr-search-backend-service.test.ts
git commit -m "revert(search): per-file 0.5B descriptions for on-demand (drop batch)" # + trailer
```

---

# SLICE 2 — Claude Map engine

## Task 2: `map-token-estimator.ts` (pure)

**Files:**
- Create: `src/node/search/map-token-estimator.ts`
- Test: `src/node/search/map-token-estimator.test.ts`

**Interfaces produced:**
- `interface MapEstimate { fileCount: number; chunkCount: number; inputTokens: number; outputTokens: number }`
- `estimateMap(summaries: string[], chunkSize: number): MapEstimate`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { estimateMap } from "./map-token-estimator.js";

describe("estimateMap", () => {
  it("counts files, chunks, and char/4 input + N*20 output tokens", () => {
    const summaries = ["abcd".repeat(25), "ab".repeat(50)]; // 100 + 100 chars
    const e = estimateMap(summaries, 75);
    expect(e.fileCount).toBe(2);
    expect(e.chunkCount).toBe(1);
    expect(e.outputTokens).toBe(40);            // 2 * 20
    expect(e.inputTokens).toBeGreaterThanOrEqual(50); // ~ (200 + overhead)/4
  });

  it("splits into chunks by chunkSize", () => {
    const summaries = Array.from({ length: 160 }, () => "x");
    expect(estimateMap(summaries, 75).chunkCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run → FAIL (module not found)**

Run: `npx vitest run src/node/search/map-token-estimator.test.ts`

- [ ] **Step 3: Implement**

```ts
/** Approximate token budget for a Map run. char/4 is the usual rough heuristic. */
export interface MapEstimate {
  fileCount: number;
  chunkCount: number;
  inputTokens: number;
  outputTokens: number;
}

/** ~60 tokens of fixed instruction text per Claude call. */
const PROMPT_OVERHEAD_CHARS = 240;
/** ~20 output tokens per file description. */
const OUTPUT_TOKENS_PER_FILE = 20;

export function estimateMap(summaries: string[], chunkSize: number): MapEstimate {
  const fileCount = summaries.length;
  const chunkCount = Math.max(1, Math.ceil(fileCount / chunkSize));
  const summaryChars = summaries.reduce((n, s) => n + s.length, 0);
  const inputChars = summaryChars + chunkCount * PROMPT_OVERHEAD_CHARS;
  return {
    fileCount,
    chunkCount,
    inputTokens: Math.ceil(inputChars / 4),
    outputTokens: fileCount * OUTPUT_TOKENS_PER_FILE,
  };
}
```

- [ ] **Step 4: Run → PASS. Commit** (`feat(search): add Map token estimator`).

---

## Task 3: `claude-batch-describer.ts`

**Files:**
- Create: `src/node/search/claude-batch-describer.ts`
- Test: `src/node/search/claude-batch-describer.test.ts`

**Interfaces produced:**
- `interface DescribeItem { relPath: string; summary: string }`
- `interface ClaudeDescriber { isAvailable(): boolean; describeChunk(items: DescribeItem[]): Promise<Map<string, string>> }`
- `buildClaudePrompt(items: DescribeItem[]): string`
- `parseClaudeResult(stdout: string, paths: string[]): Map<string, string>`
- `class ClaudeCliDescriber implements ClaudeDescriber` (constructor takes an injectable spawn fn for tests; default uses `child_process.execFile`)
- `const CLAUDE_CHUNK_SIZE = 75;`

**Consumes:** `resolveClaudeExecutable` from `./claude-profile-detector.js`.

- [ ] **Step 1: Failing tests (pure parse + prompt + fake spawn)**

```ts
import { describe, expect, it } from "vitest";
import { buildClaudePrompt, parseClaudeResult, ClaudeCliDescriber } from "./claude-batch-describer.js";

describe("buildClaudePrompt", () => {
  it("lists each path with its summary and asks for JSON", () => {
    const p = buildClaudePrompt([{ relPath: "a.ts", summary: "Symbols: foo" }]);
    expect(p).toContain("a.ts");
    expect(p).toContain("foo");
    expect(p.toLowerCase()).toContain("json");
  });
});

describe("parseClaudeResult", () => {
  const paths = ["a.ts", "b.ts"];
  it("parses the envelope.result inner JSON keyed by path", () => {
    const envelope = JSON.stringify({ result: JSON.stringify({ "a.ts": "Does A.", "b.ts": "Does B." }) });
    const m = parseClaudeResult(envelope, paths);
    expect(m.get("a.ts")).toBe("Does A.");
    expect(m.get("b.ts")).toBe("Does B.");
  });
  it("tolerates prose around the JSON and ignores unknown keys", () => {
    const inner = "Here you go:\n{\"a.ts\":\"Does A.\",\"z.ts\":\"nope\"}\nthanks";
    const envelope = JSON.stringify({ result: inner });
    const m = parseClaudeResult(envelope, paths);
    expect(m.get("a.ts")).toBe("Does A.");
    expect(m.has("z.ts")).toBe(false);
  });
  it("returns empty map on error envelope or unparseable result", () => {
    expect(parseClaudeResult(JSON.stringify({ is_error: true }), paths).size).toBe(0);
    expect(parseClaudeResult("not json", paths).size).toBe(0);
  });
});

describe("ClaudeCliDescriber", () => {
  it("describeChunk runs the executable and maps the parsed result", async () => {
    const calls: { args: string[]; input: string }[] = [];
    const fakeRun = async (args: string[], input: string) => {
      calls.push({ args, input });
      return JSON.stringify({ result: JSON.stringify({ "a.ts": "Does A." }) });
    };
    const d = new ClaudeCliDescriber("/usr/bin/claude", "/root", fakeRun);
    const m = await d.describeChunk([{ relPath: "a.ts", summary: "Symbols: foo" }]);
    expect(m.get("a.ts")).toBe("Does A.");
    expect(calls[0]!.args).toEqual(["--print", "--output-format", "json", "--input-format", "text"]);
    expect(calls[0]!.input).toContain("a.ts");
  });

  it("isAvailable reflects a resolved executable", () => {
    expect(new ClaudeCliDescriber("/usr/bin/claude", "/root", async () => "").isAvailable()).toBe(true);
    expect(new ClaudeCliDescriber(undefined, "/root", async () => "").isAvailable()).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
import { execFile } from "node:child_process";
import { resolveClaudeExecutable } from "./claude-profile-detector.js";

export const CLAUDE_CHUNK_SIZE = 75;
const CALL_TIMEOUT_MS = 120_000;

export interface DescribeItem {
  relPath: string;
  summary: string;
}

export interface ClaudeDescriber {
  isAvailable(): boolean;
  /** Describe one chunk; returns path → sentence for the files Claude answered. */
  describeChunk(items: DescribeItem[]): Promise<Map<string, string>>;
}

/** Test seam: run claude with args + stdin, resolve stdout (reject on spawn error). */
export type ClaudeRunner = (args: string[], input: string) => Promise<string>;

export function buildClaudePrompt(items: DescribeItem[]): string {
  const blocks = items.map((it) => `${it.relPath}\n${it.summary}`).join("\n\n");
  return (
    `Describe what each file below does in one short sentence (max 15 words each).\n` +
    `Reply with ONLY a JSON object mapping each exact path to its description, e.g. ` +
    `{"path/a.ts":"…","path/b.ts":"…"}. Use the paths exactly as given.\n\n${blocks}`
  );
}

/** Parse the `claude --print --output-format json` envelope and its inner path→desc JSON. */
export function parseClaudeResult(stdout: string, paths: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let result: string;
  try {
    const env = JSON.parse(stdout) as { result?: string; is_error?: boolean };
    if (env.is_error || typeof env.result !== "string") return out;
    result = env.result;
  } catch {
    return out;
  }
  const start = result.indexOf("{");
  const end = result.lastIndexOf("}");
  if (start === -1 || end <= start) return out;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(result.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return out;
  }
  const wanted = new Set(paths);
  for (const [k, v] of Object.entries(obj)) {
    if (wanted.has(k) && typeof v === "string" && v.trim().length > 0) out.set(k, v.trim());
  }
  return out;
}

function defaultRunner(exe: string, cwd: string): ClaudeRunner {
  return (args, input) =>
    new Promise<string>((resolve, reject) => {
      const child = execFile(exe, args, { cwd, timeout: CALL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(stdout)));
      child.stdin?.end(input);
    });
}

export class ClaudeCliDescriber implements ClaudeDescriber {
  private readonly run: ClaudeRunner;
  constructor(
    private readonly exe: string | undefined,
    cwd: string,
    runner?: ClaudeRunner,
  ) {
    this.run = runner ?? (exe ? defaultRunner(exe, cwd) : async () => "");
  }

  static forWorkspace(cwd: string): ClaudeCliDescriber {
    const resolved = resolveClaudeExecutable();
    return new ClaudeCliDescriber(resolved && resolved !== "ambiguous" ? resolved : undefined, cwd);
  }

  isAvailable(): boolean {
    return this.exe !== undefined;
  }

  async describeChunk(items: DescribeItem[]): Promise<Map<string, string>> {
    if (items.length === 0 || !this.exe) return new Map();
    const args = ["--print", "--output-format", "json", "--input-format", "text"];
    const paths = items.map((it) => it.relPath);
    const prompt = buildClaudePrompt(items);
    let out = parseClaudeResult(await this.run(args, prompt), paths);
    if (out.size === 0) out = parseClaudeResult(await this.run(args, prompt), paths); // retry once on empty/unparseable
    return out;
  }
}
```

- [ ] **Step 4: Run → PASS. Commit** (`feat(search): add headless Claude batch describer`).

---

## Task 4: `descriptions-store.ts`

**Files:**
- Create: `src/node/search/descriptions-store.ts`
- Test: `src/node/search/descriptions-store.test.ts`

**Interfaces produced:**
- `interface StoredDescription { description: string; category: string }`
- `class DescriptionsStore { constructor(root: string); load(): Promise<void>; get(path: string): string | undefined; merge(entries: Map<string, StoredDescription>): Promise<void>; entries(): Map<string, StoredDescription> }`
- Writes/reads `<root>/.spexr/descriptions.json` (`{ [path]: { description, category } }`).

- [ ] **Step 1: Failing test**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DescriptionsStore } from "./descriptions-store.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "spexr-store-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("DescriptionsStore", () => {
  it("merges incrementally and persists JSON", async () => {
    const s = new DescriptionsStore(root);
    await s.load();
    await s.merge(new Map([["a.ts", { description: "A", category: "backend" }]]));
    await s.merge(new Map([["b.ts", { description: "B", category: "frontend" }]]));
    expect(s.get("a.ts")).toBe("A");
    const onDisk = JSON.parse(await readFile(join(root, ".spexr", "descriptions.json"), "utf8"));
    expect(Object.keys(onDisk).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("load() restores a previously written store", async () => {
    await new DescriptionsStore(root).merge.call(
      Object.assign(new DescriptionsStore(root), {}),
      new Map([["a.ts", { description: "A", category: "x" }]]),
    );
    const s2 = new DescriptionsStore(root);
    await s2.load();
    expect(s2.get("a.ts")).toBe("A");
  });

  it("get() returns undefined for unknown path", async () => {
    const s = new DescriptionsStore(root);
    await s.load();
    expect(s.get("missing.ts")).toBeUndefined();
  });
});
```

(If the second test's `merge.call` gymnastics is awkward, the implementer may simplify it to: create a store, `await s.merge(...)`, then a second store, `await s2.load()`, assert `get` — same intent.)

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

export interface StoredDescription {
  description: string;
  category: string;
}

/** Text-only per-workspace store of file descriptions, separate from the vector index. */
export class DescriptionsStore {
  private readonly map = new Map<string, StoredDescription>();
  constructor(private readonly root: string) {}

  private get path(): string { return join(this.root, ".spexr", "descriptions.json"); }

  async load(): Promise<void> {
    try {
      const obj = JSON.parse(await readFile(this.path, "utf8")) as Record<string, StoredDescription>;
      this.map.clear();
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v.description === "string") this.map.set(k, { description: v.description, category: v.category ?? "other" });
      }
    } catch { /* missing/corrupt → empty */ }
  }

  get(path: string): string | undefined {
    return this.map.get(path)?.description;
  }

  entries(): Map<string, StoredDescription> {
    return this.map;
  }

  /** Merge new entries and atomically persist the whole store (text-only, cheap). */
  async merge(entries: Map<string, StoredDescription>): Promise<void> {
    for (const [k, v] of entries) this.map.set(k, v);
    const dir = join(this.root, ".spexr");
    await mkdir(dir, { recursive: true });
    const obj: Record<string, StoredDescription> = {};
    for (const [k, v] of [...this.map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) obj[k] = v;
    const tmp = `${this.path}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
    await rename(tmp, this.path);
  }
}
```

- [ ] **Step 4: Run → PASS. Commit** (`feat(search): add descriptions store (.spexr/descriptions.json)`).

---

## Task 5: Re-point `DescriptionJob` to the Claude engine + store

> **ATOMIC with Task 6.** `DescriptionJobDeps` changes shape here and its only
> constructor lives in `getJob` (Task 6). Implement Tasks 5 and 6 together and commit
> them as ONE commit — committing Task 5 alone leaves `getJob` constructing the old
> deps shape (red build). The controller dispatches 5+6 as a single implementer.

**Files:**
- Modify: `src/node/search/description-job.ts`
- Test: `src/node/search/description-job.test.ts`

**Interfaces:**
- Consumes: `ClaudeDescriber`, `DescribeItem`, `CLAUDE_CHUNK_SIZE` (Task 3); `DescriptionsStore`, `StoredDescription` (Task 4); `buildSymbolSummary` (`description-format.js`); `IndexRecord` (`vector-index.js`); `DescriptionJobStatus` (protocol).
- Produces: new `DescriptionJobDeps` shape:

```ts
export interface DescriptionJobDeps {
  records: () => IndexRecord[];                 // live index records
  readContent: (relPath: string) => Promise<string>;
  describer: ClaudeDescriber;
  store: DescriptionsStore;
  writeMarkdown: () => Promise<void>;           // CodebaseMapWriter md, from the store
  emit: (status: DescriptionJobStatus) => void;
}
```

The loop changes from "batch of 5 via 0.5B + setAiDescription + index save" to "chunk of `CLAUDE_CHUNK_SIZE` via Claude + store.merge"; targets = records whose path is NOT already in the store (or all when `regenerate`). The pause/error/complete state machine and the try/catch resilience are unchanged. `total` = target count; `done` advances by chunk length.

- [ ] **Step 1: Update the tests first** — replace the FakeGen with a fake `ClaudeDescriber` + fake `DescriptionsStore`, asserting: missing-only targeting (skip paths already in the store), chunking, `store.merge` called per chunk, `writeMarkdown` once on completion, pause/resume, error when `describer.isAvailable()` is false. Reuse the v1 state-sequence + error-path assertions. (Full test code: mirror v1 `description-job.test.ts` structure, swapping the deps.)

- [ ] **Step 2: Run → FAIL. Step 3: Implement** the loop.

Add a field `private categoryByPath = new Map<string, string>();` and the imports `import { buildSymbolSummary } from "./description-format.js"; import { CLAUDE_CHUNK_SIZE, type DescribeItem } from "./claude-batch-describer.js"; import type { StoredDescription } from "./descriptions-store.js";`.

In `start()`, after computing targets, capture the category lookup:

```ts
const recs = this.deps.records();
this.categoryByPath = new Map(recs.map((r) => [r.path, r.category]));
this.targets = recs
  .filter((r) => opts.regenerate || this.deps.store.get(r.path) === undefined)
  .map((r) => r.path);
```

Replace the per-iteration body of the `while (this.cursor < this.targets.length)` loop (keep the pause check and the availability check at the top) with:

```ts
      if (!this.deps.describer.isAvailable()) {
        this.state = "error";
        this.message = "Claude CLI not available.";
        this.deps.emit(this.status);
        return;
      }
      const chunk = this.targets.slice(this.cursor, this.cursor + CLAUDE_CHUNK_SIZE);
      const items: DescribeItem[] = [];
      for (const relPath of chunk) {
        try {
          items.push({ relPath, summary: buildSymbolSummary(relPath, await this.deps.readContent(relPath)) });
        } catch {
          // unreadable file: skip generation but still count it (cursor advances)
        }
      }
      const descs = await this.deps.describer.describeChunk(items);
      const merge = new Map<string, StoredDescription>();
      for (const [path, description] of descs) {
        merge.set(path, { description, category: this.categoryByPath.get(path) ?? "other" });
      }
      if (merge.size > 0) await this.deps.store.merge(merge);
      this.cursor += chunk.length;
      this.done = this.cursor;
      this.deps.emit(this.status);
```

On normal completion (after the loop) call `await this.deps.writeMarkdown();` then `this.state = "complete"; this.deps.emit(this.status);`. Keep the outer try/catch resilience from v1 (any throw → `state = "error"`, set message, emit). There is no vector-index save anywhere in the job — the store is the only persistence.

- [ ] **Step 4: Run → PASS. Commit** (`feat(search): drive Map job via Claude chunks into the descriptions store`).

---

## Task 6: Protocol `getMapEstimate` + backend wiring + store-first search

> **ATOMIC with Task 5** (see note there). Same commit.

**Files:**
- Modify: `src/common/search-protocol.ts`
- Modify: `src/node/search/spexr-search-backend-service.ts`
- Test: `src/node/search/spexr-search-backend-service.test.ts`

**Interfaces produced:**
- protocol: `interface MapEstimate { fileCount; chunkCount; inputTokens; outputTokens }` (numbers); `SpexrSearchService.getMapEstimate(root: string): Promise<MapEstimate>`.

- [ ] **Step 1: Add `MapEstimate` + `getMapEstimate` to the protocol** (after `DescriptionJobStatus`). Re-export the estimator's type or redefine the four-number shape verbatim.

- [ ] **Step 2: Backend wiring (failing test first)** — test that:
  - `getMapEstimate(root)` returns `{ fileCount === index size, chunkCount, inputTokens > 0, outputTokens === fileCount*20 }` (build a 2-file index, assert).
  - search/`describeFiles` prefers a store description: pre-seed the store (`.spexr/descriptions.json`) for a path, then `describeFiles([path])` emits the store text with `done:true` and does NOT call the generator.

- [ ] **Step 3: Implement.** In the service:
  - Per-workspace `DescriptionsStore` (lazy, `await store.load()` once), and a `ClaudeCliDescriber.forWorkspace(root)`.
  - **Widen `buildCodebaseMapMarkdown`'s parameter** in `codebase-map-writer.ts` from `IndexRecord[]` to the structural subset it already reads: `Array<{ path: string; category: string; description: string; aiDescription?: string }>` (IndexRecord still satisfies it; existing tests unchanged). Add a thin `CodebaseMapWriter.writeMarkdown(rows)` that writes only `codebase-map.md` from such rows (the store already owns `descriptions.json`).
  - `getJob` now builds `DescriptionJob` with the new deps: `records: () => ws.indexer.index.allRecords()`, `readContent`, `describer`, `store`, and
    ```ts
    writeMarkdown: () => new CodebaseMapWriter(root).writeMarkdown(
      [...store.entries()].map(([path, v]) => ({ path, category: v.category, description: v.description })),
    ),
    ```
    plus `emit`.
  - `getMapEstimate(root)`: ensure index ready; build `summaries = records.filter(missing-in-store).map(r => buildSymbolSummary(r.path, await readContent))` — but reading every file for an estimate is heavy; instead estimate from the record's existing `snippet`/`description` length as a proxy, OR cap the estimate read. **Decision:** estimate input from `buildSymbolSummary` is ideal but costly; use the record's `description` + path length × a small factor as a cheap proxy is inaccurate. Use the symbol-summary only if cheap; otherwise read content for the estimate is acceptable here because it runs once on user request, not in a hot loop — but 8226 file reads block. **Chosen approach:** estimate input tokens from `path.length + (record.description?.length ?? 0) + 200` chars per file (no file reads), so `getMapEstimate` is O(records) and non-blocking. Document this as an approximation in the dialog copy.
  - `resolveOrCollect` / `describeFiles`: before the cache/static checks, if `store.get(path)` is set, `emit({ path, text: store.get(path)!, done: true })` and return — store wins (Claude > 0.5B > static).

- [ ] **Step 4: Verify (vitest + tsc) + commit** (`feat(search): map estimate RPC + store-first description priority`).

---

## Task 7: Confirmation dialog + estimate wiring (frontend)

**Files:**
- Modify: `src/browser/search/smart-search-widget.tsx`

**Interfaces:** Consumes `getMapEstimate` (Task 6) + existing `startDescriptionJob`.

- [ ] **Step 1: Replace `startMap(false)` with an estimate-then-confirm flow.** The header CTA handler calls a new method:

```ts
private startMap = async (regenerate: boolean): Promise<void> => {
  const root = this.root();
  if (!root) return;
  const est = await this.service.getMapEstimate(root);
  const ok = await new ConfirmDialog({
    title: "Map this codebase",
    msg: `Send ${est.fileCount} files to Claude in ~${est.chunkCount} calls — ` +
         `estimated ~${est.inputTokens.toLocaleString()} input + ~${est.outputTokens.toLocaleString()} output tokens. Proceed?`,
    ok: "Proceed",
    cancel: "Cancel",
  }).open();
  if (ok) void this.service.startDescriptionJob(root, { regenerate });
};
```

Import `ConfirmDialog` from `@theia/core/lib/browser`. Make the CTA `onClick={() => void this.startMap(false)}` and the regenerate `↻` `onClick={() => void this.startMap(true)}`. (Confirm the exact `ConfirmDialog` constructor/`open()` signature against the installed `@theia/core` while implementing; adjust if it differs.)

- [ ] **Step 2: Verify `npx tsc --noEmit -p .` exit 0; `npx vitest run src/node/search/` still green. Commit** (`feat(search): confirm Map with a token estimate before spending Claude tokens`).

---

## Final verification

- [ ] `npx vitest run src/node/search/` → all green.
- [ ] `npx tsc --noEmit -p .` → exit 0.
- [ ] `npx eslint` on all created/modified source files → exit 0.
- [ ] **Manual smoke (rebuild `lib` + restart app):** (1) a normal search shows per-file 0.5B descriptions (no `src/`-prefix nulls); (2) `✦ Map this codebase` opens the token-estimate dialog; on Proceed, the status bar advances `done/total` without "Offline"; (3) on completion `.spexr/descriptions.json` + `.spexr/codebase-map.md` exist with Claude descriptions; (4) re-running a search shows the Claude store description (store-first priority).
- [ ] Hand off to the human to review and decide merge.
