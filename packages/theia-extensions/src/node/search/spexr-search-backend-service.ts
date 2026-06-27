import { inject, injectable } from "@theia/core/shared/inversify";
import type {
  SpexrSearchService,
  SearchHit,
  IndexStatus,
} from "../../common/search-protocol.js";
import type { Embedder as EmbedderType } from "./embedding-model.js";
import { EmbedderToken } from "./embedding-model.js";
import { WorkspaceIndexer } from "./workspace-indexer.js";

const TOP_K = 30;
const MIN_SCORE = 0.2;

interface Workspace {
  indexer: WorkspaceIndexer;
  status: IndexStatus;
  building?: Promise<void>;
}

/**
 * Per-workspace search backend: lazily builds and caches a {@link WorkspaceIndexer}
 * per root, runs queries against it, and degrades to an "error" status if the
 * embedding model cannot run.
 */
@injectable()
export class SpexrSearchBackendService implements SpexrSearchService {
  private readonly workspaces = new Map<string, Workspace>();

  constructor(@inject(EmbedderToken) private readonly embedder: EmbedderType) {}

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
    ws.status = { state: "idle", indexed: 0, total: 0 };
    await this.build(ws, root);
  }

  /** Build (or rebuild) an index, updating status; never throws. */
  private build(ws: Workspace, root: string): Promise<void> {
    if (ws.building) return ws.building;
    ws.status = { state: "indexing", indexed: 0, total: 0 };
    ws.building = (async () => {
      try {
        if (await ws.indexer.load()) {
          ws.status = { state: "ready", indexed: ws.indexer.index.size, total: ws.indexer.index.size };
          return;
        }
        await ws.indexer.buildAll((indexed, total) => {
          ws.status = { state: "indexing", indexed, total };
        });
        await ws.indexer.save();
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
      const [vector] = await this.embedder.embed([query]);
      return ws.indexer.index.search(vector!, TOP_K, MIN_SCORE);
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
    if (!ws || ws.status.state !== "ready") return;
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
