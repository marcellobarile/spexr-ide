// Pure gitignore-match helper, free of Theia imports so it can be unit-tested
// without the browser DI runtime. Fed by `SpexrGitService.getIgnoredPaths`.

/**
 * Build a predicate that reports whether a workspace-relative POSIX path is ignored
 * by git. Input paths come from `git ls-files … --directory`: fully-ignored
 * directories end in `/` (and cover everything beneath them), files are exact.
 */
export function buildIgnoreMatcher(paths: readonly string[]): (rel: string) => boolean {
  const exactFiles = new Set<string>();
  const dirs: string[] = [];
  for (const p of paths) {
    if (p.endsWith("/")) dirs.push(p);
    else exactFiles.add(p);
  }
  return (rel: string): boolean => {
    if (rel.length === 0) return false;
    if (exactFiles.has(rel)) return true;
    const withSlash = rel.endsWith("/") ? rel : `${rel}/`;
    // The path is (or is inside) an ignored directory.
    return dirs.some((dir) => withSlash === dir || rel.startsWith(dir));
  };
}
