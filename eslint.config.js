import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const SRC = "**/*.{ts,tsx,js,mjs,cjs}";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/target/**",
      "**/node_modules/**",
      "apps/desktop/src-tauri/gen/**",
      ".agents/**",
      ".claude/**",
      "_kit/**",
      "_loop/**",
      "_memory/**",
      "coverage/**",
    ],
  },
  {
    files: [SRC],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    files: ["**/*.tsx"],
    extends: [reactHooks.configs.flat.recommended],
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "react-refresh/only-export-components": "warn",
    },
  },
  {
    files: ["apps/**", "packages/chord-render/**"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["scripts/**", "**/*.config.*"],
    languageOptions: { globals: globals.node },
  },
  {
    // Electron-fallback rule: the shared core/render packages must stay host-agnostic.
    files: ["packages/chord-core/**", "packages/chord-render/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tauri-apps/*"],
              message:
                "chord-core and chord-render must not depend on Tauri: keep them host-agnostic so an Electron fallback stays possible.",
            },
          ],
        },
      ],
    },
  },
);
