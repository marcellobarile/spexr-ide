import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import { SpexrWelcomeWidget } from "./welcome-widget.js";

export const WELCOME_VIEW_ID = "spexr.view.welcome";

@injectable()
export class SpexrWelcomeViewContribution extends AbstractViewContribution<SpexrWelcomeWidget> {
  constructor() {
    super({
      widgetId: WELCOME_VIEW_ID,
      widgetName: "Welcome",
      defaultWidgetOptions: {
        area: "main",
      },
      toggleCommandId: "spexr.view.welcome.toggle",
      toggleKeybinding: "ctrlcmd+shift+w",
    });
  }
}
