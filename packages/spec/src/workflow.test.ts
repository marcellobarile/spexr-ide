import { describe, expect, it } from "vitest";
import {
  computeProgress,
  hasAuthoredAcceptanceCriteria,
  resolveCurrentStep,
  WORKFLOW_STEP_EXPERT,
} from "./workflow.js";
import type { AcceptanceCriterion } from "./types.js";
import type { DriftReport } from "./types.js";
import { WORKFLOW_STEP_ORDER } from "./types.js";

describe("resolveCurrentStep", () => {
  it("returns done for archived spec", () => {
    expect(
      resolveCurrentStep(
        { status: "archived" },
        { hasAcceptanceCriteria: true, hasContext: false, hasClarifications: false },
      ),
    ).toBe("done");
  });

  it("honours explicit workflowStep over derivation", () => {
    expect(
      resolveCurrentStep(
        { status: "draft", workflowStep: "plan" },
        { hasAcceptanceCriteria: true, hasContext: false, hasClarifications: false },
      ),
    ).toBe("plan");
  });

  // A persisted workflowStep must not let a draft skip specify when no real
  // acceptance criteria exist (e.g. a spec saved by a looser earlier build).
  it("clamps to specify when draft has a workflowStep but no acceptance criteria", () => {
    expect(
      resolveCurrentStep(
        { status: "draft", workflowStep: "context" },
        { hasAcceptanceCriteria: false, hasContext: true, hasClarifications: false },
      ),
    ).toBe("specify");
  });

  it("derives context when AC authored but no context yet", () => {
    expect(
      resolveCurrentStep(
        { status: "draft" },
        { hasAcceptanceCriteria: true, hasContext: false, hasClarifications: false },
      ),
    ).toBe("context");
  });

  // Regression: a fresh draft (no acceptance criteria yet) must keep "specify"
  // as the current step, not silently mark it done. The fs signal advances to
  // "context" only once real AC bullets exist.
  it("keeps specify current and context pending for a fresh draft", () => {
    const progress = computeProgress(
      resolveCurrentStep(
        { status: "draft" },
        { hasAcceptanceCriteria: false, hasContext: false, hasClarifications: false },
      ),
    );
    expect(progress.stateByStep.specify).toBe("current");
    expect(progress.stateByStep.context).toBe("pending");
  });

  it("advances specify to done once acceptance criteria are authored", () => {
    const progress = computeProgress(
      resolveCurrentStep(
        { status: "draft" },
        { hasAcceptanceCriteria: true, hasContext: false, hasClarifications: false },
      ),
    );
    expect(progress.stateByStep.specify).toBe("done");
    expect(progress.stateByStep.context).toBe("current");
  });

  it("derives clarify when context exists but no clarifications", () => {
    expect(
      resolveCurrentStep(
        { status: "draft" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: false },
      ),
    ).toBe("clarify");
  });

  it("derives plan when context + clarifications present", () => {
    expect(
      resolveCurrentStep(
        { status: "draft" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true },
      ),
    ).toBe("plan");
  });

  it("maps in-progress status to implement", () => {
    expect(
      resolveCurrentStep(
        { status: "in-progress" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true },
      ),
    ).toBe("implement");
  });

  it("maps implemented status to validate without drift report", () => {
    expect(
      resolveCurrentStep(
        { status: "implemented" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true },
      ),
    ).toBe("validate");
  });

  it("stays in validate when drift has block findings", () => {
    const driftReport: DriftReport = {
      specSlug: "0001-x",
      checkedAt: new Date().toISOString(),
      findings: [{ criterionId: "AC-1", severity: "block", message: "missing test" }],
    };
    expect(
      resolveCurrentStep(
        { status: "implemented" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true, driftReport },
      ),
    ).toBe("validate");
  });

  it("advances to ship when implemented and drift is clean", () => {
    const driftReport: DriftReport = {
      specSlug: "0001-x",
      checkedAt: new Date().toISOString(),
      findings: [],
    };
    expect(
      resolveCurrentStep(
        { status: "implemented" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true, driftReport },
      ),
    ).toBe("ship");
  });

  it("maps validated to ship", () => {
    expect(
      resolveCurrentStep(
        { status: "validated" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true },
      ),
    ).toBe("ship");
  });

  it("returns done for shipped spec", () => {
    expect(
      resolveCurrentStep(
        { status: "shipped" },
        { hasAcceptanceCriteria: true, hasContext: true, hasClarifications: true },
      ),
    ).toBe("done");
  });
});

describe("hasAuthoredAcceptanceCriteria", () => {
  const ac = (text: string): AcceptanceCriterion => ({ id: "AC-1", text });

  it("ignores the empty scaffold stub", () => {
    expect(hasAuthoredAcceptanceCriteria([ac("**AC-1**")])).toBe(false);
  });

  it("ignores blank text", () => {
    expect(hasAuthoredAcceptanceCriteria([ac("   ")])).toBe(false);
  });

  it("returns false for no criteria", () => {
    expect(hasAuthoredAcceptanceCriteria([])).toBe(false);
  });

  it("returns true once a criterion has a real description", () => {
    expect(hasAuthoredAcceptanceCriteria([ac("The user can log in")])).toBe(true);
  });
});

describe("computeProgress", () => {
  it("returns 0 for first step", () => {
    const progress = computeProgress("specify");
    expect(progress.percent).toBe(0);
    expect(progress.doneCount).toBe(0);
    expect(progress.stateByStep.specify).toBe("current");
    expect(progress.stateByStep.ship).toBe("pending");
  });

  it("marks earlier steps done", () => {
    const progress = computeProgress("implement");
    expect(progress.stateByStep.specify).toBe("done");
    expect(progress.stateByStep.plan).toBe("done");
    expect(progress.stateByStep.implement).toBe("current");
    expect(progress.stateByStep.validate).toBe("pending");
  });

  it("returns 100% when done", () => {
    const progress = computeProgress("done");
    expect(progress.percent).toBe(100);
    expect(progress.doneCount).toBe(progress.totalCount);
    expect(progress.stateByStep.ship).toBe("done");
  });
});

describe("WORKFLOW_STEP_EXPERT", () => {
  it("maps every workflow step", () => {
    for (const step of WORKFLOW_STEP_ORDER) {
      expect(step in WORKFLOW_STEP_EXPERT).toBe(true);
    }
  });

  it("maps implement to the software-engineering expert", () => {
    expect(WORKFLOW_STEP_EXPERT.implement).toBe("software-engineering");
  });
});
