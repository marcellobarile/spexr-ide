/**
 * TC-01 — Spec creation
 * Verifies: spec file created, appears in list, stepper at "Specify" step,
 * advances to "Context" once real AC authored.
 */
import { test, expect, sel, openSpecView, waitForSpecList } from "../fixtures/app.js";
import { listSpecFiles, readWorkspaceFile } from "../fixtures/fs-helpers.js";

test.describe("Spec creation", () => {
  test("creates spec file and shows it in the list", async ({ page, workspace }) => {
    await openSpecView(page);

    await page.click(sel.createBtn);

    // Spec file appears in docs/specs/
    await expect
      .poll(() => listSpecFiles(workspace).length, { timeout: 10_000 })
      .toBe(1);

    const [filename] = listSpecFiles(workspace);
    expect(filename).toMatch(/^\d{4}-[a-z0-9][a-z0-9-]*\.md$/);

    // List shows the new entry
    await waitForSpecList(page);
    const items = page.locator(sel.specItem);
    await expect(items).toHaveCount(1, { timeout: 5_000 });
  });

  test("new spec shows Specify as current step", async ({ page, workspace }) => {
    await openSpecView(page);
    await page.click(sel.createBtn);
    await waitForSpecList(page);

    const specifyStep = page.locator(sel.stepBtn("Specify"));
    await expect(specifyStep).toBeVisible({ timeout: 5_000 });

    const currentItem = page.locator(sel.stepItem("current"));
    await expect(currentItem).toContainText("Specify", { timeout: 5_000 });
  });

  test("stepper stays at Specify with placeholder AC only", async ({ page, workspace }) => {
    await openSpecView(page);
    await page.click(sel.createBtn);
    await waitForSpecList(page);

    // Scaffold file has placeholder AC — step must not advance past Specify
    const currentItem = page.locator(sel.stepItem("current")).first();
    await expect(currentItem).toContainText("Specify");
  });

  test("stepper advances to Context once real AC written", async ({ page, workspace }) => {
    await openSpecView(page);
    await page.click(sel.createBtn);
    await waitForSpecList(page);

    const [filename] = listSpecFiles(workspace);
    const slug = filename!.replace(/\.md$/, "");
    const specPath = `docs/specs/${filename}`;

    // Patch the spec file with a real AC
    const raw = readWorkspaceFile(workspace, specPath) ?? "";
    const patched = raw.replace(
      /## Acceptance Criteria[\s\S]*?(?=\n##|$)/,
      "## Acceptance Criteria\n\n- **AC-1** The system must do X when Y happens.\n",
    );
    const fs = await import("fs");
    const path = await import("path");
    fs.writeFileSync(path.join(workspace, specPath), patched, "utf8");

    // Refresh the widget
    await page.click(sel.refreshBtn);
    await page.waitForTimeout(500);

    const currentItem = page.locator(sel.stepItem("current")).first();
    await expect(currentItem).not.toContainText("Specify", { timeout: 8_000 });
  });
});
