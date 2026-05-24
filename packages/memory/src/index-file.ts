import { readFile, writeFile } from "node:fs/promises";
import type { MemoryRecord } from "./types.js";

/**
 * MEMORY.md is a one-line-per-entry index (under ~200 lines) loaded into the
 * agent context every session. Long descriptions stay in the per-file frontmatter.
 */

const HEADER = "# MEMORY index\n\nOne line per memory. Linked file holds the body.\n";

export interface RenderIndexInput {
  readonly title?: string;
  readonly records: readonly MemoryRecord[];
}

export function renderMemoryIndex(input: RenderIndexInput): string {
  const grouped = groupByType(input.records);
  const sections: string[] = [];
  for (const [type, records] of grouped) {
    if (records.length === 0) continue;
    sections.push(`## ${capitalize(type)}\n`);
    for (const r of records) {
      const line = `- [${r.frontmatter.name}](${r.filename}) — ${r.frontmatter.description}`;
      sections.push(truncate(line, 200));
    }
    sections.push("");
  }
  return `${input.title ?? HEADER}\n${sections.join("\n")}`.trimEnd() + "\n";
}

export async function readIndexFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

export async function writeIndexFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, "utf8");
}

function groupByType(records: readonly MemoryRecord[]): Map<string, MemoryRecord[]> {
  const order = ["user", "feedback", "project", "reference"];
  const map = new Map<string, MemoryRecord[]>(order.map((t) => [t, []]));
  for (const r of records) {
    const bucket = map.get(r.frontmatter.type);
    if (bucket) bucket.push(r);
  }
  return map;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncate(line: string, max: number): string {
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}
