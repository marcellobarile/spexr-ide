import { describe, expect, it } from "vitest";
import { buildClaudePrompt, parseClaudeResult, ClaudeCliDescriber } from "./claude-batch-describer.js";

describe("buildClaudePrompt", () => {
  it("lists each path with its summary and asks for JSON", () => {
    const p = buildClaudePrompt([{ relPath: "a.ts", summary: "Symbols: foo" }]);
    expect(p).toContain("a.ts");
    expect(p).toContain("foo");
    expect(p.toLowerCase()).toContain("json");
  });
});

describe("parseClaudeResult", () => {
  const paths = ["a.ts", "b.ts"];
  it("parses the envelope.result inner JSON keyed by path", () => {
    const envelope = JSON.stringify({ result: JSON.stringify({ "a.ts": "Does A.", "b.ts": "Does B." }) });
    const m = parseClaudeResult(envelope, paths);
    expect(m.get("a.ts")).toBe("Does A.");
    expect(m.get("b.ts")).toBe("Does B.");
  });
  it("tolerates prose around the JSON and ignores unknown keys", () => {
    const inner = "Here you go:\n{\"a.ts\":\"Does A.\",\"z.ts\":\"nope\"}\nthanks";
    const envelope = JSON.stringify({ result: inner });
    const m = parseClaudeResult(envelope, paths);
    expect(m.get("a.ts")).toBe("Does A.");
    expect(m.has("z.ts")).toBe(false);
  });
  it("returns empty map on error envelope or unparseable result", () => {
    expect(parseClaudeResult(JSON.stringify({ is_error: true }), paths).size).toBe(0);
    expect(parseClaudeResult("not json", paths).size).toBe(0);
  });
});

describe("ClaudeCliDescriber", () => {
  it("describeChunk runs the executable and maps the parsed result", async () => {
    const calls: { args: string[]; input: string }[] = [];
    const fakeRun = async (args: string[], input: string) => {
      calls.push({ args, input });
      return JSON.stringify({ result: JSON.stringify({ "a.ts": "Does A." }) });
    };
    const d = new ClaudeCliDescriber("/usr/bin/claude", "/root", fakeRun);
    const m = await d.describeChunk([{ relPath: "a.ts", summary: "Symbols: foo" }]);
    expect(m.get("a.ts")).toBe("Does A.");
    expect(calls[0]!.args).toEqual(["--print", "--output-format", "json", "--input-format", "text"]);
    expect(calls[0]!.input).toContain("a.ts");
  });

  it("isAvailable reflects a resolved executable", () => {
    expect(new ClaudeCliDescriber("/usr/bin/claude", "/root", async () => "").isAvailable()).toBe(true);
    expect(new ClaudeCliDescriber(undefined, "/root", async () => "").isAvailable()).toBe(false);
  });
});
