import { injectable } from "@theia/core/shared/inversify";
import type { Widget } from "@theia/core/shared/@lumino/widgets";
import type {
  TabBarToolbarContribution,
  TabBarToolbarRegistry,
} from "@theia/core/lib/browser/shell/tab-bar-toolbar";
import { SpexrCommands } from "../commands/spexr-commands-contribution.js";

const CLAUDE_TERMINAL_ID = "spexr-claude";

/**
 * Surfaces the expand/collapse action in the tab toolbar whenever the active
 * widget is the embedded Claude terminal (`spexr-claude`).
 *
 * Memory link/unlink live in the Memory panel as labelled buttons; only the
 * placement toggle belongs on the terminal toolbar.
 */
@injectable()
export class SpexrAgentTerminalToolbarContribution implements TabBarToolbarContribution {
  registerToolbarItems(registry: TabBarToolbarRegistry): void {
    registry.registerItem({
      id: "spexr.claude.terminal.toggle-expand",
      command: SpexrCommands.CLAUDE_TOGGLE_EXPAND.id,
      icon: "codicon codicon-arrow-both",
      tooltip: "Expand/collapse terminal",
      priority: 0,
      isVisible: (widget?: Widget) => this.isAgentTerminal(widget),
    });
  }

  private isAgentTerminal(widget?: Widget): boolean {
    return widget?.id === CLAUDE_TERMINAL_ID;
  }
}
