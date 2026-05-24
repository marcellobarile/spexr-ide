import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { WELCOME_VIEW_ID } from "./welcome-view-contribution.js";
import { WelcomeSplash } from "./welcome-splash.js";

@injectable()
export class SpexrWelcomeWidget extends ReactWidget {
  static readonly ID = WELCOME_VIEW_ID;

  @inject(CommandService)
  private readonly commands!: CommandService;

  constructor() {
    super();
    console.log("[spexr] welcome widget constructed");
    this.id = SpexrWelcomeWidget.ID;
    this.title.label = "Welcome";
    this.title.caption = "SPEXR — getting started";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-rocket";
    this.addClass("spexr-welcome-widget");
    this.node.setAttribute("aria-label", "Spexr welcome");
  }

  @postConstruct()
  protected init(): void {
    console.log("[spexr] welcome widget post-construct");
    this.update();
  }

  protected override onAfterAttach(msg: import("@theia/core/lib/browser").Message): void {
    super.onAfterAttach(msg);
    console.log("[spexr] welcome widget attached");
    this.update();
  }

  protected render(): React.ReactNode {
    console.log("[spexr] welcome render");
    return (
      <WelcomeSplash
        onNewProject={() => this.commands.executeCommand("spexr.project.new")}
        onOpenFolder={() => this.commands.executeCommand("workspace:openFolder")}
        onFocusAgent={() => this.commands.executeCommand("spexr.claude.focus")}
      />
    );
  }
}
