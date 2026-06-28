import { describe, expect, it } from "vitest";
import { buildPrompt, cleanGenerated } from "./description-format.js";

describe("cleanGenerated", () => {
  it("keeps one line and caps at 120 chars", () => {
    expect(cleanGenerated("Handles auth.\nExtra.")).toBe("Handles auth.");
    expect(cleanGenerated("x".repeat(200))).toHaveLength(120);
  });
  it("trims surrounding whitespace and quotes", () => {
    expect(cleanGenerated('  "Does X."  ')).toBe("Does X.");
  });
  it("truncates over-long text on a word boundary with an ellipsis", () => {
    const long = "word ".repeat(40).trim();
    const out = cleanGenerated(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith("word…")).toBe(true);
  });
});

describe("buildPrompt", () => {
  it("includes the path and the content", () => {
    const p = buildPrompt("src/a.ts", "export const x = 1;");
    expect(p).toContain("src/a.ts");
    expect(p).toContain("export const x = 1;");
  });
});
