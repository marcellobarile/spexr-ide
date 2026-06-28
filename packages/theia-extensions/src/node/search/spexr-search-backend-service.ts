import { inject, injectable } from "@theia/core/shared/inversify";
import type {
  SpexrSearchService,
  SearchHit,
  IndexStatus,
} from "../../common/search-protocol.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Embedder as EmbedderType } from "./embedding-model.js";
import { EmbedderToken } from "./embedding-model.js";
import { DescriptionGeneratorToken, type DescriptionGenerator } from "./description-generator.js";
import { WorkspaceIndexer } from "./workspace-indexer.js";
import { expandQuery } from "./query-expander.js";

const TOP_K = 30;
const MIN_SCORE = 0.18;
const DENSE_CANDIDATE_THRESHOLD = 0.05;
const DENSE_WEIGHT = 0.65;
const BM25_WEIGHT = 0.35;

interface Workspace {
  indexer: WorkspaceIndexer;
  status: IndexStatus;
  building?: Promise<void>;
  /** Changes that arrived while an index build was in progress, queued for replay. */
  pendingChanges?: { changed: string[]; removed: string[] };
}

/**
 * Per-workspace search backend: lazily builds and caches a {@link WorkspaceIndexer}
 * per root, runs queries against it, and degrades to an "error" status if the
 * embedding model cannot run.
 */
@injectable()
export class SpexrSearchBackendService implements SpexrSearchService {
  private readonly workspaces = new Map<string, Workspace>();

  constructor(
    @inject(EmbedderToken) private readonly embedder: EmbedderType,
    @inject(DescriptionGeneratorToken) private readonly generator: DescriptionGenerator,
  ) {}

  private getOrCreate(root: string): Workspace {
    let ws = this.workspaces.get(root);
    if (!ws) {
      ws = {
        indexer: new WorkspaceIndexer(root, this.embedder),
        status: { state: "idle", indexed: 0, total: 0 },
      };
      this.workspaces.set(root, ws);
    }
    return ws;
  }

  async ensureIndexed(root: string): Promise<void> {
    const ws = this.getOrCreate(root);
    if (ws.status.state === "ready" || ws.status.state === "indexing") return;
    void this.build(ws, root);
  }

  async reindex(root: string): Promise<void> {
    const ws = this.getOrCreate(root);
    if (ws.building) await ws.building; // drain in-flight build first
    // Discard the persisted index and the in-memory state so the rebuild starts
    // empty: this is the only path that picks up changes to extraction logic
    // (descriptions, categories, symbols, embeddings) for unchanged files.
    delete ws.pendingChanges;
    ws.indexer = new WorkspaceIndexer(root, this.embedder);
    ws.status = { state: "idle", indexed: 0, total: 0 };
    await this.build(ws, root, true);
  }

  async describeFile(root: string, path: string): Promise<string | null> {
    const ws = this.workspaces.get(root);
    const record = ws?.indexer.index.getRecord(path);
    if (!ws || !record) return null;
    if (record.aiDescription) return record.aiDescription;
    if (!this.generator.isAvailable()) return null;
    let content: string;
    try {
      content = await readFile(join(root, path), "utf8");
    } catch {
      return null;
    }
    const text = await this.generator.generate(path, content);
    if (!text) return null;
    ws.indexer.index.setAiDescription(path, text);
    await ws.indexer.save();
    return text;
  }

  /** Build (or rebuild) an index, updating status; never throws. */
  private build(ws: Workspace, root: string, force = false): Promise<void> {
    if (ws.building) return ws.building;
    ws.status = { state: "indexing", indexed: 0, total: 0 };
    ws.building = (async () => {
      try {
        if (!force && await ws.indexer.load()) {
          if (ws.pendingChanges) {
            const { changed, removed } = ws.pendingChanges;
            delete ws.pendingChanges;
            for (const rel of removed) ws.indexer.removeFile(rel);
            for (const rel of changed) {
              try { await ws.indexer.updateFile(rel); } catch { /* ignore */ }
            }
            await ws.indexer.save();
          }
          ws.status = { state: "ready", indexed: ws.indexer.index.size, total: ws.indexer.index.size };
          return;
        }
        await ws.indexer.buildAll((indexed, total) => {
          ws.status = { state: "indexing", indexed, total };
        });
        await ws.indexer.save();
        if (ws.pendingChanges) {
          const { changed, removed } = ws.pendingChanges;
          delete ws.pendingChanges;
          for (const rel of removed) ws.indexer.removeFile(rel);
          for (const rel of changed) {
            try { await ws.indexer.updateFile(rel); } catch { /* ignore */ }
          }
          await ws.indexer.save();
        }
        ws.status = { state: "ready", indexed: ws.indexer.index.size, total: ws.indexer.index.size };
      } catch (err) {
        ws.status = {
          state: "error",
          indexed: ws.indexer.index.size,
          total: ws.indexer.index.size,
          message: err instanceof Error ? err.message : String(err),
        };
      } finally {
        delete ws.building;
      }
    })();
    return ws.building;
  }

  async getIndexStatus(root: string): Promise<IndexStatus> {
    return this.getOrCreate(root).status;
  }

  async search(root: string, query: string): Promise<SearchHit[]> {
    const ws = this.workspaces.get(root);
    if (!ws || ws.indexer.index.size === 0 || query.trim().length === 0) return [];
    try {
      const expanded = expandQuery(query);
      const [vector] = await this.embedder.embed([expanded]);

      // Dense pass with low threshold to widen the candidate pool.
      const denseCandidates = ws.indexer.index.search(vector!, TOP_K * 3, DENSE_CANDIDATE_THRESHOLD);
      const denseMap = new Map(denseCandidates.map((h) => [h.path, h]));

      // BM25 pass over all indexed docs.
      const bm25Raw = ws.indexer.bm25.score(expanded);
      const maxBm25 = Math.max(...bm25Raw.values(), 0.001);

      // Union: dense candidates + BM25-strong docs not in dense.
      const candidatePaths = new Set(denseCandidates.map((h) => h.path));
      for (const [path, score] of bm25Raw) {
        if (score / maxBm25 >= 0.3) candidatePaths.add(path);
      }

      const results: SearchHit[] = [];
      for (const path of candidatePaths) {
        const denseHit = denseMap.get(path);
        const cosine = denseHit?.score ?? 0;
        const bm25 = (bm25Raw.get(path) ?? 0) / maxBm25;
        const hybrid = DENSE_WEIGHT * cosine + BM25_WEIGHT * bm25;
        if (hybrid < MIN_SCORE) continue;
        const rec = denseHit ?? ws.indexer.index.getRecord(path);
        results.push({
          path,
          score: hybrid,
          snippet: rec?.snippet ?? "",
          category: rec?.category ?? "other",
          description: rec?.description ?? "",
        });
      }

      results.sort((a, b) => b.score - a.score);
      return results.slice(0, TOP_K);
    } catch (err) {
      ws.status = {
        state: "error",
        indexed: ws.indexer.index.size,
        total: ws.indexer.index.size,
        message: err instanceof Error ? err.message : String(err),
      };
      return [];
    }
  }

  async applyChanges(root: string, changedPaths: string[], removedPaths: string[]): Promise<void> {
    const ws = this.workspaces.get(root);
    if (!ws) return;
    if (ws.status.state !== "ready") {
      // Queue for replay once the build completes.
      const p = ws.pendingChanges ?? (ws.pendingChanges = { changed: [], removed: [] });
      p.changed.push(...changedPaths);
      p.removed.push(...removedPaths);
      return;
    }
    for (const rel of removedPaths) ws.indexer.removeFile(rel);
    for (const rel of changedPaths) {
      try {
        await ws.indexer.updateFile(rel);
      } catch {
        // a single bad file must not break the batch
      }
    }
    await ws.indexer.save();
    ws.status = { state: "ready", indexed: ws.indexer.index.size, total: ws.indexer.index.size };
  }
}
