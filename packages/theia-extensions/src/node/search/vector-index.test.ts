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

  it("replaceWith swaps all records from another index", () => {
    const a = new VectorIndex();
    a.upsert(rec("old", [1, 0]));

    const b = new VectorIndex();
    b.upsert(rec("new1", [0, 1]));
    b.upsert(rec("new2", [1, 1]));

    a.replaceWith(b);

    expect(a.size).toBe(2);
    expect(a.has("new1", "h")).toBe(true);
    expect(a.has("new2", "h")).toBe(true);
    expect(a.has("old", "h")).toBe(false);
    expect(a.search(new Float32Array([0, 1]), 1, 0)[0]!.path).toBe("new1");
  });

  it("fromJSON returns an empty index on malformed data", () => {
    expect(VectorIndex.fromJSON(null).size).toBe(0);
    expect(VectorIndex.fromJSON({ version: INDEX_VERSION }).size).toBe(0);
  });
});

describe("allRecords", () => {
  it("returns every upserted record in insertion order", () => {
    const idx = new VectorIndex();
    idx.upsert({ path: "b.ts", vector: new Float32Array([1]), mtimeMs: 0, hash: "h1", snippet: "", category: "other", description: "B" });
    idx.upsert({ path: "a.ts", vector: new Float32Array([1]), mtimeMs: 0, hash: "h2", snippet: "", category: "other", description: "A" });
    expect(idx.allRecords().map((r) => r.path)).toEqual(["b.ts", "a.ts"]);
  });
});
