import type { VectorIndex } from "./vector-index.js";
import type { BatchItem, DescriptionGenerator } from "./description-format.js";
import type { DescriptionJobStatus } from "../../common/search-protocol.js";

const BATCH_SIZE = 5;
const SAVE_EVERY_BATCHES = 5;

export interface DescriptionJobDeps {
  index: VectorIndex;
  generator: DescriptionGenerator;
  /** Read a workspace-relative file's content. */
  readContent: (relPath: string) => Promise<string>;
  /** Persist the index. */
  save: () => Promise<void>;
  /** Write the export artifacts (called once on completion). */
  writeArtifacts: () => Promise<void>;
  /** Push a status snapshot to observers. */
  emit: (status: DescriptionJobStatus) => void;
}

/**
 * Workspace-wide description generator. Walks every record missing an
 * aiDescription (or all, when regenerating), batching them through the model,
 * persisting incrementally, and exporting artifacts on completion. Pausing is
 * cooperative — it takes effect between batches, never mid-inference.
 */
export class DescriptionJob {
  private state: DescriptionJobStatus["state"] = "idle";
  private done = 0;
  private total = 0;
  private message?: string;
  private targets: string[] = [];
  private cursor = 0;
  private pauseRequested = false;

  constructor(private readonly deps: DescriptionJobDeps) {}

  get status(): DescriptionJobStatus {
    const s: DescriptionJobStatus = { state: this.state, done: this.done, total: this.total };
    if (this.message !== undefined) s.message = this.message;
    return s;
  }

  async start(opts: { regenerate: boolean }): Promise<void> {
    if (this.state === "running") return;
    this.targets = this.deps.index
      .allRecords()
      .filter((r) => opts.regenerate || r.aiDescription === undefined)
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
    let batches = 0;
    try {
      while (this.cursor < this.targets.length) {
        if (this.pauseRequested) {
          this.state = "paused";
          await this.deps.save();
          this.deps.emit(this.status);
          return;
        }
        if (!this.deps.generator.isAvailable()) {
          this.state = "error";
          this.message = "Description model unavailable.";
          await this.deps.save();
          this.deps.emit(this.status);
          return;
        }
        const batch = this.targets.slice(this.cursor, this.cursor + BATCH_SIZE);
        const items: BatchItem[] = [];
        for (const relPath of batch) {
          try {
            items.push({ relPath, content: await this.deps.readContent(relPath) });
          } catch {
            // Unreadable file: skip generation but still count it as processed.
          }
        }
        const texts = await this.deps.generator.generateBatch(items);
        items.forEach((it, i) => {
          const text = texts[i];
          if (text) this.deps.index.setAiDescription(it.relPath, text);
        });
        this.cursor += batch.length;
        this.done = this.cursor;
        batches++;
        if (batches % SAVE_EVERY_BATCHES === 0) await this.deps.save();
        this.deps.emit(this.status);
      }
      await this.deps.save();
      await this.deps.writeArtifacts();
      this.state = "complete";
      this.deps.emit(this.status);
    } catch (err) {
      this.state = "error";
      this.message = err instanceof Error ? err.message : String(err);
      try { await this.deps.save(); } catch { /* best-effort */ }
      this.deps.emit(this.status);
    }
  }
}
