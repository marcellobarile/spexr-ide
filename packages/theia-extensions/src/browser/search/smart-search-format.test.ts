import { describe, expect, it, vi } from "vitest";
import { formatScore, statusLabel, debounce, isSpexrCacheLoss } from "./smart-search-format.js";

describe("isSpexrCacheLoss", () => {
  // FileChangeType: 0 UPDATED, 1 ADDED, 2 DELETED
  it("is true for a DELETE of the .spexr dir or a persisted artifact", () => {
    expect(isSpexrCacheLoss(".spexr", 2)).toBe(true);
    expect(isSpexrCacheLoss(".spexr/search-index.json", 2)).toBe(true);
    expect(isSpexrCacheLoss(".spexr/descriptions.json", 2)).toBe(true);
  });

  it("is false for our own *.tmp churn (regression: watcher must not chase its own writes)", () => {
    expect(isSpexrCacheLoss(".spexr/search-index.json.1a2b3c4d.tmp", 2)).toBe(false);
    expect(isSpexrCacheLoss(".spexr/descriptions.json.deadbeef.tmp", 2)).toBe(false);
  });

  it("is false for ADD/UPDATE of persisted artifacts (only deletions are cache loss)", () => {
    expect(isSpexrCacheLoss(".spexr/search-index.json", 1)).toBe(false);
    expect(isSpexrCacheLoss(".spexr/search-index.json", 0)).toBe(false);
    expect(isSpexrCacheLoss(".spexr", 1)).toBe(false);
  });

  it("is false for unrelated paths and other .spexr children", () => {
    expect(isSpexrCacheLoss("src/app.ts", 2)).toBe(false);
    expect(isSpexrCacheLoss(".spexr/codebase-map.md", 2)).toBe(false);
  });
});

describe("formatScore", () => {
  it("renders a similarity as a rounded percentage", () => {
    expect(formatScore(0.9234)).toBe("92%");
    expect(formatScore(0)).toBe("0%");
    expect(formatScore(1)).toBe("100%");
  });
});

describe("statusLabel", () => {
  it("describes each index state", () => {
    expect(statusLabel({ state: "ready", indexed: 10, total: 10 })).toBe("Ready");
    expect(statusLabel({ state: "indexing", indexed: 3, total: 12 })).toBe("Indexing… 3/12");
    expect(statusLabel({ state: "error", indexed: 0, total: 0, message: "x" })).toBe("Search unavailable");
    expect(statusLabel({ state: "idle", indexed: 0, total: 0 })).toBe("Idle");
  });
});

describe("debounce", () => {
  it("invokes once after the delay with the latest args", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 100);
    d("a");
    d("b");
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("b");
    vi.useRealTimers();
  });

  it("cancel() prevents a pending call", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 100);
    d("a");
    d.cancel();
    vi.advanceTimersByTime(100);
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
