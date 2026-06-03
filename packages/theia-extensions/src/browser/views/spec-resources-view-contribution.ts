import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import type { SpexrSpecResourcesWidget } from "./spec-resources-widget.js";

export const SPEC_RESOURCES_VIEW_ID = "spexr.view.spec-resources";

@injectable()
export class SpexrSpecResourcesViewContribution extends AbstractViewContribution<SpexrSpecResourcesWidget> {
  constructor() {
    super({
      widgetId: SPEC_RESOURCES_VIEW_ID,
      widgetName: "Linked resources",
      defaultWidgetOptions: {
        area: "bottom",
        rank: 1,
      },
      toggleCommandId: "spexr.view.spec-resources.toggle",
    });
  }
}
