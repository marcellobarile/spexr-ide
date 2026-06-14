/**
 * TC — Spec markdown preview (spec 0010)
 * Verifies: preview opens split-right when spec opened, live re-render,
 * empty state when no spec active, toolbar toggle.
 */
import path from "path";
import fs from "fs";
import { test, expect, sel } from "../fixtures/app.js";

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

async function openSpecInEditor(page: import("@playwright/test").Page, filename: string): Promise<void> {
  await page.keyboard.press("Meta+Shift+P");
  await page.waitForSelector(".quick-input-widget", { timeout: 5_000 });
  await page.keyboard.type("Go to File");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".quick-input-widget");
  await page.keyboard.type(filename);
  await page.keyboard.press("Enter");
}

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
    await page.keyboard.press("Meta+End");
    await page.keyboard.type(`\n\n## ${uniqueText}`);

    // Wait for debounce + re-render
    await expect(body).toContainText(uniqueText, { timeout: 5_000 });
  });

  test("toolbar toggle opens preview widget", async ({ page, workspace }) => {
    seedSpecFile(workspace, "0002-preview-spec.md", SPEC_CONTENT);
    await openSpecInEditor(page, "0002-preview-spec.md");

    // Close preview if open, then toggle it back
    const preview = page.locator(sel.previewWidget);
    if (await preview.isVisible()) {
      await preview.locator(".p-TabBar-tabCloseIcon").click();
      await expect(preview).not.toBeVisible({ timeout: 3_000 });
    }

    // Click toolbar toggle
    const toggleBtn = page.locator('[title="Toggle markdown preview"]');
    await expect(toggleBtn).toBeVisible({ timeout: 5_000 });
    await toggleBtn.click();

    await expect(page.locator(sel.previewWidget)).toBeVisible({ timeout: 5_000 });
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
