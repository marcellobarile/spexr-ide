/**
 * TC-02 — Plan checklist (spec 0008)
 * Verifies: _plan.md renders as checklist, toggle persists, counter updates,
 * malformed lines tolerated, hasPlan auto-advances step.
 */
import path from "path";
import fs from "fs";
import { test, expect, sel, openSpecView, waitForSpecList } from "../fixtures/app.js";
import { contextFileExists, readWorkspaceFile } from "../fixtures/fs-helpers.js";

const PLAN_CONTENT = `---
specSlug: 0001-test-spec
generatedAt: 2026-01-01T00:00:00Z
---

- [ ] T1 (AC-1): Implement the widget
- [ ] T2 (AC-1): Write unit tests
- [x] T3 (AC-2): Update README
`;

const PLAN_WITH_MALFORMED = `---
specSlug: 0001-test-spec
generatedAt: 2026-01-01T00:00:00Z
---

- [ ] T1 (AC-1): Valid task
This line is malformed and should be ignored
- [ ] T2 (AC-2): Another valid task
`;

function seedSpec(workspace: string, slug: string, withPlan?: string): void {
  const specsDir = path.join(workspace, "docs/specs");
  const contextDir = path.join(workspace, `docs/specs/.context/${slug}`);
  fs.mkdirSync(contextDir, { recursive: true });

  fs.writeFileSync(
    path.join(specsDir, `${slug}.md`),
    `---
slug: ${slug}
title: Test Spec
status: in-progress
workflowStep: plan
createdAt: 2026-01-01
---

## Goal
Make something happen.

## Acceptance Criteria
- **AC-1** The system must do X.
- **AC-2** The system must do Y.
`,
    "utf8",
  );

  if (withPlan) {
    fs.writeFileSync(path.join(contextDir, "_plan.md"), withPlan, "utf8");
  }
}

test.describe("Plan checklist", () => {
  test("checklist renders when _plan.md exists", async ({ page, workspace }) => {
    seedSpec(workspace, "0001-test-spec", PLAN_CONTENT);
    await openSpecView(page);
    await waitForSpecList(page);

    const checklist = page.locator(sel.planChecklist);
    await expect(checklist).toBeVisible({ timeout: 8_000 });
  });

  test("header shows correct done/total count", async ({ page, workspace }) => {
    seedSpec(workspace, "0001-test-spec", PLAN_CONTENT);
    await openSpecView(page);
    await waitForSpecList(page);

    const header = page.locator(sel.planHeader);
    // 1 of 3 tasks done (T3 is [x])
    await expect(header).toContainText("1/3", { timeout: 5_000 });
  });

  test("toggling checkbox updates _plan.md and counter", async ({ page, workspace }) => {
    seedSpec(workspace, "0001-test-spec", PLAN_CONTENT);
    await openSpecView(page);
    await waitForSpecList(page);

    // Click T1 checkbox
    const t1box = page.locator(sel.planCheckbox("AC-1")).first();
    await t1box.check();

    // Wait for file to be written
    await expect
      .poll(
        () => readWorkspaceFile(workspace, "docs/specs/.context/0001-test-spec/_plan.md"),
        { timeout: 5_000 },
      )
      .toMatch(/\[x\] T1/);

    // Counter updates
    const header = page.locator(sel.planHeader);
    await expect(header).toContainText("2/3", { timeout: 5_000 });
  });

  test("malformed lines ignored, valid tasks still render", async ({ page, workspace }) => {
    seedSpec(workspace, "0001-test-spec", PLAN_WITH_MALFORMED);
    await openSpecView(page);
    await waitForSpecList(page);

    const items = page.locator(sel.planItem);
    // Only 2 valid tasks; malformed line is skipped
    await expect(items).toHaveCount(2, { timeout: 5_000 });
  });

  test("hasPlan advances workflow step from plan to implement", async ({ page, workspace }) => {
    seedSpec(workspace, "0001-test-spec", PLAN_CONTENT);
    await openSpecView(page);
    await waitForSpecList(page);

    // Step should be "implement" (auto-advanced) not "plan"
    const currentItem = page.locator(sel.stepItem("current")).first();
    await expect(currentItem).toContainText("Implement", { timeout: 5_000 });
  });

  test("no checklist when _plan.md absent", async ({ page, workspace }) => {
    seedSpec(workspace, "0001-test-spec");
    await openSpecView(page);
    await waitForSpecList(page);

    const checklist = page.locator(sel.planChecklist);
    await expect(checklist).not.toBeVisible({ timeout: 3_000 });
  });
});
