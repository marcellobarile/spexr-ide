import { defineConfig } from "@playwright/test";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "../..");

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // Shared across all tests via the ElectronApp fixture.
    // Individual tests receive `app` and `page` from the fixture.
  },
  projects: [
    {
      name: "electron",
      testMatch: "**/*.spec.ts",
    },
  ],
});

export { REPO_ROOT };
