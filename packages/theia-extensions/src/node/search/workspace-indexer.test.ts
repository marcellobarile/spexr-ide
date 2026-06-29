// src/node/search/workspace-indexer.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceIndexer, buildEmbeddingInput, buildSnippet, extractDescription } from "./workspace-indexer.js";
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
    // content segment is capped at MAX_CONTENT_CHARS; symbols line sits in between
    expect(out.endsWith("x".repeat(2000))).toBe(true);
  });
  it("buildSnippet returns the first non-empty line, capped at 160 chars", () => {
    expect(buildSnippet("\n\n  hello world  \nsecond")).toBe("hello world");
    expect(buildSnippet("y".repeat(200))).toHaveLength(160);
  });
});

describe("extractDescription", () => {
  it("uses a JSDoc file header that precedes any code", () => {
    const src = `/**\n * Manages the vector index for one workspace root.\n */\nexport class WorkspaceIndexer {}`;
    expect(extractDescription(src)).toBe("Manages the vector index for one workspace root.");
  });

  it("uses a contiguous // file header that precedes any code", () => {
    const src = `// Hybrid retrieval combining BM25 and dense vectors.\n// Ranks results by reciprocal rank fusion.\nexport function search() {}`;
    expect(extractDescription(src)).toBe(
      "Hybrid retrieval combining BM25 and dense vectors. Ranks results by reciprocal rank fusion."
    );
  });

  it("ignores a doc comment attached to the first declaration (the misleading case)", () => {
    const src = `import { x } from "./x.js";\n\n/** Workaround for a Lumino drag bug; recomputes on resize. */\nexport function tweak() {}`;
    // The comment describes tweak(), not the file → structural fallback instead.
    expect(extractDescription(src)).toBe("Exports tweak.");
  });

  it("skips a license banner and keeps scanning for the real header", () => {
    const src = `/*\n * Copyright (c) 2026 Acme.\n * SPDX-License-Identifier: MIT\n */\n\n/** Parses git blame porcelain output. */\nexport const parse = () => {};`;
    expect(extractDescription(src)).toBe("Parses git blame porcelain output.");
  });

  it("falls back to the class name when no header exists", () => {
    const src = `import { Y } from "./y.js";\nexport class SearchBackendService {}`;
    expect(extractDescription(src)).toBe("Defines SearchBackendService.");
  });

  it("falls back to deduplicated export names when no header or class exists", () => {
    const src = `export const A = 1;\nexport function b() {}\nexport const A2 = 2;`;
    expect(extractDescription(src)).toBe("Exports A, b, A2.");
  });

  it("returns an empty string for files with no header, class, or exports", () => {
    expect(extractDescription('{ "key": "value" }')).toBe("");
    expect(extractDescription("const local = 1;")).toBe("");
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
    const after = embedder.calls.length;
    await indexer.updateFile("a.ts");
    expect(embedder.calls.length).toBe(after);
  });
});
