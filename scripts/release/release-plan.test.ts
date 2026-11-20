import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RELEASE_BRANCH_PREFIXES,
  TARGETS,
  assetName,
  bumpFromLabels,
  eligiblePrs,
  installNotes,
  isReleaseBranch,
  latestVersionTag,
  nextVersion,
  planRelease,
  selectMergedPr,
  stepSummary,
  versionConfig,
} from "./release-plan.mjs";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "release-plan.mjs",
);

interface Pr {
  number: number;
  merge_commit_sha: string;
  merged_at: string | null;
  base: { ref: string };
  head: { ref: string };
  labels: { name: string }[];
}

function pr(
  number: number,
  head: string,
  labels: string[] = [],
  extra: Partial<Pr> = {},
): Pr {
  return {
    number,
    merge_commit_sha: `sha${number}`,
    merged_at: "2026-01-01T00:00:00Z",
    base: { ref: "main" },
    head: { ref: head },
    labels: labels.map((name) => ({ name })),
    ...extra,
  };
}

const HOSTILE = "feat/$(touch pwned)`x`";

describe("isReleaseBranch", () => {
  it("accepts feat/ and fix/ with a name", () => {
    expect(isReleaseBranch("feat/x")).toBe(true);
    expect(isReleaseBranch("fix/y")).toBe(true);
    expect(isReleaseBranch(HOSTILE)).toBe(true);
  });
  it("rejects everything else", () => {
    for (const r of [
      "feat/",
      "fix/",
      "Feat/x",
      "chore/x",
      "main",
      "feature/x",
      "",
      undefined,
      null,
      5,
    ]) {
      expect(isReleaseBranch(r)).toBe(false);
    }
  });
  it("freezes the prefixes", () => {
    expect([...RELEASE_BRANCH_PREFIXES]).toEqual(["feat/", "fix/"]);
    expect(Object.isFrozen(RELEASE_BRANCH_PREFIXES)).toBe(true);
  });
});

describe("bumpFromLabels", () => {
  it("defaults to patch", () => {
    expect(bumpFromLabels([])).toBe("patch");
    expect(bumpFromLabels(["bug", "release:huge", "release:Major"])).toBe(
      "patch",
    );
  });
  it("picks the highest", () => {
    expect(bumpFromLabels(["release:patch", "release:minor"])).toBe("minor");
    expect(bumpFromLabels(["release:minor", "release:major"])).toBe("major");
    expect(bumpFromLabels(["release:major", "release:patch"])).toBe("major");
  });
});

describe("latestVersionTag", () => {
  it("compares numerically", () => {
    expect(latestVersionTag(["v0.9.9", "v0.10.0", "v0.2.0"])).toEqual({
      major: 0,
      minor: 10,
      patch: 0,
      tag: "v0.10.0",
    });
    expect(latestVersionTag(["v1.2.9", "v1.2.10"])?.tag).toBe("v1.2.10");
  });
  it("rejects malformed tags", () => {
    expect(
      latestVersionTag(["v1.2", "v1.2.3-rc.1", "1.2.3", "v01.2.3", "latest"]),
    ).toBeNull();
    expect(latestVersionTag([])).toBeNull();
    expect(latestVersionTag(["v1.2", "v1.0.0"])?.tag).toBe("v1.0.0");
  });
});

describe("nextVersion", () => {
  it("returns the base version on first release", () => {
    expect(nextVersion({ tags: [], bump: "major", baseVersion: "0.1.0" })).toBe(
      "0.1.0",
    );
    expect(
      nextVersion({ tags: ["v1.2"], bump: "patch", baseVersion: "0.1.0" }),
    ).toBe("0.1.0");
  });
  it("bumps the latest tag", () => {
    const tags = ["v0.1.0", "v1.4.7"];
    expect(nextVersion({ tags, bump: "major", baseVersion: "0.1.0" })).toBe(
      "2.0.0",
    );
    expect(nextVersion({ tags, bump: "minor", baseVersion: "0.1.0" })).toBe(
      "1.5.0",
    );
    expect(nextVersion({ tags, bump: "patch", baseVersion: "0.1.0" })).toBe(
      "1.4.8",
    );
  });
  it("throws naming the bad value", () => {
    expect(() =>
      nextVersion({ tags: [], bump: "patch", baseVersion: "0.1" }),
    ).toThrow("0.1");
    expect(() =>
      nextVersion({ tags: [], bump: "huge", baseVersion: "0.1.0" }),
    ).toThrow("huge");
  });
});

describe("selectMergedPr", () => {
  it("selects the PR merged by the sha", () => {
    const a = pr(1, "feat/a", [], { merge_commit_sha: "x" });
    const b = pr(2, "feat/b", [], { merge_commit_sha: "y" });
    expect(selectMergedPr([b, a], "x")).toBe(a);
  });
  it("returns null for no match, unmerged PRs, empty lists", () => {
    expect(selectMergedPr([], "x")).toBeNull();
    expect(
      selectMergedPr([pr(1, "feat/a", [], { merge_commit_sha: "z" })], "x"),
    ).toBeNull();
    expect(
      selectMergedPr(
        [pr(1, "feat/a", [], { merge_commit_sha: "x", merged_at: null })],
        "x",
      ),
    ).toBeNull();
  });
});

describe("eligiblePrs", () => {
  it("filters, de-duplicates and sorts", () => {
    const got = eligiblePrs([
      pr(12, "fix/b"),
      pr(10, "feat/a"),
      pr(10, "feat/a"),
      pr(11, "chore/c"),
      pr(13, "feat/d", [], { base: { ref: "dev" } }),
      pr(14, "feat/e", [], { merged_at: null }),
      null,
    ]);
    expect(got.map((p) => p.number)).toEqual([10, 12]);
  });
});

describe("planRelease", () => {
  const base = {
    tags: ["v0.1.0"],
    mergedTags: ["v0.1.0"],
    headTags: [] as string[],
    baseVersion: "0.1.0",
  };

  it("does nothing when head is already released", () => {
    const p = planRelease({
      ...base,
      prs: [pr(1, "feat/a")],
      headTags: ["v0.1.0"],
    });
    expect(p).toEqual({
      release: false,
      reason: "commit already released as v0.1.0",
    });
  });

  it("does nothing when head is behind the latest release", () => {
    const p = planRelease({
      ...base,
      prs: [pr(1, "feat/a")],
      tags: ["v0.1.0", "v0.3.0"],
    });
    expect(p).toEqual({
      release: false,
      reason: "head is not a descendant of latest release v0.3.0",
    });
  });

  it("does nothing without eligible PRs (with tags)", () => {
    const p = planRelease({ ...base, prs: [pr(1, "chore/a"), null] });
    expect(p).toEqual({
      release: false,
      reason: "no unreleased feat/ or fix/ PR since v0.1.0",
    });
  });

  it("does nothing without eligible PRs (no tags)", () => {
    const p = planRelease({
      prs: [],
      tags: [],
      mergedTags: [],
      headTags: [],
      baseVersion: "0.1.0",
    });
    expect(p).toEqual({
      release: false,
      reason: "no unreleased feat/ or fix/ PR since the start of history",
    });
  });

  it("aggregates the highest bump over all eligible PRs", () => {
    const p = planRelease({
      ...base,
      prs: [
        pr(10, "feat/x", ["release:minor"]),
        pr(11, "fix/y", ["release:patch"]),
        pr(12, "chore/z", ["release:major"]),
        pr(10, "feat/x", ["release:minor"]),
        null,
      ],
    });
    expect(p).toMatchObject({
      release: true,
      version: "0.2.0",
      tag: "v0.2.0",
      bump: "minor",
      prs: [10, 11],
    });
  });

  it("releases the base version first", () => {
    const p = planRelease({
      prs: [pr(1, "feat/a")],
      tags: [],
      mergedTags: [],
      headTags: [],
      baseVersion: "0.1.0",
    });
    expect(p).toMatchObject({ release: true, version: "0.1.0", tag: "v0.1.0" });
  });

  it("never puts PR-supplied text in reason or summary", () => {
    const releasing = planRelease({
      ...base,
      prs: [pr(7, HOSTILE, ["release:`evil`"])],
    });
    const idle = planRelease({ ...base, prs: [pr(7, "chore/x")] });
    for (const p of [releasing, idle]) {
      expect(p.reason).not.toContain("pwned");
      expect(p.reason).not.toContain("`");
      expect(p.reason).not.toMatch(/[\r\n]/);
      expect(stepSummary(p)).not.toContain("pwned");
      expect(stepSummary(p)).not.toContain("evil");
    }
    expect(releasing.release).toBe(true);
  });
});

describe("stepSummary", () => {
  it("lists version, bump and PRs when releasing", () => {
    const md = stepSummary({
      release: true,
      reason: "r",
      version: "1.2.3",
      tag: "v1.2.3",
      bump: "minor",
      prs: [4, 5],
    });
    expect(md).toContain("1.2.3");
    expect(md).toContain("minor");
    expect(md).toContain("#4");
    expect(md).toContain("#5");
  });
  it("shows only the reason when not releasing", () => {
    const md = stepSummary({ release: false, reason: "nothing to do" });
    expect(md).toContain("nothing to do");
    expect(md).not.toContain("Version");
  });
});

describe("TARGETS and assetName", () => {
  it("has the four targets with host triples", () => {
    expect(
      TARGETS.map((t) => [t.id, t.runner, t.bundle, t.rustTriple]),
    ).toEqual([
      ["windows-x64", "windows-latest", "nsis", "x86_64-pc-windows-msvc"],
      ["windows-arm64", "windows-11-arm", "nsis", "aarch64-pc-windows-msvc"],
      ["linux-x86_64", "ubuntu-22.04", "appimage", "x86_64-unknown-linux-gnu"],
      [
        "linux-aarch64",
        "ubuntu-22.04-arm",
        "appimage",
        "aarch64-unknown-linux-gnu",
      ],
    ]);
    expect(Object.isFrozen(TARGETS)).toBe(true);
    expect(Object.isFrozen(TARGETS[0])).toBe(true);
  });
  it("names all four assets", () => {
    expect(TARGETS.map((t) => assetName(t.id, "0.1.0"))).toEqual([
      "Shir_0.1.0_windows_x64-setup.exe",
      "Shir_0.1.0_windows_arm64-setup.exe",
      "Shir_0.1.0_linux_x86_64.AppImage",
      "Shir_0.1.0_linux_aarch64.AppImage",
    ]);
  });
  it("throws on unknown target or bad version", () => {
    expect(() => assetName("mac", "0.1.0")).toThrow("mac");
    expect(() => assetName("windows-x64", "0.1")).toThrow("0.1");
  });
});

function sumsFor(version: string): string {
  return TARGETS.map(
    (t, i) => `${String(i).repeat(64)}  ${assetName(t.id, version)}`,
  ).join("\n");
}

describe("installNotes", () => {
  it("covers install steps and embeds checksums verbatim", () => {
    const sums = sumsFor("0.2.0");
    const md = installNotes("0.2.0", `${sums}\n`);
    expect(md.startsWith("## Install")).toBe(true);
    for (const t of TARGETS) expect(md).toContain(assetName(t.id, "0.2.0"));
    expect(md).toContain("x64");
    expect(md).toContain("arm64");
    expect(md).toContain("More info");
    expect(md).toContain("Run anyway");
    expect(md).toContain("chmod +x");
    expect(md).toContain("libfuse2");
    expect(md).toContain("libfuse2t64");
    expect(md).toContain("sha256sum -c --ignore-missing SHA256SUMS.txt");
    expect(md).toContain("Get-FileHash");
    expect(md).toContain(`## SHA256 checksums\n\n\`\`\`\n${sums}\n\`\`\``);
    expect(md).not.toMatch(/[֐-׿]/);
  });
  it("rejects sums that do not list exactly the four assets", () => {
    expect(() => installNotes("0.2.0", sumsFor("0.1.0"))).toThrow(
      /exactly the four assets/,
    );
    const three = sumsFor("0.2.0").split("\n").slice(1).join("\n");
    expect(() => installNotes("0.2.0", three)).toThrow();
    expect(() =>
      installNotes("0.2.0", `${sumsFor("0.2.0")}\nabc  extra`),
    ).toThrow();
    expect(() => installNotes("bad", sumsFor("0.2.0"))).toThrow("bad");
  });
});

describe("versionConfig", () => {
  it("returns the JSON override", () => {
    expect(versionConfig("1.2.3")).toBe('{"version":"1.2.3"}');
    expect(() => versionConfig("1.2")).toThrow("1.2");
  });
});

describe("release-plan CLI", { timeout: 60_000 }, () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "release-plan-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function put(rel: string, content: string): string {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
    return full;
  }

  function run(args: string[], extraEnv: Record<string, string> = {}) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.GITHUB_OUTPUT;
    delete env.GITHUB_STEP_SUMMARY;
    return spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { ...env, ...extraEnv },
      timeout: 30_000,
    });
  }

  function setup(opts: { tags: string; merged: string; head?: string }) {
    put("commits.txt", "a1\nb2\nc3\n");
    put(
      "pulls/a1.json",
      JSON.stringify([
        pr(10, "feat/x", ["release:minor"], { merge_commit_sha: "a1" }),
      ]),
    );
    put("pulls/b2.json", "[]");
    put(
      "pulls/c3.json",
      JSON.stringify([pr(11, "fix/y", [], { merge_commit_sha: "c3" })]),
    );
    put("tags.txt", opts.tags);
    put("merged.txt", opts.merged);
    put("head.txt", opts.head ?? "");
    put("tauri.conf.json", JSON.stringify({ version: "0.1.0" }));
    return [
      "plan",
      "--commits-file",
      path.join(dir, "commits.txt"),
      "--pulls-dir",
      path.join(dir, "pulls"),
      "--tags-file",
      path.join(dir, "tags.txt"),
      "--merged-tags-file",
      path.join(dir, "merged.txt"),
      "--head-tags-file",
      path.join(dir, "head.txt"),
      "--tauri-conf",
      path.join(dir, "tauri.conf.json"),
    ];
  }

  it("plan: releases and writes stdout, GITHUB_OUTPUT and summary", () => {
    const args = setup({ tags: "v0.1.0\n", merged: "v0.1.0\n" });
    const out = path.join(dir, "gh-output.txt");
    const sum = path.join(dir, "gh-summary.md");
    const res = run(args, { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum });
    expect(res.status).toBe(0);
    for (const line of [
      "release=true",
      "version=0.2.0",
      "tag=v0.2.0",
      "bump=minor",
      "prs=10,11",
    ]) {
      expect(res.stdout).toContain(`${line}\n`);
      expect(readFileSync(out, "utf8")).toContain(`${line}\n`);
    }
    expect(readFileSync(sum, "utf8")).toContain("#10");
    expect(readFileSync(sum, "utf8")).toContain("0.2.0");
  });

  it("plan: does not release when head is behind the latest tag", () => {
    const args = setup({ tags: "v0.1.0\nv0.3.0\n", merged: "v0.1.0\n" });
    const res = run(args);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("release=false\n");
    expect(res.stdout).toContain("not a descendant");
    expect(res.stdout).not.toContain("version=");
  });

  it("plan: first release with empty tag files", () => {
    const args = setup({ tags: "", merged: "" });
    const res = run(args);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("version=0.1.0\n");
  });

  it("plan: exits 1 when a pulls file is missing", () => {
    const args = setup({ tags: "v0.1.0\n", merged: "v0.1.0\n" });
    rmSync(path.join(dir, "pulls", "b2.json"));
    const res = run(args);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/^release-plan: /);
    expect(res.stderr).not.toContain("    at ");
  });

  it("plan: exits 1 on malformed pulls JSON", () => {
    const args = setup({ tags: "v0.1.0\n", merged: "v0.1.0\n" });
    put("pulls/b2.json", "{not json");
    const res = run(args);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/^release-plan: /);
  });

  it("version-config writes the override file", () => {
    const out = path.join(dir, "override.json");
    const res = run(["version-config", "--version", "1.2.3", "--out", out]);
    expect(res.status).toBe(0);
    expect(readFileSync(out, "utf8")).toBe('{"version":"1.2.3"}');
  });

  it("notes prints install notes from a sums file", () => {
    const sums = put("SHA256SUMS.txt", `${sumsFor("0.2.0")}\n`);
    const res = run(["notes", "--version", "0.2.0", "--sums-file", sums]);
    expect(res.status).toBe(0);
    expect(res.stdout.startsWith("## Install")).toBe(true);
    expect(res.stdout).toContain("## SHA256 checksums");
  });

  it("notes exits 1 on a wrong sums file", () => {
    const sums = put("SHA256SUMS.txt", `${sumsFor("0.1.0")}\n`);
    const res = run(["notes", "--version", "0.2.0", "--sums-file", sums]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/^release-plan: /);
  });

  it("asset-name and targets", () => {
    const a = run([
      "asset-name",
      "--target",
      "linux-aarch64",
      "--version",
      "0.1.0",
    ]);
    expect(a.status).toBe(0);
    expect(a.stdout.trim()).toBe("Shir_0.1.0_linux_aarch64.AppImage");
    const t = run(["targets"]);
    expect(t.status).toBe(0);
    expect(t.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(t.stdout)).toEqual(JSON.parse(JSON.stringify(TARGETS)));
  });

  it("errors on unknown command and missing flag", () => {
    const u = run(["bogus"]);
    expect(u.status).toBe(1);
    expect(u.stderr).toMatch(/^release-plan: unknown command/);
    const m = run(["asset-name", "--target", "linux-x86_64"]);
    expect(m.status).toBe(1);
    expect(m.stderr).toMatch(/^release-plan: missing flag --version/);
    const v = run(["asset-name", "--target", "linux-x86_64", "--version", "1"]);
    expect(v.status).toBe(1);
    expect(v.stderr).toMatch(/^release-plan: /);
  });

  it("importing the module does not run the CLI", () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.GITHUB_OUTPUT;
    delete env.GITHUB_STEP_SUMMARY;
    const res = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(pathToFileURL(script).href)})`,
      ],
      { encoding: "utf8", env, timeout: 30_000 },
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toBe("");
  });
});
