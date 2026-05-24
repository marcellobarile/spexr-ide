import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import type { SpexrExpertsWidget } from "./experts-widget.js";

export const EXPERTS_VIEW_ID = "spexr.view.experts";

@injectable()
export class SpexrExpertsViewContribution extends AbstractViewContribution<SpexrExpertsWidget> {
  constructor() {
    super({
      widgetId: EXPERTS_VIEW_ID,
      widgetName: nls.localize("spexr/experts/title", "Experts"),
      defaultWidgetOptions: {
        area: "right",
        rank: 2,
      },
      toggleCommandId: "spexr.view.experts.toggle",
    });
  }
}
