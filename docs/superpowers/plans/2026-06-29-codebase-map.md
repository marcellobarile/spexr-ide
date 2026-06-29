# Codebase Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-triggered, pausable/resumable background job that pre-computes AI file descriptions for the whole workspace and exports them as agent-readable artifacts; smart-search then serves the precomputed descriptions.

**Architecture:** A per-workspace `DescriptionJob` orchestrator drives the existing `generateBatch` 0.5B path over all index records lacking an `aiDescription`, persisting incrementally and emitting progress over RPC. On completion a `CodebaseMapWriter` derives `.spexr/codebase-map.md` + `.spexr/descriptions.json` from the index. Smart-search is unchanged — it already prefers `aiDescription`.

**Tech Stack:** TypeScript, Theia extensions, inversify DI, JSON-RPC service/client proxy, vitest. Model: `Qwen2.5-Coder-0.5B-Instruct` via the existing worker.

## Global Constraints

- **Paths to the backend service must be absolute filesystem paths**, never `file://` URIs (`SpexrSearchService` contract).
- **Reuse the existing batch path** (`DescriptionGenerator.generateBatch`) — do not reintroduce per-file generation.
- **Batch size = 5**; **save cadence = every 5 batches** (plus on pause/stop/complete).
- **Commits are manual.** This repo's owner commits. Execution agents must STAGE changes at each checkpoint (`git add …`) and stop for the human to review/commit — never run `git commit`.
- **Spec:** `docs/superpowers/specs/2026-06-29-codebase-map-design.md` is the contract.
- Tests run from `packages/theia-extensions`: `npx vitest run <file>`.

---

## File structure

**Slice 1 — engine + export + trigger (headless, testable):**
- Create `packages/theia-extensions/src/node/search/codebase-map-writer.ts` — artifact builders + fs write.
- Create `packages/theia-extensions/src/node/search/description-job.ts` — orchestrator.
- Modify `packages/theia-extensions/src/node/search/vector-index.ts` — add `allRecords()`.
- Modify `packages/theia-extensions/src/common/search-protocol.ts` — job status type, RPC methods, client callback.
- Modify `packages/theia-extensions/src/node/search/spexr-search-backend-service.ts` — own a job per workspace, delegate, emit.
- Modify `packages/theia-extensions/src/browser/search/smart-search-client.ts` — progress event.
- Modify `packages/theia-extensions/src/browser/search/smart-search-contribution.ts` — Command Palette commands.
- Modify `.gitignore` — ignore the two artifacts.

**Slice 2 — UI surfaces:**
- Modify `packages/theia-extensions/src/browser/search/smart-search-widget.tsx` — header CTA + ⓘ tooltip + determinate progress + pause/resume.
- Modify `packages/theia-extensions/src/browser/style/spexr.css` — CTA + tooltip + progress styles.
- Create `packages/theia-extensions/src/browser/search/description-job-status-bar-contribution.ts` — status bar mirror.
- Modify the browser frontend module that binds search contributions — bind the new status-bar contribution (locate the module binding `SpexrSmartSearchContribution`).

---

# SLICE 1 — Engine, export, trigger

## Task 1: `VectorIndex.allRecords()`

**Files:**
- Modify: `packages/theia-extensions/src/node/search/vector-index.ts`
- Test: `packages/theia-extensions/src/node/search/vector-index.test.ts`

**Interfaces:**
- Produces: `VectorIndex.allRecords(): IndexRecord[]` — every record, insertion order.

- [ ] **Step 1: Write the failing test**

Append to `vector-index.test.ts`:

```ts
describe("allRecords", () => {
  it("returns every upserted record in insertion order", () => {
    const idx = new VectorIndex();
    idx.upsert({ path: "b.ts", vector: new Float32Array([1]), mtimeMs: 0, hash: "h1", snippet: "", category: "other", description: "B" });
    idx.upsert({ path: "a.ts", vector: new Float32Array([1]), mtimeMs: 0, hash: "h2", snippet: "", category: "other", description: "A" });
    expect(idx.allRecords().map((r) => r.path)).toEqual(["b.ts", "a.ts"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/node/search/vector-index.test.ts -t allRecords`
Expected: FAIL — `allRecords is not a function`.

- [ ] **Step 3: Implement**

In `vector-index.ts`, after `getRecord`:

```ts
  /** All records, in insertion order. */
  allRecords(): IndexRecord[] {
    return [...this.records.values()];
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/node/search/vector-index.test.ts -t allRecords`
Expected: PASS.

- [ ] **Step 5: Checkpoint (stage only)**

```bash
git add packages/theia-extensions/src/node/search/vector-index.ts packages/theia-extensions/src/node/search/vector-index.test.ts
```

---

## Task 2: `CodebaseMapWriter`

**Files:**
- Create: `packages/theia-extensions/src/node/search/codebase-map-writer.ts`
- Test: `packages/theia-extensions/src/node/search/codebase-map-writer.test.ts`

**Interfaces:**
- Consumes: `IndexRecord` from `./vector-index.js`.
- Produces:
  - `buildCodebaseMapMarkdown(records: IndexRecord[]): string`
  - `buildDescriptionsJson(records: IndexRecord[]): string`
  - `class CodebaseMapWriter { constructor(root: string); write(records: IndexRecord[]): Promise<void> }`

- [ ] **Step 1: Write the failing test**

Create `codebase-map-writer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCodebaseMapMarkdown, buildDescriptionsJson } from "./codebase-map-writer.js";
import type { IndexRecord } from "./vector-index.js";

const rec = (path: string, category: string, description: string, aiDescription?: string): IndexRecord => ({
  path, category, description, aiDescription,
  vector: new Float32Array([1]), mtimeMs: 0, hash: "h", snippet: "",
});

describe("buildDescriptionsJson", () => {
  it("keys by path with best-available description and category, sorted", () => {
    const json = JSON.parse(buildDescriptionsJson([
      rec("src/b.ts", "frontend", "static B", "AI B"),
      rec("src/a.ts", "backend", "static A"),
    ]));
    expect(Object.keys(json)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(json["src/b.ts"]).toEqual({ description: "AI B", category: "frontend" });
    expect(json["src/a.ts"]).toEqual({ description: "static A", category: "backend" });
  });
});

describe("buildCodebaseMapMarkdown", () => {
  it("groups by top-level folder then category and prefers aiDescription", () => {
    const md = buildCodebaseMapMarkdown([
      rec("src/ui/Button.tsx", "frontend", "exports Button", "Renders a button."),
      rec("src/api/users.ts", "backend", "Lists users."),
      rec("README.md", "other", "Project readme."),
    ]);
    expect(md).toContain("## (root)");
    expect(md).toContain("## src");
    expect(md).toContain("### frontend");
    expect(md).toContain("- `src/ui/Button.tsx` — Renders a button.");
    expect(md).toContain("- `src/api/users.ts` — Lists users.");
    expect(md.indexOf("## (root)")).toBeLessThan(md.indexOf("## src"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/node/search/codebase-map-writer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `codebase-map-writer.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IndexRecord } from "./vector-index.js";

function bestDescription(r: IndexRecord): string {
  return r.aiDescription ?? r.description ?? "";
}

function topFolder(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? "(root)" : path.slice(0, i);
}

function groupBy(records: IndexRecord[], keyOf: (r: IndexRecord) => string): Map<string, IndexRecord[]> {
  const m = new Map<string, IndexRecord[]>();
  for (const r of records) {
    const k = keyOf(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** Machine-readable map: `{ path: { description, category } }`, path-sorted. */
export function buildDescriptionsJson(records: IndexRecord[]): string {
  const sorted = [...records].sort((a, b) => a.path.localeCompare(b.path));
  const obj: Record<string, { description: string; category: string }> = {};
  for (const r of sorted) obj[r.path] = { description: bestDescription(r), category: r.category };
  return JSON.stringify(obj, null, 2);
}

/** Human/agent-readable map grouped by top-level folder, then category. */
export function buildCodebaseMapMarkdown(records: IndexRecord[]): string {
  const sorted = [...records].sort((a, b) => a.path.localeCompare(b.path));
  const lines: string[] = ["# Codebase map", ""];
  const byFolder = groupBy(sorted, (r) => topFolder(r.path));
  for (const folder of [...byFolder.keys()].sort()) {
    lines.push(`## ${folder}`, "");
    const byCat = groupBy(byFolder.get(folder)!, (r) => r.category);
    for (const cat of [...byCat.keys()].sort()) {
      lines.push(`### ${cat}`, "");
      for (const r of byCat.get(cat)!) lines.push(`- \`${r.path}\` — ${bestDescription(r)}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** Writes both artifacts under `<root>/.spexr/`. */
export class CodebaseMapWriter {
  constructor(private readonly root: string) {}

  async write(records: IndexRecord[]): Promise<void> {
    const dir = join(this.root, ".spexr");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "codebase-map.md"), buildCodebaseMapMarkdown(records), "utf8");
    await writeFile(join(dir, "descriptions.json"), buildDescriptionsJson(records), "utf8");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/node/search/codebase-map-writer.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint (stage only)**

```bash
git add packages/theia-extensions/src/node/search/codebase-map-writer.ts packages/theia-extensions/src/node/search/codebase-map-writer.test.ts
```

---

## Task 3: Protocol job-status types

Types only — additive, keeps the build green. The RPC method signatures and the
client callback are added together with their implementations in Task 5, so the
interface and every implementor change in one commit.

**Files:**
- Modify: `packages/theia-extensions/src/common/search-protocol.ts`

**Interfaces:**
- Produces (imported by Tasks 4–7):
  - `DescriptionJobState = "idle" | "running" | "paused" | "complete" | "error"`
  - `DescriptionJobStatus { state: DescriptionJobState; done: number; total: number; message?: string }`

- [ ] **Step 1: Add the types**

In `search-protocol.ts`, after the `DescriptionUpdate` interface:

```ts
export type DescriptionJobState = "idle" | "running" | "paused" | "complete" | "error";

/** Progress of the workspace-wide description generation job. */
export interface DescriptionJobStatus {
  state: DescriptionJobState;
  /** Targets processed this run (reaches `total` at completion). */
  done: number;
  /** Size of the target set, fixed when the job starts. */
  total: number;
  /** Set when `state` is `error`. */
  message?: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS (additive types only).

- [ ] **Step 3: Checkpoint (stage only)**

```bash
git add packages/theia-extensions/src/common/search-protocol.ts
```

---

## Task 4: `DescriptionJob` orchestrator

**Files:**
- Create: `packages/theia-extensions/src/node/search/description-job.ts`
- Test: `packages/theia-extensions/src/node/search/description-job.test.ts`

**Interfaces:**
- Consumes: `VectorIndex`, `IndexRecord` (`./vector-index.js`); `DescriptionGenerator`, `BatchItem` (`./description-format.js`); `DescriptionJobStatus` (`../../common/search-protocol.js`).
- Produces:
  - `interface DescriptionJobDeps { index: VectorIndex; generator: DescriptionGenerator; readContent: (relPath: string) => Promise<string>; save: () => Promise<void>; writeArtifacts: () => Promise<void>; emit: (status: DescriptionJobStatus) => void }`
  - `class DescriptionJob { constructor(deps: DescriptionJobDeps); get status(): DescriptionJobStatus; start(opts: { regenerate: boolean }): Promise<void>; pause(): void; resume(): Promise<void> }`

Note: `start()` and `resume()` resolve when the job settles (complete/paused/error) — this makes them awaitable in tests. The backend (Task 5) calls them with `void` so RPC returns immediately.

- [ ] **Step 1: Write the failing tests**

Create `description-job.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DescriptionJob, type DescriptionJobDeps } from "./description-job.js";
import { VectorIndex, type IndexRecord } from "./vector-index.js";
import type { BatchItem, DescriptionGenerator } from "./description-format.js";
import type { DescriptionJobStatus } from "../../common/search-protocol.js";

const rec = (path: string, aiDescription?: string): IndexRecord => ({
  path, aiDescription, category: "other", description: "static",
  vector: new Float32Array([1]), mtimeMs: 0, hash: "h", snippet: "",
});

class FakeGen implements DescriptionGenerator {
  available = true;
  calls: BatchItem[][] = [];
  beforeResolve?: () => void;
  isAvailable(): boolean { return this.available; }
  async generateBatch(items: BatchItem[]): Promise<(string | null)[]> {
    this.calls.push(items);
    this.beforeResolve?.();
    return items.map((it) => `desc:${it.relPath}`);
  }
}

interface JobEnv {
  d: DescriptionJobDeps;
  statuses: DescriptionJobStatus[];
  state: { saves: number; artifacts: number };
}

function deps(index: VectorIndex, gen: DescriptionGenerator, over: Partial<DescriptionJobDeps> = {}): JobEnv {
  const statuses: DescriptionJobStatus[] = [];
  const state = { saves: 0, artifacts: 0 };
  const d: DescriptionJobDeps = {
    index, generator: gen,
    readContent: async (rel) => `content of ${rel}`,
    save: async () => { state.saves++; },
    writeArtifacts: async () => { state.artifacts++; },
    emit: (s) => statuses.push({ ...s }),
    ...over,
  };
  return { d, statuses, state };
}

describe("DescriptionJob", () => {
  it("describes only records missing aiDescription by default", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    idx.upsert(rec("b.ts", "already"));
    idx.upsert(rec("c.ts"));
    const gen = new FakeGen();
    const { d } = deps(idx, gen);
    const job = new DescriptionJob(d);
    await job.start({ regenerate: false });
    expect(gen.calls.flat().map((i) => i.relPath).sort()).toEqual(["a.ts", "c.ts"]);
    expect(idx.getRecord("a.ts")!.aiDescription).toBe("desc:a.ts");
    expect(idx.getRecord("b.ts")!.aiDescription).toBe("already");
    expect(job.status).toMatchObject({ state: "complete", done: 2, total: 2 });
  });

  it("regenerate=true reprocesses every record", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts", "old"));
    const gen = new FakeGen();
    const { d } = deps(idx, gen);
    const job = new DescriptionJob(d);
    await job.start({ regenerate: true });
    expect(idx.getRecord("a.ts")!.aiDescription).toBe("desc:a.ts");
  });

  it("writes artifacts exactly once on completion", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    const gen = new FakeGen();
    const env = deps(idx, gen);
    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });
    expect(env.state.artifacts).toBe(1);
  });

  it("pauses after the current batch and resumes the rest", async () => {
    const idx = new VectorIndex();
    for (let i = 0; i < 8; i++) idx.upsert(rec(`f${i}.ts`)); // 2 batches of 5 + remainder
    const gen = new FakeGen();
    const env = deps(idx, gen);
    const job = new DescriptionJob(env.d);
    gen.beforeResolve = () => { gen.beforeResolve = undefined; job.pause(); }; // pause during first batch
    await job.start({ regenerate: false });
    expect(job.status.state).toBe("paused");
    expect(job.status.done).toBe(5);
    await job.resume();
    expect(job.status).toMatchObject({ state: "complete", done: 8, total: 8 });
  });

  it("ends in error when the model is unavailable", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    const gen = new FakeGen();
    gen.available = false;
    const env = deps(idx, gen);
    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });
    expect(job.status.state).toBe("error");
    expect(env.state.artifacts).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/node/search/description-job.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `description-job.ts`:

```ts
import type { VectorIndex } from "./vector-index.js";
import type { BatchItem, DescriptionGenerator } from "./description-format.js";
import type { DescriptionJobStatus } from "../../common/search-protocol.js";

const BATCH_SIZE = 5;
const SAVE_EVERY_BATCHES = 5;

export interface DescriptionJobDeps {
  index: VectorIndex;
  generator: DescriptionGenerator;
  /** Read a workspace-relative file's content. */
  readContent: (relPath: string) => Promise<string>;
  /** Persist the index. */
  save: () => Promise<void>;
  /** Write the export artifacts (called once on completion). */
  writeArtifacts: () => Promise<void>;
  /** Push a status snapshot to observers. */
  emit: (status: DescriptionJobStatus) => void;
}

/**
 * Workspace-wide description generator. Walks every record missing an
 * aiDescription (or all, when regenerating), batching them through the model,
 * persisting incrementally, and exporting artifacts on completion. Pausing is
 * cooperative — it takes effect between batches, never mid-inference.
 */
export class DescriptionJob {
  private state: DescriptionJobStatus["state"] = "idle";
  private done = 0;
  private total = 0;
  private message?: string;
  private targets: string[] = [];
  private cursor = 0;
  private pauseRequested = false;

  constructor(private readonly deps: DescriptionJobDeps) {}

  get status(): DescriptionJobStatus {
    return { state: this.state, done: this.done, total: this.total, message: this.message };
  }

  async start(opts: { regenerate: boolean }): Promise<void> {
    if (this.state === "running") return;
    this.targets = this.deps.index
      .allRecords()
      .filter((r) => opts.regenerate || r.aiDescription === undefined)
      .map((r) => r.path);
    this.cursor = 0;
    this.done = 0;
    this.total = this.targets.length;
    this.message = undefined;
    this.pauseRequested = false;
    this.state = "running";
    this.deps.emit(this.status);
    await this.run();
  }

  pause(): void {
    if (this.state === "running") this.pauseRequested = true;
  }

  async resume(): Promise<void> {
    if (this.state !== "paused") return;
    this.pauseRequested = false;
    this.state = "running";
    this.deps.emit(this.status);
    await this.run();
  }

  private async run(): Promise<void> {
    let batches = 0;
    while (this.cursor < this.targets.length) {
      if (this.pauseRequested) {
        this.state = "paused";
        await this.deps.save();
        this.deps.emit(this.status);
        return;
      }
      if (!this.deps.generator.isAvailable()) {
        this.state = "error";
        this.message = "Description model unavailable.";
        await this.deps.save();
        this.deps.emit(this.status);
        return;
      }
      const batch = this.targets.slice(this.cursor, this.cursor + BATCH_SIZE);
      const items: BatchItem[] = [];
      for (const relPath of batch) {
        try {
          items.push({ relPath, content: await this.deps.readContent(relPath) });
        } catch {
          // Unreadable file: skip generation but still count it as processed.
        }
      }
      const texts = await this.deps.generator.generateBatch(items);
      items.forEach((it, i) => {
        const text = texts[i];
        if (text) this.deps.index.setAiDescription(it.relPath, text);
      });
      this.cursor += batch.length;
      this.done = this.cursor;
      batches++;
      if (batches % SAVE_EVERY_BATCHES === 0) await this.deps.save();
      this.deps.emit(this.status);
    }
    await this.deps.save();
    await this.deps.writeArtifacts();
    this.state = "complete";
    this.deps.emit(this.status);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/node/search/description-job.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Checkpoint (stage only)**

```bash
git add packages/theia-extensions/src/node/search/description-job.ts packages/theia-extensions/src/node/search/description-job.test.ts
```

---

## Task 5: Full wiring — protocol methods, backend, client, commands, gitignore

This single task adds the RPC method signatures and the client callback to the
protocol **together with** every implementor (backend service, client dispatcher)
plus the Command Palette commands and the `.gitignore` entries — so the build is
green at the end of the task (no intermediate red state).

**Files:**
- Modify: `packages/theia-extensions/src/common/search-protocol.ts`
- Modify: `packages/theia-extensions/src/node/search/spexr-search-backend-service.ts`
- Modify: `packages/theia-extensions/src/browser/search/smart-search-client.ts`
- Modify: `packages/theia-extensions/src/browser/search/smart-search-contribution.ts`
- Modify: `.gitignore`
- Test: `packages/theia-extensions/src/node/search/spexr-search-backend-service.test.ts`

**Interfaces:**
- Consumes: `DescriptionJob`, `DescriptionJobDeps` (Task 4); `CodebaseMapWriter` (Task 2); `DescriptionJobStatus` (Task 3).
- Produces:
  - protocol: `SpexrSearchClient.onDescriptionJobProgress(status): void`; `SpexrSearchService.startDescriptionJob(root, { regenerate }): Promise<void>`, `pauseDescriptionJob(root): Promise<void>`, `resumeDescriptionJob(root): Promise<void>`, `getDescriptionJobStatus(root): Promise<DescriptionJobStatus>`.
  - `SpexrSearchClientDispatcher.onDescriptionJobProgress$: Event<DescriptionJobStatus>`.
  - commands `spexr.search.map`, `spexr.search.mapPause`, `spexr.search.mapResume`, `spexr.search.regenerateDescriptions`.

- [ ] **Step 1: Write the failing test**

In `spexr-search-backend-service.test.ts`, extend `FakeGenerator` to record calls and add a job test. Append:

```ts
describe("description job", () => {
  it("generates descriptions for all files, emits progress, and writes artifacts", async () => {
    await writeFile(join(root, "auth.ts"), "auth");
    await writeFile(join(root, "ui.ts"), "ui");
    const service = serviceWith("Generated.");
    const jobStatuses: import("../../common/search-protocol.js").DescriptionJobStatus[] = [];
    service.setClient({
      onDescriptionUpdate: () => undefined,
      onDescriptionJobProgress: (s) => jobStatuses.push(s),
    });
    await service.ensureIndexed(root);
    await waitReady(service);

    await service.startDescriptionJob(root, { regenerate: false });
    // start() returns immediately; poll until the job reports complete.
    for (let i = 0; i < 50 && (await service.getDescriptionJobStatus(root)).state !== "complete"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const status = await service.getDescriptionJobStatus(root);
    expect(status.state).toBe("complete");
    expect(jobStatuses.some((s) => s.state === "running")).toBe(true);
    const mapped = JSON.parse(await readFile(join(root, ".spexr", "descriptions.json"), "utf8"));
    expect(Object.keys(mapped).sort()).toEqual(["auth.ts", "ui.ts"]);
    expect(mapped["auth.ts"].description).toBe("Generated.");
  });
});
```

Add `readFile` to the existing `node:fs/promises` import at the top of the test file (currently `mkdtemp, writeFile, rm`).

Update the two `setClient` calls already in the file (`collectClient` and the unavailable test) to also provide `onDescriptionJobProgress: () => undefined` so they still satisfy `SpexrSearchClient`. In `collectClient`:

```ts
function collectClient(svc: SpexrSearchBackendService): DescriptionUpdate[] {
  const updates: DescriptionUpdate[] = [];
  svc.setClient({ onDescriptionUpdate: (u) => updates.push(u), onDescriptionJobProgress: () => undefined });
  return updates;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/node/search/spexr-search-backend-service.test.ts -t "description job"`
Expected: FAIL — `startDescriptionJob is not a function`.

- [ ] **Step 3: Add protocol method signatures + client callback**

In `search-protocol.ts`, add to `SpexrSearchClient`:

```ts
  onDescriptionJobProgress(status: DescriptionJobStatus): void;
```

Add to `SpexrSearchService` (after `describeFiles`):

```ts
  /** Start the workspace-wide description job. `regenerate` overwrites existing AI descriptions. */
  startDescriptionJob(root: string, opts: { regenerate: boolean }): Promise<void>;
  /** Request the running job to pause after the current batch. */
  pauseDescriptionJob(root: string): Promise<void>;
  /** Resume a paused job. */
  resumeDescriptionJob(root: string): Promise<void>;
  /** Current job status (idle if never started). */
  getDescriptionJobStatus(root: string): Promise<DescriptionJobStatus>;
```

- [ ] **Step 4: Add the client dispatcher event**

Replace the body of `smart-search-client.ts` with:

```ts
import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { SpexrSearchClient, DescriptionUpdate, DescriptionJobStatus } from "../../common/search-protocol.js";

export const SpexrSearchClientToken = Symbol("SpexrSearchClientDispatcher");

/**
 * Singleton client registered on the search RPC proxy. The backend pushes
 * per-file description progress and whole-workspace job progress here; widgets
 * subscribe to the events.
 */
@injectable()
export class SpexrSearchClientDispatcher implements SpexrSearchClient {
  private readonly descEmitter = new Emitter<DescriptionUpdate>();
  readonly onDescriptionUpdate$: Event<DescriptionUpdate> = this.descEmitter.event;

  private readonly jobEmitter = new Emitter<DescriptionJobStatus>();
  readonly onDescriptionJobProgress$: Event<DescriptionJobStatus> = this.jobEmitter.event;

  onDescriptionUpdate(update: DescriptionUpdate): void {
    this.descEmitter.fire(update);
  }

  onDescriptionJobProgress(status: DescriptionJobStatus): void {
    this.jobEmitter.fire(status);
  }
}
```

- [ ] **Step 5: Implement the backend service methods**

In `spexr-search-backend-service.ts`:

Add imports:

```ts
import { DescriptionJob } from "./description-job.js";
import { CodebaseMapWriter } from "./codebase-map-writer.js";
import type { DescriptionJobStatus } from "../../common/search-protocol.js";
```

Add to the `Workspace` interface:

```ts
  descriptionJob?: DescriptionJob;
```

Add a job factory and the four methods (place after `describeFiles` / `resolveOrCollect`):

```ts
  private getJob(ws: Workspace, root: string): DescriptionJob {
    if (!ws.descriptionJob) {
      ws.descriptionJob = new DescriptionJob({
        index: ws.indexer.index,
        generator: this.generator,
        readContent: (rel) => readFile(join(root, rel), "utf8"),
        save: () => ws.indexer.save(),
        writeArtifacts: () => new CodebaseMapWriter(root).write(ws.indexer.index.allRecords()),
        emit: (s) => this.client?.onDescriptionJobProgress(s),
      });
    }
    return ws.descriptionJob;
  }

  async startDescriptionJob(root: string, opts: { regenerate: boolean }): Promise<void> {
    const ws = this.getOrCreate(root);
    if (ws.status.state !== "ready") await this.build(ws, root);
    if (ws.status.state !== "ready") return; // build failed → leave job idle
    void this.getJob(ws, root).start(opts); // fire-and-forget; progress streams via emit
  }

  async pauseDescriptionJob(root: string): Promise<void> {
    this.workspaces.get(root)?.descriptionJob?.pause();
  }

  async resumeDescriptionJob(root: string): Promise<void> {
    await this.workspaces.get(root)?.descriptionJob?.resume();
  }

  async getDescriptionJobStatus(root: string): Promise<DescriptionJobStatus> {
    return this.workspaces.get(root)?.descriptionJob?.status ?? { state: "idle", done: 0, total: 0 };
  }
```

- [ ] **Step 6: Add commands**

In `smart-search-contribution.ts`, extend `SmartSearchCommands`:

```ts
export const SmartSearchCommands = {
  REINDEX: { id: "spexr.search.reindex", label: "Smart Search: Reindex Workspace" } satisfies Command,
  MAP: { id: "spexr.search.map", label: "Spexr: Map this codebase" } satisfies Command,
  MAP_PAUSE: { id: "spexr.search.mapPause", label: "Spexr: Pause mapping" } satisfies Command,
  MAP_RESUME: { id: "spexr.search.mapResume", label: "Spexr: Resume mapping" } satisfies Command,
  REGENERATE: { id: "spexr.search.regenerateDescriptions", label: "Spexr: Regenerate all descriptions" } satisfies Command,
} as const;
```

Extend `registerCommands`:

```ts
    commands.registerCommand(SmartSearchCommands.MAP, {
      execute: () => this.startMap(false),
      isEnabled: () => this.root() !== undefined,
    });
    commands.registerCommand(SmartSearchCommands.REGENERATE, {
      execute: () => this.startMap(true),
      isEnabled: () => this.root() !== undefined,
    });
    commands.registerCommand(SmartSearchCommands.MAP_PAUSE, {
      execute: () => this.mapControl("pause"),
      isEnabled: () => this.root() !== undefined,
    });
    commands.registerCommand(SmartSearchCommands.MAP_RESUME, {
      execute: () => this.mapControl("resume"),
      isEnabled: () => this.root() !== undefined,
    });
```

Add the helpers (after `reindex`):

```ts
  private async startMap(regenerate: boolean): Promise<void> {
    const root = this.root();
    if (!root) return;
    try {
      await this.service.startDescriptionJob(root, { regenerate });
    } catch (err) {
      this.messages.error(`Codebase mapping failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async mapControl(action: "pause" | "resume"): Promise<void> {
    const root = this.root();
    if (!root) return;
    if (action === "pause") await this.service.pauseDescriptionJob(root);
    else await this.service.resumeDescriptionJob(root);
  }
```

- [ ] **Step 7: Ignore the artifacts**

In `.gitignore`, near the existing `.spexr/settings.json` line (29), add:

```
.spexr/codebase-map.md
.spexr/descriptions.json
```

- [ ] **Step 8: Verify — tests then typecheck**

Run: `npx vitest run src/node/search/spexr-search-backend-service.test.ts`
Expected: PASS (existing + new "description job").

Run: `npx vitest run src/node/search/`
Expected: PASS (whole search suite).

Run: `npx tsc --noEmit -p .`
Expected: PASS, exit 0 (interface and all implementors changed together).

- [ ] **Step 9: Checkpoint (stage only)**

```bash
git add packages/theia-extensions/src/common/search-protocol.ts \
  packages/theia-extensions/src/node/search/spexr-search-backend-service.ts \
  packages/theia-extensions/src/node/search/spexr-search-backend-service.test.ts \
  packages/theia-extensions/src/browser/search/smart-search-client.ts \
  packages/theia-extensions/src/browser/search/smart-search-contribution.ts \
  .gitignore
```

---

# SLICE 2 — UI surfaces

## Task 6: Header CTA, info tooltip, determinate progress, pause/resume

**Files:**
- Modify: `packages/theia-extensions/src/browser/search/smart-search-widget.tsx`
- Modify: `packages/theia-extensions/src/browser/style/spexr.css`

**Interfaces:**
- Consumes: `SpexrSearchClientDispatcher.onDescriptionJobProgress$` (Task 5); service job methods (Task 5).

Smart-search has no widget-level unit tests (it is a `ReactWidget`); verify this task by typecheck + the manual smoke at the end.

- [ ] **Step 1: Add job state + subscription**

In `smart-search-widget.tsx`, add to the imports the `DescriptionJobStatus` type:

```ts
import type { SearchHit, IndexStatus, SpexrSearchService, DescriptionUpdate, DescriptionJobStatus } from "../../common/search-protocol.js";
```

Add a field near `aiDone`:

```ts
  private jobStatus: DescriptionJobStatus = { state: "idle", done: 0, total: 0 };
```

In `init()`, after the existing `onDescriptionUpdate$` subscription:

```ts
    this.toDispose.push(this.searchClient.onDescriptionJobProgress$((s) => { this.jobStatus = s; this.update(); }));
    void this.refreshJobStatus();
```

Add the helper methods (near `requestAiDescriptions`):

```ts
  private async refreshJobStatus(): Promise<void> {
    const root = this.root();
    if (root) { this.jobStatus = await this.service.getDescriptionJobStatus(root); this.update(); }
  }

  private startMap = (regenerate: boolean): void => {
    const root = this.root();
    if (root) void this.service.startDescriptionJob(root, { regenerate });
  };

  private pauseMap = (): void => {
    const root = this.root();
    if (root) void this.service.pauseDescriptionJob(root);
  };

  private resumeMap = (): void => {
    const root = this.root();
    if (root) void this.service.resumeDescriptionJob(root);
  };
```

- [ ] **Step 2: Render the header**

In `render()`, insert the header just inside `spexr-smart-search__body`, before the `<input>`:

```tsx
        {this.renderMapHeader()}
```

Add `renderMapHeader`:

```tsx
  private renderMapHeader(): React.ReactNode {
    const { state, done, total } = this.jobStatus;
    const running = state === "running";
    const paused = state === "paused";
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
      <div className="spexr-smart-search__map">
        <div className="spexr-smart-search__map-row">
          {running ? (
            <button className="spexr-smart-search__map-cta" onClick={this.pauseMap} title="Pause mapping">
              ✦ Pause
            </button>
          ) : paused ? (
            <button className="spexr-smart-search__map-cta" onClick={this.resumeMap} title="Resume mapping">
              ✦ Resume
            </button>
          ) : (
            <button className="spexr-smart-search__map-cta" onClick={() => this.startMap(false)}>
              ✦ Map this codebase
            </button>
          )}
          <span
            className="spexr-smart-search__map-info"
            title="Pre-compute AI descriptions for every file so search is instant and agents can orient in the codebase."
          >
            ⓘ
          </span>
          {(state === "idle" || state === "complete") && (
            <button
              className="spexr-smart-search__map-regen"
              onClick={() => this.startMap(true)}
              title="Regenerate all descriptions"
            >
              ↻
            </button>
          )}
        </div>
        {(running || paused) && (
          <div className="spexr-smart-search__map-progress">
            <span className="spexr-smart-search__map-track">
              <span className="spexr-smart-search__map-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="spexr-smart-search__map-count">{done}/{total}</span>
          </div>
        )}
        {state === "error" && (
          <div className="spexr-smart-search__map-error">{this.jobStatus.message ?? "Mapping failed."}</div>
        )}
      </div>
    );
  }
```

- [ ] **Step 3: Styles**

Append to `spexr.css`:

```css
.spexr-smart-search__map {
  padding: 4px 6px 8px;
}
.spexr-smart-search__map-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.spexr-smart-search__map-cta {
  flex: 1;
  border: 1px solid var(--theia-textLink-foreground, #b18cff);
  background: transparent;
  color: var(--theia-textLink-foreground, #b18cff);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.spexr-smart-search__map-cta:hover {
  background: var(--theia-textLink-foreground, #b18cff);
  color: var(--theia-editor-background, #1e1e1e);
}
.spexr-smart-search__map-info,
.spexr-smart-search__map-regen {
  opacity: 0.6;
  cursor: pointer;
  font-size: 12px;
  background: none;
  border: none;
  color: inherit;
}
.spexr-smart-search__map-info:hover,
.spexr-smart-search__map-regen:hover {
  opacity: 1;
}
.spexr-smart-search__map-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 11px;
}
.spexr-smart-search__map-track {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: rgba(168, 85, 247, 0.18);
  overflow: hidden;
}
.spexr-smart-search__map-fill {
  display: block;
  height: 100%;
  background: var(--theia-textLink-foreground, #b18cff);
  transition: width 0.3s ease;
}
.spexr-smart-search__map-error {
  margin-top: 6px;
  font-size: 11px;
  color: var(--theia-errorForeground, #f48771);
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Checkpoint (stage only)**

```bash
git add packages/theia-extensions/src/browser/search/smart-search-widget.tsx packages/theia-extensions/src/browser/style/spexr.css
```

---

## Task 7: Status bar mirror

**Files:**
- Create: `packages/theia-extensions/src/browser/search/description-job-status-bar-contribution.ts`
- Modify: `packages/theia-extensions/src/browser/spexr-frontend-module.ts` (binds `SpexrSmartSearchContribution` at lines 241–243; `FrontendApplicationContribution` is already imported there).

**Interfaces:**
- Consumes: `SpexrSearchClientDispatcher.onDescriptionJobProgress$`; Theia `StatusBar`, `StatusBarAlignment`.

- [ ] **Step 1: Implement the contribution**

Create `description-job-status-bar-contribution.ts`:

```ts
import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import { CommandService } from "@theia/core/lib/common/command";
import { SpexrSearchClientDispatcher } from "./smart-search-client.js";
import { SmartSearchCommands } from "./smart-search-contribution.js";
import type { DescriptionJobStatus } from "../../common/search-protocol.js";

const ENTRY_ID = "spexr-description-job";

/** Mirrors the codebase-mapping job in the status bar; click toggles pause/resume. */
@injectable()
export class DescriptionJobStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(SpexrSearchClientDispatcher) private readonly client!: SpexrSearchClientDispatcher;
  @inject(CommandService) private readonly commands!: CommandService;

  onStart(): void {
    this.client.onDescriptionJobProgress$((s) => this.render(s));
  }

  private render(s: DescriptionJobStatus): void {
    if (s.state === "idle" || s.state === "complete") {
      this.statusBar.removeElement(ENTRY_ID);
      return;
    }
    const text =
      s.state === "running" ? `$(sparkle) Mapping ${s.done}/${s.total}`
      : s.state === "paused" ? `$(debug-pause) Mapping paused ${s.done}/${s.total}`
      : `$(error) Mapping failed`;
    void this.statusBar.setElement(ENTRY_ID, {
      text,
      alignment: StatusBarAlignment.LEFT,
      priority: 100,
      tooltip: s.state === "running" ? "Click to pause mapping" : "Click to resume mapping",
      command: s.state === "paused" ? SmartSearchCommands.MAP_RESUME.id : SmartSearchCommands.MAP_PAUSE.id,
    });
  }
}
```

- [ ] **Step 2: Bind it**

In `packages/theia-extensions/src/browser/spexr-frontend-module.ts`, add the import near the other `./search/...` imports (lines 74–76):

```ts
import { DescriptionJobStatusBarContribution } from "./search/description-job-status-bar-contribution.js";
```

Then, immediately after line 242 (`bind(FrontendApplicationContribution).toService(SpexrSmartSearchContribution);`), add:

```ts
  bind(DescriptionJobStatusBarContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(DescriptionJobStatusBarContribution);
```

`FrontendApplicationContribution` is already imported in this module (line 5) — do not re-import.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 4: Checkpoint (stage only)**

```bash
git add packages/theia-extensions/src/browser/search/description-job-status-bar-contribution.ts <the-modified-frontend-module>
```

---

## Final verification

- [ ] **Run the full search test suite**

Run (from `packages/theia-extensions`): `npx vitest run src/node/search/`
Expected: all PASS.

- [ ] **Typecheck the package**

Run: `npx tsc --noEmit -p .`
Expected: PASS, exit 0.

- [ ] **Lint touched files**

Run: `npx eslint src/node/search/description-job.ts src/node/search/codebase-map-writer.ts src/node/search/spexr-search-backend-service.ts src/browser/search/smart-search-widget.tsx src/browser/search/description-job-status-bar-contribution.ts`
Expected: exit 0.

- [ ] **Manual smoke (requires webpack build + vendored model):** build the desktop app, open the Explorer, click `✦ Map this codebase`, confirm: determinate progress advances, pause/resume works, status bar mirrors, and on completion `.spexr/codebase-map.md` + `.spexr/descriptions.json` exist and a fresh search shows the precomputed descriptions without an on-demand spinner.

- [ ] **Hand off to the human to review staged changes and commit.**
