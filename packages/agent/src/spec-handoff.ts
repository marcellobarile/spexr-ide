export const SPEC_HANDOFF_BUDGET_BYTES = 200_000;

export interface ContextFileEntry {
  /** Filename only (no path). */
  readonly name: string;
  /** Text content, or null when the file is binary. */
  readonly content: string | null;
  /** File size in bytes — used for budget accounting. */
  readonly sizeBytes: number;
  /** Last-modified epoch ms — newest files are included first. */
  readonly mtimeMs: number;
}

export interface ContextLink {
  readonly label: string;
  readonly url: string;
}

export interface SpecHandoffInput {
  /** Raw markdown body of the spec file. */
  readonly specBody: string;
  /** All non-`_links.md` files in the context dir (caller pre-loaded). */
  readonly contextFiles: readonly ContextFileEntry[];
  /** Links parsed from `_links.md`. */
  readonly links: readonly ContextLink[];
  /** Max total bytes for file contents (default SPEC_HANDOFF_BUDGET_BYTES). */
  readonly budgetBytes?: number;
}

/**
 * Assemble the agent handoff message for a spec.
 *
 * Order: spec body → included context files (newest-first) → links section.
 * Binary files and budget-dropped files appear in a summary block so the
 * agent knows they exist without inline content.
 */
export function buildSpecHandoff(input: SpecHandoffInput): string {
  const { specBody, contextFiles, links, budgetBytes = SPEC_HANDOFF_BUDGET_BYTES } = input;

  if (contextFiles.length === 0 && links.length === 0) {
    return specBody;
  }

  const parts: string[] = [specBody];

  if (contextFiles.length > 0) {
    const sorted = [...contextFiles].sort((a, b) => b.mtimeMs - a.mtimeMs);

    let remaining = budgetBytes;
    const included: ContextFileEntry[] = [];
    const omitted: ContextFileEntry[] = [];

    for (const f of sorted) {
      if (f.content === null) {
        included.push(f);
        continue;
      }
      if (f.sizeBytes <= remaining) {
        included.push(f);
        remaining -= f.sizeBytes;
      } else {
        omitted.push(f);
      }
    }

    parts.push("---\n\n## Context files\n");

    for (const f of included) {
      if (f.content === null) {
        parts.push(`### \`${f.name}\` _(binary — not inlined)_\n\n_[attached, not inlined]_`);
      } else {
        parts.push(`### \`${f.name}\`\n\n${f.content}`);
      }
    }

    if (omitted.length > 0) {
      const names = omitted.map((f) => `\`${f.name}\``).join(", ");
      parts.push(
        `> **Budget limit reached.** The following files were omitted (oldest first): ${names}.`,
      );
    }
  }

  if (links.length > 0) {
    const lines = links.map((l) => `- [${l.label}](${l.url})`).join("\n");
    parts.push(`---\n\n## Context links\n\n${lines}`);
  }

  return parts.join("\n\n");
}

const LINK_RE = /^-\s+\[([^\]]*)\]\(([^)]+)\)/;

/**
 * Parse `_links.md` entries into structured link objects.
 * Malformed lines are silently skipped.
 */
export function parseLinksFile(content: string): ContextLink[] {
  const links: ContextLink[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(LINK_RE);
    if (!m) continue;
    const label = m[1]!.trim();
    const url = m[2]!.trim();
    if (url.length === 0) continue;
    links.push({ label: label.length > 0 ? label : url, url });
  }
  return links;
}
