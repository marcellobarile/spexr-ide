import { injectable, inject } from "@theia/core/shared/inversify";
import { Disposable } from "@theia/core";
import type { Resource, ResourceResolver } from "@theia/core/lib/common/resource";
import URI from "@theia/core/lib/common/uri";
import { SpexrGitServiceProxySymbol } from "./git-service-proxy.js";
import type { SpexrGitService } from "../../common/git-protocol.js";

export const GIT_ORIGINAL_SCHEME = "git-original";

/**
 * Resolves URIs with scheme `git-original` to file content from git (HEAD or index).
 *
 * URI format: `git-original:/relative/path/to/file?root=/abs/workspace&rev=HEAD`
 * `rev` is either `HEAD` (working-tree diff) or `:0` (staged diff against index).
 */
@injectable()
export class GitOriginalResourceResolver implements ResourceResolver {
  @inject(SpexrGitServiceProxySymbol)
  private readonly gitService!: SpexrGitService;

  resolve(uri: URI): Resource {
    if (uri.scheme !== GIT_ORIGINAL_SCHEME) {
      throw new Error(`Cannot resolve URI with scheme '${uri.scheme}'`);
    }
    return new GitOriginalResource(uri, this.gitService);
  }
}

class GitOriginalResource implements Resource {
  constructor(
    readonly uri: URI,
    private readonly gitService: SpexrGitService,
  ) {}

  async readContents(): Promise<string> {
    const params = new URLSearchParams(this.uri.query);
    const root = params.get("root") ?? "";
    const rev = params.get("rev") ?? "HEAD";
    // Path is stored in the URI path component (leading slash stripped)
    const filePath = this.uri.path.toString().replace(/^\//, "");
    return this.gitService.getFileAtRevision(root, filePath, rev);
  }

  dispose(): void {
    // stateless — nothing to dispose
  }
}
