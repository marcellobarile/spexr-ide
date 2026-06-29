import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import { CommandService } from "@theia/core/lib/common/command";
import { SpexrSearchClientDispatcher } from "./smart-search-client.js";
import { SmartSearchCommands } from "./smart-search-contribution.js";
import type { DescriptionJobStatus } from "../../common/search-protocol.js";

const ENTRY_ID = "spexr-description-job";

/** Mirrors the codebase-mapping job in the status bar; click toggles pause/resume. */
@injectable()
export class DescriptionJobStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(SpexrSearchClientDispatcher) private readonly client!: SpexrSearchClientDispatcher;
  @inject(CommandService) private readonly commands!: CommandService;

  onStart(): void {
    this.client.onDescriptionJobProgress$((s) => this.render(s));
  }

  private render(s: DescriptionJobStatus): void {
    if (s.state === "idle" || s.state === "complete") {
      this.statusBar.removeElement(ENTRY_ID);
      return;
    }
    const text =
      s.state === "running" ? `$(sparkle) Mapping ${s.done}/${s.total}`
      : s.state === "paused" ? `$(debug-pause) Mapping paused ${s.done}/${s.total}`
      : `$(error) Mapping failed`;
    void this.statusBar.setElement(ENTRY_ID, {
      text,
      alignment: StatusBarAlignment.LEFT,
      priority: 100,
      tooltip: s.state === "running" ? "Click to pause mapping" : "Click to resume mapping",
      command: s.state === "paused" ? SmartSearchCommands.MAP_RESUME.id : SmartSearchCommands.MAP_PAUSE.id,
    });
  }
}
