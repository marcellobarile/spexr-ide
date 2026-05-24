---
name: Project overview
description: agent-centric IDE, Theia + Theia AI, TypeScript end-to-end.
type: project
---

SPEXR is an agent-centric, spec-based IDE built on Eclipse Theia + Theia AI.
The Claude session is the **primary** UI — not a sidebar.
Specs (`docs/specs/<slug>.md` at the workspace root) are first-class artifacts; every change traces back to acceptance criteria.

Memory is two-scoped: `~/.spexr/memory` (user) and `<repo>/docs/memory` (project), with a baseline community-best-practices layer underneath. Project overrides user; user overrides baseline.
