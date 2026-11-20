# Shir

Shir is an offline-first Hebrew + English guitar chord manager for Ubuntu 22.04+ and
Windows 10/11. It is a Tauri 2 + React 19 desktop app in a pnpm monorepo.

## Download and install

Installers are published on the **Releases** page of this GitHub repository. Pick the download
that matches your CPU: x64 (Intel/AMD 64-bit) or arm64/aarch64 (ARM 64-bit). Each release lists
these files, where `<version>` is the release version:

| Platform | Architecture | Download                                 |
| -------- | ------------ | ---------------------------------------- |
| Windows  | x64          | `Shir_<version>_windows_x64-setup.exe`   |
| Windows  | arm64        | `Shir_<version>_windows_arm64-setup.exe` |
| Linux    | x86_64       | `Shir_<version>_linux_x86_64.AppImage`   |
| Linux    | aarch64      | `Shir_<version>_linux_aarch64.AppImage`  |

- **Windows** — run the `setup.exe` installer. The installers are unsigned, so SmartScreen shows
  "Windows protected your PC": click **More info**, then **Run anyway**.
- **Linux** — make the AppImage executable, then run it (`chmod +x Shir_<version>_linux_x86_64.AppImage`,
  then `./Shir_<version>_linux_x86_64.AppImage`). AppImages need FUSE 2 (`libfuse2`, or
  `libfuse2t64` on Ubuntu 24.04).
- **Verify your download** — each release also has `SHA256SUMS.txt`, and the release notes repeat
  the checksums. On Linux, run `sha256sum -c --ignore-missing SHA256SUMS.txt` next to the
  download. On Windows, run `Get-FileHash .\<file> -Algorithm SHA256` in PowerShell and compare.

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
| `pnpm test:e2e`      | Real-app WebdriverIO E2E suite (`e2e` workspace)                |

Built-frontend Playwright print and accessibility checks of the desktop app run with
`pnpm --filter desktop test:web`.

## Repository layout

- `apps/desktop` — Tauri 2 + React 19 + Vite desktop app (Rust side in `apps/desktop/src-tauri`). The frontend is the desktop song viewer: a searchable SQLite library seeded on first run from the bundled `.cho` songs (`samples/` plus the test fixtures), with niqqud-insensitive search. When the database cannot be opened, the app falls back to a read-only bundled library. The viewer also has a transpose/capo view and a diagnostics panel, and, in database mode, a song editor with two tabs, Visual (the default: a song-details form and the song as editable rows of lyrics with chords, chord-only lines, comments and sections) and Source (the ChordPro text with live preview): New song, Edit, undo/redo, transpose, paste or convert chords-over-lyrics text, and Open files… to import `.cho`, `.chopro`, `.chordpro` and `.txt` files (RTL chord sheets go through an alignment review). Also in database mode, songs can be deleted from a list row, from the open song, or in bulk through select mode, always after an in-app confirmation. The interface is Hebrew or English: an `עב` / `EN` toggle in the sidebar heading switches it and mirrors the layout. In database mode the library has a sort order and a language filter, and each song row shows its key (when set) and a language badge. In database mode a Songs/Setlists switch in the sidebar opens setlists: named, ordered lists of songs, each entry with its own transpose and capo, which can be created, renamed, duplicated, deleted and reordered, and songs are added from the open song or from select mode. An open setlist (cover page plus one song per page) or an open song, in both database and bundled modes, can be printed, saved as PDF through the print dialog, or exported to Word (`.docx`). Spec in [`docs/DESKTOP.md`](docs/DESKTOP.md).
- `packages/chord-core` — shared chord logic package (text-direction and grapheme helpers, ChordPro parse and canonical save, chord transpose and capo view, and the edit operations behind the visual editor: `EditOp`, `applyEdit`, `applyEdits`; and the export model behind print, PDF and Word export: `buildExportSong`, `buildExportDocument`, `directionalCells`; spec in [`docs/CHORDPRO.md`](docs/CHORDPRO.md)).
- `packages/chord-render` — shared React chord-sheet rendering package (`ChordSymbol`, `ChordLine` with an optional `editing` prop for the visual editor, `SongView`, `computeOverlapPadding`, `useChordOverlap`, `lineDirection`).
- `packages/test-fixtures` — shared fixture package.
- `e2e` — real-app WebdriverIO suite that drives the built debug binary through `tauri-driver`; see [`e2e/README.md`](e2e/README.md).
- `scripts` — repo scripts and cross-workspace contract tests, including `scripts/smoke`.
- `samples` — original sample songs and their `LICENSES.md`.
- `docs` — project documentation.

## Launch smoke

With `SHIR_SMOKE=1` the app prints a line `SHIR_READY` once the frontend has mounted React and
emitted the `shir://ui-ready` event (`apps/desktop/src/uiReady.ts`), stays up for 10 seconds, then
exits 0. The smoke scripts run a built binary this way and require exit 0 plus that marker within a timeout
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
`pnpm install --frozen-lockfile`, then runs `pnpm test` and `cargo test`. On Linux only it
also runs lint, typecheck, stylelint, check:samples, format check, `cargo fmt --check`,
`cargo clippy -D warnings`, the Playwright browser install (cached), `pnpm --filter chord-render
test:bidi` and the desktop Playwright checks (`pnpm --filter desktop test:web`). Both then run a
debug Tauri build (`pnpm tauri build --debug --no-bundle` on pull requests, with bundles on
pushes and manual runs) and the platform's launch smoke. On Linux only it runs the WebdriverIO
E2E (`pnpm test:e2e`, with `webkit2gtk-driver`, generated `he_IL`/`en_US` locales and
`tauri-driver` pinned to 2.1.0). Debug bundles are uploaded when they were built.

## Releases

`.github/workflows/release.yml` (workflow `Release`) runs after the `CI` workflow completes
successfully for a push to `main` of this repository. It plans the release, builds the installers
and publishes them; runs are serialized (concurrency group `release`; a run in progress is never cancelled, and a newer queued run replaces a pending one).

- **Release rule** — a release is made when the first-parent history of the commit since the latest
  `vX.Y.Z` tag contains at least one merged PR into `main` from a `feat/` or `fix/` branch.
  A release therefore includes every unreleased `feat/` and `fix/` PR since the last tag, so a
  cancelled or failed CI run only delays a release. A commit that already has a `vX.Y.Z` tag is never
  released again, and a commit that is not a descendant of the latest release tag never releases.
- **Version** — the bump is the highest of the `release:major`, `release:minor` and `release:patch`
  labels on those PRs; a PR with no such label counts as a patch. The first release uses the
  `version` in `apps/desktop/src-tauri/tauri.conf.json`. The labels must exist in the repository;
  create them once with `gh label create release:major` (and `release:minor`, `release:patch`).
- **Builds** — four native runners, one per target: `windows-latest` (x64), `windows-11-arm`
  (arm64), `ubuntu-22.04` (x86_64) and `ubuntu-22.04-arm` (aarch64). Each job first checks that
  `rustc`'s host triple matches the target, then runs
  `pnpm tauri build --bundles <nsis|appimage> --config <file>`. The version is injected through that
  generated config file, so nothing is committed back to the repository.
- **Publishing** — the release is tagged `vX.Y.Z` at the released commit, marked Latest, and has the
  four installers plus `SHA256SUMS.txt`. The release notes contain install instructions and the
  checksums, together with GitHub-generated notes. The installers are unsigned.
- **Recovery** — a failed run publishes nothing, and a leftover draft release for the same tag is
  deleted before the release is created; a published release is never deleted automatically. To roll
  back a bad release, delete the release (`gh release delete vX.Y.Z`) and then its tag
  (`git push origin :refs/tags/vX.Y.Z`).
- **Tests** — the release logic is covered by `scripts/release/release-plan.test.ts` and the
  workflow by `scripts/release-contract.test.ts`; both run with `pnpm test`.

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
