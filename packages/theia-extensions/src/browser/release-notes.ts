export interface ReleaseNote {
  readonly version: string;
  readonly date: string;
  readonly tagline: string;
  readonly changes: readonly string[];
}

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: "0.1.0",
    date: "2026-06-14",
    tagline: "The one where we finally commit.",
    changes: [
      "[Spec-driven development](https://en.wikipedia.org/wiki/Behavior-driven_development) in 7 steps — Specify, Context, Clarify, Plan, Implement, Validate, Ship. Step 3 exists to prevent Step 6.",
      "[Claude Code](https://docs.anthropic.com/en/docs/claude-code) auto-starts on workspace open. The agent has already read your codebase and formed opinions.",
      "Expert personas: [DRI](https://en.wikipedia.org/wiki/Directly_responsible_individual), Design, Review, Marketing, Software Engineering. Each one tells you what you didn't want to hear.",
      "Live [acceptance criteria](https://en.wikipedia.org/wiki/Acceptance_testing) linting catches duplicate IDs and placeholder text before the agent can gaslight you about the spec.",
      "[Markdown preview](https://spec.commonmark.org/) for specs, with [XSS](https://owasp.org/www-community/attacks/xss/) sanitization. You're welcome.",
      "Two-scope [memory](https://en.wikipedia.org/wiki/Semantic_memory): user conventions + project context. The agent remembers your decisions long after you've forgotten them.",
      "[Ship-to-PR](https://docs.github.com/en/pull-requests) attaches a `Spec: <slug>` [git trailer](https://git-scm.com/docs/git-interpret-trailers) so blame points to the contract, not the vibes.",
      "[ASAR](https://github.com/electron/asar)-packaged for macOS, Windows, and Linux — after a surprisingly educational number of [CI](https://en.wikipedia.org/wiki/Continuous_integration) failures.",
    ],
  },
];
