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
requires exit code 0 plus a `SHIR_READY` line. Without a display the binary cannot start, so on a
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
