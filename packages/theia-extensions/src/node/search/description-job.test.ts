import { describe, expect, it } from "vitest";
import { DescriptionJob, type DescriptionJobDeps } from "./description-job.js";
import { VectorIndex, type IndexRecord } from "./vector-index.js";
import type { BatchItem, DescriptionGenerator } from "./description-format.js";
import type { DescriptionJobStatus } from "../../common/search-protocol.js";

const rec = (path: string, aiDescription?: string): IndexRecord => ({
  path, aiDescription, category: "other", description: "static",
  vector: new Float32Array([1]), mtimeMs: 0, hash: "h", snippet: "",
});

class FakeGen implements DescriptionGenerator {
  available = true;
  calls: BatchItem[][] = [];
  beforeResolve?: () => void;
  isAvailable(): boolean { return this.available; }
  async generateBatch(items: BatchItem[]): Promise<(string | null)[]> {
    this.calls.push(items);
    this.beforeResolve?.();
    return items.map((it) => `desc:${it.relPath}`);
  }
}

interface JobEnv {
  d: DescriptionJobDeps;
  statuses: DescriptionJobStatus[];
  state: { saves: number; artifacts: number };
}

function deps(index: VectorIndex, gen: DescriptionGenerator, over: Partial<DescriptionJobDeps> = {}): JobEnv {
  const statuses: DescriptionJobStatus[] = [];
  const state = { saves: 0, artifacts: 0 };
  const d: DescriptionJobDeps = {
    index, generator: gen,
    readContent: async (rel) => `content of ${rel}`,
    save: async () => { state.saves++; },
    writeArtifacts: async () => { state.artifacts++; },
    emit: (s) => statuses.push({ ...s }),
    ...over,
  };
  return { d, statuses, state };
}

describe("DescriptionJob", () => {
  it("describes only records missing aiDescription by default", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    idx.upsert(rec("b.ts", "already"));
    idx.upsert(rec("c.ts"));
    const gen = new FakeGen();
    const { d } = deps(idx, gen);
    const job = new DescriptionJob(d);
    await job.start({ regenerate: false });
    expect(gen.calls.flat().map((i) => i.relPath).sort()).toEqual(["a.ts", "c.ts"]);
    expect(idx.getRecord("a.ts")!.aiDescription).toBe("desc:a.ts");
    expect(idx.getRecord("b.ts")!.aiDescription).toBe("already");
    expect(job.status).toMatchObject({ state: "complete", done: 2, total: 2 });
  });

  it("regenerate=true reprocesses every record", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts", "old"));
    const gen = new FakeGen();
    const { d } = deps(idx, gen);
    const job = new DescriptionJob(d);
    await job.start({ regenerate: true });
    expect(idx.getRecord("a.ts")!.aiDescription).toBe("desc:a.ts");
  });

  it("writes artifacts exactly once on completion", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    const gen = new FakeGen();
    const env = deps(idx, gen);
    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });
    expect(env.state.artifacts).toBe(1);
  });

  it("pauses after the current batch and resumes the rest", async () => {
    const idx = new VectorIndex();
    for (let i = 0; i < 8; i++) idx.upsert(rec(`f${i}.ts`)); // 2 batches of 5 + remainder
    const gen = new FakeGen();
    const env = deps(idx, gen);
    const job = new DescriptionJob(env.d);
    gen.beforeResolve = () => { gen.beforeResolve = undefined; job.pause(); }; // pause during first batch
    await job.start({ regenerate: false });
    expect(job.status.state).toBe("paused");
    expect(job.status.done).toBe(5);
    await job.resume();
    expect(job.status).toMatchObject({ state: "complete", done: 8, total: 8 });
  });

  it("ends in error when the model is unavailable", async () => {
    const idx = new VectorIndex();
    idx.upsert(rec("a.ts"));
    const gen = new FakeGen();
    gen.available = false;
    const env = deps(idx, gen);
    const job = new DescriptionJob(env.d);
    await job.start({ regenerate: false });
    expect(job.status.state).toBe("error");
    expect(env.state.artifacts).toBe(0);
  });
});
