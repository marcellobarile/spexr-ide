import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DescriptionsStore } from "./descriptions-store.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "spexr-store-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("DescriptionsStore", () => {
  it("merges incrementally and persists JSON", async () => {
    const s = new DescriptionsStore(root);
    await s.load();
    await s.merge(new Map([["a.ts", { description: "A", category: "backend" }]]));
    await s.merge(new Map([["b.ts", { description: "B", category: "frontend" }]]));
    expect(s.get("a.ts")).toBe("A");
    const onDisk = JSON.parse(await readFile(join(root, ".spexr", "descriptions.json"), "utf8"));
    expect(Object.keys(onDisk).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("load() restores a previously written store", async () => {
    const s = new DescriptionsStore(root);
    await s.merge(new Map([["a.ts", { description: "A", category: "x" }]]));
    const s2 = new DescriptionsStore(root);
    await s2.load();
    expect(s2.get("a.ts")).toBe("A");
  });

  it("get() returns undefined for unknown path", async () => {
    const s = new DescriptionsStore(root);
    await s.load();
    expect(s.get("missing.ts")).toBeUndefined();
  });
});
