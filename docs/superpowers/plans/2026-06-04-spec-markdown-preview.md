# Spec Markdown Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live markdown preview that opens split-right alongside the spec editor automatically whenever a spec file is opened.

**Architecture:** A singleton `SpexrSpecPreviewWidget` (ReactWidget) renders the live Monaco buffer via `marked`. A `SpexrSpecPreviewContribution` (FrontendApplicationContribution + CommandContribution) wires the auto-open logic by listening to `shell.onDidAddWidget` for new spec EditorWidgets and calls `shell.addWidget(preview, { area: 'main', ref: editorWidget, mode: 'split-right' })`. A toolbar item fires a toggle command to manually open/close.

**Tech Stack:** React 18, TypeScript 6, Theia 1.71, `marked` v14, Inversify DI

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Add dep | `packages/theia-extensions/package.json` | `marked` direct dep |
| Create | `packages/theia-extensions/src/browser/views/spec-preview-widget.tsx` | Singleton ReactWidget that renders markdown HTML from the active spec editor |
| Modify | `packages/theia-extensions/src/browser/style/spexr.css` | CSS for `.spexr-spec-preview*` classes |
| Create | `packages/theia-extensions/src/browser/views/spec-preview-contribution.ts` | Auto-open split-right + `spexr.view.spec-preview.toggle` command |
| Modify | `packages/theia-extensions/src/browser/views/spec-editor-toolbar-contribution.ts` | Add "Toggle preview" toolbar item |
| Modify | `packages/theia-extensions/src/browser/spexr-frontend-module.ts` | Bind widget + contribution + WidgetFactory |

---

## Task 1: Add `marked` dependency

**Files:**
- Modify: `packages/theia-extensions/package.json`

- [ ] **Step 1: Add dependency**

In `packages/theia-extensions/package.json`, add `"marked": "^14.0.0"` to the `dependencies` block (after `@theia/workspace`):

```json
    "@theia/workspace": "^1.71.0",
    "marked": "^14.0.0",
```

- [ ] **Step 2: Install**

```bash
pnpm install
```

Expected: lock file updates, no errors.

- [ ] **Step 3: Verify TypeScript can see it**

```bash
pnpm --filter @spexr/theia-extensions typecheck
```

Expected: passes (no new errors).

- [ ] **Step 4: Commit**

```bash
git add packages/theia-extensions/package.json pnpm-lock.yaml
git commit -m "chore(theia-extensions): add marked as direct dep for spec preview"
```

---

## Task 2: Create `spec-preview-widget.tsx`

**Files:**
- Create: `packages/theia-extensions/src/browser/views/spec-preview-widget.tsx`

- [ ] **Step 1: Create the widget file**

```typescript
import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { DisposableCollection } from "@theia/core/lib/common/disposable";
import { EditorManager, type EditorWidget } from "@theia/editor/lib/browser";
import { marked } from "marked";

export const SPEC_PREVIEW_VIEW_ID = "spexr.view.spec-preview";
const SPEC_FILE_RE = /^\d{4}-[a-z0-9][a-z0-9-]*\.md$/;
const DEBOUNCE_MS = 200;

interface PreviewState {
  readonly title: string;
  readonly html: string;
}

/** Strip <script> and <iframe> elements from rendered HTML (AC-7). */
function sanitize(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("script, iframe").forEach((el) => el.remove());
  return div.innerHTML;
}

/**
 * Singleton ReactWidget that renders the active spec editor's markdown content
 * as HTML, updating live on every keystroke (debounced).
 */
@injectable()
export class SpexrSpecPreviewWidget extends ReactWidget {
  static readonly ID = SPEC_PREVIEW_VIEW_ID;

  @inject(EditorManager)
  private readonly editorManager!: EditorManager;

  private state: PreviewState | undefined;
  private tracked: EditorWidget | undefined;
  private readonly trackedDisposables = new DisposableCollection();
  private debounce: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.id = SpexrSpecPreviewWidget.ID;
    this.title.label = "Spec preview";
    this.title.caption = "Live markdown preview of the open spec";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-open-preview";
    this.addClass("spexr-spec-preview-widget");
    this.node.tabIndex = 0;
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(this.trackedDisposables);
    this.toDispose.push(
      this.editorManager.onCurrentEditorChanged(() => this.retarget()),
    );
    this.retarget();
    this.update();
  }

  protected override onActivateRequest(msg: Message): void {
    super.onActivateRequest(msg);
    this.node.focus();
  }

  /**
   * Bind to the active editor when it is a spec. Non-spec editors do not clear
   * the preview — the last spec stays until explicitly closed (AC-4).
   */
  private retarget(): void {
    const widget = this.editorManager.currentEditor;
    const uri = widget?.getResourceUri();
    const isSpec = !!uri && SPEC_FILE_RE.test(uri.path.base);
    if (!widget || !uri || !isSpec) return;
    if (this.tracked === widget) return;
    this.trackedDisposables.dispose();
    this.tracked = widget;
    this.title.label = `Preview: ${uri.path.base}`;
    this.trackedDisposables.push(
      widget.editor.onDocumentContentChanged(() => this.scheduleRender()),
    );
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      this.render_();
    }, DEBOUNCE_MS);
  }

  private render_(): void {
    const widget = this.tracked;
    const uri = widget?.getResourceUri();
    if (!widget || !uri) return;
    const raw = widget.editor.document.getText();
    const html = sanitize(marked.parse(raw) as string);
    this.state = { title: uri.path.base, html };
    this.update();
  }

  protected render(): React.ReactNode {
    if (!this.state) {
      return (
        <div className="spexr-spec-preview" aria-label="Spec preview">
          <p className="spexr-spec-preview__empty">Open a spec to preview it.</p>
        </div>
      );
    }
    return (
      <div className="spexr-spec-preview" aria-label={`Preview: ${this.state.title}`}>
        <div
          className="spexr-spec-preview__body"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: this.state.html }}
        />
      </div>
    );
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @spexr/theia-extensions typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add packages/theia-extensions/src/browser/views/spec-preview-widget.tsx
git commit -m "feat(theia-extensions): add SpexrSpecPreviewWidget for live markdown preview"
```

---

## Task 3: Add CSS for the preview widget

**Files:**
- Modify: `packages/theia-extensions/src/browser/style/spexr.css`

- [ ] **Step 1: Append styles at the end of `spexr.css`**

```css
/* ── Spec preview widget ─────────────────────────────────────── */

.spexr-spec-preview-widget {
  overflow: hidden;
}

.spexr-spec-preview {
  height: 100%;
  overflow-y: auto;
  padding: var(--spexr-space-4) var(--spexr-space-5);
  box-sizing: border-box;
}

.spexr-spec-preview__empty {
  color: var(--spexr-text-secondary);
  font-size: var(--spexr-text-sm);
  padding: var(--spexr-space-4);
}

.spexr-spec-preview__body {
  font-size: var(--spexr-text-md);
  line-height: 1.65;
  color: var(--spexr-text-primary);
  max-width: 72ch;
}

.spexr-spec-preview__body h1,
.spexr-spec-preview__body h2,
.spexr-spec-preview__body h3,
.spexr-spec-preview__body h4 {
  margin: 1.4em 0 0.4em;
  font-weight: 600;
  line-height: 1.3;
  color: var(--spexr-text-primary);
}

.spexr-spec-preview__body h1 { font-size: 1.5em; }
.spexr-spec-preview__body h2 { font-size: 1.25em; border-bottom: 1px solid var(--spexr-border-subtle); padding-bottom: 0.2em; }
.spexr-spec-preview__body h3 { font-size: 1.1em; }

.spexr-spec-preview__body p {
  margin: 0.6em 0;
}

.spexr-spec-preview__body ul,
.spexr-spec-preview__body ol {
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.spexr-spec-preview__body li {
  margin: 0.25em 0;
}

.spexr-spec-preview__body code {
  font-family: var(--theia-code-font-family, monospace);
  font-size: 0.9em;
  background: var(--spexr-bg-surface);
  border: 1px solid var(--spexr-border-subtle);
  border-radius: var(--spexr-radius-sm);
  padding: 0.1em 0.35em;
}

.spexr-spec-preview__body pre {
  background: var(--spexr-bg-surface);
  border: 1px solid var(--spexr-border-subtle);
  border-radius: var(--spexr-radius-md);
  padding: var(--spexr-space-3) var(--spexr-space-4);
  overflow-x: auto;
  margin: 0.75em 0;
}

.spexr-spec-preview__body pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.875em;
}

.spexr-spec-preview__body blockquote {
  margin: 0.75em 0;
  padding: var(--spexr-space-2) var(--spexr-space-4);
  border-left: 3px solid var(--spexr-border-default);
  color: var(--spexr-text-secondary);
}

.spexr-spec-preview__body table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75em 0;
  font-size: var(--spexr-text-sm);
}

.spexr-spec-preview__body th,
.spexr-spec-preview__body td {
  border: 1px solid var(--spexr-border-subtle);
  padding: var(--spexr-space-2) var(--spexr-space-3);
  text-align: left;
}

.spexr-spec-preview__body th {
  background: var(--spexr-bg-surface);
  font-weight: 600;
}

.spexr-spec-preview__body a {
  color: var(--theia-textLink-foreground, var(--spexr-text-primary));
}

.spexr-spec-preview__body hr {
  border: none;
  border-top: 1px solid var(--spexr-border-subtle);
  margin: 1.5em 0;
}
```

- [ ] **Step 2: Build to check CSS is copied**

```bash
pnpm --filter @spexr/theia-extensions run copy-assets
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/theia-extensions/src/browser/style/spexr.css
git commit -m "feat(theia-extensions): add CSS for spec-preview widget"
```

---

## Task 4: Create `spec-preview-contribution.ts`

**Files:**
- Create: `packages/theia-extensions/src/browser/views/spec-preview-contribution.ts`

- [ ] **Step 1: Create the contribution file**

```typescript
import { injectable, inject } from "@theia/core/shared/inversify";
import {
  type FrontendApplicationContribution,
  ApplicationShell,
  type Widget,
} from "@theia/core/lib/browser";
import {
  CommandContribution,
  type CommandRegistry,
  type Command,
} from "@theia/core/lib/common/command";
import { EditorManager, type EditorWidget } from "@theia/editor/lib/browser";
import { SpexrSpecPreviewWidget } from "./spec-preview-widget.js";

const SPEC_FILE_RE = /^\d{4}-[a-z0-9][a-z0-9-]*\.md$/;

export const SPEC_PREVIEW_TOGGLE_COMMAND: Command = {
  id: "spexr.view.spec-preview.toggle",
  label: "SPEXR: Toggle markdown preview",
};

/**
 * Wires the auto-open split-right behaviour for the spec markdown preview.
 *
 * Auto-open rules (AC-1, AC-5):
 * - When a new spec EditorWidget is added to the shell, open the preview
 *   split-right of it — unless the user closed it while viewing that same spec.
 * - Switching to a different spec URI after a manual close re-opens the preview.
 *
 * Also registers the `spexr.view.spec-preview.toggle` command used by the
 * toolbar item (AC-6).
 */
@injectable()
export class SpexrSpecPreviewContribution
  implements FrontendApplicationContribution, CommandContribution
{
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  @inject(EditorManager)
  private readonly editorManager!: EditorManager;

  @inject(SpexrSpecPreviewWidget)
  private readonly preview!: SpexrSpecPreviewWidget;

  /** User's last explicit intent: open (true) or closed (false). */
  private wantOpen = true;
  /** URI for which the user last set wantOpen = false. */
  private closedForUri: string | undefined;
  /** True while we add/close the preview ourselves so those shell events are ignored. */
  private programmatic = false;

  onStart(): void {
    this.shell.onDidAddWidget((w) => {
      this.captureIntent(w, true);
      void this.handleWidgetAdded(w);
    });
    this.shell.onDidRemoveWidget((w) => this.captureIntent(w, false));
  }

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(SPEC_PREVIEW_TOGGLE_COMMAND, {
      execute: () => void this.togglePreview(),
    });
  }

  /** Called by the toolbar item to force-open or close the preview (AC-6). */
  async togglePreview(): Promise<void> {
    if (this.preview.isAttached) {
      await this.run(() => { this.preview.close(); });
      return;
    }
    const current = this.editorManager.currentEditor;
    if (current && this.isSpecEditor(current)) {
      await this.openPreviewFor(current);
    }
  }

  private async handleWidgetAdded(widget: Widget): Promise<void> {
    if (this.programmatic) return;
    if (!this.isSpecEditorWidget(widget)) return;
    const uri = (widget as EditorWidget).getResourceUri()?.toString();
    if (!uri) return;
    const shouldOpen = this.wantOpen || uri !== this.closedForUri;
    if (shouldOpen && !this.preview.isAttached) {
      await this.openPreviewFor(widget as EditorWidget);
    }
  }

  private async openPreviewFor(editorWidget: EditorWidget): Promise<void> {
    await this.run(async () => {
      await this.shell.addWidget(this.preview, {
        area: "main",
        ref: editorWidget,
        mode: "split-right",
      });
      await this.shell.activateWidget(this.preview.id);
    });
    this.wantOpen = true;
    this.closedForUri = undefined;
  }

  private captureIntent(widget: Widget, opened: boolean): void {
    if (this.programmatic || widget.id !== SpexrSpecPreviewWidget.ID) return;
    this.wantOpen = opened;
    if (!opened) {
      // Remember which spec URI the preview was closed for.
      this.closedForUri = this.editorManager.currentEditor
        ?.getResourceUri()
        ?.toString();
    }
  }

  private async run(op: () => Promise<void> | void): Promise<void> {
    this.programmatic = true;
    try {
      await op();
    } finally {
      this.programmatic = false;
    }
  }

  private isSpecEditor(widget: EditorWidget): boolean {
    return SPEC_FILE_RE.test(widget.getResourceUri()?.path.base ?? "");
  }

  private isSpecEditorWidget(widget: Widget): boolean {
    if (!(widget instanceof EditorWidget)) return false;
    return this.isSpecEditor(widget);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @spexr/theia-extensions typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add packages/theia-extensions/src/browser/views/spec-preview-contribution.ts
git commit -m "feat(theia-extensions): add SpexrSpecPreviewContribution for auto-open split-right"
```

---

## Task 5: Add "Toggle preview" toolbar item

**Files:**
- Modify: `packages/theia-extensions/src/browser/views/spec-editor-toolbar-contribution.ts`

Current file registers two toolbar items. Add a third at priority 2.

- [ ] **Step 1: Import the toggle command id**

Add this import at the top of the file (after the existing imports):

```typescript
import { SPEC_PREVIEW_TOGGLE_COMMAND } from "./spec-preview-contribution.js";
```

- [ ] **Step 2: Register the toolbar item**

Inside `registerToolbarItems`, after the `spexr.spec.editor.resources` item registration, add:

```typescript
    registry.registerItem({
      id: "spexr.spec.editor.preview",
      command: SPEC_PREVIEW_TOGGLE_COMMAND.id,
      icon: "codicon codicon-open-preview",
      tooltip: "Toggle markdown preview",
      priority: 2,
      isVisible: (widget?: Widget) => this.isSpecEditor(widget),
    });
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @spexr/theia-extensions typecheck
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add packages/theia-extensions/src/browser/views/spec-editor-toolbar-contribution.ts
git commit -m "feat(theia-extensions): add preview toggle toolbar item for spec editors"
```

---

## Task 6: Register contributions in `spexr-frontend-module.ts`

**Files:**
- Modify: `packages/theia-extensions/src/browser/spexr-frontend-module.ts`

- [ ] **Step 1: Add imports**

After the `SpexrSpecLintVisibilityContribution` import block, add:

```typescript
import { SpexrSpecPreviewWidget, SPEC_PREVIEW_VIEW_ID } from "./views/spec-preview-widget.js";
import { SpexrSpecPreviewContribution } from "./views/spec-preview-contribution.js";
```

- [ ] **Step 2: Add bindings**

After the `SpexrSpecLintVisibilityContribution` block (around line 108), add:

```typescript
  bind(SpexrSpecPreviewWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: SPEC_PREVIEW_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrSpecPreviewWidget),
    }))
    .inSingletonScope();
  bind(SpexrSpecPreviewContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrSpecPreviewContribution);
  bind(CommandContribution).toService(SpexrSpecPreviewContribution);
```

- [ ] **Step 3: Verify `CommandContribution` is imported**

Check the top of `spexr-frontend-module.ts`. It already imports `CommandContribution` from `@theia/core`:

```typescript
import { CommandContribution, MenuContribution } from "@theia/core";
```

No change needed if that line exists.

- [ ] **Step 4: Full build + typecheck**

```bash
pnpm --filter @spexr/theia-extensions build
pnpm --filter @spexr/theia-extensions typecheck
```

Expected: both pass, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/browser/spexr-frontend-module.ts
git commit -m "feat(theia-extensions): register spec preview widget and contribution"
```

---

## Verification Checklist

After all tasks complete:

- [ ] Start the app: `pnpm dev`
- [ ] Open any spec file (e.g. `docs/specs/0010-spec-markdown-preview.md`) — preview should open split-right automatically
- [ ] Type in the spec editor — preview updates within ~200ms without saving
- [ ] Switch to a different spec tab — preview title updates, content updates
- [ ] Switch to a non-spec file — preview stays showing last spec (AC-4)
- [ ] Close the preview tab manually — no reopen when switching back to same spec
- [ ] Switch to a DIFFERENT spec — preview reopens (AC-5)
- [ ] Click the "Toggle preview" icon in the editor toolbar — opens if closed, closes if open (AC-6)
- [ ] Add `<script>alert('xss')</script>` to a spec and save — no alert fires (AC-7)
