import ignore from "ignore";

/** Directories never walked during indexing. */
export const ALWAYS_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".spexr",
  "dist",
  "lib",
  "build",
  "out",
  ".turbo",
]);

export const DEFAULT_MAX_BYTES = 1_000_000;

const SKIPPED_EXTENSIONS: ReadonlySet<string> = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg",
  "woff", "woff2", "ttf", "otf", "eot",
  "pdf", "zip", "gz", "tar", "rar", "7z",
  "mp3", "mp4", "mov", "avi", "wav", "ogg", "webm",
  "exe", "dll", "dylib", "so", "node", "wasm", "onnx", "bin",
  "class", "jar", "lock", "map",
]);

/** True when the file's extension is a known non-text/binary type. */
export function isSkippedExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return false;
  return SKIPPED_EXTENSIONS.has(filePath.slice(dot + 1).toLowerCase());
}

/** True when the first 8000 bytes contain a NUL byte (heuristic for binary). */
export function isBinaryBuffer(buf: Buffer): boolean {
  const end = Math.min(buf.length, 8000);
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Build a predicate that reports whether a workspace-relative path is excluded
 * by the given `.gitignore` contents. Empty input ignores nothing.
 */
export function createIgnoreFilter(gitignoreText: string): (relPath: string) => boolean {
  const matcher = ignore().add(gitignoreText);
  return (relPath: string) => relPath.length > 0 && matcher.ignores(relPath);
}
