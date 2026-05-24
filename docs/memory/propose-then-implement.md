---
name: Propose then implement
description: non-trivial work waits for OK before edits.
type: feedback
---

For multi-file changes, refactors, new features, or non-obvious architectural choices: write a brief proposal (2–4 sentences naming approach + key tradeoff) and wait for OK before editing.
Single-file localized changes can skip the proposal.

**Why:** undoing a wrong direction is expensive once code is written. A 30-second proposal step prevents a 30-minute reroll.

**How to apply:** if a task touches more than one file, or introduces a new abstraction, propose first. Trivial typo/doc fixes go direct.
