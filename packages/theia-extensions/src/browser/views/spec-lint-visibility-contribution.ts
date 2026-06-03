import { injectable, inject } from "@theia/core/shared/inversify";
import {
  type FrontendApplicationContribution,
  ApplicationShell,
  type Widget,
} from "@theia/core/lib/browser";
import { EditorWidget } from "@theia/editor/lib/browser";
import {
  SpexrSpecLintViewContribution,
  SPEC_LINT_VIEW_ID,
} from "./spec-lint-view-contribution.js";

const SPEC_FILE_RE = /^\d{4}-[a-z0-9][a-z0-9-]*\.md$/;

/**
 * Keeps the spec-validation panel scoped to spec editors, mirroring the
 * linked-resources panel so both companions appear together on the spec detail
 * page and stay hidden elsewhere. The user's open/closed choice is remembered.
 */
@injectable()
export class SpexrSpecLintVisibilityContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  @inject(SpexrSpecLintViewContribution)
  private readonly view!: SpexrSpecLintViewContribution;

  private wantOpen = true;
  private programmatic = false;

  onStart(): void {
    this.shell.onDidChangeCurrentWidget(() => void this.enforce());
    this.shell.onDidAddWidget((w) => this.captureIntent(w, true));
    this.shell.onDidRemoveWidget((w) => this.captureIntent(w, false));
    void this.enforce();
  }

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

  private captureIntent(widget: Widget, opened: boolean): void {
    if (this.programmatic || widget.id !== SPEC_LINT_VIEW_ID) return;
    this.wantOpen = opened;
  }

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
