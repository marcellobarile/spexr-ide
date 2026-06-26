import { injectable } from "@theia/core/shared/inversify";
import simpleGit from "simple-git";
import type {
  SpexrGitService,
  GitStatusDto,
  GitFileChangeDto,
  GitFileState,
  GitBranchDto,
  GitLogEntryDto,
} from "../common/git-protocol.js";

function mapStateChar(char: string): GitFileState | undefined {
  switch (char) {
    case "A": return "A";
    case "M": return "M";
    case "D": return "D";
    case "R": return "R";
    case "C": return "C";
    case "U": return "C"; // merge conflict → treat as conflicted
    default: return undefined;
  }
}

function mapFileChange(
  filePath: string,
  indexChar: string,
  workingDirChar: string,
): GitFileChangeDto | undefined {
  if (indexChar === "?" && workingDirChar === "?") {
    return { path: filePath, unstagedState: "U" };
  }
  const stagedState =
    indexChar !== " " && indexChar !== "?" ? mapStateChar(indexChar) : undefined;
  const unstagedState =
    workingDirChar !== " " && workingDirChar !== "?" ? mapStateChar(workingDirChar) : undefined;
  if (!stagedState && !unstagedState) return undefined;
  return {
    path: filePath,
    ...(stagedState !== undefined && { stagedState }),
    ...(unstagedState !== undefined && { unstagedState }),
  };
}

@injectable()
export class SpexrGitBackendService implements SpexrGitService {
  async getStatus(root: string): Promise<GitStatusDto> {
    const git = simpleGit(root);
    const status = await git.status();
    const files: GitFileChangeDto[] = status.files
      .map((f) => mapFileChange(f.path, f.index, f.working_dir))
      .filter((f): f is GitFileChangeDto => f !== undefined);
    return {
      branch: status.current ?? "unknown",
      ...(status.tracking && { upstream: status.tracking }),
      ahead: status.ahead,
      behind: status.behind,
      files,
      isClean: status.isClean(),
    };
  }

  async stage(root: string, paths: string[]): Promise<void> {
    await simpleGit(root).add(paths);
  }

  async unstage(root: string, paths: string[]): Promise<void> {
    await simpleGit(root).reset(["HEAD", "--", ...paths]);
  }

  async commit(root: string, message: string): Promise<void> {
    await simpleGit(root).commit(message);
  }

  async getDiff(root: string, filePath: string, staged: boolean): Promise<string> {
    return staged
      ? simpleGit(root).diff(["--cached", "--", filePath])
      : simpleGit(root).diff(["--", filePath]);
  }

  async getBranches(root: string): Promise<GitBranchDto[]> {
    const result = await simpleGit(root).branch(["-a", "-vv"]);
    return Object.values(result.branches).map((b) => ({
      name: b.name,
      isCurrent: b.current,
      isRemote: b.name.startsWith("remotes/"),
    }));
  }

  async checkout(root: string, branch: string): Promise<void> {
    await simpleGit(root).checkout(branch);
  }

  async createBranch(root: string, name: string, checkoutAfter: boolean): Promise<void> {
    if (checkoutAfter) {
      await simpleGit(root).checkoutLocalBranch(name);
    } else {
      await simpleGit(root).branch([name]);
    }
  }

  async push(root: string, remote?: string, branch?: string): Promise<void> {
    const git = simpleGit(root);
    if (remote && branch) {
      await git.push(remote, branch);
    } else {
      await git.push();
    }
  }

  async pull(root: string): Promise<void> {
    await simpleGit(root).pull();
  }

  async fetch(root: string): Promise<void> {
    await simpleGit(root).fetch();
  }

  async getLog(root: string, maxCount = 20): Promise<GitLogEntryDto[]> {
    const log = await simpleGit(root).log({ maxCount });
    return log.all.map((c) => ({
      hash: c.hash.slice(0, 7),
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
  }
}
