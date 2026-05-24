---
name: React conventions (community baseline)
description: function components, hooks, accessibility-first, no inline objects in props.
type: feedback
tags:
  - framework:react
  - baseline
---

## Components

- Function components only; class components are legacy.
- One component per file. Co-locate styles and tests.
- Props are read-only; never mutate.

## State

- Local state via `useState` / `useReducer`. Cross-tree state via context or a dedicated store — not prop drilling more than 2 levels.
- Derive when possible: do not store data that can be computed from props/state.

## Performance

- Wrap non-primitive props in `useMemo` if they cross a memoized boundary.
- Don't `useMemo` everything — measure first.

## Accessibility

- Every interactive element must be reachable by keyboard.
- Use semantic HTML before ARIA. ARIA only fills gaps semantic HTML cannot.
- Manage focus on route changes and modal open/close.

**Why:** these are the rules whose violation produces the most production bugs and the most accessibility regressions.

**How to apply:** apply when authoring React; if the project memory disagrees, project wins.
