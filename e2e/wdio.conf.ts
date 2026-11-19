import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGS } from "./src/launch";
import { appBinary, startLaunchState, stopLaunchState } from "./src/profile";
import { resolveTools } from "./src/tools";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const PORT = 4444;

// Fail fast, with one line, when a driver is missing (also runs in each worker).
let tools: ReturnType<typeof resolveTools>;
try {
  tools = resolveTools();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// The launcher creates the run directory; workers inherit it through the environment.
const runDir = (process.env["SHIR_E2E_RUN_DIR"] ||= mkdtempSync(
  path.join(os.tmpdir(), "shir-e2e-run-"),
));
const wrapperPath = path.join(runDir, "launch.sh");
const binary = appBinary(repoRoot);

let driver: ChildProcess | undefined;

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline)
          reject(new Error(`tauri-driver did not listen on port ${port}`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

export const config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  hostname: "127.0.0.1",
  port: PORT,
  outputDir: path.join(here, "logs"),
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": { application: wrapperPath },
    },
  ],
  logLevel: "warn",
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 0,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 120_000 },

  /** Starts tauri-driver before any session. */
  onPrepare: async () => {
    mkdirSync(path.join(here, "logs"), { recursive: true });
    const log = createWriteStream(path.join(here, "logs", "tauri-driver.log"));
    driver = spawn(
      tools.tauriDriver,
      ["--native-driver", tools.webkitWebDriver],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    driver.stdout?.pipe(log);
    driver.stderr?.pipe(log);
    await waitForPort(PORT, 30_000);
  },
  /** Stops tauri-driver and removes the run directory. */
  onComplete: () => {
    driver?.kill();
    rmSync(runDir, { recursive: true, force: true });
  },
  /** A fresh temporary profile (never the user's) for each spec file. */
  beforeSession: () => {
    startLaunchState(wrapperPath, binary, LANGS.en);
  },
  afterSession: () => {
    stopLaunchState();
  },
};
