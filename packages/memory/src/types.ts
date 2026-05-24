/**
 * Memory model. Mirrors the Claude Code memory taxonomy so users moving between
 * tools share a mental model. Types are stable across scopes.
 */

export type MemoryType = "user" | "feedback" | "project" | "reference";

export type MemoryScope = "user" | "project" | "baseline";

export interface MemoryFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly type: MemoryType;
  readonly tags?: readonly string[];
  /** ISO8601. Optional; absent means undated. */
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface MemoryRecord {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly filename: string;
  readonly absolutePath: string;
  readonly frontmatter: MemoryFrontmatter;
  readonly body: string;
  /** Baseline records are seeded by spexr and treated as read-only by default. */
  readonly readOnly: boolean;
}

export interface MemoryWriteInput {
  readonly scope: Exclude<MemoryScope, "baseline">;
  readonly filename: string;
  readonly frontmatter: MemoryFrontmatter;
  readonly body: string;
}

export interface MemoryListFilter {
  readonly scope?: MemoryScope;
  readonly type?: MemoryType;
  readonly tag?: string;
}
