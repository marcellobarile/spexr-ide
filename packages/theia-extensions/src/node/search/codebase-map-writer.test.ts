import { describe, expect, it } from "vitest";
import { buildCodebaseMapMarkdown } from "./codebase-map-writer.js";
import type { MapRow } from "./codebase-map-writer.js";

const rec = (path: string, category: string, description: string, aiDescription?: string): MapRow => ({
  path, category, description, aiDescription,
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
