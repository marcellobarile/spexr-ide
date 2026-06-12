import { describe, it, expect } from "vitest";
import { extractLinkedPaths, parseDriftVerdicts } from "./drift-detector.js";

// ── extractLinkedPaths ──────────────────────────────────────────────────────

describe("extractLinkedPaths", () => {
  it("extracts relative markdown links", () => {
    const body = "See [types](packages/spec/src/types.ts) for the model.";
    expect(extractLinkedPaths(body)).toContain("packages/spec/src/types.ts");
  });

  it("ignores http links", () => {
    const body = "[External](https://example.com)";
    expect(extractLinkedPaths(body)).toEqual([]);
  });

  it("ignores anchor-only links", () => {
    const body = "[Section](#goal)";
    expect(extractLinkedPaths(body)).toEqual([]);
  });

  it("extracts inline code paths", () => {
    const body = "Modified `packages/theia-extensions/src/browser/spec-widget.tsx:42`.";
    expect(extractLinkedPaths(body)).toContain("packages/theia-extensions/src/browser/spec-widget.tsx");
  });

  it("strips line-number from inline code paths", () => {
    const body = "`src/foo/bar.ts:123`";
    const paths = extractLinkedPaths(body);
    expect(paths).toContain("src/foo/bar.ts");
    expect(paths).not.toContain("src/foo/bar.ts:123");
  });

  it("deduplicates paths", () => {
    const body = "[a](packages/spec/src/types.ts) and `packages/spec/src/types.ts`.";
    const paths = extractLinkedPaths(body);
    expect(paths.filter((p) => p === "packages/spec/src/types.ts")).toHaveLength(1);
  });

  it("ignores inline code without a directory separator", () => {
    const body = "`README.md`";
    expect(extractLinkedPaths(body)).toEqual([]);
  });
});

// ── parseDriftVerdicts ──────────────────────────────────────────────────────

describe("parseDriftVerdicts", () => {
  it("parses a clean JSON array", () => {
    const json = JSON.stringify([
      { criterionId: "AC-1", severity: "ok", message: "Passes." },
      { criterionId: "AC-2", severity: "warn", message: "Missing edge case.", suggestion: "Add test." },
    ]);
    const findings = parseDriftVerdicts(json);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ criterionId: "AC-1", severity: "info" });
    expect(findings[1]).toMatchObject({ criterionId: "AC-2", severity: "warn", suggestion: "Add test." });
  });

  it("strips markdown code fences", () => {
    const text = "```json\n[{\"criterionId\":\"AC-1\",\"severity\":\"block\",\"message\":\"Broken.\"}]\n```";
    const findings = parseDriftVerdicts(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("block");
  });

  it("maps 'error' severity to 'block'", () => {
    const json = JSON.stringify([{ criterionId: "AC-1", severity: "error", message: "Fatal." }]);
    expect(parseDriftVerdicts(json)[0]!.severity).toBe("block");
  });

  it("returns empty array for non-array JSON", () => {
    expect(parseDriftVerdicts("{}")).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseDriftVerdicts("not json")).toEqual([]);
  });

  it("skips entries missing criterionId", () => {
    const json = JSON.stringify([{ severity: "warn", message: "No id." }]);
    expect(parseDriftVerdicts(json)).toEqual([]);
  });

  it("returns empty array for empty text", () => {
    expect(parseDriftVerdicts("")).toEqual([]);
  });
});
