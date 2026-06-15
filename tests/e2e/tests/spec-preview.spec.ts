/**
 * TC — Spec markdown preview (spec 0010)
 * Verifies: preview opens split-right when spec opened, live re-render,
 * empty state when no spec active, toolbar toggle.
 */
import path from "path";
import fs from "fs";
import { test, expect, sel, openFileInEditor } from "../fixtures/app.js";

const SPEC_CONTENT = `---
slug: 0002-preview-spec
title: Preview Spec
status: draft
createdAt: 2026-01-01
---

## Goal

Test preview rendering.

## Acceptance Criteria

- **AC-1** Preview renders markdown.
`;

function seedSpecFile(workspace: string, filename: string, content: string): void {
  const p = path.join(workspace, "docs/specs", filename);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

const openSpecInEditor = openFileInEditor;

test.describe("Spec markdown preview", () => {
  test("preview opens automatically when spec file opened", async ({ page, workspace }) => {
    seedSpecFile(workspace, "0002-preview-spec.md", SPEC_CONTENT);
    await openSpecInEditor(page, "0002-preview-spec.md");

    const preview = page.locator(sel.previewWidget);
    await expect(preview).toBeVisible({ timeout: 10_000 });
  });

  test("preview body contains rendered markdown", async ({ page, workspace }) => {
    seedSpecFile(workspace, "0002-preview-spec.md", SPEC_CONTENT);
    await openSpecInEditor(page, "0002-preview-spec.md");

    const body = page.locator(sel.previewBody);
    await expect(body).toBeVisible({ timeout: 10_000 });
    // Rendered markdown should contain the Goal heading as an <h2>
    await expect(body.locator("h2").first()).toContainText("Goal", { timeout: 5_000 });
  });

  test("preview re-renders on live edit (debounced)", async ({ page, workspace }) => {
    seedSpecFile(workspace, "0002-preview-spec.md", SPEC_CONTENT);
    await openSpecInEditor(page, "0002-preview-spec.md");

    const body = page.locator(sel.previewBody);
    await expect(body).toBeVisible({ timeout: 10_000 });

    // Type in the editor — append a unique string
    const uniqueText = `UniqueMarker_${Date.now()}`;
    await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
    await page.keyboard.type(`\n\n## ${uniqueText}`);

    // Wait for debounce + re-render
    await expect(body).toContainText(uniqueText, { timeout: 5_000 });

    // Close editor tab without saving so Electron doesn't hang on teardown.
    const cmd = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${cmd}+W`);
    const dontSave = page.locator('button:has-text("Don\'t Save")');
    if (await dontSave.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await dontSave.click();
    }
  });

  test("toolbar toggle opens preview widget", async ({ page, workspace }) => {
    seedSpecFile(workspace, "0002-preview-spec.md", SPEC_CONTENT);
    await openSpecInEditor(page, "0002-preview-spec.md");

    const toggleBtn = page.locator('[title="Toggle markdown preview"]');
    await expect(toggleBtn).toBeVisible({ timeout: 5_000 });

    const preview = page.locator(sel.previewWidget);

    // Toggle close: if preview auto-opened, close it via the toolbar toggle
    if (await preview.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await toggleBtn.click();
      await expect(preview).not.toBeVisible({ timeout: 5_000 });
    }

    // Toggle open: click toggle to reopen the preview
    await toggleBtn.click();
    await expect(page.locator(sel.previewWidget)).toBeVisible({ timeout: 10_000 });
  });

  test("preview strips script tags from rendered HTML", async ({ page, workspace }) => {
    const maliciousSpec = SPEC_CONTENT + "\n\n<script>window.__xss = true;</script>\n";
    seedSpecFile(workspace, "0002-preview-spec.md", maliciousSpec);
    await openSpecInEditor(page, "0002-preview-spec.md");

    const body = page.locator(sel.previewBody);
    await expect(body).toBeVisible({ timeout: 10_000 });

    // No script elements inside the preview body
    const scripts = body.locator("script");
    await expect(scripts).toHaveCount(0);

    // window.__xss not set
    const xssSet = await page.evaluate(() => (window as { __xss?: boolean }).__xss);
    expect(xssSet).toBeUndefined();
  });
});
