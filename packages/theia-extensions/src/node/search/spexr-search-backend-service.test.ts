/**
 * CONTRACT: `root` passed to all SpexrSearchBackendService methods MUST be an
 * absolute filesystem path (e.g. `/tmp/proj`), NOT a `file://` URI string.
 * The fixtures below use `mkdtemp()` which always returns plain paths — this
 * is intentional and must be preserved.  Passing a URI string causes every
 * `path.join(root, rel)` in WorkspaceIndexer to produce garbage, resulting in
 * ENOENT on all filesystem operations.  The regression test "rejects file:// URI
 * as root" below documents this contract and fails loudly if the frontend fix is
 * accidentally reverted.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpexrSearchBackendService } from "./spexr-search-backend-service.js";
import type { Embedder } from "./embedding-model.js";
import type { BatchItem, DescriptionGenerator } from "./description-format.js";
import type { DescriptionUpdate } from "../../common/search-protocol.js";

/** Fake generator: returns a fixed text (or null) per item, in one batch. */
class FakeGenerator implements DescriptionGenerator {
  constructor(private readonly fn: (path: string) => string | null = () => "desc.") {}
  available = true;
  isAvailable(): boolean { return this.available; }
  async generateBatch(items: BatchItem[]): Promise<(string | null)[]> {
    return items.map((it) => this.fn(it.relPath));
  }
}

const noopGenerator = (): FakeGenerator => new FakeGenerator(() => "");

/** Build a service with a fake embedder and a generator returning `text`. */
function serviceWith(text: string | null): SpexrSearchBackendService {
  return new SpexrSearchBackendService(new FakeEmbedder(), new FakeGenerator(() => text));
}

/** Collects streamed description updates as a client. */
function collectClient(svc: SpexrSearchBackendService): DescriptionUpdate[] {
  const updates: DescriptionUpdate[] = [];
  svc.setClient({ onDescriptionUpdate: (u) => updates.push(u), onDescriptionJobProgress: () => undefined });
  return updates;
}

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
async function waitReady(service: SpexrSearchBackendService, workspaceRoot: string = root): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const s = await service.getIndexStatus(workspaceRoot);
    if (s.state === "ready" || s.state === "error") return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("SpexrSearchBackendService", () => {
  it("indexes on ensureIndexed and ranks matching files first", async () => {
    await writeFile(join(root, "auth.ts"), "auth token logic");
    await writeFile(join(root, "chart.ts"), "draw a chart");
    const service = new SpexrSearchBackendService(new FakeEmbedder(), noopGenerator());

    await service.ensureIndexed(root);
    await waitReady(service);
    expect((await service.getIndexStatus(root)).state).toBe("ready");

    const hits = await service.search(root, "auth");
    expect(hits[0]?.path).toBe("auth.ts");
  });

  it("returns an empty array when searching an unindexed root", async () => {
    const service = new SpexrSearchBackendService(new FakeEmbedder(), noopGenerator());
    expect(await service.search(root, "anything")).toEqual([]);
  });

  it("reports error state when the model fails", async () => {
    await writeFile(join(root, "a.ts"), "auth");
    const service = new SpexrSearchBackendService(new ThrowingEmbedder(), noopGenerator());
    await service.ensureIndexed(root);
    await waitReady(service);
    expect((await service.getIndexStatus(root)).state).toBe("error");
  });

  it("applyChanges adds and removes records", async () => {
    const service = new SpexrSearchBackendService(new FakeEmbedder(), noopGenerator());
    await service.ensureIndexed(root);
    await waitReady(service);
    await writeFile(join(root, "auth.ts"), "auth token");
    await service.applyChanges(root, ["auth.ts"], []);
    expect((await service.search(root, "auth"))[0]?.path).toBe("auth.ts");
    await service.applyChanges(root, [], ["auth.ts"]);
    expect(await service.search(root, "auth")).toEqual([]);
  });

  it("queues applyChanges during indexing and replays them when ready", async () => {
    await writeFile(join(root, "chart.ts"), "draw a chart");
    const service = new SpexrSearchBackendService(new FakeEmbedder(), noopGenerator());
    // Kick off build — do NOT await; send changes while indexing is in flight.
    void service.ensureIndexed(root);
    await writeFile(join(root, "auth.ts"), "auth token logic");
    // applyChanges arrives while state is "indexing" — must be queued, not dropped.
    await service.applyChanges(root, ["auth.ts"], []);
    await waitReady(service);
    expect((await service.getIndexStatus(root)).state).toBe("ready");
    const hits = await service.search(root, "auth");
    expect(hits[0]?.path).toBe("auth.ts");
  });

  it("reindex rebuilds from disk, not from the stale persisted index", async () => {
    await writeFile(join(root, "auth.ts"), "auth token");
    const service = new SpexrSearchBackendService(new FakeEmbedder(), noopGenerator());
    await service.ensureIndexed(root);
    await waitReady(service);
    expect((await service.search(root, "auth"))[0]?.path).toBe("auth.ts");

    // Mutate the workspace on disk WITHOUT applyChanges: only a full rebuild
    // (not a reload of the persisted index) can reflect this.
    await rm(join(root, "auth.ts"));
    await writeFile(join(root, "chart.ts"), "draw a chart");

    await service.reindex(root);
    await waitReady(service);
    expect((await service.getIndexStatus(root)).state).toBe("ready");
    // A stale reload would still return the deleted auth.ts; a true rebuild won't.
    expect(await service.search(root, "auth")).toEqual([]);
  });

  it("describeFiles emits a final done update and caches by hash", async () => {
    await writeFile(join(root, "auth.ts"), "auth token logic");
    const service = serviceWith("Handles authentication.");
    const updates = collectClient(service);
    await service.ensureIndexed(root);
    await waitReady(service);

    await service.describeFiles(root, ["auth.ts"]);
    const final = updates.find((u) => u.done && u.path === "auth.ts");
    expect(final).toMatchObject({ text: "Handles authentication.", done: true });

    // second pass is served from cache: a single done update, no failure
    updates.length = 0;
    await service.describeFiles(root, ["auth.ts"]);
    expect(updates).toEqual([{ path: "auth.ts", text: "Handles authentication.", done: true }]);
  });

  it("describeFiles ignores unknown paths (no update emitted)", async () => {
    await writeFile(join(root, "auth.ts"), "auth");
    const service = serviceWith("x");
    const updates = collectClient(service);
    await service.ensureIndexed(root);
    await waitReady(service);
    await service.describeFiles(root, ["missing.ts"]);
    expect(updates).toEqual([]);
  });

  it("describeFiles emits a failed update when the model is unavailable", async () => {
    await writeFile(join(root, "auth.ts"), "auth");
    const generator = new FakeGenerator(() => "x");
    generator.available = false;
    const service = new SpexrSearchBackendService(new FakeEmbedder(), generator);
    const updates = collectClient(service);
    await service.ensureIndexed(root);
    await waitReady(service);
    await service.describeFiles(root, ["auth.ts"]);
    expect(updates).toEqual([{ path: "auth.ts", text: "", done: true, failed: true }]);
  });

  it("rejects file:// URI as root — passes a URI and expects ENOENT/error state", async () => {
    // CONTRACT: root MUST be a filesystem path, not a URI string.
    // This test documents that passing "file://" produces an error or empty result,
    // making the regression visible if the frontend fix is reverted.
    const uriRoot = `file://${root}`;
    await writeFile(join(root, "auth.ts"), "auth token logic");
    const service = new SpexrSearchBackendService(new FakeEmbedder(), noopGenerator());
    await service.ensureIndexed(uriRoot);
    await waitReady(service, uriRoot);
    // With a URI root, the indexer reads from a nonexistent directory — error state.
    const status = await service.getIndexStatus(uriRoot);
    expect(status.state).toBe("error");
  });
});

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
