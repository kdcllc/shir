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
pnpm tauri dev            # run the desktop app (song viewer) with the Vite dev server
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

- `apps/desktop` — Tauri 2 + React 19 + Vite desktop app (Rust side in `apps/desktop/src-tauri`). The frontend is the desktop song viewer: a searchable SQLite library seeded on first run from the bundled `.cho` songs (`samples/` plus the test fixtures), with niqqud-insensitive search. When the database cannot be opened, the app falls back to a read-only bundled library. The viewer also has a transpose/capo view and a diagnostics panel, and, in database mode, a song editor with two tabs, Visual (the default: a song-details form and the song as editable rows of lyrics with chords, chord-only lines, comments and sections) and Source (the ChordPro text with live preview): New song, Edit, undo/redo, transpose, paste or convert chords-over-lyrics text, and Open files… to import `.cho`, `.chopro`, `.chordpro` and `.txt` files (RTL chord sheets go through an alignment review). Also in database mode, songs can be deleted from a list row, from the open song, or in bulk through select mode, always after an in-app confirmation. Spec in [`docs/DESKTOP.md`](docs/DESKTOP.md).
- `packages/chord-core` — shared chord logic package (text-direction and grapheme helpers, ChordPro parse and canonical save, chord transpose and capo view, and the edit operations behind the visual editor: `EditOp`, `applyEdit`, `applyEdits`; spec in [`docs/CHORDPRO.md`](docs/CHORDPRO.md)).
- `packages/chord-render` — shared React chord-sheet rendering package (`ChordSymbol`, `ChordLine` with an optional `editing` prop for the visual editor, `SongView`, `computeOverlapPadding`, `useChordOverlap`, `lineDirection`).
- `packages/test-fixtures` — shared fixture package.
- `scripts` — repo scripts and cross-workspace contract tests, including `scripts/smoke`.
- `samples` — original sample songs and their `LICENSES.md`.
- `docs` — project documentation.

## Launch smoke

With `SHIR_SMOKE=1` the app prints a line `SHIR_READY` once the frontend has mounted React and
emitted the `shir://ui-ready` event (`apps/desktop/src/uiReady.ts`), stays up for 10 seconds, then
exits 0. The smoke
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
format check, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, on Linux only the
Playwright browser install and `pnpm --filter chord-render test:bidi`, a
`pnpm tauri build --debug`, the platform's launch smoke, and uploads the debug bundles.

## Bidi tests

The chord-render bidi geometry tests run in Playwright (chromium and webkit). Install the browsers
once, then run:

```sh
pnpm --filter chord-render exec playwright install --with-deps chromium webkit
pnpm --filter chord-render test:bidi
```

See [`docs/BIDI.md`](docs/BIDI.md).

## Sample songs and copyright

Every file under `samples/` must be original work written for this repository, or verified
public domain with its source recorded in [`samples/LICENSES.md`](samples/LICENSES.md).
Copyrighted lyrics and chord charts are never committed. A new song under `samples/` also
needs an entry in `apps/desktop/src-tauri/tests/golden/extract.json`, derived from chord-core
(see [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)), and an entry in
`apps/desktop/src-tauri/src/db/seed.rs`, which tests enforce.

## More documentation

- [`docs/BIDI.md`](docs/BIDI.md)
- [`docs/CHORDPRO.md`](docs/CHORDPRO.md)
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)
- [`docs/DESKTOP.md`](docs/DESKTOP.md)
- [`docs/STACK.md`](docs/STACK.md)
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)
