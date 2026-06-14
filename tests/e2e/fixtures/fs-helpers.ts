import fs from "fs";
import path from "path";

/** Read a file inside the test workspace, return undefined if absent. */
export function readWorkspaceFile(workspace: string, rel: string): string | undefined {
  const abs = path.join(workspace, rel);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return undefined;
  }
}

/** List files matching a glob pattern relative to workspace root. */
export function listSpecFiles(workspace: string): string[] {
  const dir = path.join(workspace, "docs/specs");
  try {
    return fs.readdirSync(dir).filter((f) => /^\d{4}-[a-z0-9][a-z0-9-]*\.md$/.test(f));
  } catch {
    return [];
  }
}

/** Check a context artifact exists for a given slug. */
export function contextFileExists(workspace: string, slug: string, filename: string): boolean {
  return fs.existsSync(path.join(workspace, `docs/specs/.context/${slug}/${filename}`));
}

/** Read and parse a JSON context artifact. */
export function readContextJson<T = unknown>(
  workspace: string,
  slug: string,
  filename: string,
): T | undefined {
  const raw = readWorkspaceFile(workspace, `docs/specs/.context/${slug}/${filename}`);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
