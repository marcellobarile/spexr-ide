import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Path resolver. Centralizes filesystem layout so renaming a directory is a
 * single-file change. Components must NOT join paths inline.
 */
export interface SpexrPaths {
  readonly userHome: string;
  readonly userScope: string;
  readonly projectRoot: string;
  readonly projectScope: string;
  readonly userMemoryDir: string;
  readonly projectMemoryDir: string;
  readonly specDir: string;
  readonly userIndexFile: string;
  readonly projectIndexFile: string;
}

export interface SpexrPathsInput {
  readonly projectRoot: string;
  readonly userScopePath?: string;
  readonly projectScopeDir?: string;
  readonly memorySubdir?: string;
  readonly specSubdir?: string;
  readonly indexFile?: string;
}

export function resolveSpexrPaths(input: SpexrPathsInput): SpexrPaths {
  const userHome = homedir();
  const userScope = expandHome(input.userScopePath ?? "~/.spexr", userHome);
  const projectScope = resolve(input.projectRoot, input.projectScopeDir ?? ".");
  const memorySubdir = input.memorySubdir ?? "memory";
  const specSubdir = input.specSubdir ?? "specs";
  const indexFile = input.indexFile ?? "MEMORY.md";

  return {
    userHome,
    userScope,
    projectRoot: input.projectRoot,
    projectScope,
    userMemoryDir: join(userScope, memorySubdir),
    projectMemoryDir: join(projectScope, memorySubdir),
    specDir: join(projectScope, specSubdir),
    userIndexFile: join(userScope, memorySubdir, indexFile),
    projectIndexFile: join(projectScope, memorySubdir, indexFile),
  };
}

function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}
