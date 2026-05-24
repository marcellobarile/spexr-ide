---
name: TypeScript conventions (community baseline)
description: strict mode, no any, exact optional, runtime validators at boundaries.
type: feedback
tags:
  - language:typescript
  - baseline
---

## Compiler

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- Prefer `unknown` over `any`. Cast only after a type guard or schema validation.

## Boundaries

- Validate untrusted input at the edge with a schema library (e.g., `zod`, `valibot`); pass parsed types inward.
- Internal modules trust their type signatures — do not double-validate.

## Errors

- Throw typed `Error` subclasses with stable `code` fields for callers to switch on.
- Return `Result<T, E>` only when failures are part of the contract and callers branch on them; otherwise throw.

## Async

- `Promise<void>` over fire-and-forget. Always handle rejections explicitly.
- No top-level `await` in library code; keep entry points the only async boundary.

**Why:** these rules trade a small amount of upfront friction for far cheaper refactors and fewer runtime surprises.

**How to apply:** when generating TS code, follow this baseline unless overridden by a project-scope memory.
