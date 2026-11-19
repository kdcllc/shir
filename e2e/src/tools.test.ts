import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  TAURI_DRIVER_VERSION,
  findTool,
  missingToolMessage,
  resolveTools,
  searchDirs,
} from "./tools";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "shir-e2e-tools-"));
  made.push(dir);
  return dir;
}

function fakeBin(dir: string, name: string, mode = 0o755): void {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, "#!/bin/sh\n");
  chmodSync(file, mode);
}

describe("missingToolMessage", () => {
  it("names tauri-driver with the pinned, locked install command on one line", () => {
    const message = missingToolMessage("tauri-driver");
    expect(message).toBe(
      `e2e: tauri-driver not found; install it with: cargo install tauri-driver --locked --version ${TAURI_DRIVER_VERSION}`,
    );
    expect(message).not.toContain("\n");
    expect(TAURI_DRIVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("names WebKitWebDriver with the apt command", () => {
    expect(missingToolMessage("WebKitWebDriver")).toBe(
      "e2e: WebKitWebDriver not found; install it with: sudo apt install webkit2gtk-driver",
    );
  });
});

describe("searchDirs", () => {
  it("searches $CARGO_HOME/bin first, then PATH", () => {
    const env = { CARGO_HOME: "/c", PATH: ["/a", "/b"].join(path.delimiter) };
    expect(searchDirs(env, "/h")).toEqual([path.join("/c", "bin"), "/a", "/b"]);
  });

  it("falls back to ~/.cargo/bin when CARGO_HOME is unset", () => {
    expect(searchDirs({ PATH: "/a" }, "/h")).toEqual([
      path.join("/h", ".cargo", "bin"),
      "/a",
    ]);
  });
});

describe("findTool and resolveTools", () => {
  // accessSync(X_OK) ignores file modes on Windows, so the exec bit cannot be tested there.
  it.skipIf(process.platform === "win32")("finds only executable files", () => {
    const root = tempRoot();
    fakeBin(path.join(root, "x"), "tool", 0o644);
    fakeBin(path.join(root, "y"), "tool");
    expect(findTool("tool", [path.join(root, "x")])).toBeUndefined();
    expect(findTool("tool", [path.join(root, "x"), path.join(root, "y")])).toBe(
      path.join(root, "y", "tool"),
    );
  });

  it("reports a missing tauri-driver before a missing WebKitWebDriver", () => {
    const root = tempRoot();
    const env = { PATH: path.join(root, "empty") };
    expect(() => resolveTools(env, root)).toThrow(
      missingToolMessage("tauri-driver"),
    );
    fakeBin(path.join(root, ".cargo", "bin"), "tauri-driver");
    expect(() => resolveTools(env, root)).toThrow(
      missingToolMessage("WebKitWebDriver"),
    );
    fakeBin(path.join(root, "empty"), "WebKitWebDriver");
    expect(resolveTools(env, root)).toEqual({
      tauriDriver: path.join(root, ".cargo", "bin", "tauri-driver"),
      webkitWebDriver: path.join(root, "empty", "WebKitWebDriver"),
    });
  });
});
