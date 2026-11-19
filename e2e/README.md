# Shir real-app E2E

WebdriverIO drives the real, built Shir debug binary through `tauri-driver` and
`WebKitWebDriver` (Linux). Every spec file starts the app against a fresh temporary
profile, so the suite never reads or writes the user's real data.

## Prerequisites

- A debug build: `pnpm tauri build --debug --no-bundle`
  (binary `apps/desktop/src-tauri/target/debug/shir`; override with `SHIR_E2E_APP`).
- `WebKitWebDriver`: `sudo apt install webkit2gtk-driver`
- `tauri-driver`, pinned to the latest non-prerelease release:
  `cargo install tauri-driver --locked --version 2.1.0`
  (found in `$CARGO_HOME/bin`, default `~/.cargo/bin`, or on `PATH`).
- A display: run under `xvfb-run -a`.

A missing `tauri-driver` or `WebKitWebDriver` stops the run at once with one line naming
the tool and its install command.

## Run

```sh
pnpm tauri build --debug --no-bundle
xvfb-run -a pnpm test:e2e
```

`pnpm --filter e2e test` is different: it runs only the driver-free unit tests of the
harness helpers (`src/*.test.ts`, vitest) and never starts WebdriverIO, tauri-driver or the
app. Root `pnpm test` runs it. The WebdriverIO specs are `specs/*.e2e.ts`.

## How a launch gets its environment

tauri-driver and WebKitWebDriver capabilities cannot set the app's environment. The
capability `tauri:options.application` therefore points at a generated wrapper script
(`<run dir>/launch.sh`) that exports `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`,
`LANG`, `LC_ALL` and `LANGUAGE` and then `exec`s the real binary.

- `beforeSession` (`wdio.conf.ts`) creates a new temporary profile directory and writes
  the wrapper for English (`en_US.UTF-8`) before each spec file's session starts.
- `relaunch({ lang, fresh })` (`src/harness.ts`) rewrites the wrapper and calls
  `browser.reloadSession()`, which closes the app and starts a new one. Without `fresh` it
  reuses the same directories, which is how persistence across a restart is tested; with
  `fresh` it deletes them first.
- `afterSession` removes the spec file's profile; `onComplete` removes the run directory
  and stops tauri-driver. `onPrepare` starts tauri-driver on port 4444 (log in `logs/`).

Specs assert against the `EN` and `HE` resources of `apps/desktop/src/i18n`, not
hard-coded copies.

## Specs

| Spec               | Covers                                                          |
| ------------------ | --------------------------------------------------------------- |
| `locale.e2e.ts`    | first-launch detection, toggle, persistence, mirroring          |
| `direction.e2e.ts` | song direction and the `+` transpose glyph inside the Hebrew UI |
| `library.e2e.ts`   | language filter, artist sort, persistence across a restart      |
| `editor.e2e.ts`    | g7 F19 (real double-click) and F54 (picker vs Add section)      |

## F39 (Paste from the real clipboard): not added

Per Q&A 20 the Paste spec is only added if WebKitGTK lets the page read the clipboard.
It does not. With text placed on the clipboard from outside the page
(`xclip -selection clipboard -i`, confirmed with `xclip -o`), under xvfb with
WebKitWebDriver 2.50.4, both a direct `navigator.clipboard.readText()` call and one made
from a real WebDriver click on the Paste button reject with:

```
NotAllowedError: The request is not allowed by the user agent or the platform in the
current context, possibly because the user denied permission.
```

(`navigator.clipboard.readText` exists and `window.isSecureContext` is true.) The editor
then shows its own fallback, "Could not read the clipboard. Paste with Ctrl+V, then use
Convert." (`editor-paste-error`). The clipboard is never faked inside the page, so no
F39 spec exists.

## Node version

`webdriverio` and the `@wdio/*` packages are pinned at 10.1.0, not 10.2.0: 10.2.0 requires
Node >=24.22.1 and the repo enforces `engine-strict` with Node 24. `expect-webdriverio` is
pinned to 8.0.0 for the same reason (8.1.0 needs Node >=24.22.1). Raise all of them
together when the repo's Node floor moves.
