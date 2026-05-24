import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Logger } from "@spexr/core";
import { MemoryError } from "@spexr/core";
import { parseMemoryMarkdown, serializeMemoryMarkdown } from "./parser.js";
import type {
  MemoryListFilter,
  MemoryRecord,
  MemoryScope,
  MemoryWriteInput,
} from "./types.js";

/**
 * Filesystem-backed memory store. One instance per scope keeps invariants local
 * (e.g., baseline scope is read-only, projects can be absent).
 */
export interface MemoryStore {
  readonly scope: MemoryScope;
  list(filter?: MemoryListFilter): Promise<readonly MemoryRecord[]>;
  read(filename: string): Promise<MemoryRecord>;
  write(input: MemoryWriteInput): Promise<MemoryRecord>;
  remove(filename: string): Promise<void>;
}

export interface MemoryStoreOptions {
  readonly scope: MemoryScope;
  readonly directory: string;
  readonly readOnly?: boolean;
  readonly logger?: Logger;
}

export class FilesystemMemoryStore implements MemoryStore {
  readonly scope: MemoryScope;
  private readonly directory: string;
  private readonly readOnly: boolean;
  private readonly logger?: Logger;

  constructor(opts: MemoryStoreOptions) {
    this.scope = opts.scope;
    this.directory = opts.directory;
    this.readOnly = opts.readOnly ?? opts.scope === "baseline";
    if (opts.logger !== undefined) this.logger = opts.logger;
  }

  async list(filter: MemoryListFilter = {}): Promise<readonly MemoryRecord[]> {
    if (filter.scope !== undefined && filter.scope !== this.scope) return [];
    const exists = await dirExists(this.directory);
    if (!exists) return [];
    const entries = await readdir(this.directory);
    const files = entries.filter(
      (e) => e.endsWith(".md") && e !== "MEMORY.md" && !e.endsWith(".original.md"),
    );
    const records: MemoryRecord[] = [];
    for (const file of files) {
      try {
        const record = await this.read(file);
        if (matches(record, filter)) records.push(record);
      } catch (err) {
        this.logger?.warn(`Skipping invalid memory file ${file}`, { error: String(err) });
      }
    }
    return records;
  }

  async read(filename: string): Promise<MemoryRecord> {
    const absolutePath = this.resolve(filename);
    const raw = await readFile(absolutePath, "utf8");
    const { frontmatter, body } = parseMemoryMarkdown(raw);
    return {
      id: idFromFilename(filename),
      scope: this.scope,
      filename,
      absolutePath,
      frontmatter,
      body,
      readOnly: this.readOnly,
    };
  }

  async write(input: MemoryWriteInput): Promise<MemoryRecord> {
    if (this.readOnly) {
      throw new MemoryError(`Cannot write to read-only memory scope "${this.scope}"`);
    }
    if (input.scope !== this.scope) {
      throw new MemoryError(
        `Scope mismatch: store is "${this.scope}" but input targets "${input.scope}"`,
      );
    }
    const filename = ensureMarkdownExt(input.filename);
    const absolutePath = this.resolve(filename);
    await mkdir(this.directory, { recursive: true });
    const content = serializeMemoryMarkdown(input.frontmatter, input.body);
    await writeFile(absolutePath, content, "utf8");
    this.logger?.info("Memory written", { scope: this.scope, filename });
    return this.read(filename);
  }

  async remove(filename: string): Promise<void> {
    if (this.readOnly) {
      throw new MemoryError(`Cannot delete from read-only memory scope "${this.scope}"`);
    }
    const absolutePath = this.resolve(filename);
    await rm(absolutePath, { force: true });
    this.logger?.info("Memory removed", { scope: this.scope, filename });
  }

  private resolve(filename: string): string {
    const safe = basename(filename);
    if (safe !== filename) {
      throw new MemoryError(`Filename must not contain path separators: ${filename}`);
    }
    return join(this.directory, ensureMarkdownExt(safe));
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function matches(record: MemoryRecord, filter: MemoryListFilter): boolean {
  if (filter.type && record.frontmatter.type !== filter.type) return false;
  if (filter.tag && !(record.frontmatter.tags ?? []).includes(filter.tag)) return false;
  return true;
}

function idFromFilename(filename: string): string {
  return filename.replace(/\.md$/, "");
}

function ensureMarkdownExt(filename: string): string {
  return filename.endsWith(".md") ? filename : `${filename}.md`;
}
