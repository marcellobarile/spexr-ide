import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
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

  it("removeMany removes entries and persists; no-op when none match", async () => {
    const s = new DescriptionsStore(root);
    await s.load();
    await s.merge(new Map([
      ["a.ts", { description: "A", category: "backend" }],
      ["b.ts", { description: "B", category: "frontend" }],
    ]));
    await s.removeMany(["a.ts", "unknown.ts"]);
    expect(s.get("a.ts")).toBeUndefined();
    expect(s.get("b.ts")).toBe("B");
    const onDisk = JSON.parse(await readFile(join(root, ".spexr", "descriptions.json"), "utf8"));
    expect(Object.keys(onDisk)).toEqual(["b.ts"]);

    // no-op when nothing matches: should not throw and should not rewrite
    await s.removeMany(["nonexistent.ts"]);
    expect(s.get("b.ts")).toBe("B");
  });

  it("load() clears stale entries when file is corrupt or missing", async () => {
    const s = new DescriptionsStore(root);
    await s.merge(new Map([["a.ts", { description: "A", category: "x" }]]));
    expect(s.get("a.ts")).toBe("A");

    // Corrupt the file
    await writeFile(join(root, ".spexr", "descriptions.json"), "invalid json", "utf8");

    // load() should clear the map even though the file is corrupt
    await s.load();
    expect(s.get("a.ts")).toBeUndefined();
    expect(s.entries().size).toBe(0);
  });
});
