import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "bidi",
  testMatch: "**/*.bidi.ts",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: { baseURL: "http://127.0.0.1:1421" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "pnpm exec vite --config vite.harness.config.ts",
    url: "http://127.0.0.1:1421",
    reuseExistingServer: !process.env.CI,
  },
});
