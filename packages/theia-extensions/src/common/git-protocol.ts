export const GIT_SERVICE_PATH = "/services/spexr-git";

export type GitFileState = "A" | "M" | "D" | "R" | "U" | "C";

export interface GitFileChangeDto {
  readonly path: string;
  readonly originalPath?: string;
  readonly stagedState?: GitFileState;
  readonly unstagedState?: GitFileState;
}

export interface GitStatusDto {
  readonly branch: string;
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly files: readonly GitFileChangeDto[];
  readonly isClean: boolean;
}

export interface GitBranchDto {
  readonly name: string;
  readonly isCurrent: boolean;
  readonly isRemote: boolean;
  readonly upstream?: string;
}

export interface GitLogEntryDto {
  readonly hash: string;
  readonly message: string;
  readonly author: string;
  readonly date: string;
}

export interface SpexrGitService {
  getStatus(root: string): Promise<GitStatusDto>;
  stage(root: string, paths: string[]): Promise<void>;
  unstage(root: string, paths: string[]): Promise<void>;
  commit(root: string, message: string): Promise<void>;
  getDiff(root: string, filePath: string, staged: boolean): Promise<string>;
  getBranches(root: string): Promise<GitBranchDto[]>;
  checkout(root: string, branch: string): Promise<void>;
  createBranch(root: string, name: string, checkout: boolean): Promise<void>;
  push(root: string, remote?: string, branch?: string): Promise<void>;
  pull(root: string): Promise<void>;
  fetch(root: string): Promise<void>;
  getLog(root: string, maxCount?: number): Promise<GitLogEntryDto[]>;
}
