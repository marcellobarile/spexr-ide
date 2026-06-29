import { describe, expect, it } from "vitest";
import { estimateMap } from "./map-token-estimator.js";

describe("estimateMap", () => {
  it("counts files, chunks, and char/4 input + N*20 output tokens", () => {
    const summaries = ["abcd".repeat(25), "ab".repeat(50)]; // 100 + 100 chars
    const e = estimateMap(summaries, 75);
    expect(e.fileCount).toBe(2);
    expect(e.chunkCount).toBe(1);
    expect(e.outputTokens).toBe(40);            // 2 * 20
    expect(e.inputTokens).toBeGreaterThanOrEqual(50); // ~ (200 + overhead)/4
  });

  it("splits into chunks by chunkSize", () => {
    const summaries = Array.from({ length: 160 }, () => "x");
    expect(estimateMap(summaries, 75).chunkCount).toBe(3);
  });
});
