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
