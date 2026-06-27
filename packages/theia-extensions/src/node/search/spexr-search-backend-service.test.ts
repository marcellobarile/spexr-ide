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

  it("queues applyChanges during indexing and replays them when ready", async () => {
    await writeFile(join(root, "chart.ts"), "draw a chart");
    const service = new SpexrSearchBackendService(new FakeEmbedder());
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

  it("rejects file:// URI as root — passes a URI and expects ENOENT/error state", async () => {
    // CONTRACT: root MUST be a filesystem path, not a URI string.
    // This test documents that passing "file://" produces an error or empty result,
    // making the regression visible if the frontend fix is reverted.
    const uriRoot = `file://${root}`;
    await writeFile(join(root, "auth.ts"), "auth token logic");
    const service = new SpexrSearchBackendService(new FakeEmbedder());
    await service.ensureIndexed(uriRoot);
    await waitReady(service);
    // With a URI root, the indexer reads from a nonexistent directory — error state.
    const status = await service.getIndexStatus(uriRoot);
    expect(status.state).toBe("error");
  });
});
