export interface PlanTask {
  readonly id: string;
  readonly acRef: string;
  readonly description: string;
  readonly done: boolean;
}

export interface SpecPlanDocument {
  readonly specSlug: string;
  readonly generatedAt: string;
  readonly tasks: readonly PlanTask[];
}

const TASK_RE = /^-\s+\[([ xX])\]\s+(T\d+)\s+\(([^)]+)\):\s+(.+)$/;
const FM_SPEC_SLUG_RE = /^specSlug:\s*(.+)$/m;
const FM_GENERATED_RE = /^generatedAt:\s*(.+)$/m;

/**
 * Parse `_plan.md` content into a structured plan document.
 * Malformed lines are skipped; valid tasks are preserved.
 */
export function parseSpecPlan(raw: string, fallbackSlug = ""): SpecPlanDocument {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  let specSlug = fallbackSlug;
  let generatedAt = "";
  if (fmMatch) {
    const fm = fmMatch[1]!;
    specSlug = fm.match(FM_SPEC_SLUG_RE)?.[1]?.trim() ?? fallbackSlug;
    generatedAt = fm.match(FM_GENERATED_RE)?.[1]?.trim() ?? "";
  }

  const tasks: PlanTask[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = TASK_RE.exec(line);
    if (!m) continue;
    tasks.push({
      id: m[2]!.trim(),
      done: m[1]! !== " ",
      acRef: m[3]!.trim(),
      description: m[4]!.trim(),
    });
  }

  return { specSlug, generatedAt, tasks };
}

/** Validate that every task references an AC id from the spec's known ids. */
export function validatePlanTasks(
  tasks: readonly PlanTask[],
  knownAcIds: readonly string[],
): Array<{ taskId: string; reason: string }> {
  const known = new Set(knownAcIds);
  return tasks
    .filter((t) => !known.has(t.acRef))
    .map((t) => ({ taskId: t.id, reason: `Unknown AC ref: ${t.acRef}` }));
}

/** Serialize a plan document back to `_plan.md` format. */
export function serializeSpecPlan(doc: SpecPlanDocument): string {
  const fm = `---\nspecSlug: ${doc.specSlug}\ngeneratedAt: ${doc.generatedAt || new Date().toISOString()}\n---`;
  if (doc.tasks.length === 0) return `${fm}\n`;
  const lines = doc.tasks.map(
    (t) => `- [${t.done ? "x" : " "}] ${t.id} (${t.acRef}): ${t.description}`,
  );
  return `${fm}\n\n${lines.join("\n")}\n`;
}

/** Return a new document with the given task's done flag toggled. */
export function togglePlanTask(doc: SpecPlanDocument, taskId: string): SpecPlanDocument {
  return {
    ...doc,
    tasks: doc.tasks.map((t) =>
      t.id === taskId ? { ...t, done: !t.done } : t,
    ),
  };
}
