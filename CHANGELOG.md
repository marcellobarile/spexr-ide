# Changelog

## 0.1.0 — 2026-06-14

Initial public release.

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
