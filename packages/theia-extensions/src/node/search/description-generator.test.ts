import { describe, expect, it, vi } from "vitest";
import {
  TransformersDescriptionGenerator,
  buildPrompt,
  cleanGenerated,
  type TextGenerateFn,
} from "./description-generator.js";

describe("cleanGenerated", () => {
  it("keeps one line and caps at 120 chars", () => {
    expect(cleanGenerated("Handles auth.\nExtra.")).toBe("Handles auth.");
    expect(cleanGenerated("x".repeat(200))).toHaveLength(120);
  });
  it("trims surrounding whitespace and quotes", () => {
    expect(cleanGenerated('  "Does X."  ')).toBe("Does X.");
  });
  it("truncates over-long text on a word boundary with an ellipsis", () => {
    const long = "word ".repeat(40).trim(); // 199 chars of "word word …"
    const out = cleanGenerated(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith("…")).toBe(true);
    expect(out.endsWith("word…")).toBe(true); // cut at a boundary, not mid-word
  });
});

describe("buildPrompt", () => {
  it("includes the path and the content", () => {
    const p = buildPrompt("src/a.ts", "export const x = 1;");
    expect(p).toContain("src/a.ts");
    expect(p).toContain("export const x = 1;");
  });
});

describe("TransformersDescriptionGenerator", () => {
  it("returns a cleaned description from the model", async () => {
    const fn: TextGenerateFn = async () => "Handles authentication tokens.";
    const gen = new TransformersDescriptionGenerator(async () => fn);
    expect(await gen.generate("a.ts", "code")).toBe("Handles authentication tokens.");
  });

  it("serializes generation: never more than one inference at a time", async () => {
    let active = 0, maxActive = 0;
    const fn: TextGenerateFn = async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--; return "desc.";
    };
    const gen = new TransformersDescriptionGenerator(async () => fn);
    await Promise.all([
      gen.generate("a.ts", "x"), gen.generate("b.ts", "y"), gen.generate("c.ts", "z"),
    ]);
    expect(maxActive).toBe(1);
  });

  it("de-duplicates concurrent requests for the same path", async () => {
    const fn = vi.fn<TextGenerateFn>(async () => "desc.");
    const gen = new TransformersDescriptionGenerator(async () => fn);
    await Promise.all([gen.generate("a.ts", "x"), gen.generate("a.ts", "x")]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("becomes unavailable after a load failure and returns null without retrying", async () => {
    const loader = vi.fn(async (): Promise<TextGenerateFn> => { throw new Error("no model"); });
    const gen = new TransformersDescriptionGenerator(loader);
    expect(await gen.generate("a.ts", "x")).toBeNull();
    expect(await gen.generate("b.ts", "y")).toBeNull();
    expect(gen.isAvailable()).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns null (not throwing) when a single generation fails", async () => {
    const fn: TextGenerateFn = async () => { throw new Error("boom"); };
    const gen = new TransformersDescriptionGenerator(async () => fn);
    expect(await gen.generate("a.ts", "x")).toBeNull();
    expect(gen.isAvailable()).toBe(true);
  });

  it("returns null when the model yields empty text", async () => {
    const gen = new TransformersDescriptionGenerator(async () => async () => "   ");
    expect(await gen.generate("a.ts", "x")).toBeNull();
  });
});
