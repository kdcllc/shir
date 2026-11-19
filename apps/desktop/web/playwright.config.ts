import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.SHIR_WEB_PORT ?? 4399);
const baseURL = `http://127.0.0.1:${port}`;
// Local-only escape hatch for a cached WebKit build that does not match the
// pinned Playwright revision; CI installs the matching browser.
const webkitLaunch = process.env.SHIR_WEBKIT_EXECUTABLE
  ? { launchOptions: { executablePath: process.env.SHIR_WEBKIT_EXECUTABLE } }
  : {};

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.web.ts",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], ...webkitLaunch },
    },
  ],
  webServer: {
    // The production build, served by vite preview (never the dev server).
    command: `pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "..",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
