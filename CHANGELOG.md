# Changelog

## 0.1.4 — 2026-07-02

- fix(search): skip nested node_modules (and other heavy dirs) during incremental indexing
- README polish + fix Git/Search panel visibility bugs (#4)
- fix(search): strip 'This file' prefix from AI-generated descriptions
- Smart Search: semantic file search + local-model codebase understanding (#3)
- feat(release-notes): automate sync from CHANGELOG
- fix(security): harden shell.openExternal — construct release URL locally


## 0.1.3 — 2026-06-21

> Updates that actually tell you about updates.

### Fixes

- **Update check** — replaced `electron-updater` (requires Apple Developer cert) with a direct GitHub API check; shows a dialog with a download link when a newer version is available. Works on unsigned builds across all platforms.
- **Security** — release URL constructed locally from the validated version tag, never sourced from the GitHub API response.

## 0.1.2 — 2026-06-20

> Small things that were bothering everyone.

### Fixes

- **Responsive sidebar lists** — experts and memory panels wrap at ≤320 px via CSS container queries: description goes full-width, action buttons move below.
- **What's new spacing** — added top margin to the What's new panel for visual separation from the workflow section above.
- **Local settings untracked** — `.spexr/settings.json` removed from version control (contains machine-specific paths); `settings.example.json` added as onboarding template.

## 0.1.1 — 2026-06-17

> The one where we learned what version we are.

### Features

- **About dialog** — version and build info accessible from the menu.

### Fixes

- **Startup UX** — improved loading sequence and initial state on workspace open.
- **Preview focus** — fixed focus steal on markdown preview open.

## 0.1.0 — 2026-06-14

> The one where we finally commit.

### Features

- **Spec workflow** — `docs/specs/<NNNN-slug>.md` files move through a 7-step stepper (Specify → Context → Clarify → Plan → Implement → Validate → Ship).
- **Agent-primary shell** — Claude Code session starts automatically on workspace open; the terminal is the primary surface.
- **Expert personas** — built-in catalog (brainstorming, design, review, marketing, DRI, software-engineering); each auto-activates on the matching workflow step. Installed as `docs/agents/<id>.md`.
- **Spec context fan-in** — files and links attached to a spec are passed to the agent automatically on handoff.
- **Plan & task artifacts** — the Plan step produces `_plan.md` with a checklist linked to acceptance criteria; checkboxes are tickable from the UI.
- **Drift detector** — runs the agent against the spec's acceptance criteria and linked source files; surfaces block/warn/info findings; persists `_drift.json`.
- **Ship to PR** — one action commits staged work with a `Spec: <slug>` trailer, pushes, and opens a GitHub PR.
- **Live spec validation** — bottom panel lints the active spec on every keystroke (duplicate AC ids, placeholder text, frontmatter errors); count badge on collapsed tab.
- **Markdown preview** — split-right preview of the active spec, debounced live re-render, toolbar toggle.
- **Two-scope memory** — `~/.spexr/memory/` (user) + `<workspace>/docs/memory/` (project).
- **Workspace progress bar** — aggregate completion percentage across all specs in the panel.
