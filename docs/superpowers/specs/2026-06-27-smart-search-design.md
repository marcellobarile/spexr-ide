# Smart Search (natural-language workspace file search) — Design

> **What is this file:** the implementation contract (design spec) for SPEXR's
> natural-language workspace file search. **Audience:** engineers implementing
> the feature, plus PM/design reviewers. **Owner:** marcello.barile.
> **Companion files:** none yet; an implementation plan will be generated from
> this spec under `docs/superpowers/plans/`. This spec is the source of truth
> for scope and interfaces.

## Legend (delivery status terms)

- **PoC implemented (not delivered):** prototype only, not in production build.
- **Placeholder (not delivered):** stub kept for a later slice.
- **Delivered:** merged to the production codebase and available to users.

At authoring time everything below is **planned** — nothing delivered yet.

## Goal

Let a user type, in plain natural language, what kind of file they are looking
for ("where auth tokens get refreshed") and get the most relevant files of the
workspace ranked by semantic relevance — fully offline, no Claude CLI, no API
keys.

## Architecture

The backend (the Theia Node server, where `SpexrAgentService` and the git
backend already run) owns the embedding model and the vector index. The
frontend is UI only and talks to the backend over a dedicated JSON-RPC service,
separate from `SpexrAgentService` (distinct responsibility).

The frontend never sees embeddings or ONNX (Open Neural Network Exchange); it
only calls `search(query) → SearchHit[]`. The model and index stay in the
backend, out of the renderer process.

### Components

**Backend — `packages/theia-extensions/src/node/search/`**

- `EmbeddingModel` — wraps `@xenova/transformers` running the quantized
  `all-MiniLM-L6-v2` sentence-embedding model via ONNX Runtime, in-process.
  Loads the model lazily once. The model files are bundled as a local asset
  (no runtime download). Exposes `embed(texts: string[]): Promise<Float32Array[]>`.
  Output vector dimension is 384.
- `WorkspaceIndexer` — discovers indexable files (honors `.gitignore`; skips
  `node_modules`, `.git`, build output; skips binaries by extension plus a
  null-byte content sniff; skips files larger than a size cap), extracts text,
  and drives `EmbeddingModel` + `VectorIndex` to build/update the index.
- `VectorIndex` — in-memory store of records
  `{ path, vector: Float32Array, mtimeMs, hash }`, persisted to disk. Search is
  brute-force cosine similarity returning top-K above a minimum score. No
  approximate-nearest-neighbor structure (brute force is instant for typical
  workspaces under ~10k files; ANN is deferred — YAGNI).
- `SearchService` — the JSON-RPC service. Methods:
  - `search(query: string): Promise<SearchHit[]>`
  - `getIndexStatus(): Promise<IndexStatus>`
  - `reindex(): Promise<void>`

**Frontend — `packages/theia-extensions/src/browser/search/`**

- `SmartSearchService` — RPC proxy to the backend `SearchService`.
- `SmartSearchWidget` — the input + ranked-results UI, added to the Explorer
  view-container above the file-tree navigator. It does not modify Theia's
  navigator tree.

### Data types (`packages/theia-extensions/src/common/search-protocol.ts`)

```ts
export const SEARCH_SERVICE_PATH = "/services/spexr-search";

export interface SearchHit {
  /** Workspace-relative path of the matched file. */
  path: string;
  /** Cosine similarity in [0, 1]; higher is more relevant. */
  score: number;
  /** Short text excerpt for display (first chars or nearest line). */
  snippet: string;
}

export interface IndexStatus {
  state: "idle" | "indexing" | "ready" | "error";
  /** Files embedded so far. */
  indexed: number;
  /** Total files discovered for indexing. */
  total: number;
  /** Present when state === "error". */
  message?: string;
}

export interface SpexrSearchService {
  /** Build the index in the background if missing; returns immediately. */
  ensureIndexed(root: string): Promise<void>;
  search(root: string, query: string): Promise<SearchHit[]>;
  getIndexStatus(root: string): Promise<IndexStatus>;
  /** Apply incremental file changes (workspace-relative POSIX paths). */
  applyChanges(root: string, changedPaths: string[], removedPaths: string[]): Promise<void>;
  reindex(root: string): Promise<void>;
}
```

The service is **root-first** (workspace root passed explicitly) because the
index is workspace-stateful, mirroring `SpexrGitService`. RPC is wired with
`RpcConnectionHandler(SEARCH_SERVICE_PATH, () => service)` in
`spexr-backend-module.ts`, matching the existing `AGENT_SESSION_SERVICE_PATH`
and `GIT_SERVICE_PATH` pattern. The frontend proxy is created via
`WebSocketConnectionProvider.createProxy(SEARCH_SERVICE_PATH)`, like the git
proxy.

## Indexing granularity

**Slice 1:** one embedding per file, computed from the file's path/name plus the
first ~2000 characters of content. Simple, good recall for "what kind of file".

**Slice 2:** per-section chunking (multiple embeddings per file) for better
recall on long files, with better snippets.

## Index lifecycle

- **First workspace open (no index):** build in the background, non-blocking.
  Status exposed via `getIndexStatus()`.
- **Persistence:** on build completion, save to `<workspace>/.spexr/search-index.json`
  with a `version` header. On restart, reload from disk → `ready` immediately,
  then incrementally reconcile.
- **Incremental updates:** reuse `FileService.onDidFilesChange` (already used by
  the git provider). Created/modified file → re-embed (debounced ~500ms,
  batched); deleted file → removed from the index. Deduplicate via content
  `hash` + `mtimeMs`: skip if unchanged.

## Query flow (runtime)

1. User types natural language in the widget input → debounce ~250ms.
2. Frontend calls `search(query)` over RPC.
3. Backend: `embed([query])` → one vector; cosine similarity against all indexed
   vectors; take top-K (default 30) above a minimum score threshold.
4. Returns `SearchHit[]` with `path`, `score`, `snippet`.
5. Frontend renders the ranked list.

Costs/limits: the model loads lazily on first index or first query (~1–2s,
once). Slice-1 files are truncated to ~2000 characters for embedding. Binary
files and files over the size cap are skipped. Everything runs offline with no
API key and no Claude CLI.

## UI

`SmartSearchWidget` is a dedicated section in the Explorer view-container, above
the navigator tree, in native Theia styling with a subtle SPEXR accent.

States:

- **Empty query:** input only, plus an index-status hint (`Indexing… 142/3201`
  or `Ready`).
- **Active query:** input plus a ranked results list. Each row: file-type icon +
  file name, dimmed relative path, a thin score bar/percentage, and a snippet on
  a second line.
- **No results:** empty state.
- **Click a result:** open the file in the editor and reveal it in the tree.

Interaction: 250ms debounce while typing; `Esc` clears; `Enter`/arrow keys
navigate and open results. During indexing the search stays usable over what is
already indexed, with a status badge.

```
┌─ EXPLORER ───────────────────────────┐
│ ⌕  "where auth tokens get refreshed"  │   ← NL input
│ ───────────────────────────────────── │
│ ▸ Results (4)              Ready ●     │
│  token-refresh.ts          ▓▓▓▓  92%   │
│     src/auth/  · "...renew JWT before" │
│  session-store.ts          ▓▓▓░  74%   │
│     src/auth/  · "...persist refresh"  │
│  auth.guard.ts             ▓▓░░  61%   │
│ ───────────────────────────────────── │
│ ▾ <file tree navigator, unchanged>    │   ← tree below, untouched
│   ▾ src/                               │
└────────────────────────────────────────┘
```

## Error handling (degrade, never break the IDE)

- ONNX model fails to load → search disabled with a message; rest of the IDE
  intact (`IndexStatus.state = "error"`).
- Corrupt or stale on-disk index (version mismatch) → discard and rebuild.
- Unreadable / undetected-binary file → silent skip, debug-level log.
- `embed()` failure on a query → error toast; input stays usable.
- Workspace with no root → widget shows an empty state; no RPC issued.

## Testing

- `VectorIndex` — unit: cosine top-K ordering, threshold, add/update/remove,
  dedup by `hash` + `mtimeMs`. Uses synthetic vectors, no real model.
- `WorkspaceIndexer` — unit: `.gitignore`/skip-list/size-cap/binary-sniff
  behavior over a temp-dir fixture.
- `EmbeddingModel` — one integration test that loads the real model and checks
  vector dimension (384) and determinism; marked slow/opt-in (runs separately).
- `SearchService` (RPC) — happy path plus degradations (model down, no root).
- `SmartSearchWidget` — debounce, state rendering (indexing/ready/empty/results),
  click→open. Light DOM tests if local conventions support them.

## Delivery slices

- **Slice 1:** full backend (`EmbeddingModel` + `WorkspaceIndexer` +
  `VectorIndex` + `SearchService`), per-file indexing, base UI with ranked
  results. Independently shippable and usable.
- **Slice 2:** per-section chunking (recall on long files), better snippets,
  threshold tuning.

## Out of scope

- Approximate-nearest-neighbor index (brute force is sufficient at target
  scale).
- Cross-workspace / global search.
- Reranking via the Claude CLI or any remote LLM.
- Embedding via Ollama or a remote embeddings API (explicitly rejected during
  design in favor of the in-process model).
