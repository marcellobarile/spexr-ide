import type { DriftFinding, DriftReport, Spec } from "./types.js";

// ---------------------------------------------------------------------------
// Pure file-path extraction from spec body
// ---------------------------------------------------------------------------

const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const INLINE_PATH_RE = /`([^`]+\.(ts|tsx|js|jsx|json|css|md|py|go|rs|java|cpp|c|html|xml|yaml|yml)(?::[0-9]+)?)`/g;

/**
 * Extract relative file paths referenced inside a spec's markdown body.
 * HTTP links and anchor-only refs are ignored.
 */
export function extractLinkedPaths(specBody: string): string[] {
  const paths = new Set<string>();

  for (const m of specBody.matchAll(MARKDOWN_LINK_RE)) {
    const target = m[2]!.trim();
    if (target.startsWith("http") || target.startsWith("#") || target.startsWith("mailto")) continue;
    paths.add(target.split(":")[0]!);
  }

  for (const m of specBody.matchAll(INLINE_PATH_RE)) {
    const raw = m[1]!.split(":")[0]!;
    if (raw.includes("/")) paths.add(raw);
  }

  return [...paths];
}

// ---------------------------------------------------------------------------
// Agent-verdict parser
// ---------------------------------------------------------------------------

const SEVERITY_MAP: Record<string, DriftFinding["severity"]> = {
  ok: "info",
  info: "info",
  warn: "warn",
  warning: "warn",
  block: "block",
  error: "block",
};

/**
 * Parse a JSON array of drift verdicts from Claude's `--print` text response.
 * Strips optional markdown code fences. Malformed or missing entries degrade
 * to a `warn` finding instead of throwing.
 */
export function parseDriftVerdicts(text: string): DriftFinding[] {
  let jsonText = text.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonText = fenceMatch[1]!.trim();

  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    const findings: DriftFinding[] = [];
    for (const v of parsed) {
      if (!v || typeof v !== "object") continue;
      const obj = v as Record<string, unknown>;
      const criterionId = typeof obj["criterionId"] === "string" ? obj["criterionId"] : undefined;
      const rawSev = typeof obj["severity"] === "string" ? (obj["severity"] as string).toLowerCase() : "warn";
      const severity: DriftFinding["severity"] = SEVERITY_MAP[rawSev] ?? "warn";
      const message = typeof obj["message"] === "string" ? obj["message"] : String(obj["message"] ?? "No detail.");
      const suggestion = typeof obj["suggestion"] === "string" ? obj["suggestion"] : undefined;
      if (!criterionId) continue;
      findings.push({ criterionId, severity, message, ...(suggestion ? { suggestion } : {}) });
    }
    return findings;
  } catch {
    return [];
  }
}

/**
 * Drift detector — initial heuristic pass.
 *
 * The full implementation will:
 *   1. Resolve files referenced by the spec (via `Spec: <slug>` commit trailers + spec links).
 *   2. Diff against last validated state of each acceptance criterion.
 *   3. Ask the agent to evaluate criteria against the current code.
 *
 * This stub returns structural findings only (missing sections, criteria
 * without IDs) so the wider pipeline can be wired before the heuristic lands.
 */

export interface DriftDetector {
  evaluate(spec: Spec): Promise<DriftReport>;
}

export class StructuralDriftDetector implements DriftDetector {
  async evaluate(spec: Spec): Promise<DriftReport> {
    const findings: DriftFinding[] = [];
    if (spec.goal.length === 0) {
      findings.push({
        criterionId: "structure",
        severity: "warn",
        message: "Spec has no goal section.",
        suggestion: "Add a `## Goal` section describing the user-visible outcome.",
      });
    }
    if (spec.acceptanceCriteria.length === 0) {
      findings.push({
        criterionId: "structure",
        severity: "block",
        message: "Spec has no acceptance criteria.",
        suggestion: "Add `## Acceptance Criteria` with bullet items, optionally tagged AC-N.",
      });
    }
    return {
      specSlug: spec.frontmatter.slug,
      checkedAt: new Date().toISOString(),
      findings,
    };
  }
}
