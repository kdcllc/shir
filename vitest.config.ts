import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.{ts,mjs}"],
    environment: "node",
  },
});
