import { inject, injectable } from "@theia/core/shared/inversify";
import type { interfaces } from "@theia/core/shared/inversify";
import {
  type CommandContribution,
  type CommandRegistry,
  type Command,
  MessageService,
} from "@theia/core";
import {
  type FrontendApplicationContribution,
  WidgetManager,
} from "@theia/core/lib/browser";
import type { ViewContainer } from "@theia/core/lib/browser/view-container";
import { EXPLORER_VIEW_CONTAINER_ID } from "@theia/navigator/lib/browser/navigator-widget-factory";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import type URI from "@theia/core/lib/common/uri";
import type { Disposable } from "@theia/core/lib/common/disposable";
import type { SpexrSearchService } from "../../common/search-protocol.js";
import { SpexrSearchServiceProxy } from "./smart-search-service.js";
import { SmartSearchWidget } from "./smart-search-widget.js";
import { debounce } from "./smart-search-format.js";

export const SmartSearchCommands = {
  REINDEX: { id: "spexr.search.reindex", label: "Smart Search: Reindex Workspace" } satisfies Command,
  MAP: { id: "spexr.search.map", label: "Spexr: Understand the codebase" } satisfies Command,
  MAP_PAUSE: { id: "spexr.search.mapPause", label: "Spexr: Pause understanding" } satisfies Command,
  MAP_RESUME: { id: "spexr.search.mapResume", label: "Spexr: Resume understanding" } satisfies Command,
  REGENERATE: { id: "spexr.search.regenerateDescriptions", label: "Spexr: Regenerate all descriptions" } satisfies Command,
} as const;

/**
 * Places {@link SmartSearchWidget} at the top of the Explorer view container,
 * kicks off the initial index, and forwards file changes to the backend for
 * incremental re-indexing.
 */
@injectable()
export class SpexrSmartSearchContribution
  implements FrontendApplicationContribution, CommandContribution
{
  @inject(WidgetManager) private readonly widgetManager!: WidgetManager;
  @inject(SpexrSearchServiceProxy) private readonly service!: SpexrSearchService;
  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
  @inject(FileService) private readonly fileService!: FileService;
  @inject(MessageService) private readonly messages!: MessageService;

  private changed = new Set<string>();
  private removed = new Set<string>();
  private readonly flush = debounce(() => void this.flushChanges(), 500);
  private readonly restoreSpexr = debounce(() => void this.persistSpexr(), 500);
  private fileWatcher?: Disposable;

  private root(): string | undefined {
    return this.workspace.tryGetRoots()[0]?.resource.path.toString();
  }

  private rootUri(): URI | undefined {
    const r = this.workspace.tryGetRoots()[0];
    return r ? r.resource : undefined;
  }

  async onDidInitializeLayout(): Promise<void> {
    const container = (await this.widgetManager.getOrCreateWidget(
      EXPLORER_VIEW_CONTAINER_ID,
    )) as ViewContainer;
    const widget = await this.widgetManager.getOrCreateWidget<SmartSearchWidget>(SmartSearchWidget.ID);
    container.addWidget(widget, {
      order: -1,
      canHide: true,
      initiallyCollapsed: false,
      weight: 25,
    });
  }

  async onStart(): Promise<void> {
    const root = this.root();
    if (!root) return;
    await this.service.ensureIndexed(root);
    this.fileWatcher = this.fileService.onDidFilesChange(
      (event) => this.onFilesChanged(event.changes),
    );
  }

  onStop(): void {
    this.fileWatcher?.dispose();
    this.flush.cancel();
    this.restoreSpexr.cancel();
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(SmartSearchCommands.REINDEX, {
      execute: () => this.reindex(),
      isEnabled: () => this.root() !== undefined,
    });
    commands.registerCommand(SmartSearchCommands.MAP, {
      execute: () => this.startMap(false),
      isEnabled: () => this.root() !== undefined,
    });
    commands.registerCommand(SmartSearchCommands.REGENERATE, {
      execute: () => this.startMap(true),
      isEnabled: () => this.root() !== undefined,
    });
    commands.registerCommand(SmartSearchCommands.MAP_PAUSE, {
      execute: () => this.mapControl("pause"),
      isEnabled: () => this.root() !== undefined,
    });
    commands.registerCommand(SmartSearchCommands.MAP_RESUME, {
      execute: () => this.mapControl("resume"),
      isEnabled: () => this.root() !== undefined,
    });
  }

  private async reindex(): Promise<void> {
    const root = this.root();
    if (!root) return;
    try {
      await this.service.reindex(root);
    } catch (err) {
      this.messages.error(
        `Smart Search reindex failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async startMap(regenerate: boolean): Promise<void> {
    const root = this.root();
    if (!root) return;
    try {
      await this.service.startDescriptionJob(root, { regenerate });
    } catch (err) {
      this.messages.error(`Understanding the codebase failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async mapControl(action: "pause" | "resume"): Promise<void> {
    const root = this.root();
    if (!root) return;
    if (action === "pause") await this.service.pauseDescriptionJob(root);
    else await this.service.resumeDescriptionJob(root);
  }

  private onFilesChanged(changes: readonly { resource: URI; type: number }[]): void {
    const rootUri = this.rootUri();
    if (!rootUri) return;
    for (const change of changes) {
      const rel = rootUri.relative(change.resource);
      if (!rel) continue;
      const path = rel.toString();
      // Never re-index SPEXR's own generated dir: the index + descriptions store write
      // there, and re-indexing our writes would re-save → re-trigger this watcher → loop.
      // But a DELETE of `.spexr/` means the on-disk cache vanished while we hold it in
      // memory — ask the backend to re-persist it. ADD/UPDATE stay ignored (our own writes).
      if (path === ".spexr" || path.startsWith(".spexr/")) {
        if (change.type === 2) this.restoreSpexr();
        continue;
      }
      // FileChangeType: 0 UPDATED, 1 ADDED, 2 DELETED
      if (change.type === 2) {
        this.removed.add(path);
        this.changed.delete(path);
      } else {
        this.changed.add(path);
        this.removed.delete(path);
      }
    }
    this.flush();
  }

  private async persistSpexr(): Promise<void> {
    const root = this.root();
    if (root) await this.service.persistIfMissing(root);
  }

  private async flushChanges(): Promise<void> {
    const root = this.root();
    if (!root) return;
    const changed = [...this.changed];
    const removed = [...this.removed];
    this.changed.clear();
    this.removed.clear();
    if (changed.length === 0 && removed.length === 0) return;
    await this.service.applyChanges(root, changed, removed);
  }
}

/** Bind the widget factory for {@link SmartSearchWidget}. */
export function bindSmartSearchWidgetFactory(bind: interfaces.Bind): void {
  bind(SmartSearchWidget).toSelf();
}
