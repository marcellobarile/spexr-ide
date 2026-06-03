import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultMemoryScopeManager } from "./scope-manager.js";
import type { MemoryStore } from "./store.js";
import type {
  MemoryListFilter,
  MemoryRecord,
  MemoryScope,
  MemoryWriteInput,
} from "./types.js";

/** In-memory MemoryStore so the manager's scope logic is tested without fs. */
class FakeStore implements MemoryStore {
  private readonly records = new Map<string, MemoryRecord>();

  constructor(
    readonly scope: MemoryScope,
    private readonly readOnly = scope === "baseline",
  ) {}

  seed(filename: string, body: string): void {
    this.records.set(filename, this.build(filename, body));
  }

  has(filename: string): boolean {
    return this.records.has(filename);
  }

  async list(filter: MemoryListFilter = {}): Promise<readonly MemoryRecord[]> {
    if (filter.scope !== undefined && filter.scope !== this.scope) return [];
    return [...this.records.values()].filter(
      (r) => !filter.type || r.frontmatter.type === filter.type,
    );
  }

  async read(filename: string): Promise<MemoryRecord> {
    const record = this.records.get(filename);
    if (!record) throw new Error(`not found: ${filename}`);
    return record;
  }

  async write(input: MemoryWriteInput): Promise<MemoryRecord> {
    const record = this.build(input.filename, input.body, input.frontmatter.description);
    this.records.set(input.filename, record);
    return record;
  }

  async remove(filename: string): Promise<void> {
    this.records.delete(filename);
  }

  private build(filename: string, body: string, description?: string): MemoryRecord {
    const id = filename.replace(/\.md$/, "");
    return {
      id,
      scope: this.scope,
      filename,
      absolutePath: `/${this.scope}/${filename}`,
      frontmatter: { name: id, description: description ?? `${this.scope}:${id}`, type: "project" },
      body,
      readOnly: this.readOnly,
    };
  }
}

let tmp: string;
let baseline: FakeStore;
let user: FakeStore;
let project: FakeStore;
let manager: DefaultMemoryScopeManager;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "spexr-scope-"));
  baseline = new FakeStore("baseline");
  user = new FakeStore("user");
  project = new FakeStore("project");
  manager = new DefaultMemoryScopeManager({
    stores: { baseline, user, project },
    indexFiles: { user: join(tmp, "user.md"), project: join(tmp, "project.md") },
  });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("DefaultMemoryScopeManager.effective", () => {
  it("collapses by id with project > user > baseline", async () => {
    baseline.seed("a.md", "baseline-a");
    baseline.seed("b.md", "baseline-b");
    user.seed("b.md", "user-b");
    user.seed("c.md", "user-c");
    project.seed("c.md", "project-c");

    const effective = await manager.effective();
    const byId = new Map(effective.map((r) => [r.id, r]));

    expect(byId.get("a")?.body).toBe("baseline-a");
    expect(byId.get("b")?.body).toBe("user-b");
    expect(byId.get("c")?.body).toBe("project-c");
    expect(effective).toHaveLength(3);
  });

  it("returns baseline entries when no overrides exist", async () => {
    baseline.seed("only.md", "baseline-only");
    const effective = await manager.effective();
    expect(effective).toHaveLength(1);
    expect(effective[0]?.body).toBe("baseline-only");
  });
});

describe("DefaultMemoryScopeManager.list", () => {
  it("filters by scope", async () => {
    baseline.seed("a.md", "x");
    user.seed("b.md", "y");
    project.seed("c.md", "z");

    const userOnly = await manager.list({ scope: "user" });
    expect(userOnly.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("DefaultMemoryScopeManager.promote", () => {
  it("copies a user record into project and removes the user source", async () => {
    user.seed("note.md", "body");

    const target = await manager.promote("note.md", "user", "project");

    expect(target.scope).toBe("project");
    expect(target.body).toBe("body");
    expect(project.has("note.md")).toBe(true);
    expect(user.has("note.md")).toBe(false);
  });

  it("promotes baseline to user without mutating read-only baseline", async () => {
    baseline.seed("seed.md", "baseline-body");

    const target = await manager.promote("seed.md", "baseline", "user");

    expect(target.scope).toBe("user");
    expect(user.has("seed.md")).toBe(true);
    expect(baseline.has("seed.md")).toBe(true);
  });

  it("rejects promotion to the same scope", async () => {
    await expect(manager.promote("x.md", "user", "user")).rejects.toThrow(/same/);
  });
});

describe("DefaultMemoryScopeManager.demote", () => {
  it("moves a project record down to user", async () => {
    project.seed("p.md", "project-body");

    const target = await manager.demote("p.md", "project", "user");

    expect(target.scope).toBe("user");
    expect(user.has("p.md")).toBe(true);
    expect(project.has("p.md")).toBe(false);
  });
});

describe("DefaultMemoryScopeManager.rebuildIndex", () => {
  it("writes the index file for the scope", async () => {
    user.seed("first.md", "b");
    await manager.rebuildIndex("user");
    const contents = await readFile(join(tmp, "user.md"), "utf8");
    expect(contents).toMatch(/first/);
  });
});
