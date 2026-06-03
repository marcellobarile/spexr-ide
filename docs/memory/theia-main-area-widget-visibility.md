---
name: theia-main-area-widget-visibility
description: Two gotchas when reacting to main-area widget/tab switches in Theia (focus + currentEditor vs getCurrentWidget)
metadata:
  type: reference
---

Reconciling a panel's visibility against which main-area tab is in front (e.g. the linked-resources bottom panel that should only show for spec editors) hit two distinct Theia gotchas. Both must be fixed together — fixing one alone produces "no events fire" or "events fire but wrong decision".

**1. A custom `ReactWidget` in the `main` area must accept focus, or tab-switch events never fire.** `SpexrSpecWidget` (the spec list, `area: "main"`) had no focusable node. Selecting its tab logged `Widget was activated, but did not accept focus after 2000ms: spexr.view.spec`, the activation never completed, and `shell.onDidChangeCurrentWidget` / `onDidChangeActiveWidget` / `editorManager.onCurrentEditorChanged` **did not emit at all**. Fix: make it focusable —
```ts
this.node.tabIndex = 0; // in constructor
protected override onActivateRequest(msg: Message): void {
  super.onActivateRequest(msg);
  this.node.focus();
}
```
Side-panel views (right/bottom dock) don't need this; the main area does.

**2. Source of truth for "is a spec editor in front" must be `shell.getCurrentWidget("main")`, not `editorManager.currentEditor`.** `currentEditor` stays pointed at the last opened editor even after a non-editor main widget (the spec list) becomes current — so `inSpec` reads true on the list and the panel never hides. Use `isSpecEditor(shell.getCurrentWidget("main"))` instead.

Also: keep a single owner of panel visibility. `openSpec` was force-revealing the panel (`revealSpecResources`) while the visibility contribution tried to close it — two owners fighting. Removed the forced reveal; panel content already auto-syncs via the resources widget's own `editorManager.onCurrentEditorChanged`. See [[layout-supersession-ac4]].
