import { describe, expect, it } from "vitest";
import { buildIgnoreMatcher } from "./git-ignore-matcher.js";

describe("buildIgnoreMatcher", () => {
  it("matches exact ignored files (e.g. global/system-ignored)", () => {
    const m = buildIgnoreMatcher([".env", ".DS_Store", "src/secrets.ts"]);
    expect(m(".env")).toBe(true);
    expect(m(".DS_Store")).toBe(true);
    expect(m("src/secrets.ts")).toBe(true);
    expect(m("src/app.ts")).toBe(false);
  });

  it("matches an ignored directory and everything under it", () => {
    const m = buildIgnoreMatcher(["node_modules/", "dist/"]);
    expect(m("node_modules")).toBe(true);          // the folder node itself
    expect(m("node_modules/react/index.js")).toBe(true); // a child, deep
    expect(m("dist")).toBe(true);
    expect(m("dist/bundle.js")).toBe(true);
    expect(m("source/node_modules_notes.md")).toBe(false); // not a segment match
  });

  it("does not match unrelated paths or the empty path", () => {
    const m = buildIgnoreMatcher(["node_modules/", ".env"]);
    expect(m("")).toBe(false);
    expect(m("README.md")).toBe(false);
  });

  it("matches nothing when the ignore set is empty", () => {
    const m = buildIgnoreMatcher([]);
    expect(m("anything")).toBe(false);
    expect(m("node_modules/x")).toBe(false);
  });
});
