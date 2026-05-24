import type { DriftReport, SpecFrontmatter, SpecStatus, WorkflowStep } from "./types.js";
import { WORKFLOW_STEP_ORDER } from "./types.js";

export type WorkflowStepState = "done" | "current" | "pending";

export interface WorkflowSignals {
  readonly hasContext: boolean;
  readonly hasClarifications: boolean;
  readonly driftReport?: DriftReport;
}

export interface WorkflowProgress {
  readonly currentStep: WorkflowStep | "done";
  readonly stateByStep: Record<WorkflowStep, WorkflowStepState>;
  readonly doneCount: number;
  readonly totalCount: number;
  readonly percent: number;
}

export interface WorkflowAction {
  readonly type: "command" | "agent-prompt";
  readonly commandId?: string;
  readonly promptTitle?: string;
  readonly promptBody?: string;
  readonly nextStatus?: SpecStatus;
  readonly nextWorkflowStep: WorkflowStep | null;
}

const STATUS_AT_OR_AFTER: Record<SpecStatus, number> = {
  draft: 0,
  ready: 1,
  "in-progress": 2,
  implemented: 3,
  validated: 4,
  archived: 5,
};

/**
 * Compute the current workflow step for a spec, blending frontmatter signals
 * with filesystem heuristics. Explicit `workflowStep` always wins; otherwise
 * we derive from status + fs.
 */
export function resolveCurrentStep(
  frontmatter: Pick<SpecFrontmatter, "status" | "workflowStep">,
  signals: WorkflowSignals,
): WorkflowStep | "done" {
  if (frontmatter.status === "archived") return "done";
  if (frontmatter.workflowStep) return frontmatter.workflowStep;

  const statusLevel = STATUS_AT_OR_AFTER[frontmatter.status];

  if (statusLevel >= STATUS_AT_OR_AFTER.validated) return "ship";
  if (statusLevel >= STATUS_AT_OR_AFTER.implemented) return validateOrShip(signals);
  if (statusLevel >= STATUS_AT_OR_AFTER["in-progress"]) return "implement";
  if (statusLevel >= STATUS_AT_OR_AFTER.ready) return "implement";

  if (!signals.hasContext) return "context";
  if (!signals.hasClarifications) return "clarify";
  return "plan";
}

function validateOrShip(signals: WorkflowSignals): WorkflowStep {
  if (!signals.driftReport) return "validate";
  const hasBlocker = signals.driftReport.findings.some((f) => f.severity === "block");
  return hasBlocker ? "validate" : "ship";
}

export function computeProgress(currentStep: WorkflowStep | "done"): WorkflowProgress {
  const totalCount = WORKFLOW_STEP_ORDER.length;
  if (currentStep === "done") {
    const stateByStep = Object.fromEntries(
      WORKFLOW_STEP_ORDER.map((s) => [s, "done" as WorkflowStepState]),
    ) as Record<WorkflowStep, WorkflowStepState>;
    return { currentStep, stateByStep, doneCount: totalCount, totalCount, percent: 100 };
  }

  const idx = WORKFLOW_STEP_ORDER.indexOf(currentStep);
  const stateByStep = Object.fromEntries(
    WORKFLOW_STEP_ORDER.map((s, i) => {
      const state: WorkflowStepState = i < idx ? "done" : i === idx ? "current" : "pending";
      return [s, state];
    }),
  ) as Record<WorkflowStep, WorkflowStepState>;

  const percent = Math.round((idx / totalCount) * 100);
  return { currentStep, stateByStep, doneCount: idx, totalCount, percent };
}

export const WORKFLOW_STEP_LABEL: Record<WorkflowStep, string> = {
  specify: "Specify",
  context: "Context",
  clarify: "Clarify",
  plan: "Plan",
  implement: "Implement",
  validate: "Validate",
  ship: "Ship",
};

export const WORKFLOW_STEP_HINT: Record<WorkflowStep, string> = {
  specify: "Author goal, non-goals, acceptance criteria",
  context: "Attach reference files and links",
  clarify: "Resolve open AC questions with the agent",
  plan: "Draft plan steps linked to AC",
  implement: "Agent edits, you review the diff",
  validate: "Drift detector + tests check AC coverage",
  ship: "Open PR with `Spec: <slug>` trailer",
};

/**
 * Status / workflowStep that should be persisted when the user clicks a step.
 * Clicking a step means "I am starting / re-entering this step now."
 */
const STEP_PERSISTED: Record<WorkflowStep, { status?: SpecStatus; workflowStep: WorkflowStep }> = {
  specify: { status: "draft", workflowStep: "specify" },
  context: { workflowStep: "context" },
  clarify: { workflowStep: "clarify" },
  plan: { workflowStep: "plan" },
  implement: { status: "in-progress", workflowStep: "implement" },
  validate: { status: "implemented", workflowStep: "validate" },
  ship: { status: "validated", workflowStep: "ship" },
};

export function persistedStateForStep(
  step: WorkflowStep,
): { status?: SpecStatus; workflowStep: WorkflowStep } {
  return STEP_PERSISTED[step];
}
