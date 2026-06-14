import { test as base, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";
const REPO_ROOT = path.resolve(__dirname, "../../..");
// `electron` package exports the platform-correct binary path as its default value.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ELECTRON_BIN: string = require("electron") as string;
const ELECTRON_MAIN = path.join(REPO_ROOT, "apps/desktop/src-gen/backend/electron-main.js");

// On Linux CI there is no display server; Electron needs --no-sandbox.
const EXTRA_ARGS = process.platform === "linux" ? ["--no-sandbox"] : [];

export interface AppFixtures {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly workspace: string;
}

/**
 * Creates an isolated temp workspace per test, launches the Electron app
 * pointing at it, and tears everything down after.
 */
export const test = base.extend<AppFixtures>({
  workspace: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spexr-e2e-"));
    // Minimal workspace structure the app expects
    fs.mkdirSync(path.join(dir, "docs/specs"), { recursive: true });
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },

  app: async ({ workspace }, use) => {
    const app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [...EXTRA_ARGS, ELECTRON_MAIN, workspace],
      env: {
        ...process.env,
        THEIA_DEFAULT_PLUGINS: "local-dir:plugins",
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        DISPLAY: process.env.DISPLAY ?? ":99",
      },
    });
    await use(app);
    await app.close();
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    // Wait for Theia shell DOM, then for the status bar (id="theia-statusBar")
    // which appears only after Theia finishes JS initialization (keybindings, plugins).
    await page.waitForSelector(".theia-ApplicationShell", { timeout: 30_000 });
    await page.waitForSelector("#theia-statusBar", { timeout: 30_000 });
    await use(page);
  },
});

export { expect } from "@playwright/test";

// ── Selectors ──────────────────────────────────────────────────────────────

export const sel = {
  // Spec panel
  specPanel: ".spexr-spec-panel",
  createBtn: "button:has-text('Create new spec')",
  refreshBtn: "button:has-text('Refresh')",
  specList: ".spexr-spec-list",
  specItem: ".spexr-spec-list__item",
  specTitle: ".spexr-spec-list__title",

  // Workflow stepper
  stepper: ".spexr-stepper",
  stepItem: (state: "current" | "done" | "pending") =>
    `.spexr-stepper__item--${state}`,
  stepBtn: (label: string) =>
    `.spexr-stepper__btn:has(.spexr-stepper__label:text("${label}"))`,

  // Plan checklist
  planChecklist: ".spexr-plan-checklist",
  planHeader: ".spexr-plan-checklist__header",
  planItem: ".spexr-plan-checklist__item",
  planCheckbox: (id: string) =>
    `.spexr-plan-checklist__item:has(.spexr-plan-checklist__ac-ref:text("${id}")) input[type="checkbox"]`,

  // Spec lint (bottom panel)
  lintWidget: ".spexr-spec-lint-widget",
  lintSummary: ".spexr-spec-lint__summary",
  lintFinding: ".spexr-spec-lint__finding",

  // Spec preview
  previewWidget: ".spexr-spec-preview",
  previewBody: ".spexr-spec-preview__body",
  previewEmpty: ".spexr-spec-preview__empty",

  // Theia helpers
  tab: (label: string) => `.p-TabBar-tab:has-text("${label}")`,
  notification: ".theia-notification-message",
} as const;

/**
 * Open the SPEXR spec view by clicking its tab in the main area.
 * The spec view is pre-opened at startup with activate:false so the tab always
 * exists in the main tab bar — no keyboard shortcut needed.
 * Theia (lumino) uses .lm-TabBar-tabLabel; .p-TabBar-tabLabel is the legacy alias.
 */
export async function openSpecView(page: Page): Promise<void> {
  const tabLabel = page
    .locator(".lm-TabBar-tabLabel, .p-TabBar-tabLabel")
    .filter({ hasText: "Active Spec" });
  await tabLabel.first().click({ timeout: 10_000 });
  await page.waitForSelector(sel.specPanel, { state: "visible", timeout: 15_000 });
}

/**
 * Open a file in the Theia editor via the Explorer sidebar tree.
 * More reliable than keyboard-driven quick-open in headless Electron CI where
 * modifier+key CDP events are unreliable.
 * The file must already exist on disk before calling this.
 */
export async function openFileInEditor(page: Page, filename: string): Promise<void> {
  // Expand parent folders in the Explorer tree if needed.
  for (const segment of ["docs", "specs"]) {
    const folder = page
      .locator(".theia-FileTreeNode")
      .filter({ hasText: new RegExp(`^${segment}$`) });
    if (await folder.count() > 0 && await folder.first().isVisible()) {
      const isExpanded = await folder.first().getAttribute("aria-expanded");
      if (isExpanded !== "true") {
        await folder.first().click();
        await page.waitForTimeout(200);
      }
    }
  }

  // Find and double-click the file node to open it in the editor.
  const fileNode = page
    .locator(".theia-FileTreeNode")
    .filter({ hasText: filename });
  await fileNode.first().dblclick({ timeout: 8_000 });
  // Settle time for editor to open and emit onCurrentEditorChanged.
  await page.waitForTimeout(800);
}

/** Wait until at least one spec item appears in the list. */
export async function waitForSpecList(page: Page): Promise<void> {
  await page.waitForSelector(sel.specItem, { timeout: 10_000 });
}
