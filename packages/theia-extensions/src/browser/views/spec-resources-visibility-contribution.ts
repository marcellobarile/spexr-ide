import { injectable, inject } from "@theia/core/shared/inversify";
import {
  type FrontendApplicationContribution,
  ApplicationShell,
  type Widget,
} from "@theia/core/lib/browser";
import { EditorWidget } from "@theia/editor/lib/browser";
import {
  SpexrSpecResourcesViewContribution,
  SPEC_RESOURCES_VIEW_ID,
} from "./spec-resources-view-contribution.js";

const SPEC_FILE_RE = /^\d{4}-[a-z0-9][a-z0-9-]*\.md$/;

/**
 * Keeps the linked-resources panel scoped to spec editors. Visibility is
 * reconciled against the main area's current widget on every current-widget
 * change, so switching between a spec editor tab and the spec list is caught.
 * The user's open/closed choice is remembered and re-applied whenever a spec
 * editor is back in front.
 */
@injectable()
export class SpexrSpecResourcesVisibilityContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  @inject(SpexrSpecResourcesViewContribution)
  private readonly view!: SpexrSpecResourcesViewContribution;

  /**
   * Last state the user left the panel in while a spec editor was in front.
   * Defaults to open so the linked-resources panel is shown by default on the
   * spec detail page; it stays closed only after the user explicitly closes it.
   */
  private wantOpen = true;
  /** True while we open/close the panel ourselves, so those events are ignored. */
  private programmatic = false;

  onStart(): void {
    this.shell.onDidChangeCurrentWidget(() => void this.enforce());
    this.shell.onDidAddWidget((w) => this.captureIntent(w, true));
    this.shell.onDidRemoveWidget((w) => this.captureIntent(w, false));
    void this.enforce();
  }

  /**
   * Reconcile panel visibility against the main area's current widget. In a spec
   * editor → restore the user's choice; anywhere else → force the panel closed.
   */
  private async enforce(): Promise<void> {
    const inSpec = this.isSpecEditor(this.shell.getCurrentWidget("main"));
    const widget = this.view.tryGetWidget();
    if (inSpec && this.wantOpen) {
      if (!widget?.isVisible) {
        await this.run(() => this.view.openView({ reveal: true, activate: false }));
      }
    } else if (widget?.isVisible) {
      await this.run(() => widget.close());
    }
  }

  /** A user-driven open/close of the panel is the real intent signal. */
  private captureIntent(widget: Widget, opened: boolean): void {
    if (this.programmatic || widget.id !== SPEC_RESOURCES_VIEW_ID) return;
    this.wantOpen = opened;
  }

  /** Run a panel open/close while suppressing the resulting intent events. */
  private async run(op: () => Promise<unknown> | unknown): Promise<void> {
    this.programmatic = true;
    try {
      await op();
    } finally {
      this.programmatic = false;
    }
  }

  private isSpecEditor(widget: unknown): boolean {
    if (!(widget instanceof EditorWidget)) return false;
    return SPEC_FILE_RE.test(widget.getResourceUri()?.path.base ?? "");
  }
}
