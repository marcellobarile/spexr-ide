import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { SpecError, type Logger } from "@spexr/core";
import { parseSpec } from "./parser.js";
import type { Spec, SpecRegistry } from "./types.js";

export type { SpecRegistry };

export interface SpecRegistryOptions {
  readonly directory: string;
  readonly logger?: Logger;
}

export class FilesystemSpecRegistry implements SpecRegistry {
  private readonly directory: string;
  private readonly logger?: Logger;

  constructor(opts: SpecRegistryOptions) {
    this.directory = opts.directory;
    if (opts.logger !== undefined) this.logger = opts.logger;
  }

  async list(): Promise<readonly Spec[]> {
    if (!(await dirExists(this.directory))) return [];
    const entries = await readdir(this.directory);
    const files = entries.filter((e) => e.endsWith(".md"));
    const specs: Spec[] = [];
    for (const file of files) {
      try {
        specs.push(await this.readFile(file));
      } catch (err) {
        this.logger?.warn(`Skipping invalid spec ${file}`, { error: String(err) });
      }
    }
    return specs;
  }

  async get(slug: string): Promise<Spec> {
    return this.readFile(`${slug}.md`);
  }

  async save(slug: string, content: string): Promise<Spec> {
    const filename = ensureMd(slug);
    const path = this.resolve(filename);
    await mkdir(this.directory, { recursive: true });
    await writeFile(path, content, "utf8");
    this.logger?.info("Spec saved", { slug, path });
    return this.readFile(filename);
  }

  private async readFile(filename: string): Promise<Spec> {
    const path = this.resolve(filename);
    const raw = await readFile(path, "utf8");
    return parseSpec(raw, path);
  }

  private resolve(filename: string): string {
    const safe = basename(filename);
    if (safe !== filename) {
      throw new SpecError(`Filename must not contain path separators: ${filename}`);
    }
    return join(this.directory, ensureMd(safe));
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function ensureMd(name: string): string {
  return name.endsWith(".md") ? name : `${name}.md`;
}
