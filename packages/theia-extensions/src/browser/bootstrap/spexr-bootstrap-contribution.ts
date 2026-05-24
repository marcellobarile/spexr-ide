import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { TabBarToolbarRegistry } from "@theia/core/lib/browser/shell/tab-bar-toolbar";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";

const TERMINAL_SPLIT_ITEM_ID = "terminal:split";

/**
 * Bootstraps spexr-specific behavior at frontend start.
 *
 * Removes the terminal "Split" toolbar action, then once the workspace is ready
 * delegates to `ClaudeTerminalManager` to launch the embedded Claude terminal
 * (profile resolution, context injection, and error surfacing live in the manager).
 */
@injectable()
export class SpexrBootstrapContribution implements FrontendApplicationContribution {
  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(TabBarToolbarRegistry)
  private readonly toolbar!: TabBarToolbarRegistry;

  @inject(ClaudeTerminalManager)
  private readonly terminalManager!: ClaudeTerminalManager;

  async onDidInitializeLayout(): Promise<void> {
    this.toolbar.unregisterItem(TERMINAL_SPLIT_ITEM_ID);
    await this.workspace.ready;
    if (!this.workspace.opened) return;
    await this.terminalManager.ensureStarted();
  }
}
