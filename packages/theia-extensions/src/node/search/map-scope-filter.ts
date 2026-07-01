// Decides which indexed files are worth describing in the "Understand the
// codebase" job. Vendored library trees and test artifacts (fixtures, mocks,
// snapshots, generated files) add cost and noise without helping a reader or
// agent orient, so they are skipped. This is intentionally narrower than the
// index itself: a file can be searchable yet not worth a generated description.

/**
 * Path segments (matched whole, case-insensitive) that mark a vendored
 * dependency tree or test artifact. Segment match — not substring — so a real
 * source file like `vendored-utils.ts` is kept while `vendor/lib.ts` is skipped.
 */
const SKIP_SEGMENTS: ReadonlySet<string> = new Set([
  // Per-language dependency / vendor directories.
  "node_modules", "bower_components", "jspm_packages", ".yarn", ".pnp",
  "vendor", "third_party", "third-party", "external",
  "pods", "carthage",
  ".venv", "venv", "site-packages", "__pycache__", ".tox", ".eggs",
  "target", ".gradle", ".mvn",
  "_build", "deps", "elm-stuff", ".stack-work", ".cargo",
  // Test artifacts and generated fixtures (not the test sources themselves).
  "fixtures", "__fixtures__", "mocks", "__mocks__",
  "snapshots", "__snapshots__", "testdata", "test-data",
]);

/** Filename markers of generated, minified, or machine-emitted files. */
const SKIP_FILE_RE = /\.min\.|\.generated\.|\.gen\.|\.pb\.|_pb2|\.d\.ts$/i;

/**
 * True when a workspace-relative POSIX path is worth generating a description
 * for. Excludes vendored library trees, test fixtures/mocks/snapshots, and
 * generated/minified files.
 */
export function isWorthMapping(relPath: string): boolean {
  const segments = relPath.toLowerCase().split("/");
  for (const seg of segments) {
    if (SKIP_SEGMENTS.has(seg)) return false;
  }
  const file = segments[segments.length - 1] ?? "";
  return !SKIP_FILE_RE.test(file);
}
