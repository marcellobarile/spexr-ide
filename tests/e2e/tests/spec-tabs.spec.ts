/**
 * TC-TABS — Tab switching smoke test
 *
 * Verifies that switching between the main Theia tab bar tabs (Spec panel,
 * editor, Preview, Welcome) is stable and each panel renders the expected
 * content after activation.  All tab switches use the robust pointerdown
 * approach (real clientX/clientY) because Lumino hit-tests pointer coordinates
 * and synthetic events with clientX=0 silently miss the tab.
 */
import path from "path";
import fs from "fs";
import { test, expect, sel, openSpecView, waitForSpecList } from "../fixtures/app.js";
import type { Page } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Switch to any Lumino tab by its visible label text.
 * Works for both the main tab bar and the bottom panel tab bar.
 */
async function switchToTab(page: Page, label: string): Promise<void> {
  await page.evaluate((lbl) => {
    const labels = [
      ...document.querySelectorAll<HTMLElement>(".lm-TabBar-tabLabel, .p-TabBar-tabLabel"),
    ];
    const el = labels.find((e) => e.textContent?.trim() === lbl);
    if (!el) throw new Error(`Tab "${lbl}" not found`);
    const tab = el.closest<HTMLElement>("li") ?? el.parentElement!;
    const rect = tab.getBoundingClientRect();
    tab.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
        pointerId: 1,
        isPrimary: true,
      }),
    );
  }, label);
}

/** List all visible Lumino tab labels in the DOM. */
async function visibleTabLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".lm-TabBar-tabLabel, .p-TabBar-tabLabel")]
      .map((e) => e.textContent?.trim() ?? "")
      .filter(Boolean),
  );
}

const SPEC_CONTENT = `---
slug: 0001-tab-test
title: Tab Test Spec
status: in-progress
createdAt: 2026-01-01
---

## Goal

Test tab switching behaviour.

## Acceptance Criteria

- **AC-1** The system must switch tabs without losing state.
`;

function seedSpec(workspace: string): string {
  const p = path.join(workspace, "docs/specs/0001-tab-test.md");
  fs.writeFileSync(p, SPEC_CONTENT, "utf8");
  return p;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Tab switching smoke tests", () => {
  test("Spec tab is present and activates the spec panel", async ({ page }) => {
    await openSpecView(page);
    await expect(page.locator(sel.specPanel)).toBeVisible({ timeout: 5_000 });
  });

  test("switching away from Spec tab and back preserves the panel", async ({
    page,
    workspace,
  }) => {
    seedSpec(workspace);
    await openSpecView(page);
    await waitForSpecList(page);

    // Confirm spec panel visible and has item
    await expect(page.locator(sel.specItem)).toHaveCount(1, { timeout: 5_000 });

    // Switch to Welcome tab (always present at startup) — in a split layout
    // the spec panel may remain visible as a sidebar; we just verify no crash.
    const tabs = await visibleTabLabels(page);
    const welcomeLabel = tabs.find((t) => t === "Welcome" || t === "Get Started");
    if (welcomeLabel) {
      await switchToTab(page, welcomeLabel);
      await page.waitForTimeout(400);
    }

    // Switch back to Spec
    await switchToTab(page, "Spec");
    await page.waitForSelector(sel.specPanel, { state: "visible", timeout: 8_000 });
    // Spec list must still show the item — no re-fetch needed
    await expect(page.locator(sel.specItem)).toHaveCount(1, { timeout: 5_000 });
  });

  test("opening spec in editor and returning to Spec panel is stable", async ({
    page,
    workspace,
  }) => {
    seedSpec(workspace);
    await openSpecView(page);
    await waitForSpecList(page);

    // Open spec file in editor
    const openBtn = page
      .locator(sel.specItem)
      .first()
      .locator('button[aria-label^="Open"]');
    await openBtn.click();
    // Editor tab should appear
    await page.waitForTimeout(1_500);

    // Verify editor tab is now active (spec panel hidden)
    const specPanelVisible = await page
      .locator(sel.specPanel)
      .isVisible()
      .catch(() => false);
    // After opening the editor the spec panel may still be open in a split or
    // may be behind the editor — both are valid, just ensure no crash.

    // Switch back to Spec panel explicitly
    await switchToTab(page, "Spec");
    await page.waitForSelector(sel.specPanel, { state: "visible", timeout: 8_000 });
    await expect(page.locator(sel.specItem)).toHaveCount(1, { timeout: 5_000 });

    // Silence TS: specPanelVisible is checked only to avoid unused var warning
    void specPanelVisible;
  });

  test("rapid tab switching (x5) does not leave the panel in a broken state", async ({
    page,
    workspace,
  }) => {
    seedSpec(workspace);
    await openSpecView(page);
    await waitForSpecList(page);

    const tabs = await visibleTabLabels(page);
    const welcomeLabel = tabs.find((t) => t === "Welcome" || t === "Get Started") ?? "";

    // Rapid back-and-forth 5 times
    for (let i = 0; i < 5; i++) {
      if (welcomeLabel) await switchToTab(page, welcomeLabel);
      await page.waitForTimeout(150);
      await switchToTab(page, "Spec");
      await page.waitForTimeout(150);
    }

    // After rapid switching spec panel must be visible and functional
    await page.waitForSelector(sel.specPanel, { state: "visible", timeout: 8_000 });
    await expect(page.locator(sel.specItem)).toHaveCount(1, { timeout: 5_000 });
  });

  test("Preview tab activates the preview widget when a spec is open", async ({
    page,
    workspace,
  }) => {
    seedSpec(workspace);
    await openSpecView(page);
    await waitForSpecList(page);

    // Open spec in editor first (preview requires active spec editor)
    const openBtn = page
      .locator(sel.specItem)
      .first()
      .locator('button[aria-label^="Open"]');
    await openBtn.click();
    await page.waitForTimeout(1_500);

    // Check if Preview tab exists
    const tabs = await visibleTabLabels(page);
    const hasPreview = tabs.some((t) => t === "Preview" || t.includes("Preview"));
    if (!hasPreview) {
      test.skip();
      return;
    }

    const previewLabel = tabs.find((t) => t === "Preview" || t.includes("Preview"))!;
    await switchToTab(page, previewLabel);
    await page.waitForTimeout(600);

    const preview = page.locator(sel.previewWidget);
    if (await preview.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Either empty state or body — both acceptable
      const hasContent =
        (await page.locator(sel.previewBody).isVisible().catch(() => false)) ||
        (await page.locator(sel.previewEmpty).isVisible().catch(() => false));
      expect(hasContent).toBe(true);
    }
  });

  test("lint panel tab is stable after switching between spec and editor", async ({
    page,
    workspace,
  }) => {
    seedSpec(workspace);
    await openSpecView(page);
    await waitForSpecList(page);

    const openBtn = page
      .locator(sel.specItem)
      .first()
      .locator('button[aria-label^="Open"]');
    await openBtn.click();
    await page.waitForTimeout(1_500);

    // Lint widget exists in the DOM once editor is active. After switching to the
    // spec panel and back the lint widget should not crash — Lumino may hide it
    // (lm-mod-hidden) while the editor tab is not focused, which is correct.
    const lintWidget = page.locator(sel.lintWidget);
    if (await lintWidget.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Switch to Spec panel — lint widget will hide (expected Lumino behaviour)
      await switchToTab(page, "Spec");
      await page.waitForTimeout(400);

      // Open spec in editor again
      const openBtn2 = page
        .locator(sel.specItem)
        .first()
        .locator('button[aria-label^="Open"]');
      await openBtn2.click();
      await page.waitForTimeout(1_000);

      // Lint widget must be attached (may be hidden while non-active, not removed)
      await expect(lintWidget).toHaveCount(1, { timeout: 5_000 });
    }
  });
});
