---
name: Accessibility checklist (WCAG 2.1 AA)
description: minimum bar for any UI work in SPEXR.
type: feedback
tags:
  - accessibility
  - baseline
---

Every UI change must satisfy:

- **Keyboard reachability**: all interactive elements operable without a pointer.
- **Focus visibility**: a visible focus indicator with at least 3:1 contrast against the adjacent surface (WCAG 2.4.11).
- **Color contrast**: normal text ≥ 4.5:1, large text ≥ 3:1, UI components/state indicators ≥ 3:1.
- **Reduced motion**: respect `prefers-reduced-motion: reduce` — set transitions to 0ms.
- **Live regions**: announce state changes (e.g., "Sending…", "Error") via `aria-live="polite"`.
- **Form labels**: every input has an associated `<label>` or `aria-labelledby`.
- **Errors**: error messages programmatically associated via `aria-describedby` or `aria-errormessage`.
- **Headings**: one `<h1>` per view; subsequent headings monotonically nested.
- **Landmarks**: `header`, `main`, `nav`, `aside` present where applicable.

**Why:** WCAG 2.1 AA is the legal floor in many jurisdictions and the practical floor for usability.

**How to apply:** add this checklist to PRs that touch UI. Reject changes that regress any item without explicit justification.
