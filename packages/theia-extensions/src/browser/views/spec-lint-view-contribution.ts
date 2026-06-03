import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import type { SpexrSpecLintWidget } from "./spec-lint-widget.js";

export const SPEC_LINT_VIEW_ID = "spexr.view.spec-lint";

@injectable()
export class SpexrSpecLintViewContribution extends AbstractViewContribution<SpexrSpecLintWidget> {
  constructor() {
    super({
      widgetId: SPEC_LINT_VIEW_ID,
      widgetName: "Spec validation",
      defaultWidgetOptions: {
        area: "bottom",
        rank: 2,
      },
      toggleCommandId: "spexr.view.spec-lint.toggle",
    });
  }
}
