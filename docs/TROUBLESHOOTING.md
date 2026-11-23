# Troubleshooting

## Linux: blank or white window, or a WebKitGTK crash (NVIDIA / Wayland)

On Linux the Tauri shell renders with WebKitGTK. On some setups (for example the NVIDIA proprietary
driver and/or a Wayland session) the window can come up blank or white, or the webview can crash.

As a workaround, set the WebKitGTK env var for a single launch:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 pnpm tauri dev
```

The same prefix works when starting a built binary directly.

Shir and CI do **not** set this variable unconditionally: no `WEBKIT_*` variable is set anywhere in
`apps/`, `scripts/` or `.github/`. Set it yourself, per launch, only when you hit this problem.

## Linux: symbol lookup error when launched from a snap VS Code terminal

Symptom, when running `pnpm tauri dev` (or the built binary) from the integrated terminal of VS Code
or VS Code Insiders installed as a snap:

```text
target/debug/shir: symbol lookup error: /snap/core20/current/lib/x86_64-linux-gnu/libpthread.so.0:
undefined symbol: __libc_pthread_init, version GLIBC_PRIVATE
```

The snap exports `GTK_PATH`, `GTK_EXE_PREFIX`, `LOCPATH`, `GIO_MODULE_DIR`, `GDK_PIXBUF_MODULEDIR`,
`GDK_PIXBUF_MODULE_FILE`, `GTK_IM_MODULE_FILE` and a rewritten `XDG_DATA_DIRS` to every child
process. WebKitGTK then loads the snap's GTK modules and their older `core20` glibc libraries next to
the host glibc, and the process aborts. Shir itself is fine.

Fixes, in order of preference:

1. Run the command from a regular terminal (for example GNOME Terminal).
2. Clear the leaked variables for one launch from the VS Code terminal:

   ```sh
   env -u GTK_PATH -u GTK_EXE_PREFIX -u LOCPATH -u GIO_MODULE_DIR \
       -u GDK_PIXBUF_MODULEDIR -u GDK_PIXBUF_MODULE_FILE -u GTK_IM_MODULE_FILE \
       XDG_DATA_DIRS="$XDG_DATA_DIRS_VSCODE_SNAP_ORIG" pnpm tauri dev
   ```

3. Install VS Code from Microsoft's `.deb` package instead of the snap.

## Linux: headless launch smoke needs a display

The launch smoke (`scripts/smoke/smoke-launch.sh`) starts the real binary with `SHIR_SMOKE=1` and
requires exit code 0 plus a `SHIR_READY` line, which the app prints after the frontend emits
`shir://ui-ready` (React mounted). Without a display the binary cannot start, so on a
headless machine wrap the script in `xvfb-run`, as CI does:

```sh
xvfb-run -a scripts/smoke/smoke-launch.sh apps/desktop/src-tauri/target/debug/shir
```

Set `SMOKE_TIMEOUT=<seconds>` to change the default 120 second limit.

## `pnpm: command not found`

The repo pins pnpm through the `packageManager` field in `package.json`. Enable Corepack so that
version is used:

```sh
corepack enable
```

## Bidi tests: Playwright WebKit fails to launch

`pnpm --filter chord-render test:bidi` needs the Playwright browsers and their host libraries. CI
caches the browsers, runs `pnpm --filter chord-render exec playwright install --with-deps chromium webkit`
on a cache miss and `playwright install-deps chromium webkit` on a hit; run the full command once locally. The `--with-deps` flag installs system packages, so Playwright
asks for `sudo` permissions.

To run the web suite's WebKit project (`test:web`, `apps/desktop/web/playwright.config.ts`) locally
against a cached WebKit build whose revision differs from the pinned Playwright one, set
`SHIR_WEBKIT_EXECUTABLE` to that build's executable. It is a local-only escape hatch; CI installs
the matching browser.

## PDF import: niqqud missing or on the wrong letter

Symptom: after Open files on a `.pdf`, a niqqud mark is missing or sits on the wrong letter.

Cause: Shir reads the inline `/ActualText` spans that LibreOffice and many other producers write for
ligature glyphs, so those PDFs import with their niqqud intact. The limitation applies to PDFs
without `/ActualText` spans, PDFs whose `/ActualText` spans are named-property spans (referenced
through the page's `/Properties` resources), and PDFs with non-Identity CID encodings, and to pages
that show text with the `'` or `"` operators or use Form XObjects. These can still drop or misplace
marks.

Workarounds:

- Open the source `.docx`, `.odt` or `.rtf` file instead.
- Fix the letters in the editor.
- Attach the PDF in Import with AI.

See [`docs/DESKTOP.md` § Editor and import](DESKTOP.md#editor-and-import) for how document
import behaves.

## Real-app E2E (`e2e/`)

Setup and the run command are in [`e2e/README.md`](../e2e/README.md). Common failures:

- **The run stops at once with `e2e: <tool> not found; install it with: ...`.** `tauri-driver` or
  `WebKitWebDriver` is missing. The message names the tool and its install command
  (`cargo install tauri-driver --locked --version 2.1.0` or `sudo apt install webkit2gtk-driver`).
  `tauri-driver` is looked up in `$CARGO_HOME/bin` (default `~/.cargo/bin`), then on `PATH`.
- **There is no Paste-from-clipboard E2E spec.** Under WebKitGTK, `navigator.clipboard.readText()`
  rejects with `NotAllowedError`, so the real-clipboard Paste cannot be automated. The clipboard is
  never faked inside the page; see `e2e/README.md`.
- **Bumping `webdriverio` or `expect-webdriverio` fails to install on Node 24.20.** `webdriverio`
  10.2.0 and `expect-webdriverio` 8.1.0 require Node >=24.22.1, so they are pinned to 10.1.0 and
  8.0.0, and the `@wdio/*` packages are pinned at 10.1.0 too (`docs/STACK.md`, `e2e/README.md`).
  Raise all of them together when the repo's Node floor moves.
