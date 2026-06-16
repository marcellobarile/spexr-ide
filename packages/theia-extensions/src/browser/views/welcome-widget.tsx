import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { type FileOperationEvent } from "@theia/filesystem/lib/common/files";
import type URI from "@theia/core/lib/common/uri";
import { WELCOME_VIEW_ID } from "./welcome-view-contribution.js";
import { WelcomeSplash } from "./welcome-splash.js";
import { WelcomeBackground } from "./welcome-background.js";
import { specsDir } from "../workspace-paths.js";
import { RELEASE_NOTES } from "../release-notes.js";

/** Matches a spec file name (`NNNN-<slug>.md`). */
const SPEC_FILE_RE = /^\d{4}-[a-z0-9][a-z0-9-]*\.md$/;

@injectable()
export class SpexrWelcomeWidget extends ReactWidget {
  static readonly ID = WELCOME_VIEW_ID;

  @inject(CommandService)
  private readonly commands!: CommandService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(FileService)
  private readonly fileService!: FileService;

  private emptyProject = false;

  constructor() {
    super();
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
    this.toDispose.push(this.workspace.onWorkspaceChanged(() => void this.refresh()));
    this.toDispose.push(
      this.fileService.onDidRunOperation((event) => {
        if (this.affectsSpecs(event)) void this.refresh();
      }),
    );
    void this.refresh();
    this.update();
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    void this.refresh();
    this.update();
  }

  private workspaceRoot(): URI | undefined {
    return this.workspace.tryGetRoots()[0]?.resource;
  }

  private affectsSpecs(event: FileOperationEvent): boolean {
    const root = this.workspaceRoot();
    if (!root) return false;
    const specsRoot = specsDir(root).toString() + "/";
    const candidates = [event.resource, event.target?.resource].filter(
      (u): u is URI => u !== undefined,
    );
    return candidates.some((uri) => uri.toString().startsWith(specsRoot));
  }

  /** Recompute whether the open workspace has no specs yet. */
  private async refresh(): Promise<void> {
    const next = await this.computeEmptyProject();
    if (next !== this.emptyProject) {
      this.emptyProject = next;
      this.update();
    }
  }

  private async computeEmptyProject(): Promise<boolean> {
    const root = this.workspaceRoot();
    if (!root) return false;
    try {
      const stat = await this.fileService.resolve(specsDir(root));
      return !(stat.children ?? []).some((c) => c.isFile && SPEC_FILE_RE.test(c.name));
    } catch {
      return true;
    }
  }

  protected render(): React.ReactNode {
    return (
      <>
        <WelcomeBackground />
        <WelcomeSplash
          emptyProject={this.emptyProject}
          releaseNote={RELEASE_NOTES[0]}
          onNewProject={() => this.commands.executeCommand("spexr.project.new")}
          onOpenFolder={() => this.commands.executeCommand("workspace:openFolder")}
          onFocusAgent={() => this.commands.executeCommand("spexr.claude.focus")}
          onStartFirstSpec={() => this.commands.executeCommand("spexr.spec.create")}
        />
      </>
    );
  }
}
