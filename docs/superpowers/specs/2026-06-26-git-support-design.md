> **File purpose:** Implementation spec for git support in SPEXR IDE.
> **Audience:** Engineers implementing this feature.
> **Owner:** marcello.barile
> **Companion:** No separate solution proposal — trade-offs covered in Alternatives section.

# Git Support Design — SPEXR IDE

## Scope

Add git support to SPEXR (Theia 1.71.0 + Electron) using `@theia/scm` (native Theia SCM panel) and a custom `ScmProvider` backed by `simple-git` on the Node backend.

**In scope (v1):**
- Status, stage/unstage, commit, inline diff
- Push, pull, fetch (remote operations)
- Branch checkout + create (no delete)
- Git context injected into Claude agent system prompt

**Out of scope (v1):**
- Conflict resolution UI
- Rebase / cherry-pick
- Blame / history panel
- File-watcher upgrade to backend-push (current: Theia FileSystemWatcher frontend-side)

---

## Architecture

```
Theia SCM Panel (UI from @theia/scm — zero custom UI)
    ↑ ScmService.registerScmProvider()
git-scm-provider.ts  ←→  git-service-proxy.ts
                               ↓ JSON-RPC (/services/spexr-git)
                    spexr-git-backend-service.ts
                               ↓
                          simple-git(root)
```

Agent context flow:
```
ClaudeTerminalManager.buildLaunchContext(root)
    → SpexrGitBackendService.getStatus(root)
    → formatGitContext(status) → appended to system prompt
```

---

## Files

### New files (all under `packages/theia-extensions/src/`)

#### `common/git-protocol.ts`

RPC contract. Node-free (plain DTOs only).

```
GIT_SERVICE_PATH = "/services/spexr-git"

GitFileState = "A" | "M" | "D" | "R" | "U" | "C"

GitFileChangeDto {
  path: string
  originalPath?: string       // R only
  stagedState?: GitFileState
  unstagedState?: GitFileState
}

GitStatusDto {
  branch: string
  upstream?: string
  ahead: number
  behind: number
  files: readonly GitFileChangeDto[]
  isClean: boolean
}

GitBranchDto {
  name: string
  isCurrent: boolean
  isRemote: boolean
  upstream?: string
}

GitLogEntryDto {
  hash: string
  message: string
  author: string
  date: string
}

SpexrGitService interface {
  getStatus(root): Promise<GitStatusDto>
  stage(root, paths[]): Promise<void>
  unstage(root, paths[]): Promise<void>
  commit(root, message): Promise<void>
  getDiff(root, filePath, staged): Promise<string>
  getBranches(root): Promise<GitBranchDto[]>
  checkout(root, branch): Promise<void>
  createBranch(root, name, checkout): Promise<void>
  push(root, remote?, branch?): Promise<void>
  pull(root): Promise<void>
  fetch(root): Promise<void>
  getLog(root, maxCount?): Promise<GitLogEntryDto[]>
}
```

#### `node/spexr-git-backend-service.ts`

- `@injectable()`, no Theia deps beyond Inversify
- `simpleGit(root)` created on-demand per call (stateless — no workspace-switch issues)
- All git errors caught and rethrown as `Error` with readable message (no raw RPC crashes)
- `getStatus` maps `simple-git` `StatusResult` to `GitFileChangeDto[]`
- `getDiff(root, path, staged)`: `git.diff(['--', path])` or `git.diff(['--cached', '--', path])`
- Non-git workspace: `getStatus` throws; caller catches silently

#### `browser/scm/git-service-proxy.ts`

Mirror of `agent-service-proxy.ts`:
```typescript
export const SpexrGitServiceProxy = Symbol("SpexrGitServiceProxy");
// bound via WebSocketConnectionProvider.createProxy(GIT_SERVICE_PATH)
```

#### `browser/scm/git-scm-provider.ts`

Implements `ScmProvider` from `@theia/scm`.

**Injected:**
- `SpexrGitServiceProxy`
- `FileSystemWatcher` (`@theia/filesystem`)
- `WorkspaceService` (`@theia/workspace`)
- `ScmService` (`@theia/scm`)

**Key behaviours:**
- `id = "spexr-git"`, `label = "Git"`
- Two resource groups: `"index"` (staged) + `"workingTree"` (unstaged + untracked)
- `onStart()`: registers self with `ScmService`, sets up file watching
- File watching: `FileSystemWatcher.onFilesChanged` → debounced 200ms → `refresh()`
- Write operations (stage/unstage/commit/push/pull/fetch/checkout/createBranch): call backend, then `refresh()` immediately (no wait for watcher)
- `getOriginalResource(uri)`: calls `getDiff` to power Theia's native diff editor
- `dispose()`: clears watchers, unregisters from `ScmService`

**Commands registered in `spexr-commands-contribution.ts`:**
```
spexr.git.stage
spexr.git.unstage
spexr.git.commit
spexr.git.push
spexr.git.pull
spexr.git.fetch
spexr.git.checkout
spexr.git.createBranch
```

---

### Modified files

#### `common/agent-protocol.ts`

Add to `LaunchContextDto`:
```typescript
readonly gitContext?: string;
```

#### `node/spexr-agent-backend-service.ts`

- Inject `SpexrGitBackendService`
- In `buildLaunchContext`: call `getStatus(workspaceRoot)`, format via `formatGitContext()`, assign to `gitContext`
- Non-git workspace: catch error, leave `gitContext` undefined

`formatGitContext(status: GitStatusDto): string` output:
```
Git: branch=main, ahead=2, behind=0
Staged: 3 files | Modified: 1 file | Untracked: 2 files
```

#### `node/spexr-backend-module.ts`

Add:
```typescript
bind(SpexrGitBackendService).toSelf().inSingletonScope();
bind(ConnectionHandler)
  .toDynamicValue(ctx => new RpcConnectionHandler(
    GIT_SERVICE_PATH,
    () => ctx.container.get(SpexrGitBackendService)
  ))
  .inSingletonScope();
```

#### `browser/spexr-frontend-module.ts`

Add:
```typescript
bind(SpexrGitServiceProxy)
  .toDynamicValue(ctx =>
    ctx.container.get(WebSocketConnectionProvider).createProxy(GIT_SERVICE_PATH)
  )
  .inSingletonScope();

bind(SpexrGitScmProvider).toSelf().inSingletonScope();
bind(FrontendApplicationContribution).toService(SpexrGitScmProvider);
```

#### `packages/theia-extensions/package.json`

Add to `dependencies`:
```json
"@theia/scm": "^1.71.0",
"simple-git": "^3.27.0"
```

#### `apps/desktop/package.json`

Add to `dependencies`:
```json
"@theia/scm": "^1.71.0"
```

---

## Alternatives Considered

| Option | Dropped reason |
|---|---|
| `@theia/git@1.60.2` direct | Requires `@theia/core@1.60.2` — dual Theia install, 11 versions behind |
| `@theia/git` + pnpm overrides | API surface changed across 11 releases, high runtime crash risk |
| Extend `SpexrAgentService` | Mixes agent + git concerns; service already large |
| `@spexr/git` package | Over-engineering for v1 |
| Polling instead of file watching | CPU waste; FileSystemWatcher already available |

---

## Error Handling

- **Non-git workspace:** `getStatus` throws → `buildLaunchContext` catches silently, `gitContext` stays `undefined`; SCM provider shows empty panel
- **Remote failures** (push/pull/fetch with no remote, auth error): backend throws `Error` with git message → frontend surfaces via Theia `MessageService.showError`
- **Commit with nothing staged:** frontend validates before calling backend (staged group empty → disable commit action)

---

## Testing

- Unit: `SpexrGitBackendService` with a real temp git repo (`simple-git` creates it in `beforeAll`) — no mocks
- Test cases: status on clean repo, status with staged/unstaged files, stage/unstage round-trip, commit, getDiff staged vs unstaged
- No browser-side unit tests for `GitScmProvider` (Theia DI too heavy to mock); covered by manual integration test

---

## Follow-ups

- [ ] File-watcher upgrade: backend `chokidar` push via client notification (eliminates frontend polling entirely)
- [ ] Branch delete (with confirmation dialog)
- [ ] Stash support
- [ ] Git log panel (custom widget)
- [ ] Surface file-level diff in agent context (opt-in, token budget gated)
