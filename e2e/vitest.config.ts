import { defineConfig } from "vitest/config";

// Driver-free unit tests of the harness helpers only. The WebdriverIO specs live in
// specs/*.e2e.ts and run through `pnpm test:e2e`, never through vitest.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
