import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.{ts,mjs}"],
    // e2e/ has its own driver-free vitest run (pnpm -r test); its WebdriverIO
    // specs (specs/*.e2e.ts) must never be collected by vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
    environment: "node",
  },
});
