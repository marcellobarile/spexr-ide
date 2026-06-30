// Ensures `.spexr/` is ignored at the user (global git) level, so SPEXR's generated
// maps aren't tracked in any repository the user opens — without editing each repo's
// `.gitignore`. Git reads `core.excludesFile` if set, else `${XDG_CONFIG_HOME:-~/.config}/git/ignore`.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";

/** Runs `git <args>`, resolving stdout (empty string on any error). Test seam. */
export type GitRunner = (args: string[]) => Promise<string>;

const defaultRunner: GitRunner = (args) =>
  new Promise((resolve) => {
    execFile("git", args, { timeout: 5000 }, (err, stdout) => resolve(err ? "" : stdout));
  });

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Path git uses for global ignores: `core.excludesFile` if set, else the XDG default. */
export async function resolveGlobalExcludesPath(run: GitRunner = defaultRunner): Promise<string> {
  const configured = (await run(["config", "--global", "--get", "core.excludesFile"])).trim();
  if (configured.length > 0) return expandTilde(configured);
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "git", "ignore");
}

/** True if the global ignore file lists `.spexr/` (or `.spexr`). */
export async function isSpexrIgnoredGlobally(run: GitRunner = defaultRunner): Promise<boolean> {
  const path = await resolveGlobalExcludesPath(run);
  try {
    const content = await readFile(path, "utf8");
    return content.split("\n").some((l) => {
      const t = l.trim();
      return t === ".spexr/" || t === ".spexr";
    });
  } catch {
    return false;
  }
}

/** Idempotently append `.spexr/` to the global ignore file, creating it if needed. */
export async function ensureSpexrGloballyIgnored(
  run: GitRunner = defaultRunner,
): Promise<{ added: boolean; path: string }> {
  const path = await resolveGlobalExcludesPath(run);
  if (await isSpexrIgnoredGlobally(run)) return { added: false, path };
  await mkdir(dirname(path), { recursive: true });
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch {
    /* no file yet */
  }
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(path, existing + prefix + ".spexr/\n", "utf8");
  return { added: true, path };
}
