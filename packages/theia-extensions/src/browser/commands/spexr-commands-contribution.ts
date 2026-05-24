import { injectable, inject, optional } from "@theia/core/shared/inversify";
import {
  type CommandContribution,
  type CommandRegistry,
  type Command,
  type MenuContribution,
  type MenuModelRegistry,
  MessageService,
} from "@theia/core";
import { CommonMenus, ConfirmDialog, QuickInputService } from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { EditorManager } from "@theia/editor/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileDialogService } from "@theia/filesystem/lib/browser/file-dialog/file-dialog-service";
import URI from "@theia/core/lib/common/uri";
import {
  computeProgress,
  parseSpec,
  patchFrontmatter,
  persistedStateForStep,
  resolveCurrentStep,
  StructuralDriftDetector,
  WORKFLOW_STEP_LABEL,
  WORKFLOW_STEP_ORDER,
  type DriftReport,
  type WorkflowStep,
} from "@spexr/spec";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";
import { SpexrShellLayoutContribution } from "../shell/spexr-shell-layout-contribution.js";
import { memoryDir, specsDir, specContextDir, agentsDir } from "../workspace-paths.js";
import { serializeExpertFile } from "../views/experts-format.js";
import { SpexrAgentServiceProxy } from "../agent/agent-service-proxy.js";
import type { SpexrAgentService, ExpertAgentDto } from "../../common/agent-protocol.js";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { PreferenceScope } from "@theia/core/lib/common/preferences/preference-scope";
import { SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE } from "../preferences/spexr-preferences.js";

export const SpexrCommands = {
  CREATE_SPEC: { id: "spexr.spec.create", label: "Spexr: Create new spec" } satisfies Command,
  NEW_PROJECT: { id: "spexr.project.new", label: "Spexr: New project" } satisfies Command,
  SPEC_HANDOFF: {
    id: "spexr.spec.handoff",
    label: "Spexr: Send spec to agent",
  } satisfies Command,
  SPEC_OPEN: {
    id: "spexr.spec.open",
    label: "Spexr: Open spec",
  } satisfies Command,
  SPEC_ADD_CONTEXT: {
    id: "spexr.spec.context.add",
    label: "Spexr: Add context to spec",
  } satisfies Command,
  RESET_LAYOUT: {
    id: "spexr.layout.reset",
    label: "Spexr: Reset layout",
  } satisfies Command,
  SPEC_DELETE: {
    id: "spexr.spec.delete",
    label: "Spexr: Delete spec",
  } satisfies Command,
  MEMORY_ADD: {
    id: "spexr.memory.add",
    label: "Spexr: Add memory",
  } satisfies Command,
  MEMORY_OPEN: {
    id: "spexr.memory.open",
    label: "Spexr: Open memory",
  } satisfies Command,
  MEMORY_DELETE: {
    id: "spexr.memory.delete",
    label: "Spexr: Delete memory",
  } satisfies Command,
  SPEC_WORKFLOW_ACTION: {
    id: "spexr.spec.workflow.action",
    label: "Spexr: Run spec workflow step",
  } satisfies Command,
  CLAUDE_TOGGLE_EXPAND: {
    id: "spexr.claude.toggleExpand",
    label: nls.localize("spexr/agent/expandTerminal", "Expand terminal"),
  } satisfies Command,
  CLAUDE_FOCUS: {
    id: "spexr.claude.focus",
    label: "Spexr: Talk to the agent",
  } satisfies Command,
  MEMORY_LINK: {
    id: "spexr.memory.link",
    label: "Spexr: Link project memory to agent",
  } satisfies Command,
  MEMORY_UNLINK: {
    id: "spexr.memory.unlink",
    label: "Spexr: Unlink project memory from agent",
  } satisfies Command,
  MEMORY_RESOLVE_CONFLICT: {
    id: "spexr.memory.resolveConflict",
    label: "Spexr: Resolve memory link conflict",
  } satisfies Command,
  EXPERT_ADD: {
    id: "spexr.experts.add",
    label: "Spexr: Add expert to project",
  } satisfies Command,
  EXPERT_REMOVE: {
    id: "spexr.experts.remove",
    label: "Spexr: Remove expert from project",
  } satisfies Command,
  EXPERT_START: {
    id: "spexr.experts.start",
    label: "Spexr: Start session with expert",
  } satisfies Command,
  EXPERT_DEACTIVATE: {
    id: "spexr.experts.deactivate",
    label: "Spexr: Deactivate expert",
  } satisfies Command,
  EXPERT_KICKOFF: {
    id: "spexr.experts.kickoff",
    label: "Spexr: Run expert kickoff prompt",
  } satisfies Command,
} as const;

const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
type MemoryType = (typeof MEMORY_TYPES)[number];

const MEMORY_TYPE_DESCRIPTIONS: Record<MemoryType, string> = {
  user: "Who the user is, how they work",
  feedback: "Corrections, validated approaches",
  project: "Ongoing work, deadlines, motivations",
  reference: "Where to look — external systems, dashboards",
};

const MEMORY_TEMPLATE = (
  name: string,
  description: string,
  type: MemoryType,
) => `---
name: ${name}
description: ${description}
type: ${type}
---

`;

const SPEC_FILE_RE = /^(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/;
const URL_RE = /^https?:\/\/\S+$/i;

const SPEC_TEMPLATE = (slug: string, title: string, today: string) => `---
slug: ${slug}
title: ${title}
status: draft
createdAt: ${today}
---

## Goal

Describe the user-facing outcome this spec delivers.

## Non-goals

-

## Acceptance Criteria

- **AC-1**

## Notes
`;

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

type WorkflowPromptBuilder = (slug: string, specBody: string, driftBlock: string) => string;

const WORKFLOW_PROMPTS: Record<WorkflowStep, WorkflowPromptBuilder> = {
  specify: (slug, specBody) =>
    `Help me refine spec ${slug}. Review the current draft, suggest missing acceptance criteria, tighten goal/non-goals.\n\n---\n${specBody}`,
  context: (slug) =>
    `I'm gathering reference material for spec ${slug}. Ask me which files or URLs are relevant; I'll attach them via "Add context".`,
  clarify: (slug, specBody) =>
    `Spec ${slug} needs clarification before planning. List 5–10 open questions on the acceptance criteria below. For each, propose an answer using any context under docs/specs/.context/${slug}/. Write the final Q&A to docs/specs/.context/${slug}/clarifications.md so the next step can reference it.\n\n---\n${specBody}`,
  plan: (slug, specBody) =>
    `Draft an implementation plan for spec ${slug}. Output a markdown table with columns: step, description, AC covered, files touched. Then a numbered task list. Do not write code yet.\n\n---\n${specBody}`,
  implement: (slug, specBody) =>
    `Execute the plan for spec ${slug}. Edit files as needed; reference AC IDs in each commit message and include a \`Spec: ${slug}\` trailer. Stop after each logical chunk for review.\n\n---\n${specBody}`,
  validate: (slug, specBody, driftBlock) =>
    `Validate spec ${slug}. For each acceptance criterion below, verify the current code satisfies it. Run tests if available. Report pass/fail per AC and list remaining gaps.\n\n${driftBlock}\n\n---\n${specBody}`,
  ship: (slug, specBody) =>
    `Prepare to ship spec ${slug}. Draft a PR title (≤70 chars) and body summarizing the change, AC covered, and test plan. End with \`Spec: ${slug}\` trailer. Do not push.\n\n---\n${specBody}`,
};

@injectable()
export class SpexrCommandsContribution implements CommandContribution, MenuContribution {
  @inject(QuickInputService)
  private readonly quickInput!: QuickInputService;

  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(FileDialogService)
  private readonly fileDialog!: FileDialogService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  @inject(ClaudeTerminalManager)
  private readonly claudeTerminal!: ClaudeTerminalManager;

  @inject(EditorManager)
  private readonly editorManager!: EditorManager;

  @inject(SpexrShellLayoutContribution)
  private readonly shellLayout!: SpexrShellLayoutContribution;

  @optional()
  @inject(SpexrAgentServiceProxy)
  private readonly agentService!: SpexrAgentService | undefined;

  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(SpexrCommands.CREATE_SPEC, {
      execute: () => this.createSpec(),
    });
    commands.registerCommand(SpexrCommands.NEW_PROJECT, {
      execute: () => this.newProject(),
    });
    commands.registerCommand(SpexrCommands.SPEC_HANDOFF, {
      execute: (raw: unknown) => this.handoffSpec(this.resolveSpecUri(raw)),
    });
    commands.registerCommand(SpexrCommands.SPEC_OPEN, {
      execute: (raw: unknown) => this.openSpec(this.resolveSpecUri(raw)),
    });
    commands.registerCommand(SpexrCommands.SPEC_ADD_CONTEXT, {
      execute: (raw: unknown) => this.addSpecContext(this.resolveSpecUri(raw)),
    });
    commands.registerCommand(SpexrCommands.RESET_LAYOUT, {
      execute: () => this.resetLayout(),
    });
    commands.registerCommand(SpexrCommands.SPEC_DELETE, {
      execute: (raw: unknown) => this.deleteSpec(this.resolveSpecUri(raw)),
    });
    commands.registerCommand(SpexrCommands.MEMORY_ADD, {
      execute: () => this.addMemory(),
    });
    commands.registerCommand(SpexrCommands.MEMORY_OPEN, {
      execute: (raw: unknown) => this.openMemory(this.resolveMemoryUri(raw)),
    });
    commands.registerCommand(SpexrCommands.MEMORY_DELETE, {
      execute: (raw: unknown) => this.deleteMemory(this.resolveMemoryUri(raw)),
    });
    commands.registerCommand(SpexrCommands.SPEC_WORKFLOW_ACTION, {
      execute: (rawUri: unknown, rawStep: unknown) =>
        this.runWorkflowStep(this.resolveSpecUri(rawUri), this.coerceWorkflowStep(rawStep)),
    });
    commands.registerCommand(SpexrCommands.CLAUDE_TOGGLE_EXPAND, {
      execute: () => this.toggleClaudeExpand(),
    });
    commands.registerCommand(SpexrCommands.CLAUDE_FOCUS, {
      execute: () => this.claudeTerminal.ensureStarted(),
    });
    commands.registerCommand(SpexrCommands.MEMORY_LINK, {
      execute: () => this.linkMemory(),
    });
    commands.registerCommand(SpexrCommands.MEMORY_UNLINK, {
      execute: () => this.unlinkMemory(),
    });
    commands.registerCommand(SpexrCommands.MEMORY_RESOLVE_CONFLICT, {
      execute: () => this.resolveMemoryConflict(),
    });
    commands.registerCommand(SpexrCommands.EXPERT_ADD, {
      execute: (raw: unknown) => this.addExpert(raw),
    });
    commands.registerCommand(SpexrCommands.EXPERT_REMOVE, {
      execute: (raw: unknown) => this.removeExpert(typeof raw === "string" ? raw : undefined),
    });
    commands.registerCommand(SpexrCommands.EXPERT_START, {
      execute: (raw: unknown) => this.startExpert(raw),
    });
    commands.registerCommand(SpexrCommands.EXPERT_DEACTIVATE, {
      execute: () => this.deactivateExpert(),
    });
    commands.registerCommand(SpexrCommands.EXPERT_KICKOFF, {
      execute: (raw: unknown) => this.kickoffExpert(raw),
    });
  }

  private coerceWorkflowStep(raw: unknown): WorkflowStep | undefined {
    if (typeof raw !== "string") return undefined;
    if (raw in WORKFLOW_STEP_LABEL) return raw as WorkflowStep;
    return undefined;
  }

  private async runWorkflowStep(
    uri: URI | undefined,
    step: WorkflowStep | undefined,
  ): Promise<void> {
    if (!uri || !step) {
      this.messages.warn("Workflow action requires a spec and a step.");
      return;
    }

    try {
      const file = await this.fileService.read(uri);
      const spec = parseSpec(file.value, uri.toString());
      const signals = await this.loadWorkflowSignals(uri, spec.frontmatter.slug);
      const currentStep = resolveCurrentStep(spec.frontmatter, signals);
      const progress = computeProgress(currentStep);
      if (progress.stateByStep[step] === "pending") {
        this.warnDependency(step, currentStep);
        return;
      }

      if (step === "specify") {
        await this.openSpec(uri);
        await this.persistStep(uri, step);
        return;
      }
      if (step === "context") {
        await this.persistStep(uri, step);
        await this.addSpecContext(uri);
        return;
      }

      const drift = step === "validate" ? await this.runDrift(spec) : undefined;
      const prompt = this.buildWorkflowPrompt(step, spec.frontmatter.slug, spec.raw, drift);
      await this.claudeTerminal.ensureStarted();
      this.claudeTerminal.send(prompt.body + "\n");
      await this.claudeTerminal.reveal();
      await this.persistStep(uri, step);
      this.messages.info(`Sent ${WORKFLOW_STEP_LABEL[step]} prompt for ${spec.frontmatter.slug}.`);
    } catch (err) {
      console.error("[spexr] runWorkflowStep failed", err);
      this.messages.error(
        `Workflow step failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private warnDependency(target: WorkflowStep, currentStep: WorkflowStep | "done"): void {
    const targetLabel = WORKFLOW_STEP_LABEL[target];
    if (currentStep === "done") {
      this.messages.warn(`Cannot start "${targetLabel}" — spec is already complete.`);
      return;
    }
    const targetIdx = WORKFLOW_STEP_ORDER.indexOf(target);
    const currentIdx = WORKFLOW_STEP_ORDER.indexOf(currentStep);
    const missing = WORKFLOW_STEP_ORDER.slice(currentIdx, targetIdx)
      .map((s) => WORKFLOW_STEP_LABEL[s])
      .join(", ");
    this.messages.warn(
      `Cannot start "${targetLabel}" — complete previous step${missing.includes(",") ? "s" : ""} first: ${missing}.`,
    );
  }

  private async loadWorkflowSignals(
    specUri: URI,
    slug: string,
  ): Promise<{ hasContext: boolean; hasClarifications: boolean }> {
    const specsDir = specUri.parent;
    const contextDir = specsDir.resolve(".context").resolve(slug);
    const hasContext = await this.hasAnyEntry(contextDir);
    const hasClarifications = await this.exists(contextDir.resolve("clarifications.md"));
    return { hasContext, hasClarifications };
  }

  private async hasAnyEntry(dir: URI): Promise<boolean> {
    try {
      const stat = await this.fileService.resolve(dir);
      return (stat.children?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  private async runDrift(spec: ReturnType<typeof parseSpec>): Promise<DriftReport> {
    const detector = new StructuralDriftDetector();
    return detector.evaluate(spec);
  }

  private async persistStep(uri: URI, step: WorkflowStep): Promise<void> {
    try {
      const current = await this.fileService.read(uri);
      const persisted = persistedStateForStep(step);
      const today = new Date().toISOString().slice(0, 10);
      const next = patchFrontmatter(current.value, {
        ...(persisted.status ? { status: persisted.status } : {}),
        workflowStep: persisted.workflowStep,
        updatedAt: today,
      });
      if (next !== current.value) {
        await this.fileService.write(uri, next);
      }
    } catch (err) {
      console.error("[spexr] persistStep failed", err);
    }
  }

  private buildWorkflowPrompt(
    step: WorkflowStep,
    slug: string,
    specBody: string,
    drift: DriftReport | undefined,
  ): { title: string; body: string } {
    const driftBlock = drift ? this.formatDrift(drift) : "";
    const title = `${WORKFLOW_STEP_LABEL[step]} — ${slug}`;
    const body = WORKFLOW_PROMPTS[step](slug, specBody, driftBlock);
    return { title, body };
  }

  private formatDrift(report: DriftReport): string {
    if (report.findings.length === 0) return "Drift detector: no findings.";
    const lines = report.findings.map(
      (f) => `- [${f.severity}] ${f.criterionId}: ${f.message}${f.suggestion ? ` — ${f.suggestion}` : ""}`,
    );
    return `Drift detector findings:\n${lines.join("\n")}`;
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.VIEW_LAYOUT, {
      commandId: SpexrCommands.RESET_LAYOUT.id,
      label: "Reset Layout",
      order: "z_spexr_reset",
    });
    menus.registerMenuAction(CommonMenus.VIEW_LAYOUT, {
      commandId: SpexrCommands.MEMORY_LINK.id,
      label: "Link project memory to agent",
      order: "z_spexr_memory_link",
    });
    menus.registerMenuAction(CommonMenus.VIEW_LAYOUT, {
      commandId: SpexrCommands.MEMORY_UNLINK.id,
      label: "Unlink project memory from agent",
      order: "z_spexr_memory_unlink",
    });
    menus.registerMenuAction(CommonMenus.VIEW_LAYOUT, {
      commandId: SpexrCommands.MEMORY_RESOLVE_CONFLICT.id,
      label: "Resolve memory link conflict",
      order: "z_spexr_memory_resolve",
    });
  }

  private async deleteSpec(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Delete spec requires a file URI.");
      return;
    }
    const filename = uri.path.base;
    const slug = this.specSlug(uri);
    const root = this.workspaceRoot();
    const contextDir =
      root && slug ? specContextDir(root, slug) : undefined;
    const hasContext = contextDir ? await this.exists(contextDir) : false;

    const detail = hasContext
      ? `Also deletes context folder docs/specs/.context/${slug}/. This cannot be undone.`
      : "This cannot be undone.";
    const confirmed = await new ConfirmDialog({
      title: `Delete ${filename}?`,
      msg: detail,
      ok: "Delete",
      cancel: "Cancel",
    }).open();
    if (!confirmed) return;

    try {
      await this.fileService.delete(uri, { useTrash: false, recursive: false });
      if (contextDir && hasContext) {
        await this.fileService.delete(contextDir, { useTrash: false, recursive: true });
      }
      this.messages.info(`Deleted ${filename}.`);
    } catch (err) {
      console.error("[spexr] deleteSpec failed", err);
      this.messages.error(
        `Delete spec failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async toggleClaudeExpand(): Promise<void> {
    await this.claudeTerminal.toggleExpand();
  }

  private async linkMemory(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) {
      this.messages.warn("Open a workspace before linking project memory.");
      return;
    }
    const workspaceRoot = root.path.toString();
    await this.claudeTerminal.linkMemory(workspaceRoot);
    this.messages.info("Project memory linked to Claude agent.");
  }

  private async unlinkMemory(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) {
      this.messages.warn("Open a workspace before unlinking project memory.");
      return;
    }
    const workspaceRoot = root.path.toString();
    const configDir = this.claudeTerminal.currentConfigDir();
    const slug = workspaceRoot.replace(/[^a-zA-Z0-9]/g, "-");
    const configRoot = configDir ?? "~/.claude";
    const target = `${configRoot}/projects/${slug}/memory`;
    const confirmed = await new ConfirmDialog({
      title: "Unlink project memory?",
      msg: [
        `This removes the link at ${target} so the Claude session for this account`,
        `stops reading ${workspaceRoot}/docs/memory.`,
        "Your memory files are NOT deleted — only the symlink is removed.",
        "You can re-link anytime.",
      ].join(" "),
      ok: "Unlink",
      cancel: "Cancel",
      maxWidth: 480,
    }).open();
    if (!confirmed) return;
    await this.claudeTerminal.unlinkMemory(workspaceRoot);
    this.messages.info("Project memory unlinked from Claude agent.");
  }

  private async resolveMemoryConflict(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) {
      this.messages.warn("Open a workspace before resolving a memory conflict.");
      return;
    }
    const workspaceRoot = root.path.toString();
    const configDir = this.claudeTerminal.currentConfigDir();
    const slug = workspaceRoot.replace(/[^a-zA-Z0-9]/g, "-");
    const configRoot = configDir ?? "~/.claude";
    const target = `${configRoot}/projects/${slug}/memory`;
    const confirmed = await new ConfirmDialog({
      title: "Resolve memory link conflict?",
      msg: [
        `Claude already keeps memory at ${target}.`,
        "Resolving moves that existing folder aside to a timestamped backup",
        "(nothing is deleted) and links SPEXR's docs/memory in its place.",
        "You can merge the backup manually afterwards.",
      ].join(" "),
      ok: "Resolve & link",
      cancel: "Cancel",
      maxWidth: 480,
    }).open();
    if (!confirmed) return;
    await this.claudeTerminal.resolveMemoryConflict(workspaceRoot);
    this.messages.info("Project memory linked. Any existing memory was backed up alongside it.");
  }

  private isExpertDto(raw: unknown): raw is ExpertAgentDto {
    return (
      typeof raw === "object" &&
      raw !== null &&
      typeof (raw as ExpertAgentDto).id === "string" &&
      typeof (raw as ExpertAgentDto).systemPrompt === "string"
    );
  }

  private async addExpert(raw: unknown): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) {
      this.messages.warn("Open a workspace before adding an expert.");
      return;
    }
    if (!this.isExpertDto(raw)) {
      this.messages.warn("Add expert requires an expert definition.");
      return;
    }
    try {
      const dir = agentsDir(root);
      await this.ensureDir(dir);
      const fileUri = dir.resolve(`${raw.id}.md`);
      const content = serializeExpertFile({
        id: raw.id,
        name: raw.name,
        icon: raw.icon,
        color: raw.color,
        systemPrompt: raw.systemPrompt,
        ...(raw.model ? { model: raw.model } : {}),
      });
      await this.fileService.create(fileUri, content, { overwrite: true });
      this.messages.info(`Added expert ${raw.name} to the project.`);
    } catch (err) {
      console.error("[spexr] addExpert failed", err);
      this.messages.error(
        `Add expert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async removeExpert(id: string | undefined): Promise<void> {
    const root = this.workspaceRoot();
    if (!root || !id) {
      this.messages.warn("Remove expert requires a workspace and an expert id.");
      return;
    }
    const fileUri = agentsDir(root).resolve(`${id}.md`);
    const confirmed = await new ConfirmDialog({
      title: `Remove expert "${id}"?`,
      msg: "This deletes the persona file from docs/agents/. You can add it again from the marketplace.",
      ok: "Remove",
      cancel: "Cancel",
      maxWidth: 480,
    }).open();
    if (!confirmed) return;
    try {
      await this.fileService.delete(fileUri, { useTrash: false, recursive: false });
      const active = this.preferences.get<string>(SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE) ?? "";
      if (active === id) {
        await this.preferences.set(
          SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE,
          "",
          PreferenceScope.Folder,
          root.toString(),
        );
      }
      this.messages.info(`Removed expert "${id}".`);
    } catch (err) {
      console.error("[spexr] removeExpert failed", err);
      this.messages.error(
        `Remove expert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async startExpert(raw: unknown): Promise<void> {
    if (!this.isExpertDto(raw)) {
      this.messages.warn("Start expert requires an expert definition.");
      return;
    }
    try {
      await this.claudeTerminal.startWithExpert({ id: raw.id, name: raw.name, icon: raw.icon });
      this.messages.info(`Started session as ${raw.name}.`);
      if (raw.kickoffPrompt) await this.sendKickoff(raw.kickoffPrompt);
    } catch (err) {
      console.error("[spexr] startExpert failed", err);
      this.messages.error(
        `Start expert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Re-run an expert's kickoff prompt against the already-running session. */
  private async kickoffExpert(raw: unknown): Promise<void> {
    if (!this.isExpertDto(raw) || !raw.kickoffPrompt) {
      this.messages.warn("This expert has no kickoff prompt.");
      return;
    }
    try {
      await this.claudeTerminal.reveal();
      await this.sendKickoff(raw.kickoffPrompt);
    } catch (err) {
      console.error("[spexr] kickoffExpert failed", err);
      this.messages.error(
        `Run kickoff failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Type a kickoff prompt into the running session and submit it.
   *
   * The claude TUI treats a single stdin chunk as a paste, so a trailing "\r"
   * only inserts a newline. Send the text, then the Enter keystroke separately
   * once the paste has been processed, so it submits.
   */
  private async sendKickoff(prompt: string): Promise<void> {
    await this.claudeTerminal.whenReady();
    this.claudeTerminal.send(prompt);
    await new Promise((resolve) => setTimeout(resolve, 200));
    this.claudeTerminal.send("\r");
  }

  private async deactivateExpert(): Promise<void> {
    try {
      await this.claudeTerminal.deactivateExpert();
      this.messages.info("Expert deactivated. Running the base agent.");
    } catch (err) {
      console.error("[spexr] deactivateExpert failed", err);
      this.messages.error(
        `Deactivate expert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async resetLayout(): Promise<void> {
    try {
      await this.shellLayout.resetLayout();
      this.messages.info("Layout reset to defaults.");
    } catch (err) {
      console.error("[spexr] resetLayout failed", err);
      this.messages.error(
        `Reset layout failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handoffSpec(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Spec handoff requires a spec file URI.");
      return;
    }
    try {
      const content = await this.fileService.read(uri);
      const title = uri.path.base.replace(/\.md$/, "");
      await this.claudeTerminal.ensureStarted();
      this.claudeTerminal.send(content.value + "\n");
      await this.claudeTerminal.reveal();
      this.messages.info(`Sent ${title} to agent.`);
    } catch (err) {
      console.error("[spexr] handoffSpec failed", err);
      this.messages.error(
        `Spec handoff failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async openSpec(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Open spec requires a file URI.");
      return;
    }
    try {
      await this.editorManager.open(uri, { mode: "activate", preview: false });
    } catch (err) {
      console.error("[spexr] openSpec failed", err);
      this.messages.error(
        `Open spec failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async addSpecContext(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Add context requires a spec URI.");
      return;
    }
    const root = this.workspaceRoot();
    if (!root) {
      this.messages.warn("Open a workspace before adding spec context.");
      return;
    }
    const slug = this.specSlug(uri);
    if (!slug) {
      this.messages.warn("Spec filename must match NNNN-slug.md.");
      return;
    }
    const choice = await this.quickInput.pick(
      [
        { label: "From file…", description: "Copy local files into the spec context folder" },
        { label: "From URL…", description: "Append a link to _links.md" },
      ],
      { placeHolder: "Add spec context" },
    );
    if (!choice) return;

    const contextDir = specContextDir(root, slug);
    await this.ensureDir(contextDir);

    if (choice.label === "From file…") {
      await this.addContextFromFiles(contextDir);
    } else {
      await this.addContextFromUrl(contextDir);
    }
  }

  private async addContextFromFiles(contextDir: URI): Promise<void> {
    const picked = await this.fileDialog.showOpenDialog({
      title: "Pick context files for the spec",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
    });
    if (!picked) return;
    const sources = Array.isArray(picked) ? picked : [picked];
    if (sources.length === 0) return;

    const copied: string[] = [];
    for (const source of sources) {
      try {
        const buffer = await this.fileService.readFile(source);
        const target = await this.uniqueTarget(contextDir, source.path.base);
        await this.fileService.createFile(target, buffer.value, { overwrite: false });
        copied.push(target.path.base);
      } catch (err) {
        console.error("[spexr] addContextFromFiles failed for", source.toString(), err);
        this.messages.error(
          `Could not copy ${source.path.base}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (copied.length > 0) {
      this.messages.info(`Added ${copied.length} context file(s): ${copied.join(", ")}`);
    }
  }

  private async addContextFromUrl(contextDir: URI): Promise<void> {
    const url = await this.quickInput.input({
      prompt: "Context URL (https://…)",
      placeHolder: "https://example.com/brief",
      validateInput: (value) =>
        URL_RE.test(value.trim())
          ? Promise.resolve(undefined)
          : Promise.resolve("Enter a valid http(s) URL."),
    });
    if (!url) return;
    const label = await this.quickInput.input({
      prompt: "Short label (optional)",
      placeHolder: "Customer kickoff brief",
    });
    if (label === undefined) return;

    const linksUri = contextDir.resolve("_links.md");
    const today = new Date().toISOString().slice(0, 10);
    const display = label.trim().length > 0 ? label.trim() : url.trim();
    const line = `- [${display}](${url.trim()}) — ${today}\n`;
    await this.appendOrCreate(linksUri, "# Context links\n\n", line);
    this.messages.info(`Added link to ${linksUri.path.base}`);
  }

  private async appendOrCreate(uri: URI, header: string, line: string): Promise<void> {
    if (await this.exists(uri)) {
      const current = await this.fileService.read(uri);
      const next = current.value.endsWith("\n") ? current.value + line : current.value + "\n" + line;
      await this.fileService.write(uri, next);
      return;
    }
    await this.fileService.create(uri, header + line);
  }

  private async uniqueTarget(dir: URI, filename: string): Promise<URI> {
    let target = dir.resolve(filename);
    if (!(await this.exists(target))) return target;
    const dot = filename.lastIndexOf(".");
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : "";
    let i = 2;
    while (true) {
      target = dir.resolve(`${stem}-${i}${ext}`);
      if (!(await this.exists(target))) return target;
      i += 1;
    }
  }

  private async ensureDir(uri: URI): Promise<void> {
    if (!(await this.exists(uri))) {
      await this.fileService.createFolder(uri);
    }
  }

  private specSlug(uri: URI): string | undefined {
    const match = uri.path.base.match(SPEC_FILE_RE);
    if (!match) return undefined;
    return `${match[1]}-${match[2]}`;
  }

  isSpecUri(uri: URI | undefined): boolean {
    if (!uri) return false;
    const root = this.workspaceRoot();
    if (!root) return false;
    if (uri.scheme !== root.scheme) return false;
    const specsRoot = specsDir(root);
    const isUnderSpecs = uri.toString().startsWith(specsRoot.toString() + "/");
    return isUnderSpecs && SPEC_FILE_RE.test(uri.path.base);
  }

  resolveSpecUri(raw: unknown): URI | undefined {
    if (raw instanceof URI) return raw;
    if (typeof raw === "string") return new URI(raw);
    if (raw && typeof raw === "object") {
      const widget = raw as { getResourceUri?: () => URI | undefined };
      if (typeof widget.getResourceUri === "function") {
        return widget.getResourceUri();
      }
      const candidate = String(raw);
      if (candidate.startsWith("file:")) return new URI(candidate);
    }
    return undefined;
  }

  private async createSpec(): Promise<void> {
    try {
      const root = await this.resolveSpecTarget();
      if (!root) return;
      console.log("[spexr] createSpec target", root.uri.toString(), "openAfter", root.openAfter);

      const slug = await this.quickInput.input({
        prompt: "Spec slug (lowercase, hyphens, e.g. user-onboarding)",
        placeHolder: "user-onboarding",
        validateInput: (value) =>
          SLUG_RE.test(value)
            ? Promise.resolve(undefined)
            : Promise.resolve("Use lowercase letters, digits, and hyphens only."),
      });
      if (!slug) return;

      const title = await this.quickInput.input({
        prompt: "Spec title (human-readable)",
        placeHolder: "User onboarding flow",
      });
      if (title === undefined) return;

      const number = await this.nextSpecNumber(root.uri);
      const padded = number.toString().padStart(4, "0");
      const filename = `${padded}-${slug}.md`;
      const fileUri = specsDir(root.uri).resolve(filename);
      const today = new Date().toISOString().slice(0, 10);
      const content = SPEC_TEMPLATE(`${padded}-${slug}`, title || slug, today);
      console.log("[spexr] createSpec writing", fileUri.toString());

      await this.scaffoldSpexrDir(root.uri);
      const stat = await this.fileService.create(fileUri, content, { overwrite: false });
      console.log("[spexr] createSpec wrote", stat.resource.toString(), "size", stat.size);
      this.messages.info(`Created ${filename}`);

      if (root.openAfter) {
        console.log("[spexr] createSpec opening workspace", root.uri.toString());
        this.workspace.open(root.uri);
      } else {
        await this.openSpec(fileUri);
      }
    } catch (err) {
      console.error("[spexr] createSpec failed", err);
      this.messages.error(
        `Create spec failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async resolveSpecTarget(): Promise<{ uri: URI; openAfter: boolean } | undefined> {
    const existing = this.workspaceRoot();
    if (existing) return { uri: existing, openAfter: false };

    const picked = await this.fileDialog.showOpenDialog({
      title: "Select folder to host the new spec",
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
    });
    if (!picked || Array.isArray(picked)) return undefined;
    return { uri: picked, openAfter: true };
  }

  private async newProject(): Promise<void> {
    const folder = await this.fileDialog.showOpenDialog({
      title: "Select folder for new SPEXR project",
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
    });
    if (!folder || Array.isArray(folder)) return;

    const target = folder;
    await this.scaffoldSpexrDir(target);
    await this.workspace.open(target);
  }

  private async scaffoldSpexrDir(root: URI): Promise<void> {
    const memDir = memoryDir(root);
    const spcsDir = specsDir(root);
    if (!(await this.exists(memDir))) {
      await this.fileService.createFolder(memDir);
    }
    if (!(await this.exists(spcsDir))) {
      await this.fileService.createFolder(spcsDir);
    }
    const indexUri = memDir.resolve("MEMORY.md");
    if (!(await this.exists(indexUri))) {
      await this.fileService.create(indexUri, "# MEMORY\n\nIndex of project memory entries.\n");
    }
  }

  private async exists(uri: URI): Promise<boolean> {
    try {
      await this.fileService.resolve(uri);
      return true;
    } catch {
      return false;
    }
  }

  private workspaceRoot(): URI | undefined {
    const roots = this.workspace.tryGetRoots();
    const first = roots[0];
    return first ? first.resource : undefined;
  }

  private async nextSpecNumber(root: URI): Promise<number> {
    const spcsDir = specsDir(root);
    try {
      const stat = await this.fileService.resolve(spcsDir);
      const used = (stat.children ?? [])
        .map((c) => c.name.match(/^(\d{4})-/)?.[1])
        .filter((s): s is string => Boolean(s))
        .map((s) => parseInt(s, 10));
      return used.length === 0 ? 1 : Math.max(...used) + 1;
    } catch {
      return 1;
    }
  }

  private async addMemory(): Promise<void> {
    try {
      const root = this.workspaceRoot();
      if (!root) {
        this.messages.warn("Open a workspace before adding a memory.");
        return;
      }

      const typeChoice = await this.quickInput.pick(
        MEMORY_TYPES.map((t) => ({ label: t, description: MEMORY_TYPE_DESCRIPTIONS[t] })),
        { placeHolder: "Pick the memory type" },
      );
      if (!typeChoice) return;
      const type = typeChoice.label as MemoryType;

      const name = await this.quickInput.input({
        prompt: "Memory name (short, human-readable)",
        placeHolder: "User role + preferences",
        validateInput: (value) =>
          value.trim().length > 0
            ? Promise.resolve(undefined)
            : Promise.resolve("Name cannot be empty."),
      });
      if (!name) return;

      const description = await this.quickInput.input({
        prompt: "One-line description (used to decide relevance later)",
        placeHolder: "Senior backend engineer, prefers terse review comments",
        validateInput: (value) =>
          value.trim().length > 0
            ? Promise.resolve(undefined)
            : Promise.resolve("Description cannot be empty."),
      });
      if (!description) return;

      await this.scaffoldSpexrDir(root);
      const memDir = memoryDir(root);
      const slug = this.slugify(name);
      const filename = `${type}-${slug}.md`;
      const fileUri = await this.uniqueTarget(memDir, filename);
      const content = MEMORY_TEMPLATE(name.trim(), description.trim(), type);
      await this.fileService.create(fileUri, content, { overwrite: false });

      await this.appendToMemoryIndex(memDir, {
        title: name.trim(),
        file: fileUri.path.base,
        hook: description.trim(),
      });

      this.messages.info(`Created memory ${fileUri.path.base}.`);
      await this.openMemory(fileUri);
    } catch (err) {
      console.error("[spexr] addMemory failed", err);
      this.messages.error(
        `Add memory failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async openMemory(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Open memory requires a file URI.");
      return;
    }
    try {
      await this.editorManager.open(uri, { mode: "activate", preview: false });
    } catch (err) {
      console.error("[spexr] openMemory failed", err);
      this.messages.error(
        `Open memory failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async deleteMemory(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Delete memory requires a file URI.");
      return;
    }
    const filename = uri.path.base;
    const confirmed = await new ConfirmDialog({
      title: `Delete ${filename}?`,
      msg: "This removes the file and its MEMORY.md index entry. This cannot be undone.",
      ok: "Delete",
      cancel: "Cancel",
    }).open();
    if (!confirmed) return;

    try {
      await this.fileService.delete(uri, { useTrash: false, recursive: false });
      const root = this.workspaceRoot();
      if (root) {
        await this.removeFromMemoryIndex(memoryDir(root), filename);
      }
      this.messages.info(`Deleted memory ${filename}.`);
    } catch (err) {
      console.error("[spexr] deleteMemory failed", err);
      this.messages.error(
        `Delete memory failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  isMemoryUri(uri: URI | undefined): boolean {
    if (!uri) return false;
    const root = this.workspaceRoot();
    if (!root) return false;
    if (uri.scheme !== root.scheme) return false;
    const memoryRoot = memoryDir(root).toString() + "/";
    if (!uri.toString().startsWith(memoryRoot)) return false;
    return uri.path.base.endsWith(".md") && uri.path.base !== "MEMORY.md";
  }

  resolveMemoryUri(raw: unknown): URI | undefined {
    if (raw instanceof URI) return raw;
    if (typeof raw === "string") return new URI(raw);
    if (raw && typeof raw === "object") {
      const widget = raw as { getResourceUri?: () => URI | undefined };
      if (typeof widget.getResourceUri === "function") {
        return widget.getResourceUri();
      }
      const candidate = String(raw);
      if (candidate.startsWith("file:")) return new URI(candidate);
    }
    return undefined;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "entry";
  }

  private async appendToMemoryIndex(
    memoryDir: URI,
    entry: { title: string; file: string; hook: string },
  ): Promise<void> {
    const indexUri = memoryDir.resolve("MEMORY.md");
    const line = `- [${entry.title}](${entry.file}) — ${entry.hook}\n`;
    if (!(await this.exists(indexUri))) {
      await this.fileService.create(
        indexUri,
        `# MEMORY\n\nIndex of project memory entries.\n\n${line}`,
      );
      return;
    }
    const current = await this.fileService.read(indexUri);
    const body = current.value.endsWith("\n") ? current.value : current.value + "\n";
    await this.fileService.write(indexUri, body + line);
  }

  private async removeFromMemoryIndex(memoryDir: URI, filename: string): Promise<void> {
    const indexUri = memoryDir.resolve("MEMORY.md");
    if (!(await this.exists(indexUri))) return;
    const current = await this.fileService.read(indexUri);
    const linkPattern = `](${filename})`;
    const next = current.value
      .split("\n")
      .filter((line) => !line.includes(linkPattern))
      .join("\n");
    if (next !== current.value) {
      await this.fileService.write(indexUri, next);
    }
  }
}
