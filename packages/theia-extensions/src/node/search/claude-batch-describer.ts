import { execFile } from "node:child_process";
import { resolveClaudeExecutable } from "../claude-profile-detector.js";

export const CLAUDE_CHUNK_SIZE = 75;
const CALL_TIMEOUT_MS = 120_000;

export interface DescribeItem {
  relPath: string;
  summary: string;
}

export interface ClaudeDescriber {
  isAvailable(): boolean;
  /** Describe one chunk; returns path → sentence for the files Claude answered. */
  describeChunk(items: DescribeItem[]): Promise<Map<string, string>>;
}

/** Test seam: run claude with args + stdin, resolve stdout (reject on spawn error). */
export type ClaudeRunner = (args: string[], input: string) => Promise<string>;

export function buildClaudePrompt(items: DescribeItem[]): string {
  const blocks = items.map((it) => `${it.relPath}\n${it.summary}`).join("\n\n");
  return (
    `Describe what each file below does in one short sentence (max 15 words each).\n` +
    `Reply with ONLY a JSON object mapping each exact path to its description, e.g. ` +
    `{"path/a.ts":"…","path/b.ts":"…"}. Use the paths exactly as given.\n\n${blocks}`
  );
}

/** Parse the `claude --print --output-format json` envelope and its inner path→desc JSON. */
export function parseClaudeResult(stdout: string, paths: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let result: string;
  try {
    const env = JSON.parse(stdout) as { result?: string; is_error?: boolean };
    if (env.is_error || typeof env.result !== "string") return out;
    result = env.result;
  } catch {
    return out;
  }
  const start = result.indexOf("{");
  const end = result.lastIndexOf("}");
  if (start === -1 || end <= start) return out;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(result.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return out;
  }
  const wanted = new Set(paths);
  for (const [k, v] of Object.entries(obj)) {
    if (wanted.has(k) && typeof v === "string" && v.trim().length > 0) out.set(k, v.trim());
  }
  return out;
}

function defaultRunner(exe: string, cwd: string): ClaudeRunner {
  return (args, input) =>
    new Promise<string>((resolve, reject) => {
      const child = execFile(exe, args, { cwd, timeout: CALL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(stdout)));
      child.stdin?.end(input);
    });
}

export class ClaudeCliDescriber implements ClaudeDescriber {
  private readonly run: ClaudeRunner;
  constructor(
    private readonly exe: string | undefined,
    cwd: string,
    runner?: ClaudeRunner,
  ) {
    this.run = runner ?? (exe ? defaultRunner(exe, cwd) : async () => "");
  }

  static forWorkspace(cwd: string): ClaudeCliDescriber {
    const resolved = resolveClaudeExecutable();
    return new ClaudeCliDescriber(resolved && resolved !== "ambiguous" ? resolved : undefined, cwd);
  }

  isAvailable(): boolean {
    return this.exe !== undefined;
  }

  async describeChunk(items: DescribeItem[]): Promise<Map<string, string>> {
    if (items.length === 0 || !this.exe) return new Map();
    const args = ["--print", "--output-format", "json", "--input-format", "text"];
    const paths = items.map((it) => it.relPath);
    const prompt = buildClaudePrompt(items);
    const once = async (): Promise<Map<string, string>> => parseClaudeResult(await this.run(args, prompt), paths);
    let out: Map<string, string>;
    try { out = await once(); } catch { out = await once(); } // retry on thrown error/timeout
    if (out.size === 0) { try { out = await once(); } catch { /* keep empty */ } } // retry on empty/unparseable
    return out;
  }
}
