# AI File Descriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show short, AI-generated, whole-file descriptions in smart-search results, produced locally and lazily, with the existing heuristic description as fallback.

**Architecture:** Reuse the existing `@xenova/transformers` (ONNX) runtime that already powers embeddings. A new backend `DescriptionGenerator` runs a small code instruct model with a serialized, de-duplicated queue. A new `describeFile` RPC method generates on demand for files shown in results and caches the text on the index record (keyed by content hash). The widget shows the heuristic description immediately with a pulsing AI icon, then swaps in the AI text when ready. A boolean preference (default on) gates the whole feature.

**Tech Stack:** TypeScript, Theia (Inversify DI, RPC), `@xenova/transformers`, ONNX, Vitest, React (Theia ReactWidget).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-28-ai-file-descriptions-design.md`.
- Model: `onnx-community/Qwen2.5-Coder-1.5B-Instruct`, quantized, loaded offline (`env.allowRemoteModels = false`, `env.localModelPath = resolveModelsDir()`).
- No new native dependency; no electron-builder config changes (the model lands in `resources/models`, already globbed).
- `root` passed to backend methods MUST be an absolute filesystem path, never a `file://` URI.
- `MAX_DESC_CHARS = 120` is the description length cap, matching the heuristic path.
- Generation is in-process, serialized (one inference at a time), and never runs at index/reindex time.
- Tests: `pnpm --filter @spexr/theia-extensions exec vitest run <file>`; typecheck: `pnpm --filter @spexr/theia-extensions exec tsc --noEmit`.
- Reply/commit language: code & commits in English.

---

### Task 1: Extract a shared offline model-dir resolver

**Files:**
- Create: `packages/theia-extensions/src/node/search/models-dir.ts`
- Create: `packages/theia-extensions/src/node/search/models-dir.test.ts`
- Modify: `packages/theia-extensions/src/node/search/embedding-model.ts` (replace local `resolveModelsDir` with the shared one)

**Interfaces:**
- Produces: `resolveModelsDir(): string` — directory holding vendored ONNX models. Used by the embedder and the new generator.

- [ ] **Step 1: Write the failing test**

```ts
// models-dir.test.ts
import { describe, expect, it, afterEach } from "vitest";
import { resolveModelsDir } from "./models-dir.js";

describe("resolveModelsDir", () => {
  afterEach(() => { delete process.env.SPEXR_MODELS_DIR; });

  it("honors the SPEXR_MODELS_DIR override", () => {
    process.env.SPEXR_MODELS_DIR = "/custom/models";
    expect(resolveModelsDir()).toBe("/custom/models");
  });

  it("returns an absolute path when no override is set", () => {
    expect(resolveModelsDir().startsWith("/")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/search/models-dir.test.ts`
Expected: FAIL — cannot resolve `./models-dir.js`.

- [ ] **Step 3: Write the implementation**

```ts
// models-dir.ts
import { resolve } from "node:path";
import { existsSync } from "node:fs";

/**
 * Directory holding vendored ONNX models: env override, else <package>/resources/models.
 *
 * Two resolution strategies because __dirname differs between dev and webpack:
 * - Source tree: lib/node/search/*.js → ../../../resources/models
 * - Webpack bundle (apps/desktop/lib/backend/main.js): ../../../ lands in apps/desktop/,
 *   so fall back to node_modules/@spexr/theia-extensions (a workspace symlink).
 */
export function resolveModelsDir(): string {
  if (process.env.SPEXR_MODELS_DIR) return process.env.SPEXR_MODELS_DIR;
  const fromSource = resolve(__dirname, "..", "..", "..", "resources", "models");
  if (existsSync(fromSource)) return fromSource;
  return resolve(__dirname, "..", "..", "node_modules", "@spexr", "theia-extensions", "resources", "models");
}
```

- [ ] **Step 4: Update the embedder to use it**

In `embedding-model.ts`: delete the local `resolveModelsDir` function (lines defining it) and its now-unused `resolve`/`existsSync` imports, then add:

```ts
import { resolveModelsDir } from "./models-dir.js";
```

Leave the call site `env.localModelPath = resolveModelsDir();` unchanged.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/search/models-dir.test.ts && pnpm --filter @spexr/theia-extensions exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/theia-extensions/src/node/search/models-dir.ts packages/theia-extensions/src/node/search/models-dir.test.ts packages/theia-extensions/src/node/search/embedding-model.ts
git commit -m "refactor(search): extract shared resolveModelsDir"
```

---

### Task 2: Add `aiDescription` to the index record

**Files:**
- Modify: `packages/theia-extensions/src/node/search/vector-index.ts`
- Create: `packages/theia-extensions/src/node/search/vector-index.aidesc.test.ts`

**Interfaces:**
- Produces: `IndexRecord.aiDescription?: string`; helpers `VectorIndex.setAiDescription(path, text)` and round-trip persistence of the field.

- [ ] **Step 1: Write the failing test**

```ts
// vector-index.aidesc.test.ts
import { describe, expect, it } from "vitest";
import { VectorIndex } from "./vector-index.js";

function rec(path: string) {
  return { path, vector: new Float32Array([1, 0]), mtimeMs: 1, hash: "h1",
           snippet: "s", category: "backend", description: "d" };
}

describe("VectorIndex aiDescription", () => {
  it("setAiDescription stores text on an existing record", () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    idx.setAiDescription("a.ts", "Handles auth tokens.");
    expect(idx.getRecord("a.ts")?.aiDescription).toBe("Handles auth tokens.");
  });

  it("round-trips aiDescription through toJSON/fromJSON", () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    idx.setAiDescription("a.ts", "Handles auth tokens.");
    const restored = VectorIndex.fromJSON(idx.toJSON());
    expect(restored.getRecord("a.ts")?.aiDescription).toBe("Handles auth tokens.");
  });

  it("upsert with a new hash drops a prior aiDescription", () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    idx.setAiDescription("a.ts", "old");
    idx.upsert({ ...rec("a.ts"), hash: "h2" });
    expect(idx.getRecord("a.ts")?.aiDescription).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/search/vector-index.aidesc.test.ts`
Expected: FAIL — `setAiDescription` is not a function.

- [ ] **Step 3: Implement**

In `vector-index.ts`:

Bump the version constant:
```ts
export const INDEX_VERSION = 7;
```

Add the field to `IndexRecord`, `SerializedRecord`:
```ts
export interface IndexRecord {
  path: string;
  vector: Float32Array;
  mtimeMs: number;
  hash: string;
  snippet: string;
  category: string;
  description: string;
  aiDescription?: string;
}
```
```ts
interface SerializedRecord {
  path: string;
  vector: number[];
  mtimeMs: number;
  hash: string;
  snippet: string;
  category: string;
  description: string;
  aiDescription?: string;
}
```

Add the setter (after `upsert`):
```ts
/** Attach an AI-generated description to an existing record, if present. */
setAiDescription(path: string, text: string): void {
  const rec = this.records.get(path);
  if (rec) rec.aiDescription = text;
}
```

`upsert` already replaces the whole record, so a new-hash upsert naturally drops `aiDescription` — no change needed there.

In `toJSON`, add `aiDescription: r.aiDescription,` to the mapped object.
In `fromJSON`'s `upsert`, add `aiDescription: r.aiDescription,`.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/search/vector-index.aidesc.test.ts && pnpm --filter @spexr/theia-extensions exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/search/vector-index.ts packages/theia-extensions/src/node/search/vector-index.aidesc.test.ts
git commit -m "feat(search): persist aiDescription on index records"
```

---

### Task 3: DescriptionGenerator (model wrapper + queue)

**Files:**
- Create: `packages/theia-extensions/src/node/search/description-generator.ts`
- Create: `packages/theia-extensions/src/node/search/description-generator.test.ts`

**Interfaces:**
- Produces:
  - `interface DescriptionGenerator { generate(relPath: string, content: string): Promise<string | null>; isAvailable(): boolean; }`
  - `const DescriptionGeneratorToken: symbol`
  - `type TextGenerateFn = (prompt: string) => Promise<string>`
  - `class TransformersDescriptionGenerator implements DescriptionGenerator` with constructor `(loader?: () => Promise<TextGenerateFn>)` — the optional loader makes it testable with a fake.
  - `buildPrompt(relPath: string, content: string): string`, `cleanGenerated(raw: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// description-generator.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  TransformersDescriptionGenerator,
  buildPrompt,
  cleanGenerated,
  type TextGenerateFn,
} from "./description-generator.js";

describe("cleanGenerated", () => {
  it("keeps one line and caps at 120 chars", () => {
    expect(cleanGenerated("Handles auth.\nExtra.")).toBe("Handles auth.");
    expect(cleanGenerated("x".repeat(200))).toHaveLength(120);
  });
  it("trims surrounding whitespace and quotes", () => {
    expect(cleanGenerated('  "Does X."  ')).toBe("Does X.");
  });
});

describe("buildPrompt", () => {
  it("includes the path and the content", () => {
    const p = buildPrompt("src/a.ts", "export const x = 1;");
    expect(p).toContain("src/a.ts");
    expect(p).toContain("export const x = 1;");
  });
});

describe("TransformersDescriptionGenerator", () => {
  it("returns a cleaned description from the model", async () => {
    const fn: TextGenerateFn = async () => "Handles authentication tokens.";
    const gen = new TransformersDescriptionGenerator(async () => fn);
    expect(await gen.generate("a.ts", "code")).toBe("Handles authentication tokens.");
  });

  it("serializes generation: never more than one inference at a time", async () => {
    let active = 0, maxActive = 0;
    const fn: TextGenerateFn = async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--; return "desc.";
    };
    const gen = new TransformersDescriptionGenerator(async () => fn);
    await Promise.all([
      gen.generate("a.ts", "x"), gen.generate("b.ts", "y"), gen.generate("c.ts", "z"),
    ]);
    expect(maxActive).toBe(1);
  });

  it("de-duplicates concurrent requests for the same path", async () => {
    const fn = vi.fn<TextGenerateFn>(async () => "desc.");
    const gen = new TransformersDescriptionGenerator(async () => fn);
    await Promise.all([gen.generate("a.ts", "x"), gen.generate("a.ts", "x")]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("becomes unavailable after a load failure and returns null without retrying", async () => {
    const loader = vi.fn(async (): Promise<TextGenerateFn> => { throw new Error("no model"); });
    const gen = new TransformersDescriptionGenerator(loader);
    expect(await gen.generate("a.ts", "x")).toBeNull();
    expect(await gen.generate("b.ts", "y")).toBeNull();
    expect(gen.isAvailable()).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns null (not throwing) when a single generation fails", async () => {
    const fn: TextGenerateFn = async () => { throw new Error("boom"); };
    const gen = new TransformersDescriptionGenerator(async () => fn);
    expect(await gen.generate("a.ts", "x")).toBeNull();
    expect(gen.isAvailable()).toBe(true);
  });

  it("returns null when the model yields empty text", async () => {
    const gen = new TransformersDescriptionGenerator(async () => async () => "   ");
    expect(await gen.generate("a.ts", "x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/search/description-generator.test.ts`
Expected: FAIL — cannot resolve `./description-generator.js`.

- [ ] **Step 3: Implement**

```ts
// description-generator.ts
import { injectable } from "@theia/core/shared/inversify";
import { env, pipeline } from "@xenova/transformers";
import { resolveModelsDir } from "./models-dir.js";

export const GEN_MODEL_ID = "onnx-community/Qwen2.5-Coder-1.5B-Instruct";
const MAX_INPUT_CHARS = 1500;
const MAX_DESC_CHARS = 120;
const MAX_NEW_TOKENS = 40;

/** Produces a one-sentence, whole-file description, or null if unavailable. */
export interface DescriptionGenerator {
  generate(relPath: string, content: string): Promise<string | null>;
  isAvailable(): boolean;
}

export const DescriptionGeneratorToken = Symbol("DescriptionGenerator");

/** Low-level text generation: prompt in, raw completion out. */
export type TextGenerateFn = (prompt: string) => Promise<string>;

export function buildPrompt(relPath: string, content: string): string {
  return (
    `File path: ${relPath}\n\n` +
    `Code:\n${content}\n\n` +
    `In one short sentence, describe what this file does. ` +
    `Reply with only the sentence, no preamble.`
  );
}

export function cleanGenerated(raw: string): string {
  const firstLine = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return firstLine.replace(/^["'`]+|["'`]+$/g, "").trim().slice(0, MAX_DESC_CHARS);
}

/** Default loader: an offline Qwen2.5-Coder ONNX text-generation pipeline. */
async function defaultLoader(): Promise<TextGenerateFn> {
  env.allowRemoteModels = false;
  env.localModelPath = resolveModelsDir();
  const pipe = await pipeline("text-generation", GEN_MODEL_ID, { quantized: true });
  return async (prompt: string): Promise<string> => {
    const out = (await pipe([{ role: "user", content: prompt }], {
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: false,
    })) as Array<{ generated_text?: Array<{ role: string; content: string }> }>;
    const msgs = out[0]?.generated_text;
    const last = Array.isArray(msgs) ? msgs[msgs.length - 1] : undefined;
    return typeof last?.content === "string" ? last.content : "";
  };
}

/**
 * In-process generator over a small instruct model. Loads lazily on first use,
 * serializes inference (one at a time), de-duplicates concurrent requests per
 * path, and degrades to null permanently if the model cannot load.
 */
@injectable()
export class TransformersDescriptionGenerator implements DescriptionGenerator {
  private loadPromise?: Promise<TextGenerateFn | null>;
  private loadFailed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(private readonly loader: () => Promise<TextGenerateFn> = defaultLoader) {}

  isAvailable(): boolean {
    return !this.loadFailed;
  }

  generate(relPath: string, content: string): Promise<string | null> {
    if (this.loadFailed) return Promise.resolve(null);
    const existing = this.inflight.get(relPath);
    if (existing) return existing;
    const run = this.enqueue(relPath, content.slice(0, MAX_INPUT_CHARS));
    this.inflight.set(relPath, run);
    void run.finally(() => this.inflight.delete(relPath));
    return run;
  }

  private enqueue(relPath: string, content: string): Promise<string | null> {
    const run = this.queue.then(() => this.runOne(relPath, content));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runOne(relPath: string, content: string): Promise<string | null> {
    const fn = await this.ensureLoaded();
    if (!fn) return null;
    try {
      const text = cleanGenerated(await fn(buildPrompt(relPath, content)));
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  }

  private ensureLoaded(): Promise<TextGenerateFn | null> {
    if (!this.loadPromise) {
      this.loadPromise = this.loader().catch(() => {
        this.loadFailed = true;
        return null;
      });
    }
    return this.loadPromise;
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/search/description-generator.test.ts && pnpm --filter @spexr/theia-extensions exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/search/description-generator.ts packages/theia-extensions/src/node/search/description-generator.test.ts
git commit -m "feat(search): local description generator with serialized queue"
```

---

### Task 4: `describeFile` RPC method

**Files:**
- Modify: `packages/theia-extensions/src/common/search-protocol.ts`
- Modify: `packages/theia-extensions/src/node/search/spexr-search-backend-service.ts`
- Modify: `packages/theia-extensions/src/node/spexr-backend-module.ts`
- Modify: `packages/theia-extensions/src/node/search/spexr-search-backend-service.test.ts`

**Interfaces:**
- Consumes: `DescriptionGenerator` (Task 3), `VectorIndex.setAiDescription` + `IndexRecord.aiDescription` (Task 2).
- Produces: `SpexrSearchService.describeFile(root: string, path: string): Promise<string | null>`.

- [ ] **Step 1: Write the failing test**

Add to `spexr-search-backend-service.test.ts` (note: the service constructor gains a second argument — a generator). At the top, define a fake generator and a helper that builds the service with it:

```ts
import { TransformersDescriptionGenerator, type TextGenerateFn } from "./description-generator.js";

function serviceWith(genFn: TextGenerateFn) {
  const generator = new TransformersDescriptionGenerator(async () => genFn);
  return new SpexrSearchBackendService(new FakeEmbedder(), generator);
}
```

Update the existing `new SpexrSearchBackendService(new FakeEmbedder())` call sites to pass a generator too — the simplest is a no-op generator:

```ts
const NOOP_GEN: TextGenerateFn = async () => "";
// e.g. const service = serviceWith(NOOP_GEN);
```

Then add the new behavior tests:

```ts
it("describeFile generates, persists, and caches by hash", async () => {
  await writeFile(join(root, "auth.ts"), "auth token logic");
  const service = serviceWith(async () => "Handles authentication.");
  await service.ensureIndexed(root);
  await waitReady(service);

  expect(await service.describeFile(root, "auth.ts")).toBe("Handles authentication.");
  // second call is served from cache — change the fn and expect the cached value
  const cached = await service.describeFile(root, "auth.ts");
  expect(cached).toBe("Handles authentication.");
});

it("describeFile returns null for an unknown path", async () => {
  await writeFile(join(root, "auth.ts"), "auth");
  const service = serviceWith(async () => "x");
  await service.ensureIndexed(root);
  await waitReady(service);
  expect(await service.describeFile(root, "missing.ts")).toBeNull();
});

it("describeFile returns null when the model is unavailable", async () => {
  await writeFile(join(root, "auth.ts"), "auth");
  const generator = new TransformersDescriptionGenerator(async () => { throw new Error("no model"); });
  const service = new SpexrSearchBackendService(new FakeEmbedder(), generator);
  await service.ensureIndexed(root);
  await waitReady(service);
  expect(await service.describeFile(root, "auth.ts")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/search/spexr-search-backend-service.test.ts`
Expected: FAIL — constructor arity / `describeFile` not a function.

- [ ] **Step 3: Add the protocol method**

In `search-protocol.ts`, inside `SpexrSearchService`, after `reindex`:
```ts
  /**
   * Return an AI-generated description for a file, generating and caching it on
   * first request. Returns null if the file is not indexed or the local model
   * is unavailable.
   */
  describeFile(root: string, path: string): Promise<string | null>;
```

- [ ] **Step 4: Implement in the backend service**

In `spexr-search-backend-service.ts`:

Add imports:
```ts
import { DescriptionGeneratorToken, type DescriptionGenerator } from "./description-generator.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
```
(If `readFile`/`join` are already imported, do not duplicate them.)

Extend the constructor:
```ts
constructor(
  @inject(EmbedderToken) private readonly embedder: EmbedderType,
  @inject(DescriptionGeneratorToken) private readonly generator: DescriptionGenerator,
) {}
```

Add the method (place it after `reindex`):
```ts
async describeFile(root: string, path: string): Promise<string | null> {
  const ws = this.workspaces.get(root);
  const record = ws?.indexer.index.getRecord(path);
  if (!record) return null;
  if (record.aiDescription) return record.aiDescription;
  if (!this.generator.isAvailable()) return null;
  let content: string;
  try {
    content = await readFile(join(root, path), "utf8");
  } catch {
    return null;
  }
  const text = await this.generator.generate(path, content);
  if (!text) return null;
  ws!.indexer.index.setAiDescription(path, text);
  await ws!.indexer.save();
  return text;
}
```

- [ ] **Step 5: Bind the generator in the backend module**

In `spexr-backend-module.ts`:
```ts
import { EmbedderToken, TransformersEmbedder } from "./search/embedding-model.js";
import { DescriptionGeneratorToken, TransformersDescriptionGenerator } from "./search/description-generator.js";
```
After `bind(EmbedderToken).to(TransformersEmbedder).inSingletonScope();` add:
```ts
bind(DescriptionGeneratorToken).to(TransformersDescriptionGenerator).inSingletonScope();
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/search/spexr-search-backend-service.test.ts && pnpm --filter @spexr/theia-extensions exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/theia-extensions/src/common/search-protocol.ts packages/theia-extensions/src/node/search/spexr-search-backend-service.ts packages/theia-extensions/src/node/spexr-backend-module.ts packages/theia-extensions/src/node/search/spexr-search-backend-service.test.ts
git commit -m "feat(search): describeFile RPC with hash-keyed caching"
```

---

### Task 5: Feature preference (default on)

**Files:**
- Modify: `packages/theia-extensions/src/browser/preferences/spexr-preferences.ts`

**Interfaces:**
- Produces: `SPEXR_SEARCH_AI_DESCRIPTIONS_PREFERENCE = "spexr.search.aiDescriptions.enabled"` (boolean, default `true`).

- [ ] **Step 1: Add the preference key + schema property**

In `spexr-preferences.ts`, add the exported key near the others:
```ts
/**
 * Toggle for locally-generated AI file descriptions in search results.
 * On by default. Off shows heuristic descriptions only and skips the local model.
 */
export const SPEXR_SEARCH_AI_DESCRIPTIONS_PREFERENCE = "spexr.search.aiDescriptions.enabled";
```

Add the property inside `SpexrPreferencesSchema.properties`:
```ts
[SPEXR_SEARCH_AI_DESCRIPTIONS_PREFERENCE]: {
  type: "boolean",
  default: true,
  description:
    "Generate AI file descriptions locally for search results. " +
    "Turn off to skip the local model and show heuristic descriptions only.",
},
```

(No new DI binding: `SpexrPreferenceContribution` is already bound in the frontend module, so the added property is registered automatically.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @spexr/theia-extensions exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/theia-extensions/src/browser/preferences/spexr-preferences.ts
git commit -m "feat(search): add spexr.search.aiDescriptions.enabled preference"
```

---

### Task 6: Widget — request, swap, and AI icon

**Files:**
- Modify: `packages/theia-extensions/src/browser/search/smart-search-widget.tsx`
- Modify: `packages/theia-extensions/src/browser/style/spexr.css`

**Interfaces:**
- Consumes: `SpexrSearchService.describeFile` (Task 4), `SPEXR_SEARCH_AI_DESCRIPTIONS_PREFERENCE` (Task 5).
- Produces: per-hit AI description state in the widget (no external interface).

This task is React UI; it is verified by typecheck + build + manual run (no unit test, consistent with the existing widget which has none).

- [ ] **Step 1: Inject the preference service and add per-hit state**

In `smart-search-widget.tsx` add imports:
```ts
import { PreferenceService } from "@theia/core/lib/browser";
import { SPEXR_SEARCH_AI_DESCRIPTIONS_PREFERENCE } from "../preferences/spexr-preferences.js";
```

Add the injection alongside the others:
```ts
@inject(PreferenceService)
private readonly preferences!: PreferenceService;
```

Add state fields next to `private hits`:
```ts
/** path → AI description text once resolved. */
private aiDescriptions = new Map<string, string>();
/** paths with an in-flight describeFile request (pulsing icon). */
private aiPending = new Set<string>();
```

- [ ] **Step 2: Reset per-hit state on each new search**

In `doSearch`, after `this.hits = await this.service.search(root, q);` add:
```ts
this.aiDescriptions.clear();
this.aiPending.clear();
```
Then after `this.update();` at the end of `doSearch`, kick off generation:
```ts
this.requestAiDescriptions(root);
```

Also, in the early-return branch of `doSearch` (empty query) clear the maps too:
```ts
this.hits = [];
this.aiDescriptions.clear();
this.aiPending.clear();
this.update();
return;
```

- [ ] **Step 3: Add the request method (gated by preference, top-N only)**

Add to the class:
```ts
private static readonly AI_TOP_N = 10;

private aiEnabled(): boolean {
  return this.preferences.get<boolean>(SPEXR_SEARCH_AI_DESCRIPTIONS_PREFERENCE, true);
}

private requestAiDescriptions(root: string): void {
  if (!this.aiEnabled()) return;
  for (const hit of this.hits.slice(0, SmartSearchWidget.AI_TOP_N)) {
    if (this.aiDescriptions.has(hit.path) || this.aiPending.has(hit.path)) continue;
    this.aiPending.add(hit.path);
    void this.service.describeFile(root, hit.path).then((text) => {
      this.aiPending.delete(hit.path);
      if (text) this.aiDescriptions.set(hit.path, text);
      this.update();
    });
  }
  this.update();
}
```

- [ ] **Step 4: Render the AI icon + swapped text**

Replace the description line in `renderHit`:
```ts
{hit.description && <div className="spexr-smart-search__hit-desc">{hit.description}</div>}
```
with:
```ts
{this.renderDesc(hit)}
```

Add the helper:
```ts
private renderDesc(hit: SearchHit): React.ReactNode {
  const ai = this.aiDescriptions.get(hit.path);
  const pending = this.aiPending.has(hit.path);
  const text = ai ?? hit.description;
  if (!text && !pending) return null;
  const showIcon = this.aiEnabled() && (pending || ai !== undefined);
  const iconClass =
    "spexr-smart-search__ai-icon" + (pending ? " spexr-smart-search__ai-icon--pulsing" : "");
  const iconTitle = pending
    ? "L'AI sta generando una descrizione del file…"
    : "Descrizione generata dall'AI";
  return (
    <div className="spexr-smart-search__hit-desc">
      {showIcon && <span className={iconClass} title={iconTitle}>✦</span>}
      {text}
    </div>
  );
}
```

- [ ] **Step 5: Add CSS for the icon + pulse**

Append to `spexr.css`:
```css
.spexr-smart-search__ai-icon {
  margin-right: 4px;
  color: var(--theia-textLink-foreground, #b18cff);
  font-size: 11px;
  opacity: 0.85;
}
.spexr-smart-search__ai-icon--pulsing {
  animation: spexr-ai-pulse 1.1s ease-in-out infinite;
}
@keyframes spexr-ai-pulse {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 1; }
}
```

- [ ] **Step 6: Typecheck + build**

Run: `pnpm --filter @spexr/theia-extensions exec tsc --noEmit && pnpm --filter @spexr/theia-extensions build`
Expected: clean typecheck, successful build (build also runs `copy-assets`, copying the updated CSS).

- [ ] **Step 7: Commit**

```bash
git add packages/theia-extensions/src/browser/search/smart-search-widget.tsx packages/theia-extensions/src/browser/style/spexr.css
git commit -m "feat(search): show AI descriptions with pulsing icon in results"
```

---

### Task 7: Vendor the generation model at build time

**Files:**
- Modify: `packages/theia-extensions/scripts/fetch-search-model.mjs`

**Interfaces:**
- Produces: the Qwen2.5-Coder ONNX model under `resources/models`, packaged by the existing electron-builder globs.

- [ ] **Step 1: Extend the fetch script**

Replace the body of `fetch-search-model.mjs` with a version that fetches both models:
```js
// Downloads the quantized models into resources/models so the app runs fully
// offline: all-MiniLM-L6-v2 (embeddings) and Qwen2.5-Coder-1.5B-Instruct
// (file descriptions). Run once before packaging:
//   node scripts/fetch-search-model.mjs
import { env, pipeline } from "@xenova/transformers";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const modelsDir = resolve(here, "..", "resources", "models");

env.allowRemoteModels = true;
env.cacheDir = modelsDir;

const embedId = "Xenova/all-MiniLM-L6-v2";
console.log(`Fetching ${embedId} into ${modelsDir} ...`);
await pipeline("feature-extraction", embedId, { quantized: true });

const genId = "onnx-community/Qwen2.5-Coder-1.5B-Instruct";
console.log(`Fetching ${genId} into ${modelsDir} ...`);
await pipeline("text-generation", genId, { quantized: true });

console.log("Done.");
```

- [ ] **Step 2: Verify the model id resolves (run the fetch)**

Run: `node packages/theia-extensions/scripts/fetch-search-model.mjs`
Expected: both models download into `resources/models` without error.
If `onnx-community/Qwen2.5-Coder-1.5B-Instruct` 404s, substitute the closest available ONNX coder instruct repo (e.g. `Xenova/Qwen2.5-Coder-1.5B-Instruct`) and update `GEN_MODEL_ID` in `description-generator.ts` to match, then re-run.

- [ ] **Step 3: Confirm size + presence**

Run: `du -sh packages/theia-extensions/resources/models`
Expected: roughly +1 GB versus the embedding-only size (~152 MB → ~1.2 GB).

- [ ] **Step 4: Commit**

```bash
git add packages/theia-extensions/scripts/fetch-search-model.mjs packages/theia-extensions/src/node/search/description-generator.ts
git commit -m "build(search): vendor Qwen2.5-Coder generation model"
```

---

## Final verification

- [ ] Run the full extension test suite: `pnpm --filter @spexr/theia-extensions exec vitest run`
- [ ] Typecheck: `pnpm --filter @spexr/theia-extensions exec tsc --noEmit`
- [ ] Build: `pnpm --filter @spexr/theia-extensions build`
- [ ] Manual: build the desktop app, open it, search, confirm: heuristic text appears immediately with a pulsing AI icon on the top results, the text swaps to AI-generated within a few seconds, the icon becomes solid, and the tooltip text matches. Toggle `spexr.search.aiDescriptions.enabled` off and confirm no icon and heuristic-only descriptions.
