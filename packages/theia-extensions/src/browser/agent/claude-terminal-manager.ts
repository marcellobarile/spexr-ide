import { injectable, inject, optional } from "@theia/core/shared/inversify";
import { ApplicationShell } from "@theia/core/lib/browser";
import { MessageService } from "@theia/core/lib/common/message-service";
import { QuickInputService } from "@theia/core/lib/common/quick-pick-service";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { PreferenceScope } from "@theia/core/lib/common/preferences/preference-scope";
import { nls } from "@theia/core/lib/common/nls";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import type { ClaudeProfileDto, MemoryLinkStatus } from "../../common/agent-protocol.js";
import { SpexrAgentServiceProxy } from "./agent-service-proxy.js";
import type { SpexrAgentService } from "./agent-service-proxy.js";
import {
  SPEXR_CLAUDE_EXECUTABLE_PREFERENCE,
  SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE,
  SPEXR_CLAUDE_PROFILE_ID_PREFERENCE,
  SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE,
} from "../preferences/spexr-preferences.js";

const CLAUDE_TERMINAL_ID = "spexr-claude";

/**
 * Owns the lifecycle and placement of the embedded `claude` terminal widget.
 *
 * A single `TerminalWidget` is created per workspace and relocated between the
 * left side-panel and the main area by the expand/collapse toggle. All launch
 * and placement operations go through this manager so consumers (bootstrap,
 * commands, welcome card) never duplicate the profile-resolution flow.
 */
@injectable()
export class ClaudeTerminalManager {
  @inject(TerminalService)
  private readonly terminalService!: TerminalService;

  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;

  @inject(QuickInputService)
  private readonly quickInput!: QuickInputService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  @optional()
  @inject(SpexrAgentServiceProxy)
  private readonly agentService!: SpexrAgentService | undefined;

  private widget: TerminalWidget | undefined;

  /** Tracks where the widget currently lives ("left" or "main"). */
  private placement: "left" | "main" = "left";

  /** Id of the expert persona the running terminal was launched with. */
  private currentExpertId: string | undefined;

  /**
   * Ensure a Claude session is running and visible.
   *
   * Reveals the existing terminal when present; otherwise resolves the account
   * profile and launches a new one. Surfaces missing-workspace / missing-CLI
   * conditions as notifications instead of throwing.
   */
  async ensureStarted(): Promise<void> {
    if (this.widget && !this.widget.isDisposed) {
      await this.reveal();
      return;
    }

    const existing = this.terminalService.getById(CLAUDE_TERMINAL_ID);
    if (existing) {
      this.widget = existing;
      existing.setTitle(nls.localize("spexr/agent/title", "Agent"));
      await this.reveal();
      return;
    }

    const activeId = this.activeExpertId();
    const expert = activeId ? await this.resolveExpert(activeId) : undefined;
    await this.launchSession(expert);
  }

  /**
   * Launch a session as the given expert (or the base agent when undefined),
   * reusing the existing terminal slot if a different one is running.
   *
   * @param expert  Minimal expert info for title/icon, or undefined for base.
   */
  async startWithExpert(expert: { id: string; name: string; icon: string }): Promise<void> {
    const firstRoot = this.workspace.tryGetRoots()[0];
    if (firstRoot) {
      await this.preferences.set(
        SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE,
        expert.id,
        PreferenceScope.Folder,
        firstRoot.resource.toString(),
      );
    }
    if (this.widget && !this.widget.isDisposed && this.currentExpertId === expert.id) {
      await this.reveal();
      return;
    }
    this.disposeCurrent();
    await this.launchSession(expert);
  }

  /**
   * Clear the active expert and relaunch the base agent (no persona).
   *
   * The installed expert files under `docs/agents/` are left untouched; only
   * the active selection is reset. Relaunches the single terminal because the
   * persona is fixed at process start.
   */
  async deactivateExpert(): Promise<void> {
    const firstRoot = this.workspace.tryGetRoots()[0];
    if (firstRoot) {
      await this.preferences.set(
        SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE,
        "",
        PreferenceScope.Folder,
        firstRoot.resource.toString(),
      );
    }
    this.disposeCurrent();
    await this.launchSession(undefined);
  }

  private activeExpertId(): string | undefined {
    const stored = this.preferences.get<string>(SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE) ?? "";
    return stored.trim() || undefined;
  }

  private async resolveExpert(
    id: string,
  ): Promise<{ id: string; name: string; icon: string } | undefined> {
    if (!this.agentService) return undefined;
    try {
      const all = await this.agentService.listMarketplaceExperts();
      const found = all.find((e) => e.id === id);
      return found ? { id: found.id, name: found.name, icon: found.icon } : undefined;
    } catch {
      return undefined;
    }
  }

  private disposeCurrent(): void {
    if (this.widget && !this.widget.isDisposed) this.widget.dispose();
    const adopted = this.terminalService.getById(CLAUDE_TERMINAL_ID);
    adopted?.dispose();
    this.widget = undefined;
    this.currentExpertId = undefined;
  }

  private async launchSession(
    expert?: { id: string; name: string; icon: string },
  ): Promise<void> {
    const firstRoot = this.workspace.tryGetRoots()[0];
    if (!firstRoot) {
      void this.messages.info("SPEXR: open a workspace to start the Claude session.");
      return;
    }
    if (!this.agentService) return;

    const workspaceRoot = firstRoot.resource.path.toString();
    const workspaceUri = firstRoot.resource.toString();

    try {
      const profile = await this.resolveProfile(workspaceUri);
      if (!profile) return;
      await this.linkMemory(workspaceRoot);
      const shellArgs = await this.buildShellArgs(workspaceRoot, expert?.id);
      await this.launch(workspaceRoot, profile, shellArgs, expert);
      this.currentExpertId = expert?.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void this.messages.error(`SPEXR: ${message}`);
    }
  }

  private async buildShellArgs(workspaceRoot: string, expertId?: string): Promise<string[]> {
    const ctx = await this.agentService!.buildLaunchContext(workspaceRoot, expertId);
    if (ctx.appendSystemPromptFile) {
      return ["--append-system-prompt-file", ctx.appendSystemPromptFile];
    }
    if (ctx.appendSystemPromptInline) {
      return ["--append-system-prompt", ctx.appendSystemPromptInline];
    }
    return [];
  }

  /**
   * Resolve the configDir that the active profile would use.
   *
   * Returns the trimmed preference value, or `undefined` when the preference
   * is unset (which maps to the CLI default `~/.claude`).
   */
  currentConfigDir(): string | undefined {
    const stored = this.preferences.get<string>(SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE) ?? "";
    return stored.trim() || undefined;
  }

  /**
   * Link the workspace `memory/` folder into the Claude native per-project
   * memory location.  Best-effort: a `blocked` result is surfaced as a warning
   * but does not prevent launch.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   */
  async linkMemory(workspaceRoot: string): Promise<void> {
    if (!this.agentService) return;
    const result = await this.agentService.linkProjectMemory(
      workspaceRoot,
      this.currentConfigDir(),
    );
    if (result.status === "blocked" || result.status === "error") {
      void this.messages.warn(`SPEXR memory link: ${result.message ?? result.status}`);
    }
  }

  /**
   * Resolve a conflict at the Claude native per-project memory location by
   * backing up whatever is there and creating a fresh link to the workspace
   * `memory/` folder.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   */
  async resolveMemoryConflict(workspaceRoot: string): Promise<void> {
    if (!this.agentService) return;
    const result = await this.agentService.resolveMemoryConflict(
      workspaceRoot,
      this.currentConfigDir(),
    );
    if (result.status === "error") {
      void this.messages.warn(`SPEXR memory resolve: ${result.message ?? result.status}`);
    }
  }

  /**
   * Unlink the Claude native per-project memory symlink for the given workspace.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   */
  async unlinkMemory(workspaceRoot: string): Promise<void> {
    if (!this.agentService) return;
    const result = await this.agentService.unlinkProjectMemory(
      workspaceRoot,
      this.currentConfigDir(),
    );
    if (result.status === "blocked" || result.status === "error") {
      void this.messages.warn(`SPEXR memory unlink: ${result.message ?? result.status}`);
    }
  }

  /**
   * Report whether the workspace memory is currently symlinked into the active
   * profile's Claude config dir. Returns `"unknown"` when the backend proxy is
   * unavailable.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   */
  async memoryLinkStatus(workspaceRoot: string): Promise<MemoryLinkStatus> {
    if (!this.agentService) return "unknown";
    const result = await this.agentService.getMemoryLinkStatus(
      workspaceRoot,
      this.currentConfigDir(),
    );
    return result.status;
  }

  /**
   * Launch the `claude` CLI in a new terminal widget docked into the left panel.
   *
   * Picks up `CLAUDE_CONFIG_DIR` from the profile when present and retains the
   * widget so `reveal()`, `send()`, and `toggleExpand()` operate on the session.
   */
  private async launch(
    workspaceRoot: string,
    profile: ClaudeProfileDto,
    shellArgs: string[],
    expert?: { id: string; name: string; icon: string },
  ): Promise<void> {
    const env: { [k: string]: string | null } = profile.configDir
      ? { CLAUDE_CONFIG_DIR: profile.configDir }
      : {};

    const term = await this.terminalService.newTerminal({
      id: CLAUDE_TERMINAL_ID,
      title: expert
        ? nls.localize("spexr/agent/expertTitle", "Agent · {0}", expert.name)
        : nls.localize("spexr/agent/title", "Agent"),
      useServerTitle: false,
      iconClass: expert ? `codicon ${expert.icon}` : "codicon codicon-sparkle",
      shellPath: profile.executablePath,
      shellArgs,
      cwd: workspaceRoot,
      env,
      destroyTermOnClose: false,
    });
    await term.start();

    this.widget = term;
    this.placement = "left";
    await this.shell.addWidget(term, { area: "left", rank: 1 });
    await this.reveal();
  }

  /** Returns the current terminal widget, or `undefined` before launch. */
  current(): TerminalWidget | undefined {
    return this.widget;
  }

  /** Reveal the terminal in its current placement and expand its panel. */
  async reveal(): Promise<void> {
    const term = this.widget;
    if (!term) return;
    await this.shell.revealWidget(term.id);
    await this.shell.activateWidget(term.id);
    if (this.placement === "left") this.expandLeftPanel();
  }

  /**
   * Send text to the terminal's stdin (e.g. a prompt followed by a newline).
   * No-op when no terminal has been launched yet.
   */
  send(text: string): void {
    this.widget?.sendText(text);
  }

  /** Returns the current placement of the widget. */
  getPlacement(): "left" | "main" {
    return this.placement;
  }

  /**
   * Relocate the terminal widget between the left panel and the main area.
   *
   * Moving to main activates the widget; moving back to left reveals and expands
   * the side panel. `placement` is updated to reflect the new location.
   */
  async toggleExpand(): Promise<void> {
    const term = this.widget;
    if (!term) {
      await this.ensureStarted();
      return;
    }
    if (this.placement === "left") {
      await this.shell.addWidget(term, { area: "main" });
      await this.shell.activateWidget(term.id);
      this.placement = "main";
    } else {
      await this.shell.addWidget(term, { area: "left", rank: 1 });
      this.placement = "left";
      await this.reveal();
    }
  }

  private expandLeftPanel(): void {
    const handler = this.shell.leftPanelHandler;
    if (!handler) return;
    const expand = (handler as unknown as { expand?: () => void }).expand;
    if (typeof expand === "function") expand.call(handler);
  }

  private async resolveProfile(workspaceUri: string): Promise<ClaudeProfileDto | undefined> {
    const storedProfileId = this.preferences.get<string>(SPEXR_CLAUDE_PROFILE_ID_PREFERENCE) ?? "";
    const storedExecPath = this.preferences.get<string>(SPEXR_CLAUDE_EXECUTABLE_PREFERENCE) ?? "";
    const storedConfigDir = this.preferences.get<string>(SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE) ?? "";

    if (storedProfileId) {
      return this.buildProfileDto(storedProfileId, storedExecPath, storedConfigDir);
    }

    const profiles = await this.agentService!.detectClaudeProfiles();
    if (profiles.length <= 1) return profiles[0];

    const chosen = await this.promptForProfile(profiles);
    if (!chosen) return undefined;
    await this.persistProfileChoice(chosen, workspaceUri);
    return chosen;
  }

  private buildProfileDto(id: string, executablePath: string, configDir: string): ClaudeProfileDto {
    return {
      id,
      label: id,
      executablePath: executablePath || "claude",
      ...(configDir.trim() ? { configDir: configDir.trim() } : {}),
    };
  }

  private async promptForProfile(
    profiles: ClaudeProfileDto[],
  ): Promise<ClaudeProfileDto | undefined> {
    const items = profiles.map((p) => ({
      label: p.label,
      description: p.configDir ?? "(default)",
      profile: p,
    }));
    const picked = await this.quickInput.pick(items, {
      placeHolder: "Select a Claude account profile for this workspace",
    });
    return picked?.profile;
  }

  private async persistProfileChoice(
    profile: ClaudeProfileDto,
    workspaceUri: string,
  ): Promise<void> {
    await this.preferences.set(
      SPEXR_CLAUDE_PROFILE_ID_PREFERENCE,
      profile.id,
      PreferenceScope.Folder,
      workspaceUri,
    );
    await this.preferences.set(
      SPEXR_CLAUDE_EXECUTABLE_PREFERENCE,
      profile.executablePath,
      PreferenceScope.Folder,
      workspaceUri,
    );
    await this.preferences.set(
      SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE,
      profile.configDir ?? "",
      PreferenceScope.Folder,
      workspaceUri,
    );
  }
}
