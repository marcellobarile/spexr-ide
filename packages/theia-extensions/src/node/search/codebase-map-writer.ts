import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Structural subset consumed by markdown rendering — IndexRecord satisfies this. */
export type MapRow = { path: string; category: string; description: string; aiDescription?: string };

function bestDescription(r: MapRow): string {
  return r.aiDescription ?? r.description ?? "";
}

function topFolder(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? "(root)" : path.slice(0, i);
}

function groupBy<T>(records: T[], keyOf: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of records) {
    const k = keyOf(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** Human/agent-readable map grouped by top-level folder, then category. */
export function buildCodebaseMapMarkdown(records: MapRow[]): string {
  const sorted = [...records].sort((a, b) => a.path.localeCompare(b.path));
  const lines: string[] = ["# Codebase map", ""];
  const byFolder = groupBy(sorted, (r) => topFolder(r.path));
  for (const folder of [...byFolder.keys()].sort()) {
    lines.push(`## ${folder}`, "");
    const byCat = groupBy(byFolder.get(folder)!, (r) => r.category);
    for (const cat of [...byCat.keys()].sort()) {
      lines.push(`### ${cat}`, "");
      for (const r of byCat.get(cat)!) lines.push(`- \`${r.path}\` — ${bestDescription(r)}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** Writes markdown map artifacts under `<root>/.spexr/`. */
export class CodebaseMapWriter {
  constructor(private readonly root: string) {}

  /** Writes `codebase-map.md` from store-derived rows (descriptions.json is owned by DescriptionsStore). */
  async writeMarkdown(rows: MapRow[]): Promise<void> {
    const dir = join(this.root, ".spexr");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "codebase-map.md"), buildCodebaseMapMarkdown(rows), "utf8");
  }
}
