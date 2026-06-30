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
    expect(calls[0]!.args).toEqual(["--print", "--output-format", "json", "--input-format", "text", "--tools", ""]);
    expect(calls[0]!.input).toContain("a.ts");
  });

  it("isAvailable reflects a resolved executable", () => {
    expect(new ClaudeCliDescriber("/usr/bin/claude", "/root", async () => "").isAvailable()).toBe(true);
    expect(new ClaudeCliDescriber(undefined, "/root", async () => "").isAvailable()).toBe(false);
  });

  it("forWorkspace prefers an explicit configured executable over PATH resolution", () => {
    // A configured executablePath is used verbatim (no PATH lookup), so the describer
    // is available even with an arbitrary absolute path.
    expect(ClaudeCliDescriber.forWorkspace("/root", "/opt/claude-perso/bin/claude", "/home/u/.claude-perso").isAvailable()).toBe(true);
    // Blank configured path falls back to PATH resolution (undefined here → unavailable in CI).
    const fallback = ClaudeCliDescriber.forWorkspace("/root", "  ");
    expect(typeof fallback.isAvailable()).toBe("boolean");
  });

  it("retries once when runner returns empty string on first call", async () => {
    let callCount = 0;
    const fakeRun = async (_args: string[], _input: string) => {
      callCount++;
      if (callCount === 1) return "";
      return JSON.stringify({ result: JSON.stringify({ "a.ts": "Does A." }) });
    };
    const d = new ClaudeCliDescriber("/usr/bin/claude", "/root", fakeRun);
    const m = await d.describeChunk([{ relPath: "a.ts", summary: "Symbols: foo" }]);
    expect(m.get("a.ts")).toBe("Does A.");
    expect(callCount).toBe(2);
  });

  it("retries once when runner throws on first call", async () => {
    let callCount = 0;
    const fakeRun = async (_args: string[], _input: string): Promise<string> => {
      callCount++;
      if (callCount === 1) throw new Error("spawn error");
      return JSON.stringify({ result: JSON.stringify({ "a.ts": "Does A." }) });
    };
    const d = new ClaudeCliDescriber("/usr/bin/claude", "/root", fakeRun);
    const m = await d.describeChunk([{ relPath: "a.ts", summary: "Symbols: foo" }]);
    expect(m.get("a.ts")).toBe("Does A.");
    expect(callCount).toBe(2);
  });
});

describe("parseClaudeResult - whitespace-only values", () => {
  it("drops keys whose value is whitespace-only", () => {
    const envelope = JSON.stringify({ result: JSON.stringify({ "a.ts": "  ", "b.ts": "Does B." }) });
    const m = parseClaudeResult(envelope, ["a.ts", "b.ts"]);
    expect(m.has("a.ts")).toBe(false);
    expect(m.get("b.ts")).toBe("Does B.");
  });
});
