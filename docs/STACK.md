# Stack

## How versions are pinned

JavaScript dependencies are pinned to exact versions in the `catalog:` of `pnpm-workspace.yaml`
(resolved in `pnpm-lock.yaml`), and Rust crates in `apps/desktop/src-tauri/Cargo.toml` (resolved in
`Cargo.lock`). Update this file in the same change as any upgrade.

## Pinned versions

| Component                            | Package                         | Version                                  | Ecosystem | Status         |
| ------------------------------------ | ------------------------------- | ---------------------------------------- | --------- | -------------- |
| Node.js                              | `node`                          | 24.20.0                                  | toolchain | installed (G0) |
| pnpm                                 | `pnpm`                          | 10.34.9                                  | toolchain | installed (G0) |
| Rust                                 | `rustc`                         | 1.97.1                                   | toolchain | installed (G0) |
| TypeScript                           | `typescript`                    | 6.0.3                                    | npm       | installed (G0) |
| Vite                                 | `vite`                          | 8.3.8                                    | npm       | installed (G0) |
| Vite React plugin                    | `@vitejs/plugin-react`          | 6.3.0                                    | npm       | installed (G0) |
| React                                | `react`                         | 19.3.1                                   | npm       | installed (G0) |
| React DOM                            | `react-dom`                     | 19.3.1                                   | npm       | installed (G0) |
| React types                          | `@types/react`                  | 19.3.0                                   | npm       | installed (G0) |
| React DOM types                      | `@types/react-dom`              | 19.3.0                                   | npm       | installed (G0) |
| Node types                           | `@types/node`                   | 26.6.6                                   | npm       | installed (G0) |
| Vitest                               | `vitest`                        | 5.1.0                                    | npm       | installed (G0) |
| jsdom                                | `jsdom`                         | 31.0.0                                   | npm       | installed (G0) |
| Testing Library React                | `@testing-library/react`        | 16.3.3                                   | npm       | installed (G0) |
| Testing Library DOM                  | `@testing-library/dom`          | 10.4.2                                   | npm       | installed (G0) |
| Testing Library jest-dom             | `@testing-library/jest-dom`     | 7.0.1                                    | npm       | installed (G0) |
| ESLint                               | `eslint`                        | 10.14.0                                  | npm       | installed (G0) |
| ESLint JS config                     | `@eslint/js`                    | 10.0.1                                   | npm       | installed (G0) |
| typescript-eslint                    | `typescript-eslint`             | 8.72.2                                   | npm       | installed (G0) |
| ESLint React Hooks plugin            | `eslint-plugin-react-hooks`     | 7.1.1                                    | npm       | installed (G0) |
| ESLint React Refresh plugin          | `eslint-plugin-react-refresh`   | 0.5.7                                    | npm       | installed (G0) |
| globals                              | `globals`                       | 17.14.0                                  | npm       | installed (G0) |
| stylelint                            | `stylelint`                     | 17.16.0                                  | npm       | installed (G0) |
| stylelint standard config            | `stylelint-config-standard`     | 40.0.0                                   | npm       | installed (G0) |
| stylelint CSS Modules config         | `stylelint-config-css-modules`  | 4.6.0                                    | npm       | installed (G0) |
| stylelint logical properties         | `stylelint-use-logical`         | 2.1.3                                    | npm       | installed (G0) |
| Prettier                             | `prettier`                      | 3.10.1                                   | npm       | installed (G0) |
| Tauri CLI                            | `@tauri-apps/cli`               | 2.12.4                                   | npm       | installed (G0) |
| Tauri JS API                         | `@tauri-apps/api`               | 2.12.4                                   | npm       | installed (G0) |
| Tauri core                           | `tauri`                         | 2.12.5                                   | crate     | installed (G0) |
| Tauri build script                   | `tauri-build`                   | 2.7.4                                    | crate     | installed (G0) |
| Serde                                | `serde`                         | 1.0.229                                  | crate     | installed (G0) |
| Serde JSON                           | `serde_json`                    | 1.0.154                                  | crate     | installed (G0) |
| ChordSheetJS                         | `chordsheetjs`                  | 18.0.0                                   | npm       | planned (G2)   |
| fast-check                           | `fast-check`                    | 4.10.2                                   | npm       | planned (G2)   |
| Zustand                              | `zustand`                       | 5.1.0                                    | npm       | planned (G7)   |
| TanStack Router                      | `@tanstack/react-router`        | 1.170.46                                 | npm       | planned (G7)   |
| i18next                              | `i18next`                       | 27.1.1                                   | npm       | planned (G7)   |
| react-i18next                        | `react-i18next`                 | 18.0.1                                   | npm       | planned (G7)   |
| SVGuitar                             | `svguitar`                      | 2.10.1                                   | npm       | planned (G3)   |
| Chord fingering data (HEAD commit)   | `tabsy-gr/chords-db`            | 43f8b4a7ba7b61b90bb48f8721ae918a4f421d64 | data      | planned (G3)   |
| SQLite bindings (bundled)            | `rusqlite`                      | 0.42.0                                   | crate     | planned (G4)   |
| Migrations (choice in G4)            | `rusqlite_migration`            | 2.7.0                                    | crate     | planned (G4)   |
| Migrations (choice in G4)            | `refinery`                      | 0.10.0                                   | crate     | planned (G4)   |
| Specta (rc, no stable release)       | `specta`                        | 2.0.0-rc.28                              | crate     | planned (G4)   |
| tauri-specta (rc, no stable release) | `tauri-specta`                  | 2.0.0-rc.28                              | crate     | planned (G4)   |
| Playwright                           | `@playwright/test`              | 1.65.0                                   | npm       | planned (G1)   |
| WebdriverIO                          | `webdriverio`                   | 10.2.0                                   | npm       | planned (G1)   |
| WDIO Tauri service                   | `@wdio/tauri-service`           | 1.5.1                                    | npm       | planned (G1)   |
| Tauri updater plugin                 | `tauri-plugin-updater`          | 2.14.1                                   | crate     | planned (G10)  |
| Noto Sans Hebrew                     | `@fontsource/noto-sans-hebrew`  | 5.3.0                                    | font      | planned (G1)   |
| Noto Serif Hebrew                    | `@fontsource/noto-serif-hebrew` | 5.3.0                                    | font      | planned (G1)   |
| Heebo                                | `@fontsource/heebo`             | 5.3.0                                    | font      | planned (G1)   |
| JetBrains Mono                       | `@fontsource/jetbrains-mono`    | 5.3.0                                    | font      | planned (G1)   |
