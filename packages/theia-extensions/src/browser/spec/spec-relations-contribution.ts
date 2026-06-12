import { injectable, inject } from "@theia/core/shared/inversify";
import { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { MessageService } from "@theia/core";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { type FileOperationEvent } from "@theia/filesystem/lib/common/files";

// Theia's `FileOperation` is a `const enum`, which cannot be referenced as a
// runtime value under `isolatedModules`. Mirror the relevant member here.
const FILE_OPERATION_MOVE = 2;
import { WorkspaceService } from "@theia/workspace/lib/browser";
import URI from "@theia/core/lib/common/uri";
import { allSpecsDirs, SPEC_CONTEXT_DIR } from "../workspace-paths.js";

const SPEC_FILE_RE = /^(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/;

/**
 * Keeps spec-related artefacts in sync when a spec file is renamed.
 *
 * When the user moves `docs/specs/<NNNN>-<old>.md` to `docs/specs/<NNNN>-<new>.md`,
 * the matching `docs/specs/.context/<NNNN>-<old>/` folder is renamed to
 * `docs/specs/.context/<NNNN>-<new>/`. Other operations (delete, copy) are ignored
 * to keep scope minimal.
 */
@injectable()
export class SpexrSpecRelationsContribution implements FrontendApplicationContribution {
  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  onStart(): void {
    this.fileService.onDidRunOperation((event) => void this.handleOperation(event));
  }

  private async handleOperation(event: FileOperationEvent): Promise<void> {
    if (event.operation !== FILE_OPERATION_MOVE) return;
    const target = event.target?.resource;
    if (!target) return;
    const source = event.resource;
    await this.syncSpecContextRename(source, target);
  }

  private async syncSpecContextRename(source: URI, target: URI): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    const oldSlug = this.specSlugUnderRoot(source, root);
    const newSlug = this.specSlugUnderRoot(target, root);
    if (!oldSlug || !newSlug) return;
    if (oldSlug === newSlug) return;

    const contextRoot = source.parent.resolve(SPEC_CONTEXT_DIR);
    const oldDir = contextRoot.resolve(oldSlug);
    const newDir = contextRoot.resolve(newSlug);

    if (!(await this.exists(oldDir))) return;
    if (await this.exists(newDir)) {
      this.messages.warn(
        `Could not rename spec context: ${newSlug} already exists. Resolve manually.`,
      );
      return;
    }

    try {
      await this.fileService.move(oldDir, newDir);
      this.messages.info(`Renamed spec context ${oldSlug} → ${newSlug}.`);
    } catch (err) {
      console.error("[spexr] spec context rename failed", err);
      this.messages.error(
        `Spec context rename failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private specSlugUnderRoot(uri: URI, root: URI): string | undefined {
    if (uri.scheme !== root.scheme) return undefined;
    const uriStr = uri.toString();
    const inAnySpecDir = allSpecsDirs(root).some((dir) => uriStr.startsWith(dir.toString() + "/"));
    if (!inAnySpecDir) return undefined;
    const match = uri.path.base.match(SPEC_FILE_RE);
    if (!match) return undefined;
    return `${match[1]}-${match[2]}`;
  }

  private workspaceRoot(): URI | undefined {
    return this.workspace.tryGetRoots()[0]?.resource;
  }

  private async exists(uri: URI): Promise<boolean> {
    try {
      await this.fileService.resolve(uri);
      return true;
    } catch {
      return false;
    }
  }
}
