import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The `tauri-driver` release this suite is pinned to (latest non-prerelease). */
export const TAURI_DRIVER_VERSION = "2.1.0";

export const INSTALL_HINTS = {
  "tauri-driver": `cargo install tauri-driver --locked --version ${TAURI_DRIVER_VERSION}`,
  WebKitWebDriver: "sudo apt install webkit2gtk-driver",
} as const;

export type ToolName = keyof typeof INSTALL_HINTS;

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Directories searched for tools: `$CARGO_HOME/bin` (default `~/.cargo/bin`), then `PATH`. */
export function searchDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  const cargoHome = env["CARGO_HOME"] || path.join(home, ".cargo");
  const onPath = (env["PATH"] ?? "").split(path.delimiter).filter(Boolean);
  return [path.join(cargoHome, "bin"), ...onPath];
}

/** The first executable named `name` in `dirs`, or `undefined`. */
export function findTool(
  name: string,
  dirs: readonly string[],
): string | undefined {
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

/** The one-line fail-fast message for a missing tool. */
export function missingToolMessage(name: ToolName): string {
  return `e2e: ${name} not found; install it with: ${INSTALL_HINTS[name]}`;
}

export interface ResolvedTools {
  tauriDriver: string;
  webkitWebDriver: string;
}

/** Resolves both drivers; throws an `Error` whose message is the one-line hint. */
export function resolveTools(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): ResolvedTools {
  const dirs = searchDirs(env, home);
  const tauriDriver = findTool("tauri-driver", dirs);
  if (tauriDriver === undefined)
    throw new Error(missingToolMessage("tauri-driver"));
  const webkitWebDriver = findTool("WebKitWebDriver", dirs);
  if (webkitWebDriver === undefined)
    throw new Error(missingToolMessage("WebKitWebDriver"));
  return { tauriDriver, webkitWebDriver };
}
