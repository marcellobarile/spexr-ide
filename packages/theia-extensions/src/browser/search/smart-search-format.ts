import type { IndexStatus } from "../../common/search-protocol.js";

/** Similarity in [0,1] → rounded percentage string. */
export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/** Human-readable label for an index status. */
export function statusLabel(s: IndexStatus): string {
  switch (s.state) {
    case "ready":
      return "Ready";
    case "indexing":
      return `Indexing… ${s.indexed}/${s.total}`;
    case "error":
      return "Search unavailable";
    default:
      return "Idle";
  }
}

interface Debounced<T extends (...args: never[]) => void> {
  (...args: Parameters<T>): void;
  cancel(): void;
}

/** Trailing-edge debounce with a cancel handle. */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: Parameters<T>): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped as Debounced<T>;
}
