import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

export interface StoredDescription {
  description: string;
  category: string;
}

/** Text-only per-workspace store of file descriptions, separate from the vector index. */
export class DescriptionsStore {
  private readonly map = new Map<string, StoredDescription>();
  constructor(private readonly root: string) {}

  private get path(): string { return join(this.root, ".spexr", "descriptions.json"); }

  async load(): Promise<void> {
    this.map.clear();
    try {
      const obj = JSON.parse(await readFile(this.path, "utf8")) as Record<string, StoredDescription>;
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v.description === "string") this.map.set(k, { description: v.description, category: v.category ?? "other" });
      }
    } catch { /* missing/corrupt → empty */ }
  }

  get(path: string): string | undefined {
    return this.map.get(path)?.description;
  }

  entries(): Map<string, StoredDescription> {
    return this.map;
  }

  /** Merge new entries and atomically persist the whole store (text-only, cheap). */
  async merge(entries: Map<string, StoredDescription>): Promise<void> {
    for (const [k, v] of entries) this.map.set(k, v);
    const dir = join(this.root, ".spexr");
    await mkdir(dir, { recursive: true });
    const obj: Record<string, StoredDescription> = {};
    for (const [k, v] of [...this.map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) obj[k] = v;
    const tmp = `${this.path}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
    await rename(tmp, this.path);
  }
}
