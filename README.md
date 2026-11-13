# Shir

Shir is an offline-first Hebrew + English guitar chord manager for Ubuntu 22.04+ and
Windows 10/11. It is a Tauri 2 + React 19 desktop app in a pnpm monorepo.

## Prerequisites

- **Node 24** — pinned in `.nvmrc` and enforced by `engines` in `package.json` (`>=24 <25`).
- **pnpm** — via corepack; `package.json` pins `packageManager` to `pnpm@10.34.9`.
- **Rust stable** — `rust-toolchain.toml` selects the stable channel with `rustfmt` and `clippy`.
- **Ubuntu system packages** (as installed by CI):
  `sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf xvfb`
- **Windows** — Microsoft C++ Build Tools ("Desktop development with C++" workload, required by
  the Rust MSVC toolchain) and WebView2. The Windows bundles (`nsis`, `msi`) use the WebView2 bootstrapper
  (`webviewInstallMode: downloadBootstrapper` in `apps/desktop/src-tauri/tauri.windows.conf.json`).

## Getting started

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm tauri dev            # run the desktop app with the Vite dev server
pnpm tauri build --debug  # debug build and bundles
```

> **Ubuntu + VS Code installed as a snap:** `pnpm tauri dev` started from the VS Code integrated
> terminal fails with `symbol lookup error: /snap/core20/.../libpthread.so.0: undefined symbol:
__libc_pthread_init`. The snap terminal leaks `GTK_PATH`, `LOCPATH`, `GIO_MODULE_DIR` and
> similar variables into the app. Run it from a regular terminal, or see
> [Troubleshooting](docs/TROUBLESHOOTING.md#linux-symbol-lookup-error-when-launched-from-a-snap-vs-code-terminal).

## Root scripts

| Script               | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `pnpm lint`          | ESLint over the repo, zero warnings allowed                     |
| `pnpm typecheck`     | Root `tsc --noEmit`, then each workspace's `typecheck` script   |
| `pnpm test`          | Root Vitest run, then each workspace's `test` script            |
| `pnpm stylelint`     | Stylelint over all CSS, zero warnings allowed                   |
| `pnpm check:samples` | Fails when a file under `samples/` has no row in `LICENSES.md`  |
| `pnpm format`        | Prettier, write mode                                            |
| `pnpm format:check`  | Prettier, check mode                                            |
| `pnpm tauri`         | Runs the Tauri CLI of the `desktop` workspace (`dev`, `build`…) |

## Repository layout

- `apps/desktop` — Tauri 2 + React 19 + Vite desktop app (Rust side in `apps/desktop/src-tauri`).
- `packages/chord-core` — shared chord logic package (currently the text direction and grapheme helpers).
- `packages/chord-render` — shared React chord-sheet rendering package (currently `ChordSymbol`).
- `packages/test-fixtures` — shared fixture package.
- `scripts` — repo scripts and cross-workspace contract tests, including `scripts/smoke`.
- `samples` — original sample songs and their `LICENSES.md`.
- `docs` — project documentation.

## Launch smoke

With `SHIR_SMOKE=1` the app prints a line `SHIR_READY` once the main window has finished
loading, stays up for 10 seconds, then exits 0. The smoke
scripts run a built binary this way and require exit 0 plus that marker within a timeout
(default 120 seconds):

```sh
# Linux (headless, under xvfb)
xvfb-run -a scripts/smoke/smoke-launch.sh apps/desktop/src-tauri/target/debug/shir
```

```powershell
# Windows
pwsh -File scripts/smoke/smoke-launch.ps1 -Binary apps/desktop/src-tauri/target/debug/shir.exe
```

## CI

`.github/workflows/ci.yml` runs on pushes to `main`, pull requests and manual dispatch, on a
matrix of `ubuntu-22.04` and `windows-latest`. Each job installs dependencies with
`pnpm install --frozen-lockfile`, then runs lint, typecheck, test, stylelint, check:samples,
format check, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, a
`pnpm tauri build --debug`, the platform's launch smoke, and uploads the debug bundles.

## Sample songs and copyright

Every file under `samples/` must be original work written for this repository, or verified
public domain with its source recorded in [`samples/LICENSES.md`](samples/LICENSES.md).
Copyrighted lyrics and chord charts are never committed.

## More documentation

- [`docs/STACK.md`](docs/STACK.md)
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)
