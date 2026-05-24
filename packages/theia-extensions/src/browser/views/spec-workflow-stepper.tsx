import * as React from "react";
import {
  WORKFLOW_STEP_HINT,
  WORKFLOW_STEP_LABEL,
  WORKFLOW_STEP_ORDER,
  type WorkflowProgress,
  type WorkflowStep,
} from "@spexr/spec";

export interface SpecWorkflowStepperProps {
  readonly progress: WorkflowProgress;
  readonly onStepClick: (step: WorkflowStep) => void;
  readonly busy?: boolean;
}

export const SpecWorkflowStepper: React.FC<SpecWorkflowStepperProps> = ({
  progress,
  onStepClick,
  busy = false,
}) => (
  <ol className="spexr-stepper" role="list" aria-label="Spec workflow">
    {WORKFLOW_STEP_ORDER.map((step, index) => {
      const state = progress.stateByStep[step];
      const label = WORKFLOW_STEP_LABEL[step];
      const hint = WORKFLOW_STEP_HINT[step];
      return (
        <li key={step} className={`spexr-stepper__item spexr-stepper__item--${state}`}>
          <button
            type="button"
            className="spexr-stepper__btn"
            onClick={() => onStepClick(step)}
            disabled={busy}
            aria-current={state === "current" ? "step" : undefined}
            aria-label={`${label} — ${hint}`}
            title={hint}
          >
            <span className="spexr-stepper__num" aria-hidden>
              {state === "done" ? "✓" : String(index + 1)}
            </span>
            <span className="spexr-stepper__label">{label}</span>
          </button>
        </li>
      );
    })}
  </ol>
);

export interface WorkspaceProgressBarProps {
  readonly percent: number;
  readonly specCount: number;
}

export const WorkspaceProgressBar: React.FC<WorkspaceProgressBarProps> = ({
  percent,
  specCount,
}) => (
  <div className="spexr-progress" role="group" aria-label="Workspace workflow progression">
    <div className="spexr-progress__head">
      <span className="spexr-progress__label">Workspace progression</span>
      <span className="spexr-progress__value">
        {percent}% · {specCount} {specCount === 1 ? "spec" : "specs"}
      </span>
    </div>
    <div
      className="spexr-progress__bar"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="spexr-progress__fill" style={{ width: `${percent}%` }} />
    </div>
  </div>
);
