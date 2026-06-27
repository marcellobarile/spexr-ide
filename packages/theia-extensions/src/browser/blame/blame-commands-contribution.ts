import { injectable, inject } from "@theia/core/shared/inversify";
import {
  type CommandContribution,
  type CommandRegistry,
  type Command,
  type MenuContribution,
  type MenuModelRegistry,
} from "@theia/core";
import {
  type KeybindingContribution,
  type KeybindingRegistry,
} from "@theia/core/lib/browser";
import { EditorContextMenu } from "@theia/editor/lib/browser";
import { SpexrGitBlameDecorator } from "./blame-decorator.js";

export const BlameCommands = {
  TOGGLE: { id: "spexr.git.toggleBlame", label: "Git: Toggle File Blame" } satisfies Command,
} as const;

/**
 * Registers the toggle-blame command plus its `ctrlcmd+alt+b` keybinding
 * (active only while an editor is focused) and an editor context-menu entry.
 */
@injectable()
export class SpexrGitBlameCommandsContribution
  implements CommandContribution, KeybindingContribution, MenuContribution
{
  @inject(SpexrGitBlameDecorator)
  private readonly decorator!: SpexrGitBlameDecorator;

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(BlameCommands.TOGGLE, {
      execute: () => this.decorator.toggle(),
    });
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybinding({
      command: BlameCommands.TOGGLE.id,
      keybinding: "ctrlcmd+alt+b",
      when: "editorTextFocus",
    });
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(EditorContextMenu.NAVIGATION, {
      commandId: BlameCommands.TOGGLE.id,
      label: "Toggle File Blame",
      order: "z_spexr_blame",
    });
  }
}
