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
 *
 * Also cleans up stale temp workspace references: if the stored workspace is
 * under a system temp dir (e.g. leftover /tmp or /var/folders path from a past
 * e2e session), close it so the app starts on the welcome page.
 * Normal user workspaces and e2e workspaces under test-results/ are untouched.
 */
@injectable()
export class SpexrBootstrapContribution implements FrontendApplicationContribution {
  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(TabBarToolbarRegistry)
  private readonly toolbar!: TabBarToolbarRegistry;

  @inject(ClaudeTerminalManager)
  private readonly terminalManager!: ClaudeTerminalManager;

  async onStart(): Promise<void> {
    await this.workspace.ready;
    const uri = this.workspace.workspace?.resource.toString() ?? "";
    if (uri && isSystemTempPath(uri)) {
      await this.workspace.close();
    }
  }

  async onDidInitializeLayout(): Promise<void> {
    this.toolbar.unregisterItem(TERMINAL_SPLIT_ITEM_ID);
    await this.workspace.ready;
    if (!this.workspace.opened) return;
    await this.terminalManager.ensureStarted();
  }
}

function isSystemTempPath(uri: string): boolean {
  return /\/(private\/var\/folders|var\/folders|tmp)\//.test(uri);
}
