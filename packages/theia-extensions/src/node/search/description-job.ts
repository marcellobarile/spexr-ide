import type { IndexRecord } from "./vector-index.js";
import type { DescriptionJobStatus } from "../../common/search-protocol.js";
import { buildSymbolSummary } from "./description-format.js";
import { CLAUDE_CHUNK_SIZE, type ClaudeDescriber, type DescribeItem } from "./claude-batch-describer.js";
import type { DescriptionsStore, StoredDescription } from "./descriptions-store.js";

export interface DescriptionJobDeps {
  /** Live index records, re-read at start() so reindex swaps are visible. */
  records: () => IndexRecord[];
  readContent: (relPath: string) => Promise<string>;
  describer: ClaudeDescriber;
  store: DescriptionsStore;
  /** Write codebase-map.md from the store; called once on completion. */
  writeMarkdown: () => Promise<void>;
  /** Push a status snapshot to observers. */
  emit: (status: DescriptionJobStatus) => void;
}

/**
 * Workspace-wide description generator. Walks records missing a store entry
 * (or all, when regenerating), chunking them through Claude, merging results
 * into the descriptions store, and exporting the markdown map on completion.
 * Pausing is cooperative — it takes effect between chunks, never mid-call.
 */
export class DescriptionJob {
  private state: DescriptionJobStatus["state"] = "idle";
  private done = 0;
  private total = 0;
  private message?: string;
  private targets: string[] = [];
  private cursor = 0;
  private pauseRequested = false;
  private categoryByPath = new Map<string, string>();

  constructor(private readonly deps: DescriptionJobDeps) {}

  get status(): DescriptionJobStatus {
    const s: DescriptionJobStatus = { state: this.state, done: this.done, total: this.total };
    if (this.message !== undefined) s.message = this.message;
    return s;
  }

  async start(opts: { regenerate: boolean }): Promise<void> {
    if (this.state === "running") return;
    const recs = this.deps.records();
    this.categoryByPath = new Map(recs.map((r) => [r.path, r.category]));
    this.targets = recs
      .filter((r) => opts.regenerate || this.deps.store.get(r.path) === undefined)
      .map((r) => r.path);
    this.cursor = 0;
    this.done = 0;
    this.total = this.targets.length;
    delete this.message;
    this.pauseRequested = false;
    this.state = "running";
    this.deps.emit(this.status);
    await this.run();
  }

  pause(): void {
    if (this.state === "running") this.pauseRequested = true;
  }

  async resume(): Promise<void> {
    if (this.state !== "paused") return;
    this.pauseRequested = false;
    this.state = "running";
    this.deps.emit(this.status);
    await this.run();
  }

  private async run(): Promise<void> {
    try {
      while (this.cursor < this.targets.length) {
        if (this.pauseRequested) {
          this.state = "paused";
          this.deps.emit(this.status);
          return;
        }
        if (!this.deps.describer.isAvailable()) {
          this.state = "error";
          this.message = "Claude CLI not available.";
          this.deps.emit(this.status);
          return;
        }
        const chunk = this.targets.slice(this.cursor, this.cursor + CLAUDE_CHUNK_SIZE);
        const items: DescribeItem[] = [];
        for (const relPath of chunk) {
          try {
            items.push({ relPath, summary: buildSymbolSummary(relPath, await this.deps.readContent(relPath)) });
          } catch {
            // unreadable file: skip generation but still count it (cursor advances)
          }
        }
        const descs = await this.deps.describer.describeChunk(items);
        const merge = new Map<string, StoredDescription>();
        for (const [path, description] of descs) {
          merge.set(path, { description, category: this.categoryByPath.get(path) ?? "other" });
        }
        if (merge.size > 0) await this.deps.store.merge(merge);
        this.cursor += chunk.length;
        this.done = this.cursor;
        this.deps.emit(this.status);
      }
      await this.deps.writeMarkdown();
      this.state = "complete";
      this.deps.emit(this.status);
    } catch (err) {
      this.state = "error";
      this.message = err instanceof Error ? err.message : String(err);
      this.deps.emit(this.status);
    }
  }
}
