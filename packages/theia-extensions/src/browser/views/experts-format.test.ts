import { describe, it, expect } from "vitest";
import { serializeExpertFile, parseExpertFrontmatter } from "./experts-format.js";

describe("experts-format", () => {
  it("round-trips id/name/icon/color through serialize → parse", () => {
    const md = serializeExpertFile({
      id: "review",
      name: "Revisione",
      icon: "codicon-search",
      color: "#7c5cff",
      systemPrompt: "You are the Review expert.",
    });
    const meta = parseExpertFrontmatter(md, "fallback");
    expect(meta).toEqual({
      id: "review",
      name: "Revisione",
      icon: "codicon-search",
      color: "#7c5cff",
    });
  });

  it("includes the system prompt body after the frontmatter", () => {
    const md = serializeExpertFile({
      id: "x",
      name: "X",
      icon: "codicon-person",
      color: "#888",
      systemPrompt: "Body line.",
    });
    expect(md).toContain("---");
    expect(md.trimEnd().endsWith("Body line.")).toBe(true);
  });

  it("returns undefined for content without frontmatter", () => {
    expect(parseExpertFrontmatter("no frontmatter", "id")).toBeUndefined();
  });
});
