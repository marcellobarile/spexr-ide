---
slug: 0001-bootstrap
title: Bootstrap SPEXR skeleton
status: in-progress
owner: marcello.barile@gmail.com
createdAt: 2026-05-09
---

## Goal

Establish a working monorepo skeleton for SPEXR so subsequent specs can land features without re-deciding structural questions.

## Non-goals

- Real Claude Agent SDK transport implementation (stubbed for now).
- Drift detector intelligence beyond structural checks.
- Marketplace / extension distribution.
- Custom Monaco language servers.

## Acceptance Criteria

- **AC-1** Monorepo built with pnpm workspaces and Turborepo, TypeScript 5.6 strict end-to-end.
- **AC-2** Six packages compile in isolation: `core`, `ui-kit`, `memory`, `spec`, `agent`, `onboarding`.
- **AC-3** Desktop app declares Theia frontend contributions for agent, spec, and memory views.
- **AC-4** Default layout puts the agent view as the primary panel; spec panel and memory panel are side surfaces.
- **AC-5** Three built-in themes (light, dark, high-contrast) load from CSS variables; `data-spexr-theme` toggles them at the document root.
- **AC-6** Memory is structured into baseline / user / project scopes with a markdown frontmatter schema and an indexable `MEMORY.md`.
- **AC-7** Onboarding wizard catalog covers role, project overview, architecture pointer, conventions, glossary, and runbook.
- **AC-8** Root-level `docs/memory/` and `docs/specs/` seed baseline memory and this spec, demonstrating the live convention (grouped under `docs/`; the earlier root-level layout has been migrated away).

## Notes

The Theia AI integration and Claude Agent SDK transport binding are deferred to spec **0002-agent-transport**. The bootstrap pass focuses on shape, not behavior.
