/**
 * Minimal frontmatter parser/serializer for spec files. Browser-safe — no
 * Node built-ins. Supports the subset we use: scalar `key: value` lines and
 * inline arrays `key: [a, b]`. Quoted strings are unwrapped; unquoted values
 * are returned as-is.
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const KEY_VALUE_RE = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;

export interface ParsedFrontmatter {
  readonly data: Record<string, unknown>;
  readonly content: string;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { data: {}, content: raw };
  return { data: parseBlock(match[1]!), content: match[2] ?? "" };
}

export function stringifyFrontmatter(content: string, data: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    lines.push(`${key}: ${serializeValue(value)}`);
  }
  lines.push("---");
  const body = content.startsWith("\n") ? content : `\n${content}`;
  return `${lines.join("\n")}${body}`;
}

function parseBlock(body: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(KEY_VALUE_RE);
    if (!match) continue;
    const key = match[1]!;
    const rawValue = match[2]!.trim();
    out[key] = parseValue(rawValue);
  }
  return out;
}

function parseValue(value: string): unknown {
  if (value.length === 0) return "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(",").map((item) => unquote(item.trim()));
  }
  return value;
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function serializeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => serializeScalar(v)).join(", ")}]`;
  }
  return serializeScalar(value);
}

function serializeScalar(value: unknown): string {
  return String(value);
}
