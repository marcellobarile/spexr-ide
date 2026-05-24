import type URI from "@theia/core/lib/common/uri";

/** Top-level docs container inside a workspace root. */
export const DOCS_DIR = "docs";

/** Memory subdirectory name inside the docs container. */
export const MEMORY_DIR = "memory";

/** Specs subdirectory name inside the docs container. */
export const SPECS_DIR = "specs";

/** Experts subdirectory name inside the docs container. */
export const AGENTS_DIR = "agents";

/** Per-spec context directory name inside the specs directory. */
export const SPEC_CONTEXT_DIR = ".context";

/**
 * Resolves the `docs/` folder URI for the given workspace root.
 *
 * All project-scoped data (memory, specs) lives under this container rather
 * than directly at the workspace root, avoiding collisions with existing folders.
 */
export function docsRoot(root: URI): URI {
  return root.resolve(DOCS_DIR);
}

/**
 * Resolves the `docs/memory/` directory URI for the given workspace root.
 *
 * This is the project-scope memory directory managed by the Memory widget and
 * linked into the Claude native per-project memory location.
 */
export function memoryDir(root: URI): URI {
  return root.resolve(DOCS_DIR).resolve(MEMORY_DIR);
}

/**
 * Resolves the `docs/specs/` directory URI for the given workspace root.
 *
 * Spec files (`NNNN-<slug>.md`) are stored directly in this directory.
 */
export function specsDir(root: URI): URI {
  return root.resolve(DOCS_DIR).resolve(SPECS_DIR);
}

/**
 * Resolves the `docs/agents/` directory URI for the given workspace root.
 *
 * Installed expert personas live here as `<id>.md`, alongside `docs/memory`
 * and `docs/specs`.
 */
export function agentsDir(root: URI): URI {
  return root.resolve(DOCS_DIR).resolve(AGENTS_DIR);
}

/**
 * Resolves the `docs/specs/.context/<slug>/` directory URI for the given
 * workspace root and spec slug.
 *
 * Spec context files (reference material, links) live under this directory so
 * they remain co-located with their spec without polluting the specs listing.
 */
export function specContextDir(root: URI, slug: string): URI {
  return root.resolve(DOCS_DIR).resolve(SPECS_DIR).resolve(SPEC_CONTEXT_DIR).resolve(slug);
}
