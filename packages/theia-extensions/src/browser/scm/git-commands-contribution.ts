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
