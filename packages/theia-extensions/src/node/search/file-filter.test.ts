import { describe, expect, it } from "vitest";
import {
  ALWAYS_SKIP_DIRS,
  isSkippedExtension,
  isBinaryBuffer,
  createIgnoreFilter,
} from "./file-filter.js";

describe("ALWAYS_SKIP_DIRS", () => {
  it("includes the heavy directories", () => {
    for (const dir of ["node_modules", ".git", ".spexr", "dist", "lib", "build", "out", ".turbo"]) {
      expect(ALWAYS_SKIP_DIRS.has(dir)).toBe(true);
    }
  });
});

describe("isSkippedExtension", () => {
  it("skips known binary extensions", () => {
    expect(isSkippedExtension("a/b/logo.png")).toBe(true);
    expect(isSkippedExtension("x.WOFF2")).toBe(true);
  });
  it("keeps text/code files", () => {
    expect(isSkippedExtension("src/index.ts")).toBe(false);
    expect(isSkippedExtension("README.md")).toBe(false);
  });
  it("skips .gitignore (extension is 'gitignore')", () => {
    expect(isSkippedExtension(".gitignore")).toBe(true);
  });
  it("does not skip other dotfiles whose extension is indexable", () => {
    // .eslintrc.js → extension is "js", must remain indexable
    expect(isSkippedExtension(".eslintrc.js")).toBe(false);
  });
});

describe("isBinaryBuffer", () => {
  it("detects a NUL byte as binary", () => {
    expect(isBinaryBuffer(Buffer.from([104, 105, 0, 121]))).toBe(true);
  });
  it("treats NUL-free content as text", () => {
    expect(isBinaryBuffer(Buffer.from("plain text"))).toBe(false);
  });
});

describe("createIgnoreFilter", () => {
  it("matches .gitignore patterns", () => {
    const ignored = createIgnoreFilter("dist/\n*.log\n");
    expect(ignored("dist/app.js")).toBe(true);
    expect(ignored("server.log")).toBe(true);
    expect(ignored("src/index.ts")).toBe(false);
  });
  it("never ignores when the gitignore is empty", () => {
    const ignored = createIgnoreFilter("");
    expect(ignored("anything.ts")).toBe(false);
  });
});
