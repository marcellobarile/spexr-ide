---
name: Validation after edits
description: always run lint, typecheck, focused tests after writes.
type: feedback
---

After code edits, run lint, typecheck, and focused tests for the touched code.
Run validation steps in parallel where possible. Report failures; fix when in scope.

**Why:** silent failures between edits and "done" are the most expensive class of regression — caught immediately, they are cheap.

**How to apply:** any edit beyond doc/comment-only triggers validation. If a step fails, do not declare the task complete.
