import { describe, expect, it } from "vitest";
import { buildCodebaseMapMarkdown, buildDescriptionsJson } from "./codebase-map-writer.js";
import type { IndexRecord } from "./vector-index.js";

const rec = (path: string, category: string, description: string, aiDescription?: string): IndexRecord => ({
  path, category, description, aiDescription,
  vector: new Float32Array([1]), mtimeMs: 0, hash: "h", snippet: "",
});

describe("buildDescriptionsJson", () => {
  it("keys by path with best-available description and category, sorted", () => {
    const json = JSON.parse(buildDescriptionsJson([
      rec("src/b.ts", "frontend", "static B", "AI B"),
      rec("src/a.ts", "backend", "static A"),
    ]));
    expect(Object.keys(json)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(json["src/b.ts"]).toEqual({ description: "AI B", category: "frontend" });
    expect(json["src/a.ts"]).toEqual({ description: "static A", category: "backend" });
  });
});

describe("buildCodebaseMapMarkdown", () => {
  it("groups by top-level folder then category and prefers aiDescription", () => {
    const md = buildCodebaseMapMarkdown([
      rec("src/ui/Button.tsx", "frontend", "exports Button", "Renders a button."),
      rec("src/api/users.ts", "backend", "Lists users."),
      rec("README.md", "other", "Project readme."),
    ]);
    expect(md).toContain("## (root)");
    expect(md).toContain("## src");
    expect(md).toContain("### frontend");
    expect(md).toContain("- `src/ui/Button.tsx` — Renders a button.");
    expect(md).toContain("- `src/api/users.ts` — Lists users.");
    expect(md.indexOf("## (root)")).toBeLessThan(md.indexOf("## src"));
  });
});
