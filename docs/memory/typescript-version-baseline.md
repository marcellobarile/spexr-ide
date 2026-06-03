---
name: TypeScript version baseline
description: repo runs TS 6.0.3 strict with aggressive flags; spec 0001 was written for 5.6.
type: reference
---

Repo runs **TypeScript 6.0.3** (root `package.json`), strict mode with
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`useUnknownInCatchVariables` (see `tsconfig.base.json`).

Spec 0001-bootstrap was authored against 5.6 and has been annotated as upgraded.
Mind `exactOptionalPropertyTypes` when adding optional fields: assign conditionally
(`...(x !== undefined ? { x } : {})`) rather than passing `undefined`.
