import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSamples } from "./check-samples.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "check-samples-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function put(rel: string, content = "x"): void {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function licenses(...rows: string[]): string {
  return [
    "# Licenses",
    "",
    "| File | License | Source |",
    "| --- | --- | --- |",
    ...rows.map((r) => `| \`${r}\` | CC0-1.0 | test |`),
    "",
  ].join("\n");
}

describe("checkSamples", () => {
  it("reports nothing when every file is listed", () => {
    put("a.cho");
    put("sub/b.cho");
    put("LICENSES.md", licenses("a.cho", "sub/b.cho"));
    expect(checkSamples(dir)).toEqual({ unlisted: [], stale: [] });
  });

  it("reports unlisted files, including in subfolders", () => {
    put("a.cho");
    put("sub/deep/b.cho");
    put("LICENSES.md", licenses("a.cho"));
    expect(checkSamples(dir)).toEqual({
      unlisted: ["sub/deep/b.cho"],
      stale: [],
    });
  });

  it("reports stale entries for missing files", () => {
    put("a.cho");
    put("LICENSES.md", licenses("a.cho", "gone.cho"));
    expect(checkSamples(dir)).toEqual({ unlisted: [], stale: ["gone.cho"] });
  });

  it("ignores .gitkeep and LICENSES.md itself", () => {
    put(".gitkeep", "");
    put("sub/.gitkeep", "");
    put("LICENSES.md", licenses());
    expect(checkSamples(dir)).toEqual({ unlisted: [], stale: [] });
  });
});

describe("check-samples CLI", () => {
  it("exits 0 on the real repo", () => {
    const res = spawnSync("node", ["scripts/check-samples.mjs"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^check:samples: \d+ file\(s\) OK/);
  });

  describe("in a copied tmp repo", () => {
    let cliDir: string;

    beforeEach(() => {
      cliDir = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), "shir-cli-")),
      );
      mkdirSync(path.join(cliDir, "scripts"), { recursive: true });
      copyFileSync(
        path.join(repoRoot, "scripts", "check-samples.mjs"),
        path.join(cliDir, "scripts", "check-samples.mjs"),
      );
    });
    afterEach(() => {
      rmSync(cliDir, { recursive: true, force: true });
    });

    function putCli(rel: string, content = "x"): void {
      const full = path.join(cliDir, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }

    function runCli() {
      return spawnSync(process.execPath, ["scripts/check-samples.mjs"], {
        cwd: cliDir,
        encoding: "utf8",
      });
    }

    it("exits 1 and names the file when a sample has no LICENSES.md entry", () => {
      putCli("samples/LICENSES.md", licenses("listed.cho"));
      putCli("samples/listed.cho");
      putCli("samples/sub/x.cho");
      const res = runCli();
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("check:samples: unlisted samples/sub/x.cho");
    });

    it("exits 1 when samples/ has files but LICENSES.md is missing", () => {
      putCli("samples/a.cho");
      const res = runCli();
      expect(res.status).toBe(1);
      expect(res.stderr).toContain(
        "check:samples: samples/LICENSES.md missing",
      );
    });
  });
});
