import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import type { SpexrSpecWidget } from "./spec-widget.js";

export const SPEC_VIEW_ID = "spexr.view.spec";

@injectable()
export class SpexrSpecViewContribution extends AbstractViewContribution<SpexrSpecWidget> {
  constructor() {
    super({
      widgetId: SPEC_VIEW_ID,
      widgetName: "Active Spec",
      defaultWidgetOptions: {
        area: "main",
        rank: 1,
      },
      toggleCommandId: "spexr.view.spec.toggle",
      toggleKeybinding: "ctrlcmd+shift+s",
    });
  }
}
