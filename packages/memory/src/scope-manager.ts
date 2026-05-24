import { MemoryError, type Logger } from "@spexr/core";
import { renderMemoryIndex, writeIndexFile } from "./index-file.js";
import type { MemoryStore } from "./store.js";
import type {
  MemoryListFilter,
  MemoryRecord,
  MemoryScope,
  MemoryWriteInput,
} from "./types.js";

/**
 * Aggregates the three scopes (baseline, user, project) and resolves overrides:
 * project > user > baseline. Promote/demote moves a record between scopes
 * without rewriting the body.
 */
export interface MemoryScopeManager {
  list(filter?: MemoryListFilter): Promise<readonly MemoryRecord[]>;
  effective(): Promise<readonly MemoryRecord[]>;
  promote(filename: string, from: "user" | "baseline", to: "user" | "project"): Promise<MemoryRecord>;
  demote(filename: string, from: "project", to: "user"): Promise<MemoryRecord>;
  write(input: MemoryWriteInput): Promise<MemoryRecord>;
  remove(scope: "user" | "project", filename: string): Promise<void>;
  rebuildIndex(scope: "user" | "project"): Promise<void>;
}

export interface MemoryScopeManagerOptions {
  readonly stores: {
    readonly baseline?: MemoryStore;
    readonly user: MemoryStore;
    readonly project: MemoryStore;
  };
  readonly indexFiles: {
    readonly user: string;
    readonly project: string;
  };
  readonly logger?: Logger;
}

export class DefaultMemoryScopeManager implements MemoryScopeManager {
  private readonly stores: MemoryScopeManagerOptions["stores"];
  private readonly indexFiles: MemoryScopeManagerOptions["indexFiles"];
  private readonly logger?: Logger;

  constructor(opts: MemoryScopeManagerOptions) {
    this.stores = opts.stores;
    this.indexFiles = opts.indexFiles;
    if (opts.logger !== undefined) this.logger = opts.logger;
  }

  async list(filter: MemoryListFilter = {}): Promise<readonly MemoryRecord[]> {
    const all = await this.collectAll();
    return all.filter((r) => matchesScope(r, filter));
  }

  /**
   * Collapse the three scopes by id, with project > user > baseline. The
   * agent receives only the effective set, which is what the user expects when
   * they "override" baseline guidance.
   */
  async effective(): Promise<readonly MemoryRecord[]> {
    const merged = new Map<string, MemoryRecord>();
    const baseline = this.stores.baseline ? await this.stores.baseline.list() : [];
    for (const r of baseline) merged.set(r.id, r);
    for (const r of await this.stores.user.list()) merged.set(r.id, r);
    for (const r of await this.stores.project.list()) merged.set(r.id, r);
    return [...merged.values()];
  }

  async write(input: MemoryWriteInput): Promise<MemoryRecord> {
    const store = this.storeFor(input.scope);
    const record = await store.write(input);
    await this.rebuildIndex(input.scope);
    return record;
  }

  async remove(scope: "user" | "project", filename: string): Promise<void> {
    await this.storeFor(scope).remove(filename);
    await this.rebuildIndex(scope);
  }

  async promote(
    filename: string,
    from: "user" | "baseline",
    to: "user" | "project",
  ): Promise<MemoryRecord> {
    if (from === to) {
      throw new MemoryError(`Promotion source and target scopes are the same: ${from}`);
    }
    const sourceStore = from === "baseline" ? this.stores.baseline : this.stores.user;
    if (!sourceStore) throw new MemoryError(`No source store for scope "${from}"`);
    const source = await sourceStore.read(filename);
    const target = await this.write({
      scope: to,
      filename,
      frontmatter: source.frontmatter,
      body: source.body,
    });
    if (from === "user" && !sourceStore.scope.includes("baseline")) {
      await this.stores.user.remove(filename);
      await this.rebuildIndex("user");
    }
    return target;
  }

  async demote(filename: string, from: "project", to: "user"): Promise<MemoryRecord> {
    const source = await this.stores.project.read(filename);
    const target = await this.write({
      scope: to,
      filename,
      frontmatter: source.frontmatter,
      body: source.body,
    });
    await this.stores.project.remove(filename);
    await this.rebuildIndex("project");
    void from;
    return target;
  }

  async rebuildIndex(scope: "user" | "project"): Promise<void> {
    const store = this.storeFor(scope);
    const records = await store.list();
    const path = scope === "user" ? this.indexFiles.user : this.indexFiles.project;
    const contents = renderMemoryIndex({ records });
    await writeIndexFile(path, contents);
    this.logger?.debug("Memory index rebuilt", { scope, count: records.length, path });
  }

  private async collectAll(): Promise<readonly MemoryRecord[]> {
    const baseline = this.stores.baseline ? await this.stores.baseline.list() : [];
    const user = await this.stores.user.list();
    const project = await this.stores.project.list();
    return [...baseline, ...user, ...project];
  }

  private storeFor(scope: "user" | "project"): MemoryStore {
    return scope === "user" ? this.stores.user : this.stores.project;
  }
}

function matchesScope(record: MemoryRecord, filter: MemoryListFilter): boolean {
  if (filter.scope && record.scope !== filter.scope) return false;
  if (filter.type && record.frontmatter.type !== filter.type) return false;
  if (filter.tag && !(record.frontmatter.tags ?? []).includes(filter.tag)) return false;
  return true;
}
