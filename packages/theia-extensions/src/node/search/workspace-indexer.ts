// src/node/search/workspace-indexer.ts
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Embedder } from "./embedding-model.js";
import { VectorIndex } from "./vector-index.js";
import {
  ALWAYS_SKIP_DIRS,
  DEFAULT_MAX_BYTES,
  createIgnoreFilter,
  isBinaryBuffer,
  isSkippedExtension,
} from "./file-filter.js";

const MAX_CONTENT_CHARS = 2000;
const MAX_SNIPPET_CHARS = 160;
const INDEX_DIR = ".spexr";
const INDEX_FILE = "search-index.json";

/** Embedding input for a file: its path followed by a content prefix. */
export function buildEmbeddingInput(relPath: string, content: string): string {
  return `${relPath}\n${content.slice(0, MAX_CONTENT_CHARS)}`;
}

/** Display snippet: first non-empty line, trimmed and capped. */
export function buildSnippet(content: string): string {
  const line = content.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.slice(0, MAX_SNIPPET_CHARS);
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/** Builds and maintains the vector index for one workspace root. */
export class WorkspaceIndexer {
  readonly index = new VectorIndex();
  private readonly embedder: Embedder;

  constructor(private readonly root: string, embedder: Embedder) {
    this.embedder = embedder;
  }

  private get indexPath(): string {
    return join(this.root, INDEX_DIR, INDEX_FILE);
  }

  /** Workspace-relative (POSIX) paths eligible for indexing. */
  async discover(): Promise<string[]> {
    let ignored: (relPath: string) => boolean = () => false;
    try {
      ignored = createIgnoreFilter(await readFile(join(this.root, ".gitignore"), "utf8"));
    } catch {
      // no .gitignore — ignore nothing
    }
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = join(dir, entry.name);
        const rel = toPosix(relative(this.root, abs));
        if (entry.isDirectory()) {
          if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
          if (ignored(`${rel}/`)) continue;
          await walk(abs);
        } else if (entry.isFile()) {
          if (isSkippedExtension(rel) || ignored(rel)) continue;
          const info = await stat(abs);
          if (info.size > DEFAULT_MAX_BYTES) continue;
          const buf = await readFile(abs);
          if (isBinaryBuffer(buf)) continue;
          out.push(rel);
        }
      }
    };
    await walk(this.root);
    return out;
  }

  /** Full rebuild of the index from scratch. */
  async buildAll(onProgress?: (indexed: number, total: number) => void): Promise<void> {
    const paths = await this.discover();
    let done = 0;
    for (const rel of paths) {
      await this.updateFile(rel);
      onProgress?.(++done, paths.length);
    }
  }

  /** (Re)embed a single workspace-relative file, skipping unchanged content. */
  async updateFile(relPath: string): Promise<void> {
    const abs = join(this.root, relPath);
    let info;
    try {
      info = await stat(abs);
    } catch {
      this.index.remove(relPath);
      return;
    }
    if (!info.isFile() || info.size > DEFAULT_MAX_BYTES || isSkippedExtension(relPath)) {
      this.index.remove(relPath);
      return;
    }
    const buf = await readFile(abs);
    if (isBinaryBuffer(buf)) {
      this.index.remove(relPath);
      return;
    }
    const content = buf.toString("utf8");
    const hash = createHash("sha1").update(content).digest("hex");
    if (this.index.has(relPath, hash)) return;
    const [vector] = await this.embedder.embed([buildEmbeddingInput(relPath, content)]);
    this.index.upsert({
      path: relPath,
      vector: vector!,
      mtimeMs: info.mtimeMs,
      hash,
      snippet: buildSnippet(content),
    });
  }

  removeFile(relPath: string): void {
    this.index.remove(relPath);
  }

  /** Load a persisted index; returns false if absent or unreadable. */
  async load(): Promise<boolean> {
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const restored = VectorIndex.fromJSON(JSON.parse(raw));
      // An empty persisted index is treated as "nothing worth loading" — return false intentionally.
      if (restored.size === 0) return false;
      this.index.replaceWith(restored);
      return true;
    } catch {
      return false;
    }
  }

  async save(): Promise<void> {
    await mkdir(join(this.root, INDEX_DIR), { recursive: true });
    await writeFile(this.indexPath, JSON.stringify(this.index.toJSON()), "utf8");
  }
}
