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
