import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const isWin = process.platform === "win32";
const root = resolve(import.meta.dirname, "..", "..");
const shScript = join(root, "scripts", "smoke", "smoke-launch.sh");
const psScript = join(root, "scripts", "smoke", "smoke-launch.ps1");

const pwshAvailable =
  spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" })
    .status === 0;

// Unique sleep duration so the leftover-process check cannot match unrelated sleepers.
const sleepTag = `30.${Date.now() % 100000}`;
// Windows equivalent: a unique ping -w value that shows up in the process command line.
const winPingTag = String(40000 + (Date.now() % 10000));

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "shir-smoke-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

type StubKind =
  | "ready"
  | "nomarker"
  | "exit3"
  | "sleep"
  | "envecho"
  | "bigLog"
  | "nonexec"
  | "ignoreTerm";

function stub(kind: StubKind): string {
  if (kind === "nonexec" && isWin) {
    // Windows has no exec bit: an existing file that CreateProcess cannot launch
    // drives the Start-Process catch in smoke-launch.ps1 (not the Test-Path guard).
    const txt = join(dir, "nonexec.txt");
    writeFileSync(txt, "not a program\r\n");
    return txt;
  }
  const path = join(dir, isWin ? `${kind}.cmd` : `${kind}.sh`);
  const posix: Record<StubKind, string> = {
    ready: "echo SHIR_READY\nexit 0",
    nomarker: "echo hello\nexit 0",
    exit3: "echo SHIR_READY\nexit 3",
    sleep: `exec sleep ${sleepTag}`,
    envecho: 'echo "SHIR_SMOKE=$SHIR_SMOKE"\nexit 0',
    bigLog:
      "echo SHIR_READY\nhead -c 300000 /dev/zero | tr '\\0' x\necho\nexit 0",
    nonexec: "echo SHIR_READY\nexit 0",
    ignoreTerm: "trap '' TERM\nwhile :; do sleep 1; done",
  };
  const win: Record<StubKind, string> = {
    ready: "echo SHIR_READY\r\nexit /b 0",
    nomarker: "echo hello\r\nexit /b 0",
    exit3: "echo SHIR_READY\r\nexit /b 3",
    sleep: `ping -n 31 -w ${winPingTag} 127.0.0.1 >NUL`,
    envecho: "echo SHIR_SMOKE=%SHIR_SMOKE%\r\nexit /b 0",
    bigLog: `echo SHIR_READY\r\nfor /l %%i in (1,1,3000) do echo ${"x".repeat(100)}\r\nexit /b 0`,
    nonexec: "echo SHIR_READY\r\nexit /b 0",
    ignoreTerm: "exit /b 0", // POSIX-only case; never generated on Windows
  };
  if (isWin) {
    writeFileSync(path, `@echo off\r\n${win[kind]}\r\n`);
  } else {
    writeFileSync(path, `#!/bin/sh\n${posix[kind]}\n`);
    chmodSync(path, kind === "nonexec" ? 0o644 : 0o755);
  }
  return path;
}

interface Result {
  status: number | null;
  out: string;
  ms: number;
}

type Runner = (binary: string | null, timeoutSec?: number) => Result;

function finish(start: number, r: ReturnType<typeof spawnSync>): Result {
  return {
    status: r.status,
    out: `${r.stdout?.toString() ?? ""}${r.stderr?.toString() ?? ""}`,
    ms: Date.now() - start,
  };
}

const runBash: Runner = (binary, timeoutSec) => {
  const start = Date.now();
  const env = { ...process.env };
  if (timeoutSec !== undefined) env.SMOKE_TIMEOUT = String(timeoutSec);
  const r = spawnSync(
    "bash",
    binary === null ? [shScript] : [shScript, binary],
    {
      env,
      timeout: 30_000,
    },
  );
  return finish(start, r);
};

const runPwsh: Runner = (binary, timeoutSec) => {
  const start = Date.now();
  const args = ["-NoProfile", "-File", psScript];
  if (binary !== null) args.push("-Binary", binary);
  if (timeoutSec !== undefined) args.push("-TimeoutSec", String(timeoutSec));
  return finish(start, spawnSync("pwsh", args, { timeout: 30_000 }));
};

function sleeperAlive(): boolean {
  if (isWin) {
    const q = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'PING.EXE' -and $_.CommandLine -like '*-w ${winPingTag} *' }) { exit 1 } else { exit 0 }`,
      ],
      { timeout: 30_000 },
    );
    return q.status === 1;
  }
  return spawnSync("pgrep", ["-f", `sleep ${sleepTag}`]).status === 0;
}

function cases(run: Runner): void {
  it("a: marker then exit 0 passes", () => {
    const r = run(stub("ready"));
    expect(r.status).toBe(0);
    expect(r.out).toContain("smoke: PASS");
  }, 20_000);

  it("b: exit 0 without marker fails", () => {
    const r = run(stub("nomarker"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("no SHIR_READY marker");
  }, 20_000);

  it("c: marker then exit 3 fails with the exit code", () => {
    const r = run(stub("exit3"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("exit 3");
  }, 20_000);

  it("d: hung stub is killed on timeout", () => {
    const r = run(stub("sleep"), 2);
    expect(r.status).toBe(1);
    expect(r.out).toContain("timeout");
    expect(r.ms).toBeLessThan(10_000);
    expect(sleeperAlive()).toBe(false);
  }, 20_000);

  it("e: no argument exits 2", () => {
    const r = run(null);
    expect(r.status).toBe(2);
    expect(r.out).toContain("usage:");
  }, 20_000);

  it("f: stub observes SHIR_SMOKE=1", () => {
    const r = run(stub("envecho"));
    expect(r.status).toBe(1); // no marker, so the log tail is printed
    expect(r.out).toContain("SHIR_SMOKE=1");
  }, 20_000);

  it("g: large log after the marker still passes", () => {
    const r = run(stub("bigLog"));
    expect(r.status).toBe(0);
    expect(r.out).toContain("smoke: PASS");
  }, 20_000);

  it("h: non-executable binary exits 2", () => {
    const r = run(stub("nonexec"));
    expect(r.status).toBe(2);
    expect(r.out).toContain("usage:");
  }, 20_000);

  // POSIX-only: a hang that ignores SIGTERM is still reported as a timeout, not as
  // the SIGKILL exit status (bash: timeout -k 5 => rc 137 after about 7 s).
  it.skipIf(isWin)(
    "i: SIGTERM-ignoring hang is reported as timeout",
    () => {
      const r = run(stub("ignoreTerm"), 2);
      expect(r.status).toBe(1);
      expect(r.out).toContain("smoke: FAIL - timeout");
    },
    20_000,
  );
}

describe.skipIf(isWin)("smoke-launch.sh", () => {
  cases(runBash);
});

describe.skipIf(!pwshAvailable)("smoke-launch.ps1", () => {
  cases(runPwsh);
});
