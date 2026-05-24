/**
 * RPC contract for the spexr agent service.
 *
 * Kept node-free (plain DTOs only) so the browser bundle can import this
 * without pulling in any node-only modules.
 */

export const AGENT_SESSION_SERVICE_PATH = "/services/spexr-agent";

/**
 * Result of a project-memory symlink operation.
 *
 * Carries the resolved source and target paths so callers can surface
 * actionable messages without re-computing paths in the frontend.
 */
export type MemoryLinkStatus =
  | "linked"
  | "already-linked"
  | "unlinked"
  | "not-linked"
  | "blocked"
  | "error"
  | "unknown";

export interface MemoryLinkResult {
  readonly status: Exclude<MemoryLinkStatus, "unknown">;
  readonly source: string;
  readonly target: string;
  readonly message?: string;
}

/**
 * Dependency-light DTO for a detected Claude account profile.
 *
 * Mirrors `ClaudeProfile` from `claude-profile-detector.ts` without any
 * node-only imports so the browser bundle can use it safely.
 */
export interface ClaudeProfileDto {
  readonly id: string;
  readonly label: string;
  readonly executablePath: string;
  readonly configDir?: string;
}

/**
 * Dependency-light DTO for an expert persona.
 *
 * Mirrors `ExpertAgent` from `@spexr/agent` without importing node-capable code,
 * so the browser bundle can use it. Carried over RPC for the marketplace list.
 */
export interface ExpertAgentDto {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly model?: string;
  readonly kickoffPrompt?: string;
}

/**
 * Return value of `buildLaunchContext`.
 *
 * Contains the path to a temporary file holding the generated system prompt
 * ready to pass as `--append-system-prompt-file`, or an inline fallback string.
 */
export interface LaunchContextDto {
  /** Absolute path to the temp file containing the system prompt. */
  readonly appendSystemPromptFile?: string;
  /** Inline fallback when the file approach is unavailable. */
  readonly appendSystemPromptInline?: string;
}

/**
 * Backend service exposed over JSON-RPC.
 *
 * Only pure-node operations remain after the SDK proxy removal:
 * profile detection, launch-context building, and project-memory symlink
 * management for the embedded terminal.
 */
export interface SpexrAgentService {
  /**
   * Detect Claude account profiles available to the current user by scanning
   * shell configuration files for claude-launching aliases with `CLAUDE_CONFIG_DIR`.
   *
   * Always resolves (never rejects); always includes at least the `default` profile.
   */
  detectClaudeProfiles(): Promise<ClaudeProfileDto[]>;

  /**
   * Return the built-in expert marketplace catalog.
   *
   * Always resolves; the list is static and shipped in `@spexr/agent`.
   */
  listMarketplaceExperts(): Promise<ExpertAgentDto[]>;

  /**
   * Build the launch context (system prompt) for the given workspace root.
   *
   * When `expertId` is provided, the persona from `docs/agents/<expertId>.md`
   * is appended to the base prompt. With no `expertId` the prompt is the base
   * (spec 0003 behaviour).
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   * @param expertId       Optional active expert id.
   */
  buildLaunchContext(workspaceRoot: string, expertId?: string): Promise<LaunchContextDto>;

  /**
   * Create a symlink from the Claude native per-project memory directory to the
   * workspace `memory/` folder so the embedded Claude session reads live memory.
   *
   * Never throws across RPC — all error conditions are captured in the result.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   * @param configDir      Optional CLAUDE_CONFIG_DIR override (profile-specific).
   */
  linkProjectMemory(workspaceRoot: string, configDir?: string): Promise<MemoryLinkResult>;

  /**
   * Remove the symlink created by `linkProjectMemory`.
   *
   * Real directories (non-symlink) are never deleted. Never throws across RPC.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   * @param configDir      Optional CLAUDE_CONFIG_DIR override (profile-specific).
   */
  unlinkProjectMemory(workspaceRoot: string, configDir?: string): Promise<MemoryLinkResult>;

  /**
   * Return the current symlink status without modifying anything.
   *
   * Useful for driving button enabled/disabled state in the UI.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   * @param configDir      Optional CLAUDE_CONFIG_DIR override (profile-specific).
   */
  getMemoryLinkStatus(workspaceRoot: string, configDir?: string): Promise<MemoryLinkResult>;

  /**
   * Resolve a conflict at the Claude native per-project memory target.
   *
   * Backs up whatever occupies the target location (real directory, file, or
   * foreign symlink) to a timestamped path, then creates a fresh symlink
   * pointing to the workspace `memory/` folder. Nothing is ever deleted.
   * Never throws across RPC; all error conditions are captured in the result.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   * @param configDir      Optional CLAUDE_CONFIG_DIR override (profile-specific).
   */
  resolveMemoryConflict(workspaceRoot: string, configDir?: string): Promise<MemoryLinkResult>;
}
