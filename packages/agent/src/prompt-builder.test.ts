import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./prompt-builder.js";

describe("buildSystemPrompt persona", () => {
  it("appends the persona section when expertPrompt is given", () => {
    const out = buildSystemPrompt({
      workspaceRoot: "/tmp/ws",
      expertPrompt: "You are operating as the Review expert.",
    });
    expect(out).toContain("# Expert Persona");
    expect(out).toContain("You are operating as the Review expert.");
    expect(out.indexOf("# House Rules")).toBeLessThan(out.indexOf("# Expert Persona"));
  });

  it("omits the persona section when no expertPrompt is given", () => {
    const out = buildSystemPrompt({ workspaceRoot: "/tmp/ws" });
    expect(out).not.toContain("# Expert Persona");
  });
});
