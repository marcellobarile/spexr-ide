---
name: Layout supersession (spec 0001 AC-4)
description: agent is a left-panel terminal, not the main panel — 0001 AC-4 superseded by 0003.
type: project
---

Spec **0001-bootstrap** AC-4 originally said the agent view is the primary (main-area)
panel. That was superseded by **0003-terminal-agent-surface**.

As shipped (`SpexrShellLayoutContribution`):
- agent = embedded `claude` terminal docked in the **left** side panel
- spec / memory / experts views = **right** side panel
- welcome splash = main area

Default layout is applied only when `layoutAlreadyConfigured()` is false (no saved
`mainPanel.main`), so user rearrangements survive reload; a missing/partial saved
layout falls back to re-applying defaults. See [[project-overview]].
