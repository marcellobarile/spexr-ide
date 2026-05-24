import type { Spec } from "@spexr/spec";

/**
 * Builds the system prompt that bootstraps a Claude session inside SPEXR.
 *
 * Order matters:
 *   1. Identity + workspace context (cheap to set once).
 *   2. Active spec, if any (so the agent grounds in the contract first).
 *   3. House rules (tone, validation, code hygiene) — short, last so they
 *      receive the most attention.
 *
 * Memory is no longer injected here — it is live via the Claude native
 * per-project memory symlink set up by `linkProjectMemory`.
 *
 * Each section is delimited so the agent can refer to them and so we can
 * truncate sections selectively when nearing the model's context budget.
 */
export interface PromptInput {
  readonly workspaceRoot: string;
  readonly activeSpec?: Spec;
  readonly expertPrompt?: string;
}

export function buildSystemPrompt(input: PromptInput): string {
  const sections = [
    identitySection(input.workspaceRoot),
    input.activeSpec ? specSection(input.activeSpec) : "",
    houseRulesSection(),
    input.expertPrompt ? expertSection(input.expertPrompt) : "",
  ].filter((s) => s.length > 0);
  return sections.join("\n\n---\n\n");
}

function identitySection(workspaceRoot: string): string {
  return [
    "# SPEXR Agent",
    "",
    "You are the primary collaborator in SPEXR — an agent-centric, spec-based editor.",
    `Workspace root: \`${workspaceRoot}\``,
    "",
    "Treat specs as the contract. When code and spec disagree, surface it before changing either.",
  ].join("\n");
}

function specSection(spec: Spec): string {
  const acLines = spec.acceptanceCriteria.map((c) => `- ${c.id}: ${c.text}`);
  return [
    `# Active Spec — ${spec.frontmatter.title} (${spec.frontmatter.slug})`,
    `Status: ${spec.frontmatter.status}`,
    "",
    "## Goal",
    spec.goal || "_(empty)_",
    "",
    "## Non-goals",
    spec.nonGoals.length === 0 ? "_(none)_" : spec.nonGoals.map((g) => `- ${g}`).join("\n"),
    "",
    "## Acceptance Criteria",
    acLines.length === 0 ? "_(none)_" : acLines.join("\n"),
  ].join("\n");
}

function houseRulesSection(): string {
  return [
    "# House Rules",
    "",
    "- Match repo conventions. Read neighbors before adding patterns.",
    "- Validate after edits: lint, typecheck, focused tests for touched code.",
    "- Don't add scope or abstractions beyond the task.",
    "- For multi-file changes, propose first; wait for OK before editing.",
    "- Bug fixes get a regression test.",
  ].join("\n");
}

/**
 * Appends an expert persona block after the house rules.
 *
 * The content comes verbatim from the `ExpertAgent.systemPrompt` field so the
 * agent knows which role it is playing for this session.
 */
function expertSection(persona: string): string {
  return ["# Expert Persona", "", persona].join("\n");
}
