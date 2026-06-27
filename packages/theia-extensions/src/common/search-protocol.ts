export const SEARCH_SERVICE_PATH = "/services/spexr-search";

/** One ranked search result. */
export interface SearchHit {
  /** Workspace-relative POSIX path of the matched file. */
  path: string;
  /** Cosine similarity in [0, 1]; higher is more relevant. */
  score: number;
  /** Short text excerpt for display. */
  snippet: string;
}

export type IndexState = "idle" | "indexing" | "ready" | "error";

export interface IndexStatus {
  state: IndexState;
  indexed: number;
  total: number;
  message?: string;
}

/**
 * Backend search service. Methods are root-first: the workspace root identifies
 * the (stateful) per-workspace index, mirroring {@link SpexrGitService}.
 */
export interface SpexrSearchService {
  /** Build the index in the background if it does not exist yet; returns at once. */
  ensureIndexed(root: string): Promise<void>;
  search(root: string, query: string): Promise<SearchHit[]>;
  getIndexStatus(root: string): Promise<IndexStatus>;
  /** Apply incremental file changes (workspace-relative POSIX paths). */
  applyChanges(root: string, changedPaths: string[], removedPaths: string[]): Promise<void>;
  /** Force a full rebuild. */
  reindex(root: string): Promise<void>;
}
