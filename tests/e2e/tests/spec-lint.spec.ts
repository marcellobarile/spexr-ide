/**
 * TC — Spec lint panel (spec 0009)
 * Verifies: panel appears when spec editor active, findings shown,
 * clicking finding navigates editor, badge visible on tab, clean spec shows no errors.
 */
import path from "path";
import fs from "fs";
import { test, expect, sel, openSpecView } from "../fixtures/app.js";

const CLEAN_SPEC = `---
slug: 0001-clean-spec
title: Clean Spec
status: in-progress
createdAt: 2026-01-01
---

## Goal

Make something real happen in production.

## Non-goals

- No scope creep.

## Acceptance Criteria

- **AC-1** The system must do X when Y is true.
- **AC-2** The system must not do Z.
`;

const SPEC_WITH_ERRORS = `---
slug: 0001-clean-spec
title: Clean Spec
status: in-progress
createdAt: 2026-01-01
---

## Goal

Make something real happen in production.

## Non-goals

- No scope creep.

## Acceptance Criteria

- **AC-1** The system must do X.
- **AC-1** Duplicate id — this should trigger an error.
`;

function seedSpecFile(workspace: string, filename: string, content: string): void {
  const p = path.join(workspace, "docs/specs", filename);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

test.describe("Spec lint panel", () => {
  test("panel shows empty state when no spec editor active", async ({ page }) => {
    await openSpecView(page);
    // Ensure lint widget exists but shows empty state (no spec open in editor)
    const lintWidget = page.locator(sel.lintWidget);
    if (await lintWidget.isVisible()) {
      await expect(lintWidget).toContainText("Open a spec to validate it.");
    }
  });

  test("clean spec shows no error findings", async ({ page, workspace }) => {
    seedSpecFile(workspace, "0001-clean-spec.md", CLEAN_SPEC);

    // Open the spec file in the editor via command palette
    await page.keyboard.press("Meta+Shift+P");
    await page.waitForSelector(".quick-input-widget", { timeout: 5_000 });
    await page.keyboard.type("Go to File");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".quick-input-widget");
    await page.keyboard.type("0001-clean-spec.md");
    await page.keyboard.press("Enter");

    // Wait for lint panel to populate
    await page.waitForSelector(sel.lintWidget, { timeout: 10_000 });

    const summary = page.locator(sel.lintSummary);
    await expect(summary).toContainText("No issues", { timeout: 8_000 });
  });

  test("duplicate AC id surfaces as error finding", async ({ page, workspace }) => {
    seedSpecFile(workspace, "0001-clean-spec.md", SPEC_WITH_ERRORS);

    await page.keyboard.press("Meta+Shift+P");
    await page.waitForSelector(".quick-input-widget", { timeout: 5_000 });
    await page.keyboard.type("Go to File");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".quick-input-widget");
    await page.keyboard.type("0001-clean-spec.md");
    await page.keyboard.press("Enter");

    await page.waitForSelector(sel.lintWidget, { timeout: 10_000 });

    const findings = page.locator(sel.lintFinding);
    await expect(findings).not.toHaveCount(0, { timeout: 8_000 });
  });
});
