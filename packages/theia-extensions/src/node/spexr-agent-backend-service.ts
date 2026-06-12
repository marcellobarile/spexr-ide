import { injectable } from "@theia/core/shared/inversify";
import * as child_process from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildSystemPrompt, EXPERT_CATALOG } from "@spexr/agent";
import { resolveSpexrPaths } from "@spexr/core";
// Subpath import: FilesystemSpecRegistry pulls in node:fs, so it is kept out
// of the @spexr/spec barrel to avoid leaking node-only code into the frontend
// bundle. The package exposes it via the `./registry` export; tsc resolves the
// types through the `paths` mapping in this package's tsconfig.
import { FilesystemSpecRegistry } from "@spexr/spec/registry";
import { buildShipCommitMessage, buildShipPrBody } from "@spexr/spec";
import type {
  SpexrAgentService,
  ClaudeProfileDto,
  ExpertAgentDto,
  LaunchContextDto,
  MemoryLinkResult,
  ShipOutcome,
} from "../common/agent-protocol.js";
import {
  detectClaudeProfiles,
  isFileExecutable,
  resolveClaudeExecutable,
} from "./claude-profile-detector.js";

/**
 * Backend singleton that provides profile detection and launch-context building
 * for the embedded Claude terminal widget.
 *
 * The SDK session lifecycle has been removed; the terminal widget (frontend)
 * owns the CLI process directly via node-pty. This service stays in the backend
 * only for node-only operations (filesystem scanning, temp-file writing).
 */
@injectable()
export class SpexrAgentBackendService implements SpexrAgentService {
  async detectClaudeProfiles(): Promise<ClaudeProfileDto[]> {
    return detectClaudeProfiles();
  }

  async listMarketplaceExperts(): Promise<ExpertAgentDto[]> {
    return EXPERT_CATALOG.map((e) => ({ ...e }));
  }

  async buildLaunchContext(workspaceRoot: string, expertId?: string): Promise<LaunchContextDto> {
    try {
      const paths = resolveSpexrPaths({ projectRoot: workspaceRoot, projectScopeDir: "docs" });
      const specRegistry = new FilesystemSpecRegistry({ directory: paths.specDir });
      const all = await specRegistry.list();
      const activeSpec = all.find((s) => s.frontmatter.status === "in-progress");

      const expertPrompt = expertId ? readInstalledExpertPrompt(workspaceRoot, expertId) : undefined;

      const prompt = buildSystemPrompt({
        workspaceRoot,
        ...(activeSpec ? { activeSpec } : {}),
        ...(expertPrompt ? { expertPrompt } : {}),
      });

      const tmpFile = path.join(os.tmpdir(), `spexr-system-prompt-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, prompt, "utf8");

      return { appendSystemPromptFile: tmpFile };
    } catch {
      return {};
    }
  }

  /**
   * Symlink the workspace `memory/` folder into Claude's native per-project
   * memory location so the embedded session reads live memory files.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   * @param configDir      Optional CLAUDE_CONFIG_DIR override.
   */
  linkProjectMemory(workspaceRoot: string, configDir?: string): Promise<MemoryLinkResult> {
    return Promise.resolve(linkProjectMemorySync(workspaceRoot, configDir));
  }

  /**
   * Remove the symlink created by `linkProjectMemory`.
   *
   * Real directories are never deleted — only symlinks are removed.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   * @param configDir      Optional CLAUDE_CONFIG_DIR override.
   */
  unlinkProjectMemory(workspaceRoot: string, configDir?: string): Promise<MemoryLinkResult> {
    return Promise.resolve(unlinkProjectMemorySync(workspaceRoot, configDir));
  }

  /**
   * Return the current state of the Claude native per-project memory symlink
   * without modifying anything.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   * @param configDir      Optional CLAUDE_CONFIG_DIR override.
   */
  getMemoryLinkStatus(workspaceRoot: string, configDir?: string): Promise<MemoryLinkResult> {
    return Promise.resolve(getMemoryLinkStatusSync(workspaceRoot, configDir));
  }

  /**
   * Resolve a conflict at the Claude native per-project memory target by backing
   * up whatever is there (real directory, file, or foreign symlink) and creating
   * a fresh symlink to the workspace `memory/` folder.
   *
   * Nothing is ever deleted — existing content is renamed to a timestamped path.
   * Never throws across RPC; all error conditions are captured in the result.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   * @param configDir      Optional CLAUDE_CONFIG_DIR override.
   */
  resolveMemoryConflict(workspaceRoot: string, configDir?: string): Promise<MemoryLinkResult> {
    return Promise.resolve(resolveMemoryConflictSync(workspaceRoot, configDir));
  }

  shipSpec(
    workspaceRoot: string,
    slug: string,
    specTitle: string,
    acItems: readonly string[],
  ): Promise<ShipOutcome> {
    return Promise.resolve(shipSpecImpl(workspaceRoot, slug, specTitle, acItems));
  }
}

// ---------------------------------------------------------------------------
// Memory symlink helpers (module-level so they can be unit-tested directly)
// ---------------------------------------------------------------------------

function resolveMemoryPaths(
  workspaceRoot: string,
  configDir?: string,
): { source: string; target: string } {
  const slug = workspaceRoot.replace(/[^a-zA-Z0-9]/g, "-");
  const configRoot =
    configDir && configDir.trim() ? configDir.trim() : path.join(os.homedir(), ".claude");
  const source = path.join(workspaceRoot, "docs", "memory");
  const target = path.join(configRoot, "projects", slug, "memory");
  return { source, target };
}

function ensureSourceMemory(source: string): void {
  fs.mkdirSync(source, { recursive: true });
  const index = path.join(source, "MEMORY.md");
  if (!fs.existsSync(index)) {
    fs.writeFileSync(index, "# MEMORY index\n\nOne line per memory. Linked file holds the body.\n", "utf8");
  }
}

/** Strip a leading `---\n...\n---` frontmatter block, returning the body. */
export function stripFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n?/);
  return match ? markdown.slice(match[0].length) : markdown;
}

/**
 * Read the persona body from `docs/agents/<expertId>.md`.
 *
 * Returns `undefined` when the file is missing or empty so the caller falls
 * back to the base prompt.
 */
function readInstalledExpertPrompt(workspaceRoot: string, expertId: string): string | undefined {
  try {
    const file = path.join(workspaceRoot, "docs", "agents", `${expertId}.md`);
    const body = stripFrontmatter(fs.readFileSync(file, "utf8")).trim();
    return body.length > 0 ? body : undefined;
  } catch {
    return undefined;
  }
}

/** Create or repair the symlink `target → source`. */
function linkProjectMemorySync(workspaceRoot: string, configDir?: string): MemoryLinkResult {
  const { source, target } = resolveMemoryPaths(workspaceRoot, configDir);
  try {
    ensureSourceMemory(source);

    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(target);
    } catch {
      // ENOENT — target does not exist, create symlink below
    }

    if (stat) {
      if (stat.isSymbolicLink()) {
        const current = fs.readlinkSync(target);
        if (current === source) {
          return { status: "already-linked", source, target };
        }
        fs.unlinkSync(target);
        fs.symlinkSync(source, target);
        return { status: "linked", source, target, message: "Replaced previous symlink." };
      }

      if (stat.isDirectory()) {
        const entries = fs.readdirSync(target);
        if (entries.length > 0) {
          return {
            status: "blocked",
            source,
            target,
            message: `A real memory directory with content already exists at ${target}; not overwritten.`,
          };
        }
        fs.rmdirSync(target);
        fs.symlinkSync(source, target);
        return { status: "linked", source, target };
      }

      return {
        status: "blocked",
        source,
        target,
        message: `Unexpected filesystem entry at ${target}; not overwritten.`,
      };
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(source, target);
    return { status: "linked", source, target };
  } catch (err) {
    return {
      status: "error",
      source,
      target,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Remove the symlink at target; never deletes real directories. */
function unlinkProjectMemorySync(workspaceRoot: string, configDir?: string): MemoryLinkResult {
  const { source, target } = resolveMemoryPaths(workspaceRoot, configDir);
  try {
    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(target);
    } catch {
      // ENOENT
    }

    if (!stat) {
      return { status: "not-linked", source, target };
    }

    if (stat.isSymbolicLink()) {
      fs.unlinkSync(target);
      return { status: "unlinked", source, target };
    }

    return {
      status: "blocked",
      source,
      target,
      message: `${target} is a real directory, not a symlink — not removed.`,
    };
  } catch (err) {
    return {
      status: "error",
      source,
      target,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Resolve a symlink conflict at `target` non-destructively.
 *
 * A symlink pointing elsewhere is replaced (removing a link loses no data).
 * A real directory or file is renamed to a timestamped backup, then a fresh
 * symlink is created. If the target is already our symlink, returns early.
 */
function resolveMemoryConflictSync(workspaceRoot: string, configDir?: string): MemoryLinkResult {
  const { source, target } = resolveMemoryPaths(workspaceRoot, configDir);
  try {
    ensureSourceMemory(source);

    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(target);
    } catch {
      // ENOENT — nothing at target, just create the symlink
    }

    if (stat) {
      if (stat.isSymbolicLink()) {
        const current = fs.readlinkSync(target);
        if (current === source) {
          return { status: "already-linked", source, target };
        }
        fs.unlinkSync(target);
        fs.symlinkSync(source, target);
        return { status: "linked", source, target, message: "Replaced a link that pointed elsewhere." };
      }

      const backup = `${target}.spexr-backup-${Date.now()}`;
      fs.renameSync(target, backup);
      fs.symlinkSync(source, target);
      return {
        status: "linked",
        source,
        target,
        message: `Existing memory backed up to ${backup}.`,
      };
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(source, target);
    return { status: "linked", source, target };
  } catch (err) {
    return {
      status: "error",
      source,
      target,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Return the current link state without modifying anything. */
function getMemoryLinkStatusSync(workspaceRoot: string, configDir?: string): MemoryLinkResult {
  const { source, target } = resolveMemoryPaths(workspaceRoot, configDir);
  try {
    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(target);
    } catch {
      // ENOENT
    }

    if (!stat) {
      return { status: "not-linked", source, target };
    }

    if (stat.isSymbolicLink()) {
      const current = fs.readlinkSync(target);
      if (current === source) {
        return { status: "already-linked", source, target };
      }
      return {
        status: "blocked",
        source,
        target,
        message: `Symlink at ${target} points to ${current}, not to ${source}.`,
      };
    }

    return {
      status: "blocked",
      source,
      target,
      message: `${target} is a real directory, not a symlink.`,
    };
  } catch (err) {
    return {
      status: "error",
      source,
      target,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Ship-spec helper
// ---------------------------------------------------------------------------

function shipSpecImpl(
  workspaceRoot: string,
  slug: string,
  specTitle: string,
  acItems: readonly string[],
): ShipOutcome {
  function run(cmd: string, args: string[]): { stdout: string; stderr: string; ok: boolean } {
    const r = child_process.spawnSync(cmd, args, { cwd: workspaceRoot, encoding: "utf8" });
    return {
      stdout: ((r.stdout as string) ?? "").trim(),
      stderr: ((r.stderr as string) ?? "").trim(),
      ok: r.status === 0,
    };
  }

  if (!run("gh", ["--version"]).ok) {
    return {
      ok: false,
      code: "gh-not-found",
      message: "GitHub CLI (`gh`) not found. Install it from https://cli.github.com.",
    };
  }

  if (!run("gh", ["auth", "status"]).ok) {
    return {
      ok: false,
      code: "gh-auth",
      message: "Not authenticated with GitHub. Run `gh auth login` and try again.",
    };
  }

  const remoteCheck = run("git", ["remote"]);
  if (!remoteCheck.ok || remoteCheck.stdout.length === 0) {
    return {
      ok: false,
      code: "no-remote",
      message:
        "No git remote configured. Add a remote (e.g. `git remote add origin <url>`) and try again.",
    };
  }

  const currentBranch = run("git", ["branch", "--show-current"]).stdout;

  let defaultBranch = "main";
  const headRef = run("git", ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (headRef.ok && headRef.stdout) {
    defaultBranch = headRef.stdout.replace("refs/remotes/origin/", "");
  }

  const specBranch = `spec/${slug}`;
  let targetBranch = currentBranch;

  if (currentBranch === defaultBranch || currentBranch === "") {
    const branchExists = run("git", ["rev-parse", "--verify", specBranch]);
    if (branchExists.ok) {
      run("git", ["checkout", specBranch]);
    } else {
      run("git", ["checkout", "-b", specBranch]);
    }
    targetBranch = specBranch;
  }

  const stagedCheck = run("git", ["diff", "--staged", "--quiet"]);
  const hasStaged = !stagedCheck.ok;

  const unpushedResult = run("git", ["rev-list", `origin/${defaultBranch}..HEAD`, "--count"]);
  const unpushed = unpushedResult.ok ? parseInt(unpushedResult.stdout, 10) || 0 : 0;

  if (!hasStaged && unpushed === 0) {
    return {
      ok: false,
      code: "nothing-to-ship",
      message: "Nothing to ship: no staged changes and no unpushed commits.",
    };
  }

  if (hasStaged) {
    const msg = buildShipCommitMessage(specTitle, slug);
    const commitResult = run("git", ["commit", "-m", msg]);
    if (!commitResult.ok) {
      return {
        ok: false,
        code: "nothing-to-ship",
        message: `Commit failed: ${commitResult.stderr}`,
      };
    }
  }

  run("git", ["push", "-u", "origin", targetBranch]);

  const prTitle = specTitle;
  const prBody = buildShipPrBody(slug, acItems);
  const prResult = run("gh", ["pr", "create", "--title", prTitle, "--body", prBody]);

  let prUrl = prResult.stdout;
  if (!prResult.ok || !prUrl.startsWith("http")) {
    const existing = run("gh", ["pr", "view", "--json", "url", "--jq", ".url"]);
    if (existing.ok && existing.stdout.startsWith("http")) {
      prUrl = existing.stdout;
    } else {
      return {
        ok: false,
        code: "gh-auth",
        message: `PR creation failed: ${prResult.stderr || prResult.stdout}`,
      };
    }
  }

  return { ok: true, prUrl, branch: targetBranch };
}

/**
 * Spawns `<execPath> --version` and logs a warning if the output does not
 * contain "Claude Code". This is best-effort; failures do not block startup.
 */
export function warnIfVersionCheckFails(execPath: string): void {
  try {
    const result = child_process.spawnSync(execPath, ["--version"], { encoding: "utf8", timeout: 5000 });
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    const looksLikeClaude = output.toLowerCase().includes("claude");
    if (!looksLikeClaude) {
      console.warn(
        `[spexr] Warning: '${execPath} --version' output did not mention "Claude". ` +
        "Proceeding anyway, but verify the executable is the Claude Code CLI.",
      );
    }
  } catch {
    console.warn(`[spexr] Warning: could not run '${execPath} --version' to verify the Claude Code CLI.`);
  }
}

/**
 * Validate the executable path and resolve it from PATH if not overridden.
 *
 * Returns the resolved path, or throws with a human-readable message when the
 * binary is missing, ambiguous, or explicitly set to a non-executable path.
 *
 * @param executableOverride  Optional override from `spexr.claude.executablePath`.
 */
export function resolveAndValidateExecutable(executableOverride?: string): string {
  if (executableOverride) {
    if (!isFileExecutable(executableOverride)) {
      throw new Error(
        `Claude Code executable override is not executable: "${executableOverride}". ` +
        "Check the `spexr.claude.executablePath` preference.",
      );
    }
    return executableOverride;
  }

  const execPath = resolveClaudeExecutable();

  if (execPath === undefined) {
    throw new Error(
      "Claude Code CLI not found on PATH. Install it and/or set the `spexr.claude.executablePath` preference.",
    );
  }

  if (execPath === "ambiguous") {
    throw new Error(
      "Multiple Claude Code CLI candidates found on PATH. Set the `spexr.claude.executablePath` preference to disambiguate.",
    );
  }

  return execPath;
}
