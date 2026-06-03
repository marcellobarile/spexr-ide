---
name: One spec, one commit
description: ship each spec as its own small reviewable commit; avoid mega-commits.
type: feedback
---

The bootstrap pass landed specs 0001–0004 plus full implementation in a single
initial git commit, which made independent review and bisection impossible.

**Why:** PM artifact rules favour small, independently reviewable, rollback-friendly
slices; a mega-commit defeats blame and per-spec review.

**How to apply:** scope each spec to its own commit (or a short series). Don't bundle
unrelated specs. Keep work in git history incrementally rather than landing weeks of
work as one snapshot.
