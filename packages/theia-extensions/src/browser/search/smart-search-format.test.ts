import { describe, expect, it, vi } from "vitest";
import { formatScore, statusLabel, debounce } from "./smart-search-format.js";

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
