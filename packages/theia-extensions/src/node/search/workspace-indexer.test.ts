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
