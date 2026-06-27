# Git Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full git support to SPEXR IDE — native SCM panel (status, stage/unstage, commit, push/pull/fetch, branch checkout/create) plus git context injected into the Claude agent system prompt.

**Architecture:** `@theia/scm` provides the SCM panel UI automatically once a custom `ScmProvider` is registered. A new `SpexrGitBackendService` (Node, `simple-git`) is exposed via JSON-RPC and consumed by both the frontend `SpexrGitScmProvider` and by `SpexrAgentBackendService` (which appends a git summary to the Claude system prompt). File watching uses Theia's `FileSystemWatcher` (frontend), debounced 200ms.

**Tech Stack:** `@theia/scm@^1.71.0`, `simple-git@^3.27.0`, Inversify DI, Theia JSON-RPC over WebSocket, `vitest` for Node-side tests.

## Global Constraints

- All Theia deps pinned to `^1.71.0` to match existing workspace.
- ESM-style imports with `.js` extension (e.g. `'./foo.js'` even for `.ts` files).
- `@theia/core/shared/inversify` for all Inversify imports, not `inversify` directly.
- No `any` — explicit types everywhere.
- `vitest` test framework — `describe`, `it`, `expect` from `'vitest'`.
- Run `pnpm typecheck` and `pnpm test` from workspace root after each task.

---

### Task 1: Install dependencies

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `packages/theia-extensions/package.json`

**Interfaces:**
- Produces: `@theia/scm` and `simple-git` available for import in subsequent tasks.

- [ ] **Step 1: Add `@theia/scm` to desktop app**

In `apps/desktop/package.json`, under `"dependencies"`, after `"@theia/filesystem": "^1.71.0",` add:

```json
"@theia/scm": "^1.71.0",
```

(Already partially done — verify it's present. If `@theia/git` is present, remove it.)

- [ ] **Step 2: Add `@theia/scm` and `simple-git` to theia-extensions**

In `packages/theia-extensions/package.json`, under `"dependencies"`, after `"@theia/filesystem": "^1.71.0",` add:

```json
"@theia/scm": "^1.71.0",
"simple-git": "^3.27.0",
```

- [ ] **Step 3: Install**

```bash
pnpm install
```

Expected: resolves without error. `@theia/scm@1.71.x` and `simple-git@3.x.x` appear in lockfile.

- [ ] **Step 4: Verify baseline build**

```bash
pnpm typecheck
```

Expected: passes (no new errors).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/package.json packages/theia-extensions/package.json pnpm-lock.yaml
git commit -m "chore(deps): add @theia/scm and simple-git for git support"
```

---

### Task 2: Git RPC protocol

**Files:**
- Create: `packages/theia-extensions/src/common/git-protocol.ts`

**Interfaces:**
- Produces: `GIT_SERVICE_PATH`, `GitFileState`, `GitFileChangeDto`, `GitStatusDto`, `GitBranchDto`, `GitLogEntryDto`, `SpexrGitService` — all used by Tasks 3, 4, and 5.

- [ ] **Step 1: Create the file**

Create `packages/theia-extensions/src/common/git-protocol.ts`:

```typescript
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
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @spexr/theia-extensions typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/theia-extensions/src/common/git-protocol.ts
git commit -m "feat(git): add RPC protocol types and SpexrGitService interface"
```

---

### Task 3: Backend git service

**Files:**
- Create: `packages/theia-extensions/src/node/spexr-git-backend-service.ts`
- Create: `packages/theia-extensions/src/node/spexr-git-backend-service.test.ts`
- Modify: `packages/theia-extensions/src/node/spexr-backend-module.ts`

**Interfaces:**
- Consumes: `GIT_SERVICE_PATH`, `SpexrGitService`, `GitStatusDto`, `GitFileChangeDto`, `GitFileState` from `'../common/git-protocol.js'`.
- Produces: `SpexrGitBackendService` class (injectable singleton, implements `SpexrGitService`).

- [ ] **Step 1: Write the failing tests**

Create `packages/theia-extensions/src/node/spexr-git-backend-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { SpexrGitBackendService } from "./spexr-git-backend-service.js";

describe("SpexrGitBackendService", () => {
  let tmpDir: string;
  let service: SpexrGitBackendService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spexr-git-test-"));
    execSync("git init", { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, "README.md"), "init");
    execSync("git add README.md", { cwd: tmpDir });
    execSync('git commit -m "init"', { cwd: tmpDir });
    service = new SpexrGitBackendService();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getStatus: returns clean state on fresh repo", async () => {
    const status = await service.getStatus(tmpDir);
    expect(status.isClean).toBe(true);
    expect(status.files).toHaveLength(0);
    expect(typeof status.branch).toBe("string");
    expect(status.branch.length).toBeGreaterThan(0);
  });

  it("getStatus: detects untracked file", async () => {
    fs.writeFileSync(path.join(tmpDir, "new.txt"), "hello");
    const status = await service.getStatus(tmpDir);
    expect(status.isClean).toBe(false);
    const f = status.files.find((x) => x.path === "new.txt");
    expect(f).toBeDefined();
    expect(f!.unstagedState).toBe("U");
    expect(f!.stagedState).toBeUndefined();
  });

  it("stage: moves untracked file to staged (A)", async () => {
    fs.writeFileSync(path.join(tmpDir, "new.txt"), "hello");
    await service.stage(tmpDir, ["new.txt"]);
    const status = await service.getStatus(tmpDir);
    const f = status.files.find((x) => x.path === "new.txt");
    expect(f?.stagedState).toBe("A");
  });

  it("unstage: reverts staged new file back to untracked", async () => {
    fs.writeFileSync(path.join(tmpDir, "new.txt"), "hello");
    await service.stage(tmpDir, ["new.txt"]);
    await service.unstage(tmpDir, ["new.txt"]);
    const status = await service.getStatus(tmpDir);
    const f = status.files.find((x) => x.path === "new.txt");
    expect(f?.stagedState).toBeUndefined();
    expect(f?.unstagedState).toBe("U");
  });

  it("commit: staged file produces clean status", async () => {
    fs.writeFileSync(path.join(tmpDir, "new.txt"), "hello");
    await service.stage(tmpDir, ["new.txt"]);
    await service.commit(tmpDir, "test commit");
    const status = await service.getStatus(tmpDir);
    expect(status.isClean).toBe(true);
  });

  it("getDiff: returns diff for unstaged modification", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "changed content");
    const diff = await service.getDiff(tmpDir, "README.md", false);
    expect(diff).toContain("-init");
    expect(diff).toContain("+changed content");
  });

  it("getDiff: returns diff for staged modification", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "staged change");
    await service.stage(tmpDir, ["README.md"]);
    const diff = await service.getDiff(tmpDir, "README.md", true);
    expect(diff).toContain("+staged change");
  });

  it("getLog: returns at least the initial commit", async () => {
    const log = await service.getLog(tmpDir, 5);
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0].message).toBe("init");
    expect(log[0].hash).toHaveLength(7);
  });

  it("getBranches: returns current branch", async () => {
    const branches = await service.getBranches(tmpDir);
    const current = branches.find((b) => b.isCurrent);
    expect(current).toBeDefined();
    expect(current!.isRemote).toBe(false);
  });

  it("createBranch + checkout: switches to new branch", async () => {
    await service.createBranch(tmpDir, "feature/test", true);
    const status = await service.getStatus(tmpDir);
    expect(status.branch).toBe("feature/test");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter @spexr/theia-extensions test
```

Expected: FAIL with "Cannot find module './spexr-git-backend-service.js'"

- [ ] **Step 3: Implement `SpexrGitBackendService`**

Create `packages/theia-extensions/src/node/spexr-git-backend-service.ts`:

```typescript
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
  return { path: filePath, stagedState, unstagedState };
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
      upstream: status.tracking ?? undefined,
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter @spexr/theia-extensions test
```

Expected: all `SpexrGitBackendService` tests PASS. Existing `stripFrontmatter` tests also pass.

- [ ] **Step 5: Register in backend module**

Edit `packages/theia-extensions/src/node/spexr-backend-module.ts` — replace the entire file:

```typescript
import { ContainerModule } from "@theia/core/shared/inversify";
import { ConnectionHandler, RpcConnectionHandler } from "@theia/core/lib/common/messaging";
import { AGENT_SESSION_SERVICE_PATH } from "../common/agent-protocol.js";
import { GIT_SERVICE_PATH } from "../common/git-protocol.js";
import { SpexrAgentBackendService } from "./spexr-agent-backend-service.js";
import { SpexrGitBackendService } from "./spexr-git-backend-service.js";

export default new ContainerModule((bind) => {
  bind(SpexrAgentBackendService).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrAgentBackendService);
      return new RpcConnectionHandler(AGENT_SESSION_SERVICE_PATH, () => service);
    })
    .inSingletonScope();

  bind(SpexrGitBackendService).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrGitBackendService);
      return new RpcConnectionHandler(GIT_SERVICE_PATH, () => service);
    })
    .inSingletonScope();
});
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @spexr/theia-extensions typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/theia-extensions/src/node/spexr-git-backend-service.ts \
        packages/theia-extensions/src/node/spexr-git-backend-service.test.ts \
        packages/theia-extensions/src/node/spexr-backend-module.ts
git commit -m "feat(git): implement SpexrGitBackendService with simple-git and register RPC handler"
```

---

### Task 4: Agent context — inject git status into system prompt

**Files:**
- Modify: `packages/theia-extensions/src/node/spexr-agent-backend-service.ts`

**Interfaces:**
- Consumes: `SpexrGitBackendService` from `'./spexr-git-backend-service.js'`; `GitStatusDto` from `'../common/git-protocol.js'`.
- Produces: `buildLaunchContext` appends a `## Git Status` section to the system prompt when the workspace is a git repo.

- [ ] **Step 1: Add `inject` import and inject `SpexrGitBackendService`**

In `packages/theia-extensions/src/node/spexr-agent-backend-service.ts`:

Change line 1 from:
```typescript
import { injectable } from "@theia/core/shared/inversify";
```
to:
```typescript
import { injectable, inject } from "@theia/core/shared/inversify";
```

Add import after the existing `@spexr/*` imports:
```typescript
import { SpexrGitBackendService } from "./spexr-git-backend-service.js";
import type { GitStatusDto } from "../common/git-protocol.js";
```

Add the injected property inside `SpexrAgentBackendService` class, before the first method:
```typescript
@inject(SpexrGitBackendService)
private readonly gitService!: SpexrGitBackendService;
```

- [ ] **Step 2: Add `formatGitContext` helper function**

Add this module-level function at the bottom of the file (before the last `}`), after the `warnIfVersionCheckFails` function:

```typescript
export function formatGitContext(status: GitStatusDto): string {
  const staged = status.files.filter((f) => f.stagedState).length;
  const modified = status.files.filter(
    (f) => f.unstagedState && f.unstagedState !== "U",
  ).length;
  const untracked = status.files.filter((f) => f.unstagedState === "U").length;

  const header = `Git: branch=${status.branch}${status.upstream ? `, upstream=${status.upstream}` : ""}, ahead=${status.ahead}, behind=${status.behind}`;
  if (staged === 0 && modified === 0 && untracked === 0) {
    return header + "\nWorking tree clean.";
  }
  const parts = [
    staged > 0 ? `Staged: ${staged} file${staged !== 1 ? "s" : ""}` : "",
    modified > 0 ? `Modified: ${modified} file${modified !== 1 ? "s" : ""}` : "",
    untracked > 0 ? `Untracked: ${untracked} file${untracked !== 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  return header + "\n" + parts.join(" | ");
}
```

- [ ] **Step 3: Update `buildLaunchContext` to append git context**

Find this block inside `buildLaunchContext` (lines ~70–73):
```typescript
      const tmpFile = path.join(os.tmpdir(), `spexr-system-prompt-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, prompt, "utf8");

      return { appendSystemPromptFile: tmpFile };
```

Replace with:
```typescript
      let gitSection = "";
      try {
        const gitStatus = await this.gitService.getStatus(workspaceRoot);
        gitSection = `\n\n## Git Status\n\n${formatGitContext(gitStatus)}`;
      } catch {
        // Non-git workspace: skip silently
      }

      const tmpFile = path.join(os.tmpdir(), `spexr-system-prompt-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, prompt + gitSection, "utf8");

      return { appendSystemPromptFile: tmpFile };
```

- [ ] **Step 4: Add test for `formatGitContext`**

Add to `packages/theia-extensions/src/node/spexr-agent-backend-service.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { stripFrontmatter, formatGitContext } from "./spexr-agent-backend-service.js";
import type { GitStatusDto } from "../common/git-protocol.js";

// ... existing stripFrontmatter tests ...

describe("formatGitContext", () => {
  it("shows clean when no files changed", () => {
    const status: GitStatusDto = {
      branch: "main", ahead: 0, behind: 0, files: [], isClean: true,
    };
    const result = formatGitContext(status);
    expect(result).toContain("branch=main");
    expect(result).toContain("Working tree clean.");
  });

  it("shows staged/modified/untracked counts", () => {
    const status: GitStatusDto = {
      branch: "feat/x", upstream: "origin/feat/x", ahead: 1, behind: 0,
      isClean: false,
      files: [
        { path: "a.ts", stagedState: "A" },
        { path: "b.ts", unstagedState: "M" },
        { path: "c.ts", unstagedState: "U" },
      ],
    };
    const result = formatGitContext(status);
    expect(result).toContain("branch=feat/x");
    expect(result).toContain("upstream=origin/feat/x");
    expect(result).toContain("ahead=1");
    expect(result).toContain("Staged: 1 file");
    expect(result).toContain("Modified: 1 file");
    expect(result).toContain("Untracked: 1 file");
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @spexr/theia-extensions test
```

Expected: all tests pass including new `formatGitContext` tests.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @spexr/theia-extensions typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/theia-extensions/src/node/spexr-agent-backend-service.ts \
        packages/theia-extensions/src/node/spexr-agent-backend-service.test.ts
git commit -m "feat(git): inject git status into Claude agent system prompt"
```

---

### Task 5: Frontend SCM provider, proxy, commands, and DI wiring

**Files:**
- Create: `packages/theia-extensions/src/browser/scm/git-service-proxy.ts`
- Create: `packages/theia-extensions/src/browser/scm/git-scm-provider.ts`
- Create: `packages/theia-extensions/src/browser/scm/git-commands-contribution.ts`
- Modify: `packages/theia-extensions/src/browser/spexr-frontend-module.ts`

**Interfaces:**
- Consumes: `GIT_SERVICE_PATH`, `SpexrGitService`, `GitFileState`, `GitFileChangeDto` from `'../../common/git-protocol.js'`.
- Produces: `SpexrGitScmProvider` (singleton, `FrontendApplicationContribution`), `SpexrGitCommandsContribution` (singleton, `CommandContribution`).

- [ ] **Step 1: Create `git-service-proxy.ts`**

Create `packages/theia-extensions/src/browser/scm/git-service-proxy.ts`:

```typescript
import { GIT_SERVICE_PATH } from "../../common/git-protocol.js";

export { GIT_SERVICE_PATH };
export const SpexrGitServiceProxySymbol = Symbol("SpexrGitServiceProxy");
```

- [ ] **Step 2: Create `git-scm-provider.ts`**

Create `packages/theia-extensions/src/browser/scm/git-scm-provider.ts`:

```typescript
import { injectable, inject } from "@theia/core/shared/inversify";
import { Emitter, DisposableCollection } from "@theia/core";
import type { Event } from "@theia/core";
import { FrontendApplicationContribution } from "@theia/core/lib/browser";
import URI from "@theia/core/lib/common/uri";
import { FileSystemWatcher } from "@theia/filesystem/lib/browser/filesystem-watcher";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { MessageService } from "@theia/core/lib/common/message-service";
import { ScmService } from "@theia/scm/lib/browser/scm-service";
import type {
  ScmProvider,
  ScmResourceGroup,
  ScmResource,
  ScmResourceDecorations,
} from "@theia/scm/lib/browser/scm-provider";
import { SpexrGitServiceProxySymbol } from "./git-service-proxy.js";
import type { SpexrGitService, GitFileState, GitFileChangeDto } from "../../common/git-protocol.js";

const STATE_LETTER: Record<GitFileState, string> = {
  A: "A", M: "M", D: "D", R: "R", U: "U", C: "C",
};

class GitScmResource implements ScmResource {
  constructor(
    readonly group: ScmResourceGroup,
    readonly sourceUri: URI,
    readonly decorations: ScmResourceDecorations,
  ) {}

  async open(): Promise<void> {
    // No-op for v1: clicking a file in the SCM panel opens it via Theia default.
  }
}

class GitScmResourceGroup implements ScmResourceGroup {
  private _resources: ScmResource[] = [];
  private readonly _onDidChangeEmitter = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChangeEmitter.event;
  hideWhenEmpty = false;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly provider: ScmProvider,
  ) {}

  get resources(): ScmResource[] {
    return this._resources;
  }

  updateResources(resources: ScmResource[]): void {
    this._resources = resources;
    this._onDidChangeEmitter.fire();
  }

  dispose(): void {
    this._onDidChangeEmitter.dispose();
  }
}

@injectable()
export class SpexrGitScmProvider implements ScmProvider, FrontendApplicationContribution {
  readonly id = "spexr-git";
  readonly label = "Git";

  @inject(SpexrGitServiceProxySymbol)
  private readonly gitService!: SpexrGitService;

  @inject(ScmService)
  private readonly scmService!: ScmService;

  @inject(FileSystemWatcher)
  private readonly fileSystemWatcher!: FileSystemWatcher;

  @inject(WorkspaceService)
  private readonly workspaceService!: WorkspaceService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  private readonly _onDidChangeEmitter = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChangeEmitter.event;

  private readonly indexGroup = new GitScmResourceGroup("index", "Staged Changes", this);
  private readonly workingTreeGroup = new GitScmResourceGroup("workingTree", "Changes", this);

  private readonly toDispose = new DisposableCollection();
  private rootPath: string | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  /** Commit message typed in the SCM panel input box. */
  commitTemplate = "";
  readonly acceptInputCommand = { id: "spexr.git.commitFromPanel", title: "Commit" };

  get groups(): ScmResourceGroup[] {
    return [this.indexGroup, this.workingTreeGroup];
  }

  get rootUri(): string | undefined {
    return this.rootPath ? new URI(this.rootPath).withScheme("file").toString() : undefined;
  }

  async onStart(): Promise<void> {
    const roots = this.workspaceService.tryGetRoots();
    if (roots.length === 0) return;
    this.rootPath = roots[0].resource.path.toString();

    this.toDispose.push(this.scmService.registerScmProvider(this));
    this.toDispose.push(
      this.fileSystemWatcher.onFilesChanged(() => this.scheduleRefresh()),
    );

    await this.refresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 200);
  }

  async refresh(): Promise<void> {
    if (!this.rootPath) return;
    try {
      const status = await this.gitService.getStatus(this.rootPath);
      const root = this.rootPath;

      const staged = status.files
        .filter((f): f is GitFileChangeDto & { stagedState: GitFileState } => f.stagedState !== undefined)
        .map(
          (f) =>
            new GitScmResource(this.indexGroup, buildFileUri(root, f.path), {
              letter: STATE_LETTER[f.stagedState],
              tooltip: stateLabel(f.stagedState),
            }),
        );

      const unstaged = status.files
        .filter((f): f is GitFileChangeDto & { unstagedState: GitFileState } => f.unstagedState !== undefined)
        .map(
          (f) =>
            new GitScmResource(this.workingTreeGroup, buildFileUri(root, f.path), {
              letter: STATE_LETTER[f.unstagedState],
              tooltip: stateLabel(f.unstagedState),
            }),
        );

      this.indexGroup.updateResources(staged);
      this.workingTreeGroup.updateResources(unstaged);
      this._onDidChangeEmitter.fire();
    } catch {
      // Non-git workspace: clear groups silently.
      this.indexGroup.updateResources([]);
      this.workingTreeGroup.updateResources([]);
    }
  }

  async getOriginalResource(_uri: URI): Promise<URI | undefined> {
    return undefined;
  }

  // --- Operations called by git-commands-contribution.ts ---

  async stage(paths: string[]): Promise<void> {
    if (!this.rootPath) return;
    await this.gitService.stage(this.rootPath, paths);
    await this.refresh();
  }

  async unstage(paths: string[]): Promise<void> {
    if (!this.rootPath) return;
    await this.gitService.unstage(this.rootPath, paths);
    await this.refresh();
  }

  async commit(message: string): Promise<void> {
    if (!this.rootPath) return;
    if (!message.trim()) throw new Error("Commit message cannot be empty.");
    await this.gitService.commit(this.rootPath, message);
    await this.refresh();
  }

  async push(remote?: string, branch?: string): Promise<void> {
    if (!this.rootPath) return;
    await this.gitService.push(this.rootPath, remote, branch);
    await this.refresh();
  }

  async pull(): Promise<void> {
    if (!this.rootPath) return;
    await this.gitService.pull(this.rootPath);
    await this.refresh();
  }

  async fetch(): Promise<void> {
    if (!this.rootPath) return;
    await this.gitService.fetch(this.rootPath);
  }

  async checkout(branch: string): Promise<void> {
    if (!this.rootPath) return;
    await this.gitService.checkout(this.rootPath, branch);
    await this.refresh();
  }

  async createBranch(name: string, checkoutAfter: boolean): Promise<void> {
    if (!this.rootPath) return;
    await this.gitService.createBranch(this.rootPath, name, checkoutAfter);
    await this.refresh();
  }

  async getBranches(): Promise<import("../../common/git-protocol.js").GitBranchDto[]> {
    if (!this.rootPath) return [];
    return this.gitService.getBranches(this.rootPath);
  }

  async showError(message: string): Promise<void> {
    await this.messages.error(message);
  }

  dispose(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.toDispose.dispose();
    this._onDidChangeEmitter.dispose();
    this.indexGroup.dispose();
    this.workingTreeGroup.dispose();
  }
}

function buildFileUri(root: string, filePath: string): URI {
  return new URI(`file://${root}/${filePath}`);
}

function stateLabel(state: GitFileState): string {
  const labels: Record<GitFileState, string> = {
    A: "Added", M: "Modified", D: "Deleted",
    R: "Renamed", U: "Untracked", C: "Conflicted",
  };
  return labels[state];
}
```

- [ ] **Step 3: Create `git-commands-contribution.ts`**

Create `packages/theia-extensions/src/browser/scm/git-commands-contribution.ts`:

```typescript
import { injectable, inject } from "@theia/core/shared/inversify";
import {
  type CommandContribution,
  type CommandRegistry,
  type Command,
  MessageService,
} from "@theia/core";
import { QuickInputService } from "@theia/core/lib/browser";
import { SpexrGitScmProvider } from "./git-scm-provider.js";

export const GitCommands = {
  STAGE_ALL: { id: "spexr.git.stageAll", label: "Git: Stage All Changes" } satisfies Command,
  UNSTAGE_ALL: { id: "spexr.git.unstageAll", label: "Git: Unstage All Changes" } satisfies Command,
  COMMIT: { id: "spexr.git.commit", label: "Git: Commit Staged Changes" } satisfies Command,
  COMMIT_FROM_PANEL: { id: "spexr.git.commitFromPanel", label: "Commit" } satisfies Command,
  PUSH: { id: "spexr.git.push", label: "Git: Push" } satisfies Command,
  PULL: { id: "spexr.git.pull", label: "Git: Pull" } satisfies Command,
  FETCH: { id: "spexr.git.fetch", label: "Git: Fetch" } satisfies Command,
  CHECKOUT: { id: "spexr.git.checkout", label: "Git: Checkout Branch" } satisfies Command,
  CREATE_BRANCH: { id: "spexr.git.createBranch", label: "Git: Create Branch" } satisfies Command,
} as const;

@injectable()
export class SpexrGitCommandsContribution implements CommandContribution {
  @inject(SpexrGitScmProvider)
  private readonly provider!: SpexrGitScmProvider;

  @inject(QuickInputService)
  private readonly quickInput!: QuickInputService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(GitCommands.STAGE_ALL, {
      execute: () => this.runGitOp(() => this.stageAll()),
    });
    commands.registerCommand(GitCommands.UNSTAGE_ALL, {
      execute: () => this.runGitOp(() => this.unstageAll()),
    });
    commands.registerCommand(GitCommands.COMMIT, {
      execute: () => this.runGitOp(() => this.promptCommit()),
    });
    commands.registerCommand(GitCommands.COMMIT_FROM_PANEL, {
      execute: (message: unknown) =>
        this.runGitOp(() =>
          this.provider.commit(typeof message === "string" ? message : ""),
        ),
    });
    commands.registerCommand(GitCommands.PUSH, {
      execute: () => this.runGitOp(() => this.provider.push()),
    });
    commands.registerCommand(GitCommands.PULL, {
      execute: () => this.runGitOp(() => this.provider.pull()),
    });
    commands.registerCommand(GitCommands.FETCH, {
      execute: () => this.runGitOp(() => this.provider.fetch()),
    });
    commands.registerCommand(GitCommands.CHECKOUT, {
      execute: () => this.runGitOp(() => this.promptCheckout()),
    });
    commands.registerCommand(GitCommands.CREATE_BRANCH, {
      execute: () => this.runGitOp(() => this.promptCreateBranch()),
    });
  }

  private async stageAll(): Promise<void> {
    const paths = this.provider.groups
      .find((g) => g.id === "workingTree")
      ?.resources.map((r) => r.sourceUri.path.toString()) ?? [];
    if (paths.length === 0) return;
    await this.provider.stage(paths);
  }

  private async unstageAll(): Promise<void> {
    const paths = this.provider.groups
      .find((g) => g.id === "index")
      ?.resources.map((r) => r.sourceUri.path.toString()) ?? [];
    if (paths.length === 0) return;
    await this.provider.unstage(paths);
  }

  private async promptCommit(): Promise<void> {
    const message = await this.quickInput.input({
      prompt: "Commit message",
      placeHolder: "feat: describe your change",
      validateInput: (v) =>
        v.trim().length > 0
          ? Promise.resolve(undefined)
          : Promise.resolve("Commit message cannot be empty."),
    });
    if (!message) return;
    await this.provider.commit(message);
    this.messages.info("Changes committed.");
  }

  private async promptCheckout(): Promise<void> {
    const branches = await this.provider.getBranches();
    const items = branches
      .filter((b) => !b.isRemote)
      .map((b) => ({ label: b.name, description: b.isCurrent ? "(current)" : "" }));
    const picked = await this.quickInput.pick(items, { placeHolder: "Select branch to checkout" });
    if (!picked) return;
    await this.provider.checkout(picked.label);
    this.messages.info(`Checked out branch: ${picked.label}`);
  }

  private async promptCreateBranch(): Promise<void> {
    const name = await this.quickInput.input({
      prompt: "New branch name",
      placeHolder: "feat/my-feature",
      validateInput: (v) =>
        /^[a-zA-Z0-9_\-./]+$/.test(v.trim()) && v.trim().length > 0
          ? Promise.resolve(undefined)
          : Promise.resolve("Use alphanumeric characters, hyphens, underscores, dots, or slashes."),
    });
    if (!name) return;
    await this.provider.createBranch(name.trim(), true);
    this.messages.info(`Created and checked out branch: ${name.trim()}`);
  }

  private async runGitOp(op: () => Promise<void>): Promise<void> {
    try {
      await op();
    } catch (err) {
      await this.provider.showError(
        `Git operation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
```

- [ ] **Step 4: Register everything in `spexr-frontend-module.ts`**

Add these imports at the top of `packages/theia-extensions/src/browser/spexr-frontend-module.ts` (after the existing imports):

```typescript
import { WebSocketConnectionProvider } from "@theia/core/lib/browser/messaging/ws-connection-provider";
import { ScmService } from "@theia/scm/lib/browser/scm-service";
import { SpexrGitScmProvider } from "./scm/git-scm-provider.js";
import { SpexrGitServiceProxySymbol, GIT_SERVICE_PATH } from "./scm/git-service-proxy.js";
import { SpexrGitCommandsContribution } from "./scm/git-commands-contribution.js";
```

Note: `WebSocketConnectionProvider` is already imported in the file — do not duplicate it.

Add these bindings inside the `ContainerModule` callback, before the final `});`:

```typescript
  // --- Git SCM ---
  bind(SpexrGitServiceProxySymbol)
    .toDynamicValue((ctx) => {
      const connection = ctx.container.get(WebSocketConnectionProvider);
      return connection.createProxy(GIT_SERVICE_PATH);
    })
    .inSingletonScope();

  bind(SpexrGitScmProvider).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrGitScmProvider);

  bind(SpexrGitCommandsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(SpexrGitCommandsContribution);
```

Also add `ScmService` binding. **Check first if `ScmService` is already bound by `@theia/scm`'s own module** — if it is (it will be, since `@theia/scm` is a Theia extension), do NOT rebind it. The `inject(ScmService)` in `SpexrGitScmProvider` will resolve automatically.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @spexr/theia-extensions typecheck
```

Expected: no errors. If `@theia/scm` types are missing, verify `@theia/scm` is in `theia-extensions/package.json` deps (Task 1).

- [ ] **Step 6: Commit**

```bash
git add packages/theia-extensions/src/browser/scm/ \
        packages/theia-extensions/src/browser/spexr-frontend-module.ts
git commit -m "feat(git): add SCM provider, frontend proxy, and git commands"
```

---

### Task 6: Full build and manual verification

**Files:** No new files. Verify the assembled app.

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 2: Full typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Build dev bundle**

```bash
pnpm build:dev
```

Expected: webpack completes without error. Note any bundle warnings but don't block on them.

- [ ] **Step 4: Start app and verify SCM panel**

```bash
pnpm start
```

1. Open a git repository as workspace.
2. Open the Source Control panel (View → Source Control, or the SCM icon in the left bar).
3. Verify the panel shows "Git" as the provider.
4. Create a new file — verify it appears under "Changes" (U = untracked).
5. Modify an existing tracked file — verify it appears under "Changes" (M = modified).
6. Run `Git: Stage All Changes` from the Command Palette — verify the file moves to "Staged Changes".
7. Run `Git: Commit Staged Changes` — enter a message — verify it commits and the panel clears.
8. Open a new SPEXR session (Agent terminal) and verify the system prompt file contains "## Git Status" with branch and file counts.

- [ ] **Step 5: Open a non-git folder and verify no crash**

Open a plain folder (no `.git`). The SCM panel should be empty and no errors should appear in the console.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: verify git support build and integration"
```

---

## Summary

| Task | Deliverable | Testable by |
|---|---|---|
| 1 | Dependencies installed | `pnpm install` + `pnpm typecheck` |
| 2 | Protocol types | `pnpm typecheck` |
| 3 | Backend git service | `pnpm test` (11 unit tests) |
| 4 | Agent git context | `pnpm test` (2 new unit tests) |
| 5 | Frontend SCM provider + commands | `pnpm typecheck` + manual |
| 6 | Full integration | Manual app test |
