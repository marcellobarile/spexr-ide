# Smart Search (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add natural-language file search to SPEXR's Explorer — type plain language, get the workspace's most semantically relevant files ranked — fully offline.

**Architecture:** A backend (Theia Node server) owns an in-process ONNX embedding model and a per-workspace in-memory vector index persisted to disk; it exposes a JSON-RPC service. The frontend is a widget added above the file-tree navigator that calls `search(root, query)` and renders ranked results. The frontend listens to file changes and forwards them to the backend for incremental re-indexing.

**Tech Stack:** TypeScript (ESM, TS 6.0.3), Theia 1.71, Inversify DI, Vitest, `@xenova/transformers` (ONNX `all-MiniLM-L6-v2`, 384-dim), `ignore` (.gitignore matching), React 18 (widget).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-27-smart-search-design.md`. This plan implements **Slice 1** only (per-file granularity); Slice 2 (chunking) is out of scope.
- **ESM module rules:** all relative imports end in `.js`; type-only imports use `import type`; new files follow the existing `src/{common,node,browser}` layout.
- **Embedding model:** quantized `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers`, run in-process in the backend, **offline** (`env.allowRemoteModels = false`). Output vector dimension is **384**.
- **No network, no API key, no Claude CLI** anywhere in this feature.
- **RPC pattern:** register with `RpcConnectionHandler(SEARCH_SERVICE_PATH, () => service)` in `spexr-backend-module.ts`; frontend proxy via `WebSocketConnectionProvider.createProxy(SEARCH_SERVICE_PATH)`. Service methods are **root-first** (e.g. `search(root, query)`), matching the existing `SpexrGitService`. *(Refinement over the spec's `search(query)`: the service is workspace-stateful, so the workspace root is passed explicitly like the git service does.)*
- **Index location:** `<workspace>/.spexr/search-index.json`, with an integer `version` header; on version mismatch or parse failure, discard and rebuild.
- **Indexing limits:** skip `node_modules`, `.git`, `.spexr`, `dist`, `lib`, `build`, `out`, `.turbo`; honor `.gitignore`; skip files over **1,000,000 bytes**; skip files whose first 8000 bytes contain a NUL byte; skip known-binary extensions. Embedding input per file = workspace-relative path + first **2000** characters of content.
- **Search defaults:** top-K = **30**, minimum cosine score = **0.2**.
- **Test runner:** `pnpm --filter @spexr/theia-extensions test` (Vitest). Lint: `pnpm --filter @spexr/theia-extensions lint`. Typecheck: `pnpm --filter @spexr/theia-extensions typecheck`. Run all three from the repo root unless a task says otherwise. The package dir is `packages/theia-extensions`.
- **Commit style:** Conventional Commits, English. End commit messages with the `Co-Authored-By` trailer the repo uses. Do not push.

All paths below are relative to `packages/theia-extensions/` unless absolute.

---

## File Structure

**Common (shared frontend/backend):**
- `src/common/search-protocol.ts` — RPC path, DTOs, `SpexrSearchService` interface.

**Backend (`src/node/search/`):**
- `vector-math.ts` — pure cosine similarity + top-K selection.
- `vector-index.ts` — `VectorIndex`: upsert/remove/search/serialize/deserialize.
- `file-filter.ts` — discovery filters: skip-dirs, binary sniff, extension skip, `.gitignore` matcher.
- `embedding-model.ts` — `Embedder` interface + `TransformersEmbedder` (ONNX, offline).
- `workspace-indexer.ts` — `WorkspaceIndexer`: discover → read → embed → index; persist/load; incremental update/remove.
- `spexr-search-backend-service.ts` — `SpexrSearchBackendService` implementing the RPC interface; per-root indexer registry + status.

**Backend wiring:**
- `src/node/spexr-backend-module.ts` — bind service + `Embedder` + RPC handler (modify).

**Frontend (`src/browser/search/`):**
- `smart-search-service.ts` — proxy symbol re-export.
- `smart-search-format.ts` — pure UI helpers (score %, status label, debounce).
- `smart-search-widget.tsx` — React widget (input + results + status).
- `smart-search-contribution.ts` — `FrontendApplicationContribution`: widget factory, placement above navigator, initial index + file-change forwarding.

**Frontend wiring:**
- `src/browser/spexr-frontend-module.ts` — bind widget/factory/proxy/contribution (modify).

**Packaging:**
- `apps/desktop/electron-builder.yml` — ship model files as resources (modify).

---

### Task 1: Vector math (pure)

**Files:**
- Create: `src/node/search/vector-math.ts`
- Test: `src/node/search/vector-math.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `cosineSimilarity(a: Float32Array, b: Float32Array): number`
  - `topKIndices(scores: number[], k: number, minScore: number): number[]` — indices of the highest scores ≥ `minScore`, descending, at most `k`.

- [ ] **Step 1: Write the failing test**

```ts
// src/node/search/vector-math.test.ts
import { describe, expect, it } from "vitest";
import { cosineSimilarity, topKIndices } from "./vector-math.js";

describe("cosineSimilarity", () => {
  it("is 1 for identical direction", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([2, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });

  it("is 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  it("returns 0 when either vector is zero-length", () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });
});

describe("topKIndices", () => {
  it("returns indices of the top scores in descending order", () => {
    expect(topKIndices([0.1, 0.9, 0.5, 0.7], 2, 0)).toEqual([1, 3]);
  });

  it("drops scores below minScore", () => {
    expect(topKIndices([0.1, 0.9, 0.15], 5, 0.2)).toEqual([1]);
  });

  it("never returns more than k", () => {
    expect(topKIndices([0.9, 0.8, 0.7], 2, 0)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions test vector-math`
Expected: FAIL — cannot resolve `./vector-math.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/node/search/vector-math.ts

/** Cosine similarity of two equal-length vectors; 0 if either is zero-length. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Indices of the highest `scores`, descending, keeping only those `>= minScore`
 * and at most `k` of them.
 */
export function topKIndices(scores: number[], k: number, minScore: number): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .filter((s) => s.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map((s) => s.index);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions test vector-math`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/search/vector-math.ts packages/theia-extensions/src/node/search/vector-math.test.ts
git commit -m "feat(search): add vector math primitives"
```

---

### Task 2: Vector index

**Files:**
- Create: `src/node/search/vector-index.ts`
- Test: `src/node/search/vector-index.test.ts`

**Interfaces:**
- Consumes: `cosineSimilarity`, `topKIndices` from `vector-math.js`.
- Produces:
  - `INDEX_VERSION = 1`
  - `interface IndexRecord { path: string; vector: Float32Array; mtimeMs: number; hash: string; snippet: string }`
  - `interface IndexHit { path: string; score: number; snippet: string }`
  - `class VectorIndex` with: `upsert(record: IndexRecord): void`, `remove(path: string): void`, `has(path: string, hash: string): boolean`, `get size(): number`, `search(queryVector: Float32Array, k: number, minScore: number): IndexHit[]`, `toJSON(): SerializedIndex`, `static fromJSON(data: unknown): VectorIndex`.
  - `interface SerializedIndex { version: number; records: SerializedRecord[] }` where `SerializedRecord = { path: string; vector: number[]; mtimeMs: number; hash: string; snippet: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/node/search/vector-index.test.ts
import { describe, expect, it } from "vitest";
import { VectorIndex, INDEX_VERSION, type IndexRecord } from "./vector-index.js";

function rec(path: string, vector: number[], hash = "h"): IndexRecord {
  return { path, vector: new Float32Array(vector), mtimeMs: 1, hash, snippet: path };
}

describe("VectorIndex", () => {
  it("ranks the nearest vectors first", () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a", [1, 0]));
    idx.upsert(rec("b", [0, 1]));
    idx.upsert(rec("c", [0.9, 0.1]));
    const hits = idx.search(new Float32Array([1, 0]), 2, 0);
    expect(hits.map((h) => h.path)).toEqual(["a", "c"]);
    expect(hits[0]!.snippet).toBe("a");
  });

  it("applies the minScore threshold", () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a", [1, 0]));
    idx.upsert(rec("b", [0, 1]));
    expect(idx.search(new Float32Array([1, 0]), 10, 0.5).map((h) => h.path)).toEqual(["a"]);
  });

  it("upsert replaces a record with the same path", () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a", [1, 0]));
    idx.upsert(rec("a", [0, 1]));
    expect(idx.size).toBe(1);
  });

  it("remove deletes a record", () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a", [1, 0]));
    idx.remove("a");
    expect(idx.size).toBe(0);
  });

  it("has() matches on path and hash for dedup", () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a", [1, 0], "h1"));
    expect(idx.has("a", "h1")).toBe(true);
    expect(idx.has("a", "h2")).toBe(false);
    expect(idx.has("b", "h1")).toBe(false);
  });

  it("round-trips through JSON", () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a", [1, 0]));
    const restored = VectorIndex.fromJSON(JSON.parse(JSON.stringify(idx.toJSON())));
    expect(restored.size).toBe(1);
    expect(restored.search(new Float32Array([1, 0]), 1, 0)[0]!.path).toBe("a");
  });

  it("fromJSON returns an empty index on a version mismatch", () => {
    const stale = { version: INDEX_VERSION + 1, records: [{ path: "a", vector: [1, 0], mtimeMs: 1, hash: "h", snippet: "a" }] };
    expect(VectorIndex.fromJSON(stale).size).toBe(0);
  });

  it("fromJSON returns an empty index on malformed data", () => {
    expect(VectorIndex.fromJSON(null).size).toBe(0);
    expect(VectorIndex.fromJSON({ version: INDEX_VERSION }).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions test vector-index`
Expected: FAIL — cannot resolve `./vector-index.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/node/search/vector-index.ts
import { cosineSimilarity, topKIndices } from "./vector-math.js";

export const INDEX_VERSION = 1;

export interface IndexRecord {
  path: string;
  vector: Float32Array;
  mtimeMs: number;
  hash: string;
  snippet: string;
}

export interface IndexHit {
  path: string;
  score: number;
  snippet: string;
}

interface SerializedRecord {
  path: string;
  vector: number[];
  mtimeMs: number;
  hash: string;
  snippet: string;
}

export interface SerializedIndex {
  version: number;
  records: SerializedRecord[];
}

/** In-memory vector store with brute-force cosine search and JSON persistence. */
export class VectorIndex {
  private readonly records = new Map<string, IndexRecord>();

  get size(): number {
    return this.records.size;
  }

  upsert(record: IndexRecord): void {
    this.records.set(record.path, record);
  }

  remove(path: string): void {
    this.records.delete(path);
  }

  has(path: string, hash: string): boolean {
    return this.records.get(path)?.hash === hash;
  }

  search(queryVector: Float32Array, k: number, minScore: number): IndexHit[] {
    const records = [...this.records.values()];
    const scores = records.map((r) => cosineSimilarity(queryVector, r.vector));
    return topKIndices(scores, k, minScore).map((i) => ({
      path: records[i]!.path,
      score: scores[i]!,
      snippet: records[i]!.snippet,
    }));
  }

  toJSON(): SerializedIndex {
    return {
      version: INDEX_VERSION,
      records: [...this.records.values()].map((r) => ({
        path: r.path,
        vector: Array.from(r.vector),
        mtimeMs: r.mtimeMs,
        hash: r.hash,
        snippet: r.snippet,
      })),
    };
  }

  /** Rebuild from serialized data; returns an empty index if version/shape is invalid. */
  static fromJSON(data: unknown): VectorIndex {
    const index = new VectorIndex();
    if (
      !data ||
      typeof data !== "object" ||
      (data as SerializedIndex).version !== INDEX_VERSION ||
      !Array.isArray((data as SerializedIndex).records)
    ) {
      return index;
    }
    for (const r of (data as SerializedIndex).records) {
      index.upsert({
        path: r.path,
        vector: new Float32Array(r.vector),
        mtimeMs: r.mtimeMs,
        hash: r.hash,
        snippet: r.snippet,
      });
    }
    return index;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions test vector-index`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/search/vector-index.ts packages/theia-extensions/src/node/search/vector-index.test.ts
git commit -m "feat(search): add persistent vector index"
```

---

### Task 3: File-discovery filters

**Files:**
- Create: `src/node/search/file-filter.ts`
- Test: `src/node/search/file-filter.test.ts`
- Modify: `package.json` (add `ignore` dependency)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ALWAYS_SKIP_DIRS: ReadonlySet<string>`
  - `DEFAULT_MAX_BYTES = 1_000_000`
  - `isSkippedExtension(filePath: string): boolean`
  - `isBinaryBuffer(buf: Buffer): boolean`
  - `createIgnoreFilter(gitignoreText: string): (relPath: string) => boolean` — returns a predicate that is `true` when the path is ignored.

- [ ] **Step 1: Add the `ignore` dependency**

Run from the repo root:
```bash
pnpm --filter @spexr/theia-extensions add ignore@^7.0.0
```
Expected: `ignore` appears under `dependencies` in `packages/theia-extensions/package.json`.

- [ ] **Step 2: Write the failing test**

```ts
// src/node/search/file-filter.test.ts
import { describe, expect, it } from "vitest";
import {
  ALWAYS_SKIP_DIRS,
  isSkippedExtension,
  isBinaryBuffer,
  createIgnoreFilter,
} from "./file-filter.js";

describe("ALWAYS_SKIP_DIRS", () => {
  it("includes the heavy directories", () => {
    for (const dir of ["node_modules", ".git", ".spexr", "dist", "lib", "build", "out", ".turbo"]) {
      expect(ALWAYS_SKIP_DIRS.has(dir)).toBe(true);
    }
  });
});

describe("isSkippedExtension", () => {
  it("skips known binary extensions", () => {
    expect(isSkippedExtension("a/b/logo.png")).toBe(true);
    expect(isSkippedExtension("x.WOFF2")).toBe(true);
  });
  it("keeps text/code files", () => {
    expect(isSkippedExtension("src/index.ts")).toBe(false);
    expect(isSkippedExtension("README.md")).toBe(false);
  });
});

describe("isBinaryBuffer", () => {
  it("detects a NUL byte as binary", () => {
    expect(isBinaryBuffer(Buffer.from([104, 105, 0, 121]))).toBe(true);
  });
  it("treats NUL-free content as text", () => {
    expect(isBinaryBuffer(Buffer.from("plain text"))).toBe(false);
  });
});

describe("createIgnoreFilter", () => {
  it("matches .gitignore patterns", () => {
    const ignored = createIgnoreFilter("dist/\n*.log\n");
    expect(ignored("dist/app.js")).toBe(true);
    expect(ignored("server.log")).toBe(true);
    expect(ignored("src/index.ts")).toBe(false);
  });
  it("never ignores when the gitignore is empty", () => {
    const ignored = createIgnoreFilter("");
    expect(ignored("anything.ts")).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions test file-filter`
Expected: FAIL — cannot resolve `./file-filter.js`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/node/search/file-filter.ts
import ignore from "ignore";

/** Directories never walked during indexing. */
export const ALWAYS_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".spexr",
  "dist",
  "lib",
  "build",
  "out",
  ".turbo",
]);

export const DEFAULT_MAX_BYTES = 1_000_000;

const SKIPPED_EXTENSIONS: ReadonlySet<string> = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg",
  "woff", "woff2", "ttf", "otf", "eot",
  "pdf", "zip", "gz", "tar", "rar", "7z",
  "mp3", "mp4", "mov", "avi", "wav", "ogg", "webm",
  "exe", "dll", "dylib", "so", "node", "wasm", "onnx", "bin",
  "class", "jar", "lock", "map",
]);

/** True when the file's extension is a known non-text/binary type. */
export function isSkippedExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return false;
  return SKIPPED_EXTENSIONS.has(filePath.slice(dot + 1).toLowerCase());
}

/** True when the first 8000 bytes contain a NUL byte (heuristic for binary). */
export function isBinaryBuffer(buf: Buffer): boolean {
  const end = Math.min(buf.length, 8000);
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Build a predicate that reports whether a workspace-relative path is excluded
 * by the given `.gitignore` contents. Empty input ignores nothing.
 */
export function createIgnoreFilter(gitignoreText: string): (relPath: string) => boolean {
  const matcher = ignore().add(gitignoreText);
  return (relPath: string) => relPath.length > 0 && matcher.ignores(relPath);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions test file-filter`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/theia-extensions/src/node/search/file-filter.ts packages/theia-extensions/src/node/search/file-filter.test.ts packages/theia-extensions/package.json
git commit -m "feat(search): add file-discovery filters"
```

---

### Task 4: Embedding model (ONNX, offline) + vendored weights

**Files:**
- Create: `src/node/search/embedding-model.ts`
- Test: `src/node/search/embedding-model.integration.test.ts`
- Create: `resources/models/.gitignore` (vendoring marker, see Step 2)
- Modify: `package.json` (add `@xenova/transformers` dependency + a `fetch-model` script)
- Create: `scripts/fetch-search-model.mjs`

**Interfaces:**
- Consumes: nothing (uses `@xenova/transformers`).
- Produces:
  - `EMBEDDING_DIM = 384`
  - `MODEL_ID = "Xenova/all-MiniLM-L6-v2"`
  - `interface Embedder { embed(texts: string[]): Promise<Float32Array[]> }`
  - `class TransformersEmbedder implements Embedder` — lazy-loads the pipeline, configures offline mode, and resolves the local model directory from `SPEXR_MODELS_DIR` (falling back to `<package>/resources/models`).

- [ ] **Step 1: Add the dependency**

Run from the repo root:
```bash
pnpm --filter @spexr/theia-extensions add @xenova/transformers@^2.17.2
```
Expected: `@xenova/transformers` under `dependencies`. (This transitively installs `onnxruntime-node`, whose native `.node` binaries are already covered by the existing `asarUnpack` glob `node_modules/**/*.{node,...}`.)

- [ ] **Step 2: Add the model-fetch script and vendoring marker**

Create `packages/theia-extensions/resources/models/.gitignore`:
```gitignore
# Vendored ONNX model weights are fetched at build time, not committed.
*
!.gitignore
```

Create `packages/theia-extensions/scripts/fetch-search-model.mjs`:
```js
// Downloads the quantized all-MiniLM-L6-v2 model into resources/models so the
// app can run feature-extraction fully offline. Run once before packaging:
//   node scripts/fetch-search-model.mjs
import { env, pipeline } from "@xenova/transformers";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const modelsDir = resolve(here, "..", "resources", "models");

env.allowRemoteModels = true;
env.cacheDir = modelsDir; // store the downloaded files here

const id = "Xenova/all-MiniLM-L6-v2";
console.log(`Fetching ${id} into ${modelsDir} ...`);
await pipeline("feature-extraction", id, { quantized: true });
console.log("Done.");
```

Add to `packages/theia-extensions/package.json` `scripts`:
```json
"fetch-model": "node scripts/fetch-search-model.mjs"
```

Run from the repo root:
```bash
pnpm --filter @spexr/theia-extensions fetch-model
```
Expected: model files appear under `packages/theia-extensions/resources/models/Xenova/all-MiniLM-L6-v2/`.

- [ ] **Step 3: Write the failing (opt-in) integration test**

```ts
// src/node/search/embedding-model.integration.test.ts
import { describe, expect, it } from "vitest";
import { TransformersEmbedder, EMBEDDING_DIM } from "./embedding-model.js";

// Loads the real ONNX model; slow and requires the vendored weights.
// Run explicitly: pnpm --filter @spexr/theia-extensions test embedding-model.integration
describe("TransformersEmbedder (integration)", () => {
  it("produces deterministic 384-dim vectors", async () => {
    const embedder = new TransformersEmbedder();
    const [a, b] = await embedder.embed(["refresh the auth token", "refresh the auth token"]);
    expect(a).toHaveLength(EMBEDDING_DIM);
    expect(Array.from(a!)).toEqual(Array.from(b!));
  }, 60_000);

  it("places related text closer than unrelated text", async () => {
    const embedder = new TransformersEmbedder();
    const [q, near, far] = await embedder.embed([
      "where auth tokens get refreshed",
      "renew the JWT before it expires",
      "render a pie chart of sales",
    ]);
    const dot = (x: Float32Array, y: Float32Array) =>
      x.reduce((sum, v, i) => sum + v * y[i]!, 0);
    expect(dot(q!, near!)).toBeGreaterThan(dot(q!, far!));
  }, 60_000);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions test embedding-model.integration`
Expected: FAIL — cannot resolve `./embedding-model.js`.

- [ ] **Step 5: Write the implementation**

```ts
// src/node/search/embedding-model.ts
import { env, pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EMBEDDING_DIM = 384;
export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/** Produces sentence embeddings for a batch of texts. */
export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** Directory holding the vendored model: env override, else <package>/resources/models. */
function resolveModelsDir(): string {
  if (process.env.SPEXR_MODELS_DIR) return process.env.SPEXR_MODELS_DIR;
  // this file is compiled to lib/node/search/embedding-model.js → ../../../resources/models
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..", "resources", "models");
}

/**
 * In-process ONNX embedder over `all-MiniLM-L6-v2`, configured for offline use.
 * The pipeline is loaded lazily on first `embed` and reused afterwards.
 */
export class TransformersEmbedder implements Embedder {
  private pipelinePromise?: Promise<FeatureExtractionPipeline>;

  private getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      env.allowRemoteModels = false;
      env.localModelPath = resolveModelsDir();
      this.pipelinePromise = pipeline("feature-extraction", MODEL_ID, {
        quantized: true,
      });
    }
    return this.pipelinePromise;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const extractor = await this.getPipeline();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const rows = output.tolist() as number[][];
    return rows.map((row) => Float32Array.from(row));
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions test embedding-model.integration`
Expected: PASS (2 tests). If the model weights are missing, re-run Step 2's `fetch-model`.

- [ ] **Step 7: Commit**

```bash
git add packages/theia-extensions/src/node/search/embedding-model.ts \
        packages/theia-extensions/src/node/search/embedding-model.integration.test.ts \
        packages/theia-extensions/resources/models/.gitignore \
        packages/theia-extensions/scripts/fetch-search-model.mjs \
        packages/theia-extensions/package.json
git commit -m "feat(search): add offline ONNX embedding model"
```

---

### Task 5: Workspace indexer

**Files:**
- Create: `src/node/search/workspace-indexer.ts`
- Test: `src/node/search/workspace-indexer.test.ts`

**Interfaces:**
- Consumes: `Embedder` (`embedding-model.js`), `VectorIndex`/`IndexRecord` (`vector-index.js`), filters (`file-filter.js`).
- Produces:
  - `buildEmbeddingInput(relPath: string, content: string): string` — exported pure helper (path + first 2000 chars).
  - `buildSnippet(content: string): string` — exported pure helper (first non-empty line, ≤160 chars).
  - `class WorkspaceIndexer` with:
    - `constructor(root: string, embedder: Embedder)`
    - `readonly index: VectorIndex`
    - `buildAll(onProgress?: (indexed: number, total: number) => void): Promise<void>`
    - `updateFile(relPath: string): Promise<void>`
    - `removeFile(relPath: string): void`
    - `load(): Promise<boolean>` — load persisted index from `<root>/.spexr/search-index.json`; `true` if loaded.
    - `save(): Promise<void>`
    - `discover(): Promise<string[]>` — workspace-relative paths to index.

- [ ] **Step 1: Write the failing test**

```ts
// src/node/search/workspace-indexer.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceIndexer, buildEmbeddingInput, buildSnippet } from "./workspace-indexer.js";
import type { Embedder } from "./embedding-model.js";

// Deterministic fake: vector = [length-of-text, count-of-letter-a], padded.
class FakeEmbedder implements Embedder {
  calls: string[][] = [];
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls.push(texts);
    return texts.map((t) => new Float32Array([t.length, (t.match(/a/g) ?? []).length]));
  }
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "spexr-idx-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("pure helpers", () => {
  it("buildEmbeddingInput prefixes the path and truncates content to 2000 chars", () => {
    const out = buildEmbeddingInput("src/a.ts", "x".repeat(5000));
    expect(out.startsWith("src/a.ts\n")).toBe(true);
    expect(out.length).toBe("src/a.ts\n".length + 2000);
  });
  it("buildSnippet returns the first non-empty line, capped at 160 chars", () => {
    expect(buildSnippet("\n\n  hello world  \nsecond")).toBe("hello world");
    expect(buildSnippet("y".repeat(200))).toHaveLength(160);
  });
});

describe("WorkspaceIndexer", () => {
  it("indexes text files and skips heavy dirs, binaries, and gitignored files", async () => {
    await writeFile(join(root, "keep.ts"), "export const a = 1;");
    await writeFile(join(root, ".gitignore"), "ignored.ts\n");
    await writeFile(join(root, "ignored.ts"), "nope");
    await writeFile(join(root, "bin.dat"), Buffer.from([1, 0, 2]));
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "node_modules", "dep.ts"), "skip me");

    const embedder = new FakeEmbedder();
    const indexer = new WorkspaceIndexer(root, embedder);
    const discovered = await indexer.discover();
    expect(discovered.sort()).toEqual(["keep.ts"]);

    await indexer.buildAll();
    expect(indexer.index.size).toBe(1);
  });

  it("persists and reloads the index", async () => {
    await writeFile(join(root, "a.ts"), "alpha");
    const indexer = new WorkspaceIndexer(root, new FakeEmbedder());
    await indexer.buildAll();
    await indexer.save();

    const reloaded = new WorkspaceIndexer(root, new FakeEmbedder());
    expect(await reloaded.load()).toBe(true);
    expect(reloaded.index.size).toBe(1);
  });

  it("updateFile re-embeds and removeFile drops the record", async () => {
    const indexer = new WorkspaceIndexer(root, new FakeEmbedder());
    await writeFile(join(root, "a.ts"), "alpha");
    await indexer.updateFile("a.ts");
    expect(indexer.index.size).toBe(1);
    indexer.removeFile("a.ts");
    expect(indexer.index.size).toBe(0);
  });

  it("updateFile skips re-embedding unchanged content (dedup by hash)", async () => {
    const indexer = new WorkspaceIndexer(root, new FakeEmbedder() as FakeEmbedder);
    const embedder = (indexer as unknown as { embedder: FakeEmbedder }).embedder;
    await writeFile(join(root, "a.ts"), "alpha");
    await indexer.updateFile("a.ts");
    await indexer.updateFile("a.ts");
    expect(embedder.calls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions test workspace-indexer`
Expected: FAIL — cannot resolve `./workspace-indexer.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/node/search/workspace-indexer.ts
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Embedder } from "./embedding-model.js";
import { VectorIndex } from "./vector-index.js";
import {
  ALWAYS_SKIP_DIRS,
  DEFAULT_MAX_BYTES,
  createIgnoreFilter,
  isBinaryBuffer,
  isSkippedExtension,
} from "./file-filter.js";

const MAX_CONTENT_CHARS = 2000;
const MAX_SNIPPET_CHARS = 160;
const INDEX_DIR = ".spexr";
const INDEX_FILE = "search-index.json";

/** Embedding input for a file: its path followed by a content prefix. */
export function buildEmbeddingInput(relPath: string, content: string): string {
  return `${relPath}\n${content.slice(0, MAX_CONTENT_CHARS)}`;
}

/** Display snippet: first non-empty line, trimmed and capped. */
export function buildSnippet(content: string): string {
  const line = content.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.slice(0, MAX_SNIPPET_CHARS);
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/** Builds and maintains the vector index for one workspace root. */
export class WorkspaceIndexer {
  readonly index = new VectorIndex();
  private readonly embedder: Embedder;

  constructor(private readonly root: string, embedder: Embedder) {
    this.embedder = embedder;
  }

  private get indexPath(): string {
    return join(this.root, INDEX_DIR, INDEX_FILE);
  }

  /** Workspace-relative (POSIX) paths eligible for indexing. */
  async discover(): Promise<string[]> {
    let ignored: (relPath: string) => boolean = () => false;
    try {
      ignored = createIgnoreFilter(await readFile(join(this.root, ".gitignore"), "utf8"));
    } catch {
      // no .gitignore — ignore nothing
    }
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = join(dir, entry.name);
        const rel = toPosix(relative(this.root, abs));
        if (entry.isDirectory()) {
          if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
          if (ignored(`${rel}/`)) continue;
          await walk(abs);
        } else if (entry.isFile()) {
          if (isSkippedExtension(rel) || ignored(rel)) continue;
          out.push(rel);
        }
      }
    };
    await walk(this.root);
    return out;
  }

  /** Full rebuild of the index from scratch. */
  async buildAll(onProgress?: (indexed: number, total: number) => void): Promise<void> {
    const paths = await this.discover();
    let done = 0;
    for (const rel of paths) {
      await this.updateFile(rel);
      onProgress?.(++done, paths.length);
    }
  }

  /** (Re)embed a single workspace-relative file, skipping unchanged content. */
  async updateFile(relPath: string): Promise<void> {
    const abs = join(this.root, relPath);
    let info;
    try {
      info = await stat(abs);
    } catch {
      this.index.remove(relPath);
      return;
    }
    if (!info.isFile() || info.size > DEFAULT_MAX_BYTES || isSkippedExtension(relPath)) {
      this.index.remove(relPath);
      return;
    }
    const buf = await readFile(abs);
    if (isBinaryBuffer(buf)) {
      this.index.remove(relPath);
      return;
    }
    const content = buf.toString("utf8");
    const hash = createHash("sha1").update(content).digest("hex");
    if (this.index.has(relPath, hash)) return;
    const [vector] = await this.embedder.embed([buildEmbeddingInput(relPath, content)]);
    this.index.upsert({
      path: relPath,
      vector: vector!,
      mtimeMs: info.mtimeMs,
      hash,
      snippet: buildSnippet(content),
    });
  }

  removeFile(relPath: string): void {
    this.index.remove(relPath);
  }

  /** Load a persisted index; returns false if absent or unreadable. */
  async load(): Promise<boolean> {
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const restored = VectorIndex.fromJSON(JSON.parse(raw));
      if (restored.size === 0) return false;
      for (const hit of restored.search(new Float32Array(0), 0, 0)) void hit; // no-op keep types
      // copy records over
      Object.assign(this.index, restored);
      return true;
    } catch {
      return false;
    }
  }

  async save(): Promise<void> {
    await mkdir(join(this.root, INDEX_DIR), { recursive: true });
    await writeFile(this.indexPath, JSON.stringify(this.index.toJSON()), "utf8");
  }
}
```

> **Implementer note:** `VectorIndex` keeps its records in a private field, so the `Object.assign(this.index, restored)` shortcut in `load()` copies that private map by reference. If TypeScript's `private` visibility blocks the assign, instead add a `VectorIndex.prototype.replaceWith(other: VectorIndex)` method (copying `other`'s records into `this`) in Task 2 and call it here. Prefer the explicit method — update Task 2's interface block and tests accordingly if you take that path. The behavior the test pins (`reloaded.index.size === 1`) is what must hold.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions test workspace-indexer`
Expected: PASS (6 tests). If `load()` fails the size assertion, implement the `replaceWith` method per the implementer note and re-run.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/search/workspace-indexer.ts packages/theia-extensions/src/node/search/workspace-indexer.test.ts packages/theia-extensions/src/node/search/vector-index.ts packages/theia-extensions/src/node/search/vector-index.test.ts
git commit -m "feat(search): add workspace indexer"
```

---

### Task 6: Protocol + backend RPC service + wiring

**Files:**
- Create: `src/common/search-protocol.ts`
- Create: `src/node/search/spexr-search-backend-service.ts`
- Test: `src/node/search/spexr-search-backend-service.test.ts`
- Modify: `src/node/spexr-backend-module.ts`

**Interfaces:**
- Consumes: `WorkspaceIndexer` (`workspace-indexer.js`), `Embedder`/`TransformersEmbedder` (`embedding-model.js`).
- Produces (`search-protocol.ts`):
  - `SEARCH_SERVICE_PATH = "/services/spexr-search"`
  - `interface SearchHit { path: string; score: number; snippet: string }`
  - `interface IndexStatus { state: "idle" | "indexing" | "ready" | "error"; indexed: number; total: number; message?: string }`
  - `interface SpexrSearchService { ensureIndexed(root): Promise<void>; search(root, query): Promise<SearchHit[]>; getIndexStatus(root): Promise<IndexStatus>; applyChanges(root, changedPaths: string[], removedPaths: string[]): Promise<void>; reindex(root): Promise<void> }`
  - `const Embedder: symbol` DI token (re-exported alongside the interface from `embedding-model.js`; add `export const EmbedderToken = Symbol("Embedder")` to `embedding-model.ts` in this task).
- Produces (`spexr-search-backend-service.ts`): `class SpexrSearchBackendService implements SpexrSearchService`.

- [ ] **Step 1: Add the DI token to the embedding module**

Append to `src/node/search/embedding-model.ts`:
```ts
/** Inversify token for the {@link Embedder} implementation. */
export const EmbedderToken = Symbol("Embedder");
```

- [ ] **Step 2: Create the protocol**

```ts
// src/common/search-protocol.ts
export const SEARCH_SERVICE_PATH = "/services/spexr-search";

/** One ranked search result. */
export interface SearchHit {
  /** Workspace-relative POSIX path of the matched file. */
  path: string;
  /** Cosine similarity in [0, 1]; higher is more relevant. */
  score: number;
  /** Short text excerpt for display. */
  snippet: string;
}

export type IndexState = "idle" | "indexing" | "ready" | "error";

export interface IndexStatus {
  state: IndexState;
  indexed: number;
  total: number;
  message?: string;
}

/**
 * Backend search service. Methods are root-first: the workspace root identifies
 * the (stateful) per-workspace index, mirroring {@link SpexrGitService}.
 */
export interface SpexrSearchService {
  /** Build the index in the background if it does not exist yet; returns at once. */
  ensureIndexed(root: string): Promise<void>;
  search(root: string, query: string): Promise<SearchHit[]>;
  getIndexStatus(root: string): Promise<IndexStatus>;
  /** Apply incremental file changes (workspace-relative POSIX paths). */
  applyChanges(root: string, changedPaths: string[], removedPaths: string[]): Promise<void>;
  /** Force a full rebuild. */
  reindex(root: string): Promise<void>;
}
```

- [ ] **Step 3: Write the failing test**

```ts
// src/node/search/spexr-search-backend-service.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpexrSearchBackendService } from "./spexr-search-backend-service.js";
import type { Embedder } from "./embedding-model.js";

class FakeEmbedder implements Embedder {
  async embed(texts: string[]): Promise<Float32Array[]> {
    // "auth" → [1,0]; otherwise [0,1]; query "auth" → [1,0]
    return texts.map((t) => new Float32Array(t.includes("auth") ? [1, 0] : [0, 1]));
  }
}

class ThrowingEmbedder implements Embedder {
  async embed(): Promise<Float32Array[]> {
    throw new Error("model down");
  }
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "spexr-svc-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Wait until the index reports "ready" (or "error"), polling status. */
async function waitReady(service: SpexrSearchBackendService): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const s = await service.getIndexStatus(root);
    if (s.state === "ready" || s.state === "error") return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("SpexrSearchBackendService", () => {
  it("indexes on ensureIndexed and ranks matching files first", async () => {
    await writeFile(join(root, "auth.ts"), "auth token logic");
    await writeFile(join(root, "chart.ts"), "draw a chart");
    const service = new SpexrSearchBackendService(new FakeEmbedder());

    await service.ensureIndexed(root);
    await waitReady(service);
    expect((await service.getIndexStatus(root)).state).toBe("ready");

    const hits = await service.search(root, "auth");
    expect(hits[0]?.path).toBe("auth.ts");
  });

  it("returns an empty array when searching an unindexed root", async () => {
    const service = new SpexrSearchBackendService(new FakeEmbedder());
    expect(await service.search(root, "anything")).toEqual([]);
  });

  it("reports error state when the model fails", async () => {
    await writeFile(join(root, "a.ts"), "auth");
    const service = new SpexrSearchBackendService(new ThrowingEmbedder());
    await service.ensureIndexed(root);
    await waitReady(service);
    expect((await service.getIndexStatus(root)).state).toBe("error");
  });

  it("applyChanges adds and removes records", async () => {
    const service = new SpexrSearchBackendService(new FakeEmbedder());
    await service.ensureIndexed(root);
    await waitReady(service);
    await writeFile(join(root, "auth.ts"), "auth token");
    await service.applyChanges(root, ["auth.ts"], []);
    expect((await service.search(root, "auth"))[0]?.path).toBe("auth.ts");
    await service.applyChanges(root, [], ["auth.ts"]);
    expect(await service.search(root, "auth")).toEqual([]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions test spexr-search-backend-service`
Expected: FAIL — cannot resolve `./spexr-search-backend-service.js`.

- [ ] **Step 5: Write the implementation**

```ts
// src/node/search/spexr-search-backend-service.ts
import { inject, injectable } from "@theia/core/shared/inversify";
import type {
  SpexrSearchService,
  SearchHit,
  IndexStatus,
} from "../../common/search-protocol.js";
import { Embedder as EmbedderType } from "./embedding-model.js";
import { EmbedderToken } from "./embedding-model.js";
import { WorkspaceIndexer } from "./workspace-indexer.js";

const TOP_K = 30;
const MIN_SCORE = 0.2;

interface Workspace {
  indexer: WorkspaceIndexer;
  status: IndexStatus;
  building?: Promise<void>;
}

/**
 * Per-workspace search backend: lazily builds and caches a {@link WorkspaceIndexer}
 * per root, runs queries against it, and degrades to an "error" status if the
 * embedding model cannot run.
 */
@injectable()
export class SpexrSearchBackendService implements SpexrSearchService {
  private readonly workspaces = new Map<string, Workspace>();

  constructor(@inject(EmbedderToken) private readonly embedder: EmbedderType) {}

  private getOrCreate(root: string): Workspace {
    let ws = this.workspaces.get(root);
    if (!ws) {
      ws = {
        indexer: new WorkspaceIndexer(root, this.embedder),
        status: { state: "idle", indexed: 0, total: 0 },
      };
      this.workspaces.set(root, ws);
    }
    return ws;
  }

  async ensureIndexed(root: string): Promise<void> {
    const ws = this.getOrCreate(root);
    if (ws.status.state === "ready" || ws.status.state === "indexing") return;
    void this.build(ws, root);
  }

  async reindex(root: string): Promise<void> {
    const ws = this.getOrCreate(root);
    ws.status = { state: "idle", indexed: 0, total: 0 };
    await this.build(ws, root);
  }

  /** Build (or rebuild) an index, updating status; never throws. */
  private build(ws: Workspace, root: string): Promise<void> {
    if (ws.building) return ws.building;
    ws.status = { state: "indexing", indexed: 0, total: 0 };
    ws.building = (async () => {
      try {
        if (await ws.indexer.load()) {
          ws.status = { state: "ready", indexed: ws.indexer.index.size, total: ws.indexer.index.size };
          return;
        }
        await ws.indexer.buildAll((indexed, total) => {
          ws.status = { state: "indexing", indexed, total };
        });
        await ws.indexer.save();
        ws.status = { state: "ready", indexed: ws.indexer.index.size, total: ws.indexer.index.size };
      } catch (err) {
        ws.status = {
          state: "error",
          indexed: ws.indexer.index.size,
          total: ws.indexer.index.size,
          message: err instanceof Error ? err.message : String(err),
        };
      } finally {
        ws.building = undefined;
      }
    })();
    void root;
    return ws.building;
  }

  async getIndexStatus(root: string): Promise<IndexStatus> {
    return this.getOrCreate(root).status;
  }

  async search(root: string, query: string): Promise<SearchHit[]> {
    const ws = this.workspaces.get(root);
    if (!ws || ws.indexer.index.size === 0 || query.trim().length === 0) return [];
    try {
      const [vector] = await this.embedder.embed([query]);
      return ws.indexer.index.search(vector!, TOP_K, MIN_SCORE);
    } catch (err) {
      ws.status = {
        state: "error",
        indexed: ws.indexer.index.size,
        total: ws.indexer.index.size,
        message: err instanceof Error ? err.message : String(err),
      };
      return [];
    }
  }

  async applyChanges(root: string, changedPaths: string[], removedPaths: string[]): Promise<void> {
    const ws = this.workspaces.get(root);
    if (!ws || ws.status.state !== "ready") return;
    for (const rel of removedPaths) ws.indexer.removeFile(rel);
    for (const rel of changedPaths) {
      try {
        await ws.indexer.updateFile(rel);
      } catch {
        // a single bad file must not break the batch
      }
    }
    await ws.indexer.save();
    ws.status = { state: "ready", indexed: ws.indexer.index.size, total: ws.indexer.index.size };
  }
}
```

> **Implementer note:** `import { Embedder as EmbedderType }` imports the interface as a value alias only for the constructor type annotation; if the ESLint `consistent-type-imports` rule flags it, split into `import type { Embedder as EmbedderType }` plus the separate `import { EmbedderToken }`. The token is a runtime value; the interface is type-only.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions test spexr-search-backend-service`
Expected: PASS (4 tests).

- [ ] **Step 7: Wire the RPC handler + bind the embedder**

Modify `src/node/spexr-backend-module.ts` — add imports and bindings:
```ts
import { SEARCH_SERVICE_PATH } from "../common/search-protocol.js";
import { EmbedderToken, TransformersEmbedder } from "./search/embedding-model.js";
import { SpexrSearchBackendService } from "./search/spexr-search-backend-service.js";
```
Inside the `ContainerModule` callback, after the git bindings:
```ts
  bind(EmbedderToken).to(TransformersEmbedder).inSingletonScope();
  bind(SpexrSearchBackendService).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrSearchBackendService);
      return new RpcConnectionHandler(SEARCH_SERVICE_PATH, () => service);
    })
    .inSingletonScope();
```

- [ ] **Step 8: Typecheck the wiring**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/theia-extensions/src/common/search-protocol.ts \
        packages/theia-extensions/src/node/search/spexr-search-backend-service.ts \
        packages/theia-extensions/src/node/search/spexr-search-backend-service.test.ts \
        packages/theia-extensions/src/node/search/embedding-model.ts \
        packages/theia-extensions/src/node/spexr-backend-module.ts
git commit -m "feat(search): add backend search RPC service"
```

---

### Task 7: Frontend widget + contribution + wiring

**Files:**
- Create: `src/browser/search/smart-search-service.ts`
- Create: `src/browser/search/smart-search-format.ts`
- Test: `src/browser/search/smart-search-format.test.ts`
- Create: `src/browser/search/smart-search-widget.tsx`
- Create: `src/browser/search/smart-search-contribution.ts`
- Modify: `src/browser/spexr-frontend-module.ts`
- Modify: `src/browser/style/spexr.css` (widget styles)

**Interfaces:**
- Consumes: `SpexrSearchService`, `SEARCH_SERVICE_PATH`, `SearchHit`, `IndexStatus` (`../../common/search-protocol.js`).
- Produces:
  - `smart-search-format.ts`: `formatScore(score: number): string` (e.g. `0.9234` → `"92%"`), `statusLabel(s: IndexStatus): string`, `debounce<T extends (...a: never[]) => void>(fn: T, ms: number): T & { cancel(): void }`.
  - `smart-search-service.ts`: `const SpexrSearchServiceProxy = Symbol("SpexrSearchServiceProxy")`, re-export `SEARCH_SERVICE_PATH`.
  - `smart-search-widget.tsx`: `class SmartSearchWidget extends ReactWidget` with `static ID = "spexr.view.smart-search"`.
  - `smart-search-contribution.ts`: `class SpexrSmartSearchContribution implements FrontendApplicationContribution`.

- [ ] **Step 1: Write the failing test (pure helpers)**

```ts
// src/browser/search/smart-search-format.test.ts
import { describe, expect, it, vi } from "vitest";
import { formatScore, statusLabel, debounce } from "./smart-search-format.js";

describe("formatScore", () => {
  it("renders a similarity as a rounded percentage", () => {
    expect(formatScore(0.9234)).toBe("92%");
    expect(formatScore(0)).toBe("0%");
    expect(formatScore(1)).toBe("100%");
  });
});

describe("statusLabel", () => {
  it("describes each index state", () => {
    expect(statusLabel({ state: "ready", indexed: 10, total: 10 })).toBe("Ready");
    expect(statusLabel({ state: "indexing", indexed: 3, total: 12 })).toBe("Indexing… 3/12");
    expect(statusLabel({ state: "error", indexed: 0, total: 0, message: "x" })).toBe("Search unavailable");
    expect(statusLabel({ state: "idle", indexed: 0, total: 0 })).toBe("Idle");
  });
});

describe("debounce", () => {
  it("invokes once after the delay with the latest args", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 100);
    d("a");
    d("b");
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("b");
    vi.useRealTimers();
  });

  it("cancel() prevents a pending call", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 100);
    d("a");
    d.cancel();
    vi.advanceTimersByTime(100);
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions test smart-search-format`
Expected: FAIL — cannot resolve `./smart-search-format.js`.

- [ ] **Step 3: Implement the pure helpers**

```ts
// src/browser/search/smart-search-format.ts
import type { IndexStatus } from "../../common/search-protocol.js";

/** Similarity in [0,1] → rounded percentage string. */
export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/** Human-readable label for an index status. */
export function statusLabel(s: IndexStatus): string {
  switch (s.state) {
    case "ready":
      return "Ready";
    case "indexing":
      return `Indexing… ${s.indexed}/${s.total}`;
    case "error":
      return "Search unavailable";
    default:
      return "Idle";
  }
}

interface Debounced<T extends (...args: never[]) => void> {
  (...args: Parameters<T>): void;
  cancel(): void;
}

/** Trailing-edge debounce with a cancel handle. */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: Parameters<T>): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped as Debounced<T>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions test smart-search-format`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the proxy symbol**

```ts
// src/browser/search/smart-search-service.ts
import { SEARCH_SERVICE_PATH } from "../../common/search-protocol.js";

export { SEARCH_SERVICE_PATH };
export const SpexrSearchServiceProxy = Symbol("SpexrSearchServiceProxy");
```

- [ ] **Step 6: Create the widget**

```tsx
// src/browser/search/smart-search-widget.tsx
import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import URI from "@theia/core/lib/common/uri";
import { CommandService } from "@theia/core/lib/common/command";
import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import type { SearchHit, IndexStatus, SpexrSearchService } from "../../common/search-protocol.js";
import { SpexrSearchServiceProxy } from "./smart-search-service.js";
import { formatScore, statusLabel, debounce } from "./smart-search-format.js";

/** Search input + ranked results, shown above the file-tree navigator. */
@injectable()
export class SmartSearchWidget extends ReactWidget {
  static readonly ID = "spexr.view.smart-search";

  @inject(SpexrSearchServiceProxy)
  private readonly service!: SpexrSearchService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(OpenerService)
  private readonly openerService!: OpenerService;

  @inject(CommandService)
  private readonly commands!: CommandService;

  private query = "";
  private hits: SearchHit[] = [];
  private status: IndexStatus = { state: "idle", indexed: 0, total: 0 };
  private statusTimer?: ReturnType<typeof setInterval>;

  private readonly runSearch = debounce((q: string) => void this.doSearch(q), 250);

  @postConstruct()
  protected init(): void {
    this.id = SmartSearchWidget.ID;
    this.title.label = "Search";
    this.title.caption = "Smart Search";
    this.title.closable = false;
    this.addClass("spexr-smart-search");
    this.pollStatus();
    this.update();
  }

  private root(): string | undefined {
    return this.workspace.tryGetRoots()[0]?.resource.toString();
  }

  private pollStatus(): void {
    const tick = async (): Promise<void> => {
      const root = this.root();
      if (!root) return;
      this.status = await this.service.getIndexStatus(root);
      this.update();
    };
    void tick();
    this.statusTimer = setInterval(() => void tick(), 1000);
  }

  override dispose(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.runSearch.cancel();
    super.dispose();
  }

  private async doSearch(q: string): Promise<void> {
    const root = this.root();
    if (!root || q.trim().length === 0) {
      this.hits = [];
      this.update();
      return;
    }
    this.hits = await this.service.search(root, q);
    this.update();
  }

  private onInput = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.query = e.target.value;
    this.runSearch(this.query);
    this.update();
  };

  private onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.query = "";
      this.hits = [];
      this.runSearch.cancel();
      this.update();
    }
  };

  private openHit = (hit: SearchHit): void => {
    const root = this.root();
    if (!root) return;
    const uri = new URI(root).resolve(hit.path);
    void open(this.openerService, uri);
    void this.commands.executeCommand("navigator.reveal", uri).catch(() => undefined);
  };

  protected render(): React.ReactNode {
    return (
      <div className="spexr-smart-search__body">
        <input
          className="spexr-smart-search__input theia-input"
          placeholder="Search files by meaning…"
          value={this.query}
          onChange={this.onInput}
          onKeyDown={this.onKeyDown}
        />
        <div className="spexr-smart-search__status">{statusLabel(this.status)}</div>
        {this.query.trim().length > 0 && (
          <ul className="spexr-smart-search__results">
            {this.hits.length === 0 ? (
              <li className="spexr-smart-search__empty">No results</li>
            ) : (
              this.hits.map((hit) => (
                <li
                  key={hit.path}
                  className="spexr-smart-search__hit"
                  title={hit.path}
                  onClick={() => this.openHit(hit)}
                >
                  <div className="spexr-smart-search__hit-head">
                    <span className="spexr-smart-search__hit-name">{basename(hit.path)}</span>
                    <span className="spexr-smart-search__hit-score">{formatScore(hit.score)}</span>
                  </div>
                  <div className="spexr-smart-search__hit-path">{dirname(hit.path)}</div>
                  <div className="spexr-smart-search__hit-snippet">{hit.snippet}</div>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    );
  }
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
}
```

- [ ] **Step 7: Create the contribution (placement + lifecycle)**

```ts
// src/browser/search/smart-search-contribution.ts
import { inject, injectable, interfaces } from "@theia/core/shared/inversify";
import {
  type FrontendApplicationContribution,
  WidgetManager,
} from "@theia/core/lib/browser";
import { ViewContainer } from "@theia/core/lib/browser/view-container";
import { EXPLORER_VIEW_CONTAINER_ID } from "@theia/navigator/lib/browser/navigator-widget-factory";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import URI from "@theia/core/lib/common/uri";
import type { SpexrSearchService } from "../../common/search-protocol.js";
import { SpexrSearchServiceProxy } from "./smart-search-service.js";
import { SmartSearchWidget } from "./smart-search-widget.js";
import { debounce } from "./smart-search-format.js";

/**
 * Places {@link SmartSearchWidget} at the top of the Explorer view container,
 * kicks off the initial index, and forwards file changes to the backend for
 * incremental re-indexing.
 */
@injectable()
export class SpexrSmartSearchContribution implements FrontendApplicationContribution {
  @inject(WidgetManager) private readonly widgetManager!: WidgetManager;
  @inject(SpexrSearchServiceProxy) private readonly service!: SpexrSearchService;
  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
  @inject(FileService) private readonly fileService!: FileService;

  private changed = new Set<string>();
  private removed = new Set<string>();
  private readonly flush = debounce(() => void this.flushChanges(), 500);

  private root(): string | undefined {
    return this.workspace.tryGetRoots()[0]?.resource.toString();
  }

  async onDidInitializeLayout(): Promise<void> {
    const container = (await this.widgetManager.getOrCreateWidget(
      EXPLORER_VIEW_CONTAINER_ID,
    )) as ViewContainer;
    const widget = await this.widgetManager.getOrCreateWidget<SmartSearchWidget>(SmartSearchWidget.ID);
    container.addWidget(widget, {
      order: -1,
      canHide: true,
      initiallyCollapsed: false,
      weight: 25,
    });
  }

  async onStart(): Promise<void> {
    const root = this.root();
    if (!root) return;
    await this.service.ensureIndexed(root);
    this.fileService.onDidFilesChange((event) => this.onFilesChanged(event.changes));
  }

  private onFilesChanged(changes: readonly { resource: URI; type: number }[]): void {
    const root = this.root();
    if (!root) return;
    const rootUri = new URI(root);
    for (const change of changes) {
      const rel = rootUri.relative(change.resource);
      if (!rel) continue;
      const path = rel.toString();
      // FileChangeType: 0 UPDATED, 1 ADDED, 2 DELETED
      if (change.type === 2) {
        this.removed.add(path);
        this.changed.delete(path);
      } else {
        this.changed.add(path);
        this.removed.delete(path);
      }
    }
    this.flush();
  }

  private async flushChanges(): Promise<void> {
    const root = this.root();
    if (!root) return;
    const changed = [...this.changed];
    const removed = [...this.removed];
    this.changed.clear();
    this.removed.clear();
    if (changed.length === 0 && removed.length === 0) return;
    await this.service.applyChanges(root, changed, removed);
  }
}

/** Bind the widget factory for {@link SmartSearchWidget}. */
export function bindSmartSearchWidgetFactory(bind: interfaces.Bind): void {
  bind(SmartSearchWidget).toSelf();
}
```

> **Implementer note:** verify the `@theia/filesystem` `FileChangeType` numeric values against the installed version before relying on `2 === DELETED`; if they differ, import `FileChangeType` from `@theia/filesystem/lib/common/files` and compare against the enum instead of a literal.

- [ ] **Step 8: Add widget styles**

Append to `src/browser/style/spexr.css`:
```css
/* Smart Search (Explorer) */
.spexr-smart-search__body { padding: 6px 8px; display: flex; flex-direction: column; gap: 6px; }
.spexr-smart-search__input { width: 100%; box-sizing: border-box; }
.spexr-smart-search__status { font-size: 11px; opacity: 0.7; }
.spexr-smart-search__results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.spexr-smart-search__hit { padding: 4px 6px; border-radius: 4px; cursor: pointer; }
.spexr-smart-search__hit:hover { background: var(--theia-list-hoverBackground); }
.spexr-smart-search__hit-head { display: flex; justify-content: space-between; gap: 8px; }
.spexr-smart-search__hit-name { font-weight: 600; }
.spexr-smart-search__hit-score { opacity: 0.6; font-variant-numeric: tabular-nums; }
.spexr-smart-search__hit-path { font-size: 11px; opacity: 0.6; }
.spexr-smart-search__hit-snippet { font-size: 11px; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.spexr-smart-search__empty { padding: 4px 6px; opacity: 0.6; font-size: 12px; }
```

- [ ] **Step 9: Wire the frontend module**

Modify `src/browser/spexr-frontend-module.ts` — add imports:
```ts
import { WebSocketConnectionProvider } from "@theia/core/lib/browser/messaging/ws-connection-provider";
// (already imported above — reuse it)
import {
  SpexrSmartSearchContribution,
  bindSmartSearchWidgetFactory,
} from "./search/smart-search-contribution.js";
import { SmartSearchWidget } from "./search/smart-search-widget.js";
import { SpexrSearchServiceProxy, SEARCH_SERVICE_PATH } from "./search/smart-search-service.js";
```
Inside the module callback (after the git bindings):
```ts
  // --- Smart Search ---
  bind(SpexrSearchServiceProxy)
    .toDynamicValue((ctx) => {
      const connection = ctx.container.get(WebSocketConnectionProvider);
      return connection.createProxy(SEARCH_SERVICE_PATH);
    })
    .inSingletonScope();
  bindSmartSearchWidgetFactory(bind);
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: SmartSearchWidget.ID,
      createWidget: () => ctx.container.get(SmartSearchWidget),
    }))
    .inSingletonScope();
  bind(SpexrSmartSearchContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrSmartSearchContribution);
```

- [ ] **Step 10: Typecheck, lint, and build**

Run:
```bash
pnpm --filter @spexr/theia-extensions typecheck
pnpm --filter @spexr/theia-extensions lint
pnpm --filter @spexr/theia-extensions build
```
Expected: typecheck clean; lint reports no **new** errors in `src/browser/search/**` or `src/node/search/**` (pre-existing repo lint errors elsewhere are out of scope); build succeeds.

- [ ] **Step 11: Commit**

```bash
git add packages/theia-extensions/src/browser/search packages/theia-extensions/src/browser/spexr-frontend-module.ts packages/theia-extensions/src/browser/style/spexr.css
git commit -m "feat(search): add Explorer smart-search widget"
```

---

### Task 8: Package the model for the desktop build

**Files:**
- Modify: `apps/desktop/electron-builder.yml`

**Interfaces:**
- Consumes: the vendored model at `packages/theia-extensions/resources/models/**` and `TransformersEmbedder`'s `SPEXR_MODELS_DIR` / package-relative fallback (Task 4).
- Produces: a packaged app whose backend can load the model offline.

- [ ] **Step 1: Ship the model as an unpacked resource**

The `TransformersEmbedder` fallback resolves the model relative to the compiled file at `node_modules/@spexr/theia-extensions/lib/node/search/embedding-model.js → ../../../resources/models`, i.e. `node_modules/@spexr/theia-extensions/resources/models`. Ensure those files are present in the packaged app and not pruned.

Add to `apps/desktop/electron-builder.yml` under `files:` (so the workspace package's `resources/` is kept, since `!node_modules/@spexr/*/src/**` only excludes `src`):
```yaml
  - "node_modules/@spexr/theia-extensions/resources/models/**"
```
And add an `asarUnpack` entry so onnxruntime can read the weights from disk rather than inside the ASAR archive:
```yaml
  - "node_modules/@spexr/theia-extensions/resources/models/**"
```

- [ ] **Step 2: Verify the model is staged before packaging**

Run from the repo root:
```bash
ls packages/theia-extensions/resources/models/Xenova/all-MiniLM-L6-v2
```
Expected: the ONNX weights and tokenizer/config JSON files are present (from Task 4's `fetch-model`). If empty, run `pnpm --filter @spexr/theia-extensions fetch-model` before building the desktop app.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/electron-builder.yml
git commit -m "build(search): package offline embedding model"
```

> **Manual verification (not automated):** after `pnpm --filter @spexr/desktop package` (or the repo's desktop build command), launch the packaged app on a machine with no network, open a workspace, and confirm the Explorer search returns ranked results. This exercises the unpacked model path end-to-end and cannot be covered by unit tests.

---

## Out of scope (Slice 2 and beyond)

- Per-section chunking (multiple embeddings per file) and improved snippets.
- Score-threshold tuning informed by real usage.
- Reveal-in-tree as a hard requirement (best-effort in Slice 1).
- Push-based status updates (Slice 1 polls every second).

## Self-Review

**Spec coverage:**
- Whole-workspace corpus → Task 5 `discover()` walks the workspace. ✅
- Local embeddings, in-process ONNX MiniLM, offline, 384-dim → Task 4. ✅
- Brute-force cosine top-K, no ANN → Tasks 1–2. ✅
- Index persistence in `<workspace>/.spexr/search-index.json` with version → Tasks 2 (version), 5 (path). ✅
- Incremental via file changes → Task 6 `applyChanges` + Task 7 contribution forwarding. ✅
- Per-file granularity, path + first 2000 chars → Task 5 `buildEmbeddingInput`. ✅
- Skip-list / `.gitignore` / size cap / binary sniff → Task 3 + Task 5. ✅
- Query flow (debounce 250ms, top-K 30, min score, snippet) → Tasks 6 (defaults), 7 (debounce/render). ✅
- UI above navigator, states, click-to-open + reveal → Task 7. ✅
- Error degradation (model load, corrupt index, unreadable file, embed failure, no root) → Tasks 2 (`fromJSON`), 5 (`updateFile` guards), 6 (status error + empty search), 7 (no-root guards). ✅
- RPC wiring matching git pattern → Task 6. ✅
- Testing matrix (VectorIndex, indexer, embedding integration opt-in, service, widget pure helpers) → Tasks 1–7. ✅

**Placeholder scan:** No "TBD"/"add error handling"/bare prose-only code steps; each code step carries full code. The two "implementer notes" name a concrete alternative with the exact method to add, not a vague deferral. ✅

**Type consistency:** `SearchHit {path,score,snippet}` is identical in `vector-index.ts` (`IndexHit`), `search-protocol.ts`, and the widget. `Embedder.embed(string[]): Promise<Float32Array[]>` is consistent across Tasks 4–6. `SpexrSearchService` signatures match between protocol (Task 6), backend (Task 6), and widget/contribution (Task 7). Index path/version constants align between Tasks 2 and 5. ✅
