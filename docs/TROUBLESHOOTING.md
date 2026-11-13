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
