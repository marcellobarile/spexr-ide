import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  resolveGlobalExcludesPath,
  isSpexrIgnoredGlobally,
  ensureSpexrGloballyIgnored,
  type GitRunner,
} from "./global-gitignore.js";

let tmpDir: string;
let savedXdg: string | undefined;

beforeEach(async () => {
  tmpDir = await mkdir(join(tmpdir(), "spexr-gitignore-"), { recursive: true }).then(
    () => join(tmpdir(), "spexr-gitignore-" + Date.now()),
  );
  tmpDir = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(join(tmpdir(), "spexr-gitignore-")),
  );
  savedXdg = process.env.XDG_CONFIG_HOME;
});

afterEach(async () => {
  if (savedXdg !== undefined) {
    process.env.XDG_CONFIG_HOME = savedXdg;
  } else {
    delete process.env.XDG_CONFIG_HOME;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

/** Runner that always returns empty — simulates "no git config" */
const emptyRunner: GitRunner = async () => "";

describe("resolveGlobalExcludesPath", () => {
  it("expands ~ to homedir when git config returns a tilde path", async () => {
    const runner: GitRunner = async () => "~/.gitignore_global\n";
    const result = await resolveGlobalExcludesPath(runner);
    expect(result).toBe(join(homedir(), ".gitignore_global"));
  });

  it("returns absolute paths as-is from git config", async () => {
    const runner: GitRunner = async () => "/etc/gitignore_global\n";
    const result = await resolveGlobalExcludesPath(runner);
    expect(result).toBe("/etc/gitignore_global");
  });

  it("falls back to XDG_CONFIG_HOME/git/ignore when git config returns empty", async () => {
    process.env.XDG_CONFIG_HOME = tmpDir;
    const result = await resolveGlobalExcludesPath(emptyRunner);
    expect(result).toBe(join(tmpDir, "git", "ignore"));
  });

  it("falls back to ~/.config/git/ignore when XDG_CONFIG_HOME is unset and git config is empty", async () => {
    delete process.env.XDG_CONFIG_HOME;
    const result = await resolveGlobalExcludesPath(emptyRunner);
    expect(result).toBe(join(homedir(), ".config", "git", "ignore"));
  });
});

describe("ensureSpexrGloballyIgnored", () => {
  beforeEach(() => {
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  it("creates the ignore file with .spexr/ when the file does not exist", async () => {
    const result = await ensureSpexrGloballyIgnored(emptyRunner);
    expect(result.added).toBe(true);
    const content = await readFile(result.path, "utf8");
    expect(content.split("\n").map((l) => l.trim())).toContain(".spexr/");
  });

  it("is idempotent: second call returns added:false, no duplicate line", async () => {
    const first = await ensureSpexrGloballyIgnored(emptyRunner);
    expect(first.added).toBe(true);
    const second = await ensureSpexrGloballyIgnored(emptyRunner);
    expect(second.added).toBe(false);
    const content = await readFile(first.path, "utf8");
    const spexrLines = content.split("\n").filter((l) => l.trim() === ".spexr/");
    expect(spexrLines).toHaveLength(1);
  });

  it("adds a leading newline when the existing file has content but no trailing newline", async () => {
    const ignoreDir = join(tmpDir, "git");
    await mkdir(ignoreDir, { recursive: true });
    const ignorePath = join(ignoreDir, "ignore");
    await writeFile(ignorePath, "*.log", "utf8"); // no trailing newline
    await ensureSpexrGloballyIgnored(emptyRunner);
    const content = await readFile(ignorePath, "utf8");
    expect(content).toBe("*.log\n.spexr/\n");
  });

  it("does not add a leading newline when the existing file already ends with newline", async () => {
    const ignoreDir = join(tmpDir, "git");
    await mkdir(ignoreDir, { recursive: true });
    const ignorePath = join(ignoreDir, "ignore");
    await writeFile(ignorePath, "*.log\n", "utf8");
    await ensureSpexrGloballyIgnored(emptyRunner);
    const content = await readFile(ignorePath, "utf8");
    expect(content).toBe("*.log\n.spexr/\n");
  });
});

describe("isSpexrIgnoredGlobally", () => {
  beforeEach(() => {
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  it("returns false when the ignore file does not exist", async () => {
    expect(await isSpexrIgnoredGlobally(emptyRunner)).toBe(false);
  });

  it("returns true after ensureSpexrGloballyIgnored is called", async () => {
    await ensureSpexrGloballyIgnored(emptyRunner);
    expect(await isSpexrIgnoredGlobally(emptyRunner)).toBe(true);
  });

  it("recognises .spexr (without trailing slash) as matching", async () => {
    const ignoreDir = join(tmpDir, "git");
    await mkdir(ignoreDir, { recursive: true });
    await writeFile(join(ignoreDir, "ignore"), ".spexr\n", "utf8");
    expect(await isSpexrIgnoredGlobally(emptyRunner)).toBe(true);
  });

  it("returns false when the file exists but .spexr/ is not in it", async () => {
    const ignoreDir = join(tmpDir, "git");
    await mkdir(ignoreDir, { recursive: true });
    await writeFile(join(ignoreDir, "ignore"), "*.log\nnode_modules/\n", "utf8");
    expect(await isSpexrIgnoredGlobally(emptyRunner)).toBe(false);
  });
});
