export const SPEC_TRAILER_PREFIX = "Spec: ";

/** Build the git commit message, ending with the required trailer. */
export function buildShipCommitMessage(specTitle: string, slug: string): string {
  return `${specTitle}\n\n${SPEC_TRAILER_PREFIX}${slug}`;
}

/** Build the PR body listing acceptance criteria and the spec trailer. */
export function buildShipPrBody(slug: string, acItems: readonly string[]): string {
  const acBlock =
    acItems.length > 0
      ? `\n\n## Acceptance Criteria\n\n${acItems.map((a) => `- ${a}`).join("\n")}`
      : "";
  return `Implements spec \`${slug}\`.${acBlock}\n\n${SPEC_TRAILER_PREFIX}${slug}`;
}
