import { injectable, inject } from "@theia/core/shared/inversify";
import { Emitter } from "@theia/core";
import type { Event } from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import type URI from "@theia/core/lib/common/uri";
import {
  DecorationsService,
  type DecorationsProvider,
  type Decoration,
} from "@theia/core/lib/browser/decorations-service";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { SpexrGitServiceProxySymbol } from "./git-service-proxy.js";
import type { SpexrGitService } from "../../common/git-protocol.js";
import { buildIgnoreMatcher } from "./git-ignore-matcher.js";

/**
 * Dims git-ignored files/folders in the file navigator. SPEXR ships a custom SCM
 * (no `@theia/git`), so the standard ignored-resource decorations are absent — this
 * restores them by registering a {@link DecorationsProvider} with the
 * {@link DecorationsService}, which the filesystem tree already consumes.
 *
 * The ignored set (from `git ls-files … --exclude-standard`, honoring nested + global
 * gitignore) is refreshed on file changes. The tree adapter builds its decoration cache
 * from the URIs we emit via {@link onDidChange}, so each refresh emits the ignored URIs.
 */
@injectable()
export class GitIgnoredDecorationProvider
  implements DecorationsProvider, FrontendApplicationContribution
{
  @inject(SpexrGitServiceProxySymbol) private readonly gitService!: SpexrGitService;
  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
  @inject(FileService) private readonly fileService!: FileService;
  @inject(DecorationsService) private readonly decorations!: DecorationsService;

  private readonly onDidChangeEmitter = new Emitter<URI[]>();
  readonly onDidChange: Event<URI[]> = this.onDidChangeEmitter.event;

  private isIgnored: (rel: string) => boolean = () => false;
  private rootUri: URI | undefined;
  private rootFsPath: string | undefined;
  private ignoredUris: URI[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  async onStart(): Promise<void> {
    const first = this.workspace.tryGetRoots()[0];
    if (!first) return;
    this.rootUri = first.resource;
    this.rootFsPath = first.resource.path.toString();
    this.decorations.registerDecorationsProvider(this);
    this.fileService.onDidFilesChange(() => this.scheduleRefresh());
    await this.refresh();
  }

  provideDecorations(uri: URI): Decoration | undefined {
    if (!this.rootUri) return undefined;
    const rel = this.rootUri.relative(uri);
    if (!rel) return undefined;
    const relStr = rel.toString();
    if (relStr.length === 0 || !this.isIgnored(relStr)) return undefined;
    return { colorId: "disabledForeground", tooltip: "Ignored by git", weight: 10 };
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 400);
  }

  private async refresh(): Promise<void> {
    if (!this.rootFsPath || !this.rootUri) return;
    let paths: string[] = [];
    try {
      paths = await this.gitService.getIgnoredPaths(this.rootFsPath);
    } catch {
      paths = [];
    }
    this.isIgnored = buildIgnoreMatcher(paths);
    // Emit the previous + current ignored URIs so the tree adapter re-queries both the
    // ones to newly dim and the ones to clear.
    const previous = this.ignoredUris;
    this.ignoredUris = paths.map((p) => this.rootUri!.resolve(p.replace(/\/$/, "")));
    this.onDidChangeEmitter.fire([...previous, ...this.ignoredUris]);
  }

  dispose(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.onDidChangeEmitter.dispose();
  }
}
