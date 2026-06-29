import { describe, expect, it, vi } from "vitest";
import { Container } from "@theia/core/shared/inversify";
import { WorkerDescriptionGenerator, type WorkerLike } from "./worker-description-generator.js";
import { DescriptionGeneratorToken, type WorkerRequest, type WorkerResponse } from "./description-format.js";

/** Controllable fake worker: records requests, lets the test push responses. */
class FakeWorker implements WorkerLike {
  requests: WorkerRequest[] = [];
  private messageCb?: (m: WorkerResponse) => void;
  private errorCb?: (e: unknown) => void;
  private exitCb?: (c: unknown) => void;
  terminated = false;

  postMessage(msg: WorkerRequest): void { this.requests.push(msg); }
  on(event: "message" | "error" | "exit", cb: (arg: never) => void): void {
    if (event === "message") this.messageCb = cb as (m: WorkerResponse) => void;
    else if (event === "error") this.errorCb = cb;
    else this.exitCb = cb;
  }
  terminate(): void { this.terminated = true; }

  emit(msg: WorkerResponse): void { this.messageCb?.(msg); }
  crash(): void { this.errorCb?.(new Error("worker crashed")); }
  exit(): void { this.exitCb?.(1); }
}

const item = (relPath: string) => ({ relPath, content: "code" });

describe("WorkerDescriptionGenerator", () => {
  it("resolves with the texts array from the done message", async () => {
    const fake = new FakeWorker();
    const gen = new WorkerDescriptionGenerator(() => fake);
    const p = gen.generateBatch([item("a.ts"), item("b.ts")]);

    const id = fake.requests[0]!.id;
    fake.emit({ id, type: "done", texts: ["Handles auth.", "Renders list."] });

    expect(await p).toEqual(["Handles auth.", "Renders list."]);
  });

  it("returns an empty array without posting for an empty batch", async () => {
    const fake = new FakeWorker();
    const gen = new WorkerDescriptionGenerator(() => fake);
    expect(await gen.generateBatch([])).toEqual([]);
    expect(fake.requests).toHaveLength(0);
  });

  it("spawns the worker only once across calls", async () => {
    const fake = new FakeWorker();
    const factory = vi.fn(() => fake);
    const gen = new WorkerDescriptionGenerator(factory);
    const p1 = gen.generateBatch([item("a.ts")]);
    const p2 = gen.generateBatch([item("b.ts")]);
    fake.emit({ id: fake.requests[0]!.id, type: "done", texts: ["one"] });
    fake.emit({ id: fake.requests[1]!.id, type: "done", texts: ["two"] });
    expect(await p1).toEqual(["one"]);
    expect(await p2).toEqual(["two"]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("resolves nulls on a worker error response", async () => {
    const fake = new FakeWorker();
    const gen = new WorkerDescriptionGenerator(() => fake);
    const p = gen.generateBatch([item("a.ts"), item("b.ts")]);
    fake.emit({ id: fake.requests[0]!.id, type: "error" });
    expect(await p).toEqual([null, null]);
  });

  it("becomes unavailable and resolves pending to nulls when the worker crashes", async () => {
    const fake = new FakeWorker();
    const gen = new WorkerDescriptionGenerator(() => fake);
    const p = gen.generateBatch([item("a.ts")]);
    fake.crash();
    expect(await p).toEqual([null]);
    expect(gen.isAvailable()).toBe(false);
    expect(await gen.generateBatch([item("b.ts")])).toEqual([null]); // no further work
  });

  it("returns nulls without spawning when the factory throws", async () => {
    const gen = new WorkerDescriptionGenerator(() => { throw new Error("spawn failed"); });
    expect(await gen.generateBatch([item("a.ts")])).toEqual([null]);
    expect(gen.isAvailable()).toBe(false);
  });

  it("resolves via inversify DI without binding the unmanaged factory", () => {
    const container = new Container();
    container.bind(DescriptionGeneratorToken).to(WorkerDescriptionGenerator);
    const gen = container.get(DescriptionGeneratorToken);
    expect(gen).toBeInstanceOf(WorkerDescriptionGenerator);
  });
});
