import { describe, it, expect } from "vitest";
import {
  parseSpecPlan,
  serializeSpecPlan,
  togglePlanTask,
  validatePlanTasks,
  type SpecPlanDocument,
} from "./plan.js";

const SAMPLE = `---
specSlug: 0008-plan-task-artifacts
generatedAt: 2026-06-12T10:00:00.000Z
---

- [ ] T1 (AC-1): Parse _plan.md into SpecPlanDocument
- [x] T2 (AC-1): Serialize back to markdown
- [ ] T3 (AC-2): Validate AC refs against spec
`;

// ── parseSpecPlan ──────────────────────────────────────────────────────────

describe("parseSpecPlan", () => {
  it("parses frontmatter slug and generatedAt", () => {
    const doc = parseSpecPlan(SAMPLE);
    expect(doc.specSlug).toBe("0008-plan-task-artifacts");
    expect(doc.generatedAt).toBe("2026-06-12T10:00:00.000Z");
  });

  it("parses all tasks with correct fields", () => {
    const doc = parseSpecPlan(SAMPLE);
    expect(doc.tasks).toHaveLength(3);
    expect(doc.tasks[0]).toMatchObject({ id: "T1", acRef: "AC-1", done: false });
    expect(doc.tasks[1]).toMatchObject({ id: "T2", acRef: "AC-1", done: true });
    expect(doc.tasks[2]).toMatchObject({ id: "T3", acRef: "AC-2", done: false });
  });

  it("skips malformed lines without dropping valid ones", () => {
    const raw = `---\nspecSlug: s\ngeneratedAt: g\n---\n\nnot a task line\n- [ ] T1 (AC-1): valid\n`;
    const doc = parseSpecPlan(raw);
    expect(doc.tasks).toHaveLength(1);
    expect(doc.tasks[0]!.id).toBe("T1");
  });

  it("uses fallbackSlug when frontmatter missing", () => {
    const doc = parseSpecPlan("- [ ] T1 (AC-1): task", "my-slug");
    expect(doc.specSlug).toBe("my-slug");
  });

  it("returns zero tasks for empty content", () => {
    expect(parseSpecPlan("").tasks).toHaveLength(0);
  });
});

// ── round-trip ──────────────────────────────────────────────────────────────

describe("serializeSpecPlan / round-trip", () => {
  it("round-trips without data loss", () => {
    const doc = parseSpecPlan(SAMPLE);
    const serialized = serializeSpecPlan(doc);
    const reparsed = parseSpecPlan(serialized);
    expect(reparsed.specSlug).toBe(doc.specSlug);
    expect(reparsed.generatedAt).toBe(doc.generatedAt);
    expect(reparsed.tasks).toHaveLength(doc.tasks.length);
    for (let i = 0; i < doc.tasks.length; i++) {
      expect(reparsed.tasks[i]).toMatchObject(doc.tasks[i]!);
    }
  });

  it("preserves completed tasks through toggle→serialize→parse", () => {
    const doc = parseSpecPlan(SAMPLE);
    const toggled = togglePlanTask(doc, "T1");
    const reparsed = parseSpecPlan(serializeSpecPlan(toggled));
    expect(reparsed.tasks.find((t) => t.id === "T1")!.done).toBe(true);
    expect(reparsed.tasks.find((t) => t.id === "T2")!.done).toBe(true);
  });
});

// ── togglePlanTask ──────────────────────────────────────────────────────────

describe("togglePlanTask", () => {
  it("toggles a pending task to done", () => {
    const doc = parseSpecPlan(SAMPLE);
    const updated = togglePlanTask(doc, "T1");
    expect(updated.tasks.find((t) => t.id === "T1")!.done).toBe(true);
  });

  it("toggles a done task to pending", () => {
    const doc = parseSpecPlan(SAMPLE);
    const updated = togglePlanTask(doc, "T2");
    expect(updated.tasks.find((t) => t.id === "T2")!.done).toBe(false);
  });

  it("leaves other tasks unchanged", () => {
    const doc = parseSpecPlan(SAMPLE);
    const updated = togglePlanTask(doc, "T1");
    expect(updated.tasks.find((t) => t.id === "T3")!.done).toBe(false);
  });

  it("returns unchanged document for unknown taskId", () => {
    const doc = parseSpecPlan(SAMPLE);
    const updated = togglePlanTask(doc, "T99");
    expect(updated.tasks).toEqual(doc.tasks);
  });
});

// ── validatePlanTasks ───────────────────────────────────────────────────────

describe("validatePlanTasks", () => {
  const KNOWN_ACS = ["AC-1", "AC-2", "AC-3"];

  it("returns empty for all-valid tasks", () => {
    const doc = parseSpecPlan(SAMPLE);
    expect(validatePlanTasks(doc.tasks, KNOWN_ACS)).toHaveLength(0);
  });

  it("flags tasks with unknown AC refs", () => {
    const tasks: SpecPlanDocument["tasks"] = [
      { id: "T1", acRef: "AC-1", description: "ok", done: false },
      { id: "T2", acRef: "AC-99", description: "bad ref", done: false },
    ];
    const errors = validatePlanTasks(tasks, KNOWN_ACS);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.taskId).toBe("T2");
  });
});
