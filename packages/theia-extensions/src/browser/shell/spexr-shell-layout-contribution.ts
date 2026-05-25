import { injectable, inject, optional } from "@theia/core/shared/inversify";
import {
  ApplicationShell,
  FrontendApplicationContribution,
  type FrontendApplication,
} from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { FileNavigatorContribution } from "@theia/navigator/lib/browser/navigator-contribution";
import { SpexrSpecViewContribution } from "../views/spec-view-contribution.js";
import { SpexrMemoryViewContribution } from "../views/memory-view-contribution.js";
import { SpexrExpertsViewContribution } from "../views/experts-view-contribution.js";
import { SpexrWelcomeViewContribution } from "../views/welcome-view-contribution.js";
import { expandLeftPanelWithMinWidth, expandRightPanelWithMinWidth } from "./side-panel.js";

const TERMINAL_NEW_COMMAND = "terminal:new";

/**
 * Forces SPEXR's default layout on first launch.
 *
 * The Claude terminal is launched by `SpexrBootstrapContribution` and docks
 * itself into the left panel via `ClaudeTerminalManager`. Spec and memory views
 * live in the right side panel; welcome splash opens in the main area. Defaults
 * are applied only when the layout state is empty so user rearrangements survive
 * reload.
 */
@injectable()
export class SpexrShellLayoutContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  @inject(CommandService)
  private readonly commands!: CommandService;

  @inject(SpexrSpecViewContribution)
  private readonly specView!: SpexrSpecViewContribution;

  @inject(SpexrMemoryViewContribution)
  private readonly memoryView!: SpexrMemoryViewContribution;

  @inject(SpexrExpertsViewContribution)
  private readonly expertsView!: SpexrExpertsViewContribution;

  @inject(SpexrWelcomeViewContribution)
  @optional()
  private readonly welcomeView?: SpexrWelcomeViewContribution;

  @inject(FileNavigatorContribution)
  @optional()
  private readonly navigatorView?: FileNavigatorContribution;

  async onStart(app: FrontendApplication): Promise<void> {
    void app;
    console.log("[spexr] layout onStart, configured?", this.layoutAlreadyConfigured());
    if (this.layoutAlreadyConfigured()) {
      this.expandLeftPanelIfNeeded();
      // Reveal views registered after the user's layout was first saved so they
      // appear without requiring a manual layout reset.
      await this.expertsView.openView({ activate: false, reveal: true });
      expandRightPanelWithMinWidth(this.shell);
      return;
    }
    await this.applyDefaultLayout();
    console.log("[spexr] applyDefaultLayout done");
  }

  async resetLayout(): Promise<void> {
    const mainWidgets = this.shell.getWidgets("main");
    if (mainWidgets.length > 0) {
      await this.shell.closeMany(mainWidgets, { save: false });
    }
    await this.detachManagedViews();
    await this.applyDefaultLayout();
  }

  /**
   * `AbstractViewContribution.openView` does not relocate a widget that is
   * already attached, so a user-dragged Spec/Memory/Navigator panel stays in
   * its current dock until detached. Closing the views forces `applyDefaultLayout`
   * to re-add each widget at its `defaultWidgetOptions` area + rank.
   */
  private async detachManagedViews(): Promise<void> {
    await this.closeViewSafely(this.specView);
    await this.closeViewSafely(this.memoryView);
    await this.closeViewSafely(this.expertsView);
    if (this.welcomeView) await this.closeViewSafely(this.welcomeView);
    if (this.navigatorView) await this.closeViewSafely(this.navigatorView);
  }

  private async closeViewSafely(view: { closeView: () => Promise<unknown> }): Promise<void> {
    try {
      await view.closeView();
    } catch (err) {
      console.warn("[spexr] closeView failed during reset", err);
    }
  }

  private layoutAlreadyConfigured(): boolean {
    const data = this.shell.getLayoutData();
    return Boolean(data?.mainPanel?.main);
  }

  private async applyDefaultLayout(): Promise<void> {
    try {
      console.log("[spexr] open welcome");
      await this.openWelcome();
      console.log("[spexr] open side views");
      await this.openSideViews();
      console.log("[spexr] open terminal");
      await this.openTerminal();
      this.expandLeftPanel();
      expandRightPanelWithMinWidth(this.shell);
      console.log("[spexr] side panels expanded");
    } catch (err) {
      console.error("[spexr] applyDefaultLayout error", err);
    }
  }

  private expandLeftPanelIfNeeded(): void {
    this.expandLeftPanel();
  }

  private async openWelcome(): Promise<void> {
    if (!this.welcomeView) return;
    await this.welcomeView.openView({ activate: true });
  }

  private async openSideViews(): Promise<void> {
    await this.openNavigator();
    await this.specView.openView({ activate: false, reveal: true });
    await this.memoryView.openView({ activate: false, reveal: true });
    await this.expertsView.openView({ activate: false, reveal: true });
  }

  private async openNavigator(): Promise<void> {
    if (!this.navigatorView) return;
    try {
      await this.navigatorView.openView({ activate: false, reveal: true });
    } catch (err) {
      console.warn("[spexr] navigator open failed", err);
    }
  }

  private async openTerminal(): Promise<void> {
    try {
      await this.commands.executeCommand(TERMINAL_NEW_COMMAND);
    } catch {
      // Terminal extension may be unavailable in some packages; ignore.
    }
  }

  private expandLeftPanel(): void {
    expandLeftPanelWithMinWidth(this.shell);
  }
}
