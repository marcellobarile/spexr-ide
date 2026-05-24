import { describe, it, expect } from "vitest";
import { stripFrontmatter } from "./spexr-agent-backend-service.js";

describe("stripFrontmatter", () => {
  it("returns the body after a frontmatter block", () => {
    const md = "---\nid: review\nname: Revisione\n---\nYou are the Review expert.\n";
    expect(stripFrontmatter(md).trim()).toBe("You are the Review expert.");
  });

  it("returns the input unchanged when there is no frontmatter", () => {
    expect(stripFrontmatter("no frontmatter here")).toBe("no frontmatter here");
  });
});
