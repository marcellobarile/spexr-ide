import { describe, expect, it } from "vitest";
import { DescriptionJob, type DescriptionJobDeps } from "./description-job.js";
import { VectorIndex, type IndexRecord } from "./vector-index.js";
import { DescriptionsStore } from "./descriptions-store.js";
import type { ClaudeDescriber, DescribeItem } from "./claude-batch-describer.js";
import type { DescriptionJobStatus } from "../../common/search-protocol.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rec = (path: string, category = "other"): IndexRecord => ({
  path, category, description: "static",
  vector: new Float32Array([1]), mtimeMs: 0, hash: "h", snippet: "",
});

class FakeDescriber implements ClaudeDescriber {
  available = true;
  calls: DescribeItem[][] = [];
  beforeResolve?: () => void;

  isAvailable(): boolean { return this.available; }

  async describeChunk(items: DescribeItem[]): Promise<Map<string, string>> {
    this.calls.push(items);
    this.beforeResolve?.();
    const result = new Map<string, string>();
    for (const it of items) result.set(it.relPath, `desc:${it.relPath}`);
    return result;
  }
}

interface JobEnv {
  d: DescriptionJobDeps;
  statuses: DescriptionJobStatus[];
  state: { markdowns: number };
  store: DescriptionsStore;
  root: string;
}

async function makeEnv(
  index: VectorIndex,
  describer: ClaudeDescriber,
  over: Partial<DescriptionJobDeps> = {},
): Promise<JobEnv> {
  const root = await mkdtemp(join(tmpdir(), "djob-"));
  const store = new DescriptionsStore(root);
  const statuses: DescriptionJobStatus[] = [];
  const state = { markdowns: 0 };
  const d: DescriptionJobDeps = {
    records: () => index.allRecords(),
    readContent: async (rel) => `content of ${rel}`,
    describer,
    store,
    writeMarkdown: async () => { state.markdowns++; },
    emit: (s) => statuses.push({ ...s }),
    ...over,
  };
  return { d, statuses, state, store, root };
}

describe("DescriptionJob", () => {
  it("describes only records missing from the store by default", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    idx.upsert(rec("b.ts"));
    idx.upsert(rec("c.ts"));
    const describer = new FakeDescriber();
    const env = await makeEnv(idx, describer);

    // Pre-seed b.ts in the store so it is skipped
    await env.store.merge(new Map([["b.ts", { description: "already", category: "other" }]]));

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });

    const described = describer.calls.flatMap((chunk) => chunk.map((it) => it.relPath)).sort();
    expect(described).toEqual(["a.ts", "c.ts"]);
    expect(env.store.get("a.ts")).toBe("desc:a.ts");
    expect(env.store.get("b.ts")).toBe("already"); // untouched
    expect(job.status).toMatchObject({ state: "complete", done: 2, total: 2 });

    await rm(env.root, { recursive: true, force: true });
  });

  it("regenerate=true reprocesses every record", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    const describer = new FakeDescriber();
    const env = await makeEnv(idx, describer);
    await env.store.merge(new Map([["a.ts", { description: "old", category: "other" }]]));

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: true });
    expect(env.store.get("a.ts")).toBe("desc:a.ts");

    await rm(env.root, { recursive: true, force: true });
  });

  it("store.merge is called per chunk and writeMarkdown once on completion", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    idx.upsert(rec("b.ts"));
    const describer = new FakeDescriber();
    const env = await makeEnv(idx, describer);

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });

    // All 2 records fit in a single chunk (CLAUDE_CHUNK_SIZE=75)
    expect(describer.calls).toHaveLength(1);
    expect(env.state.markdowns).toBe(1);
    expect(job.status.state).toBe("complete");

    await rm(env.root, { recursive: true, force: true });
  });

  it("stores the category from the index record", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("front.tsx", "frontend"));
    const describer = new FakeDescriber();
    const env = await makeEnv(idx, describer);

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });

    expect(env.store.entries().get("front.tsx")?.category).toBe("frontend");

    await rm(env.root, { recursive: true, force: true });
  });

  it("pauses after the current chunk and resumes the rest", async () => {
    // Need > CLAUDE_CHUNK_SIZE (75) files to span two chunks.
    const idx = new VectorIndex();
    for (let i = 0; i < 76; i++) idx.upsert(rec(`f${i}.ts`));
    const describer = new FakeDescriber();
    const env = await makeEnv(idx, describer);

    const job = new DescriptionJob(env.d);
    // Pause during the first chunk's describeChunk call.
    describer.beforeResolve = () => { describer.beforeResolve = undefined; job.pause(); };
    await job.start({ regenerate: false });

    expect(job.status.state).toBe("paused");
    expect(job.status.done).toBe(75); // first chunk of 75

    await job.resume();
    expect(job.status).toMatchObject({ state: "complete", done: 76, total: 76 });

    const distinctStates = env.statuses
      .map((s) => s.state)
      .filter((s, i, arr) => i === 0 || s !== arr[i - 1]);
    expect(distinctStates).toEqual(["running", "paused", "running", "complete"]);

    await rm(env.root, { recursive: true, force: true });
  });

  it("ends in error when the describer is unavailable", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    const describer = new FakeDescriber();
    describer.available = false;
    const env = await makeEnv(idx, describer);

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });
    expect(job.status.state).toBe("error");
    expect(job.status.message).toContain("Claude CLI not available");
    expect(env.state.markdowns).toBe(0);

    await rm(env.root, { recursive: true, force: true });
  });

  it("transitions to error when writeMarkdown throws, and allows restart", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    const describer = new FakeDescriber();
    let mdCalls = 0;
    const env = await makeEnv(idx, describer, {
      writeMarkdown: async () => {
        if (++mdCalls === 1) throw new Error("write failed");
      },
    });

    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });
    expect(job.status.state).toBe("error");
    expect(job.status.message).toContain("write failed");

    // Job is not stuck in "running" — start must be allowed to proceed.
    describer.calls = [];
    await job.start({ regenerate: true });
    expect(job.status.state).toBe("complete");

    await rm(env.root, { recursive: true, force: true });
  });
});
