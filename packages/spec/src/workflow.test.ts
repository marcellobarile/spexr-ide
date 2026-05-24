import { describe, expect, it } from "vitest";
import { computeProgress, resolveCurrentStep } from "./workflow.js";
import type { DriftReport } from "./types.js";

describe("resolveCurrentStep", () => {
  it("returns done for archived spec", () => {
    expect(
      resolveCurrentStep(
        { status: "archived" },
        { hasContext: false, hasClarifications: false },
      ),
    ).toBe("done");
  });

  it("honours explicit workflowStep over derivation", () => {
    expect(
      resolveCurrentStep(
        { status: "draft", workflowStep: "plan" },
        { hasContext: false, hasClarifications: false },
      ),
    ).toBe("plan");
  });

  it("derives context when draft and no context yet", () => {
    expect(
      resolveCurrentStep(
        { status: "draft" },
        { hasContext: false, hasClarifications: false },
      ),
    ).toBe("context");
  });

  it("derives clarify when context exists but no clarifications", () => {
    expect(
      resolveCurrentStep(
        { status: "draft" },
        { hasContext: true, hasClarifications: false },
      ),
    ).toBe("clarify");
  });

  it("derives plan when context + clarifications present", () => {
    expect(
      resolveCurrentStep(
        { status: "draft" },
        { hasContext: true, hasClarifications: true },
      ),
    ).toBe("plan");
  });

  it("maps in-progress status to implement", () => {
    expect(
      resolveCurrentStep(
        { status: "in-progress" },
        { hasContext: true, hasClarifications: true },
      ),
    ).toBe("implement");
  });

  it("maps implemented status to validate without drift report", () => {
    expect(
      resolveCurrentStep(
        { status: "implemented" },
        { hasContext: true, hasClarifications: true },
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
        { hasContext: true, hasClarifications: true, driftReport },
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
        { hasContext: true, hasClarifications: true, driftReport },
      ),
    ).toBe("ship");
  });

  it("maps validated to ship", () => {
    expect(
      resolveCurrentStep(
        { status: "validated" },
        { hasContext: true, hasClarifications: true },
      ),
    ).toBe("ship");
  });

  it("returns done for shipped spec", () => {
    expect(
      resolveCurrentStep(
        { status: "shipped" },
        { hasContext: true, hasClarifications: true },
      ),
    ).toBe("done");
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
