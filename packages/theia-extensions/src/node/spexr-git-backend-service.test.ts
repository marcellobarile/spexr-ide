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
