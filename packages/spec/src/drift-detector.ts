import type { DriftFinding, DriftReport, Spec } from "./types.js";

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
