import { describe, it, expect } from "vitest";
import {
  buildSpecHandoff,
  parseLinksFile,
  SPEC_HANDOFF_BUDGET_BYTES,
  type ContextFileEntry,
} from "./spec-handoff.js";

const BODY = "# Spec\nGoal text here.";

// ── parseLinksFile ──────────────────────────────────────────────────────────

describe("parseLinksFile", () => {
  it("parses standard entries", () => {
    const md = [
      "# Context links",
      "",
      "- [Customer brief](https://example.com/brief) — 2026-06-01",
      "- [RFC](https://tools.ietf.org/html/rfc1234)",
    ].join("\n");
    expect(parseLinksFile(md)).toEqual([
      { label: "Customer brief", url: "https://example.com/brief" },
      { label: "RFC", url: "https://tools.ietf.org/html/rfc1234" },
    ]);
  });

  it("falls back to url when label is empty", () => {
    const md = "- [](https://bare.example.com)";
    const [link] = parseLinksFile(md);
    expect(link?.label).toBe("https://bare.example.com");
  });

  it("skips malformed lines", () => {
    expect(parseLinksFile("not a link\n- broken(url")).toEqual([]);
  });

  it("returns empty array for empty content", () => {
    expect(parseLinksFile("")).toEqual([]);
  });
});

// ── buildSpecHandoff — backward compat ─────────────────────────────────────

describe("buildSpecHandoff — backward compat", () => {
  it("returns spec body unchanged when no context and no links", () => {
    const out = buildSpecHandoff({ specBody: BODY, contextFiles: [], links: [] });
    expect(out).toBe(BODY);
  });
});

// ── buildSpecHandoff — assembly order ──────────────────────────────────────

describe("buildSpecHandoff — assembly order", () => {
  it("places spec body before files before links", () => {
    const out = buildSpecHandoff({
      specBody: BODY,
      contextFiles: [{ name: "notes.md", content: "Notes text.", sizeBytes: 11, mtimeMs: 1000 }],
      links: [{ label: "Ref", url: "https://example.com" }],
    });
    const bodyPos = out.indexOf(BODY);
    const filePos = out.indexOf("notes.md");
    const linkPos = out.indexOf("https://example.com");
    expect(bodyPos).toBeLessThan(filePos);
    expect(filePos).toBeLessThan(linkPos);
  });

  it("wraps each file with its filename delimiter", () => {
    const out = buildSpecHandoff({
      specBody: BODY,
      contextFiles: [{ name: "analysis.md", content: "Analysis.", sizeBytes: 9, mtimeMs: 1000 }],
      links: [],
    });
    expect(out).toContain("### `analysis.md`");
    expect(out).toContain("Analysis.");
  });

  it("renders links section when links present", () => {
    const out = buildSpecHandoff({
      specBody: BODY,
      contextFiles: [],
      links: [{ label: "Doc", url: "https://docs.example.com" }],
    });
    expect(out).toContain("## Context links");
    expect(out).toContain("- [Doc](https://docs.example.com)");
  });
});

// ── buildSpecHandoff — newest-first ordering ───────────────────────────────

describe("buildSpecHandoff — file ordering", () => {
  it("includes newest files first", () => {
    const files: ContextFileEntry[] = [
      { name: "old.md", content: "old", sizeBytes: 3, mtimeMs: 1000 },
      { name: "new.md", content: "new", sizeBytes: 3, mtimeMs: 3000 },
      { name: "mid.md", content: "mid", sizeBytes: 3, mtimeMs: 2000 },
    ];
    const out = buildSpecHandoff({ specBody: BODY, contextFiles: files, links: [] });
    expect(out.indexOf("new.md")).toBeLessThan(out.indexOf("mid.md"));
    expect(out.indexOf("mid.md")).toBeLessThan(out.indexOf("old.md"));
  });
});

// ── buildSpecHandoff — byte budget ─────────────────────────────────────────

describe("buildSpecHandoff — budget", () => {
  it("drops oldest files when budget exceeded", () => {
    const files: ContextFileEntry[] = [
      { name: "old.md", content: "old content", sizeBytes: 11, mtimeMs: 1000 },
      { name: "new.md", content: "new content", sizeBytes: 11, mtimeMs: 2000 },
    ];
    const out = buildSpecHandoff({
      specBody: BODY,
      contextFiles: files,
      links: [],
      budgetBytes: 12, // fits new.md (11 bytes) but not both
    });
    expect(out).toContain("new.md");
    expect(out).not.toContain("old content");
    expect(out).toContain("old.md"); // named in truncation notice
    expect(out).toContain("Budget limit reached");
  });

  it("always keeps spec body when budget exceeded", () => {
    const files: ContextFileEntry[] = [
      { name: "huge.md", content: "x".repeat(1000), sizeBytes: 1000, mtimeMs: 1000 },
    ];
    const out = buildSpecHandoff({ specBody: BODY, contextFiles: files, links: [], budgetBytes: 0 });
    expect(out).toContain(BODY);
    expect(out).not.toContain("x".repeat(1000));
  });

  it("always keeps links when budget exceeded", () => {
    const files: ContextFileEntry[] = [
      { name: "huge.md", content: "x".repeat(1000), sizeBytes: 1000, mtimeMs: 1000 },
    ];
    const out = buildSpecHandoff({
      specBody: BODY,
      contextFiles: files,
      links: [{ label: "L", url: "https://keep.me" }],
      budgetBytes: 0,
    });
    expect(out).toContain("https://keep.me");
  });

  it("uses SPEC_HANDOFF_BUDGET_BYTES as default", () => {
    expect(SPEC_HANDOFF_BUDGET_BYTES).toBeGreaterThan(0);
    // default budget doesn't drop a small file
    const files: ContextFileEntry[] = [
      { name: "small.md", content: "hi", sizeBytes: 2, mtimeMs: 1 },
    ];
    const out = buildSpecHandoff({ specBody: BODY, contextFiles: files, links: [] });
    expect(out).toContain("small.md");
  });
});

// ── buildSpecHandoff — binary files ────────────────────────────────────────

describe("buildSpecHandoff — binary files", () => {
  it("lists binary files as not-inlined without counting against budget", () => {
    const files: ContextFileEntry[] = [
      { name: "diagram.png", content: null, sizeBytes: 50_000, mtimeMs: 2000 },
      { name: "notes.md", content: "text", sizeBytes: 4, mtimeMs: 1000 },
    ];
    const out = buildSpecHandoff({ specBody: BODY, contextFiles: files, links: [], budgetBytes: 10 });
    expect(out).toContain("diagram.png");
    expect(out).toContain("not inlined");
    expect(out).toContain("notes.md"); // still fits since binary doesn't consume budget
  });
});
