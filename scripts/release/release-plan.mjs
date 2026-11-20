// Release decisions for the release workflow: eligible PRs, version bump, next
// version, guards, build targets, asset names, notes and Tauri version override.
// Dependency-free (node: built-ins only); the workflow feeds it files, it never
// calls the network, git or gh.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {"major" | "minor" | "patch"} Bump
 * @typedef {{ major: number, minor: number, patch: number, tag: string }} VersionTag
 * @typedef {{
 *   number: number,
 *   merged_at?: string | null,
 *   merge_commit_sha?: string | null,
 *   base?: { ref?: string },
 *   head?: { ref?: string },
 *   labels?: Array<{ name?: string }>,
 * }} PullRequest
 * @typedef {{
 *   id: string, os: string, arch: string, runner: string,
 *   bundle: string, ext: string, rustTriple: string,
 * }} Target
 * @typedef {{ release: false, reason: string }
 *   | { release: true, reason: string, version: string, tag: string,
 *       bump: Bump, prs: number[] }} Plan
 */

/** Branch prefixes whose merged PRs trigger a release. */
export const RELEASE_BRANCH_PREFIXES = Object.freeze(["feat/", "fix/"]);

/**
 * @param {unknown} ref
 * @returns {boolean}
 */
export function isReleaseBranch(ref) {
  return (
    typeof ref === "string" &&
    RELEASE_BRANCH_PREFIXES.some(
      (p) => ref.startsWith(p) && ref.length > p.length,
    )
  );
}

/** @type {Record<Bump, number>} */
const BUMP_RANK = { patch: 0, minor: 1, major: 2 };

/**
 * @param {unknown} labels label names
 * @returns {Bump}
 */
export function bumpFromLabels(labels) {
  /** @type {Bump} */
  let best = "patch";
  if (!Array.isArray(labels)) return best;
  for (const l of labels) {
    /** @type {Bump | null} */
    let b = null;
    if (l === "release:major") b = "major";
    else if (l === "release:minor") b = "minor";
    else if (l === "release:patch") b = "patch";
    if (b && BUMP_RANK[b] > BUMP_RANK[best]) best = b;
  }
  return best;
}

const TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * @param {unknown} tags
 * @returns {VersionTag | null}
 */
export function latestVersionTag(tags) {
  if (!Array.isArray(tags)) return null;
  /** @type {VersionTag | null} */
  let best = null;
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const m = TAG_RE.exec(t);
    if (!m) continue;
    const cand = {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      tag: t,
    };
    if (
      !best ||
      cand.major > best.major ||
      (cand.major === best.major &&
        (cand.minor > best.minor ||
          (cand.minor === best.minor && cand.patch > best.patch)))
    ) {
      best = cand;
    }
  }
  return best;
}

/**
 * @param {{ tags: unknown, bump: unknown, baseVersion: unknown }} args
 * @returns {string}
 */
export function nextVersion({ tags, bump, baseVersion }) {
  if (typeof baseVersion !== "string" || !VERSION_RE.test(baseVersion)) {
    throw new Error(`invalid base version: ${String(baseVersion)}`);
  }
  if (bump !== "major" && bump !== "minor" && bump !== "patch") {
    throw new Error(`invalid bump: ${String(bump)}`);
  }
  const latest = latestVersionTag(tags);
  if (!latest) return baseVersion;
  if (bump === "major") return `${latest.major + 1}.0.0`;
  if (bump === "minor") return `${latest.major}.${latest.minor + 1}.0`;
  return `${latest.major}.${latest.minor}.${latest.patch + 1}`;
}

/**
 * Pick the PR merged by `sha` from the commits/{sha}/pulls API response.
 * @param {unknown} pulls
 * @param {string} sha
 * @returns {PullRequest | null}
 */
export function selectMergedPr(pulls, sha) {
  if (!Array.isArray(pulls)) return null;
  for (const pr of pulls) {
    if (
      pr &&
      typeof pr === "object" &&
      pr.merge_commit_sha === sha &&
      pr.merged_at != null
    ) {
      return pr;
    }
  }
  return null;
}

/**
 * @param {Array<PullRequest | null | undefined>} prs
 * @returns {PullRequest[]}
 */
export function eligiblePrs(prs) {
  /** @type {Map<number, PullRequest>} */
  const byNumber = new Map();
  for (const pr of prs) {
    if (!pr || typeof pr !== "object") continue;
    if (pr.base?.ref !== "main") continue;
    if (pr.merged_at == null) continue;
    if (!isReleaseBranch(pr.head?.ref)) continue;
    if (!byNumber.has(pr.number)) byNumber.set(pr.number, pr);
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/**
 * @param {{
 *   prs: Array<PullRequest | null | undefined>,
 *   tags: string[], mergedTags: string[], headTags: string[],
 *   baseVersion: string,
 * }} args
 * @returns {Plan}
 */
export function planRelease({ prs, tags, mergedTags, headTags, baseVersion }) {
  const atHead = latestVersionTag(headTags);
  if (atHead) {
    return {
      release: false,
      reason: `commit already released as ${atHead.tag}`,
    };
  }
  const latest = latestVersionTag(tags);
  if (latest && !mergedTags.includes(latest.tag)) {
    return {
      release: false,
      reason: `head is not a descendant of latest release ${latest.tag}`,
    };
  }
  const eligible = eligiblePrs(prs);
  if (eligible.length === 0) {
    const since = latest ? latest.tag : "the start of history";
    return {
      release: false,
      reason: `no unreleased feat/ or fix/ PR since ${since}`,
    };
  }
  /** @type {Bump} */
  let bump = "patch";
  for (const pr of eligible) {
    const b = bumpFromLabels(
      (pr.labels ?? []).map((l) => (l ? l.name : undefined)),
    );
    if (BUMP_RANK[b] > BUMP_RANK[bump]) bump = b;
  }
  const version = nextVersion({ tags, bump, baseVersion });
  const numbers = eligible.map((p) => p.number);
  return {
    release: true,
    reason: `releasing v${version} (${bump}) with ${numbers
      .map((n) => `#${n}`)
      .join(", ")}`,
    version,
    tag: `v${version}`,
    bump,
    prs: numbers,
  };
}

/**
 * @param {Plan} plan
 * @returns {string}
 */
export function stepSummary(plan) {
  const lines = ["## Release plan", "", `- Decision: ${plan.reason}`];
  if (plan.release) {
    lines.push(`- Version: ${plan.version}`, `- Bump: ${plan.bump}`);
    lines.push(`- PRs: ${plan.prs.map((n) => `#${n}`).join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Build matrix targets; `rustTriple` is the host triple for the build. */
export const TARGETS = Object.freeze(
  /** @type {readonly Target[]} */ ([
    {
      id: "windows-x64",
      os: "windows",
      arch: "x64",
      runner: "windows-latest",
      bundle: "nsis",
      ext: "-setup.exe",
      rustTriple: "x86_64-pc-windows-msvc",
    },
    {
      id: "windows-arm64",
      os: "windows",
      arch: "arm64",
      runner: "windows-11-arm",
      bundle: "nsis",
      ext: "-setup.exe",
      rustTriple: "aarch64-pc-windows-msvc",
    },
    {
      id: "linux-x86_64",
      os: "linux",
      arch: "x86_64",
      runner: "ubuntu-22.04",
      bundle: "appimage",
      ext: ".AppImage",
      rustTriple: "x86_64-unknown-linux-gnu",
    },
    {
      id: "linux-aarch64",
      os: "linux",
      arch: "aarch64",
      runner: "ubuntu-22.04-arm",
      bundle: "appimage",
      ext: ".AppImage",
      rustTriple: "aarch64-unknown-linux-gnu",
    },
  ]).map((t) => Object.freeze(t)),
);

/**
 * @param {string} version
 */
function assertVersion(version) {
  if (typeof version !== "string" || !VERSION_RE.test(version)) {
    throw new Error(`invalid version: ${String(version)}`);
  }
}

/**
 * @param {string} targetId
 * @param {string} version
 * @returns {string}
 */
export function assetName(targetId, version) {
  const t = TARGETS.find((x) => x.id === targetId);
  if (!t) throw new Error(`unknown target: ${String(targetId)}`);
  assertVersion(version);
  return `Shir_${version}_${t.os}_${t.arch}${t.ext}`;
}

/**
 * @param {string} version
 * @param {string} sums contents of SHA256SUMS.txt
 * @returns {string}
 */
export function installNotes(version, sums) {
  assertVersion(version);
  const names = TARGETS.map((t) => assetName(t.id, version));
  const listed = String(sums)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => l.replace(/^\S+\s+\*?/, ""));
  const ok =
    listed.length === names.length &&
    new Set(listed).size === names.length &&
    names.every((n) => listed.includes(n));
  if (!ok) {
    throw new Error(
      `SHA256SUMS.txt must list exactly the four assets for ${version}`,
    );
  }
  const [winX64, winArm, linX64, linArm] = names;
  const body = [
    "## Install",
    "",
    "Pick the download that matches your CPU: x64 (Intel/AMD 64-bit) or arm64/aarch64 (ARM 64-bit).",
    "",
    "| Platform | Architecture | Download |",
    "| --- | --- | --- |",
    `| Windows | x64 | \`${winX64}\` |`,
    `| Windows | arm64 | \`${winArm}\` |`,
    `| Linux | x86_64 | \`${linX64}\` |`,
    `| Linux | aarch64 | \`${linArm}\` |`,
    "",
    "### Windows",
    "",
    "Run the `setup.exe` installer. The installers are unsigned, so SmartScreen shows",
    '"Windows protected your PC": click **More info**, then **Run anyway**.',
    "",
    "### Linux",
    "",
    "Make the AppImage executable, then run it:",
    "",
    "```sh",
    `chmod +x ${linX64}`,
    `./${linX64}`,
    "```",
    "",
    "AppImages need FUSE 2 (`libfuse2`, or `libfuse2t64` on Ubuntu 24.04).",
    "",
    "### Verify your download",
    "",
    "Linux:",
    "",
    "```sh",
    "sha256sum -c --ignore-missing SHA256SUMS.txt",
    "```",
    "",
    "Windows (PowerShell):",
    "",
    "```powershell",
    `Get-FileHash .\\${winX64} -Algorithm SHA256`,
    "```",
    "",
    "## SHA256 checksums",
    "",
    "```",
    String(sums).replace(/\s+$/, ""),
    "```",
    "",
  ];
  return body.join("\n");
}

/**
 * @param {string} version
 * @returns {string}
 */
export function versionConfig(version) {
  assertVersion(version);
  return JSON.stringify({ version });
}

// ---------------------------------------------------------------- CLI

/**
 * @param {string[]} args
 * @param {string[]} required
 * @returns {(name: string) => string} flag getter (all required flags checked)
 */
function parseFlags(args, required) {
  /** @type {Record<string, string>} */
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i];
    const v = args[i + 1];
    if (!k || !k.startsWith("--") || v === undefined) {
      throw new Error(`bad arguments near ${k ?? "(end)"}`);
    }
    flags[k.slice(2)] = v;
  }
  for (const r of required) {
    if (flags[r] === undefined) throw new Error(`missing flag --${r}`);
  }
  return (name) => {
    const v = flags[name];
    if (v === undefined) throw new Error(`missing flag --${name}`);
    return v;
  };
}

/**
 * @param {string} file
 * @returns {string[]}
 */
function readLines(file) {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/**
 * @param {string} file
 * @returns {unknown}
 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(
      `cannot read JSON ${file}: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
}

/**
 * @param {string[]} args
 * @returns {string}
 */
function cmdPlan(args) {
  const f = parseFlags(args, [
    "commits-file",
    "pulls-dir",
    "tags-file",
    "merged-tags-file",
    "head-tags-file",
    "tauri-conf",
  ]);
  const conf = /** @type {{ version?: unknown }} */ (readJson(f("tauri-conf")));
  const baseVersion = conf && conf.version;
  if (typeof baseVersion !== "string") {
    throw new Error(`no version in ${f("tauri-conf")}`);
  }
  /** @type {PullRequest[]} */
  const prs = [];
  for (const sha of readLines(f("commits-file"))) {
    const pulls = readJson(path.join(f("pulls-dir"), `${sha}.json`));
    if (!Array.isArray(pulls)) {
      throw new Error(`pulls for ${sha} is not a JSON array`);
    }
    const pr = selectMergedPr(pulls, sha);
    if (pr) prs.push(pr);
  }
  const plan = planRelease({
    prs,
    tags: readLines(f("tags-file")),
    mergedTags: readLines(f("merged-tags-file")),
    headTags: readLines(f("head-tags-file")),
    baseVersion,
  });
  const out = [`release=${plan.release}`, `reason=${plan.reason}`];
  if (plan.release) {
    out.push(
      `version=${plan.version}`,
      `tag=${plan.tag}`,
      `bump=${plan.bump}`,
      `prs=${plan.prs.join(",")}`,
    );
  }
  const text = `${out.join("\n")}\n`;
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, stepSummary(plan));
  }
  return text;
}

/**
 * Run the CLI; returns text for stdout. Throws on error.
 * @param {string[]} argv
 * @returns {string}
 */
function run(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case "plan":
      return cmdPlan(rest);
    case "version-config": {
      const f = parseFlags(rest, ["version", "out"]);
      writeFileSync(f("out"), versionConfig(f("version")));
      return "";
    }
    case "notes": {
      const f = parseFlags(rest, ["version", "sums-file"]);
      return `${installNotes(f("version"), readFileSync(f("sums-file"), "utf8"))}`;
    }
    case "asset-name": {
      const f = parseFlags(rest, ["target", "version"]);
      return `${assetName(f("target"), f("version"))}\n`;
    }
    case "targets":
      return `${JSON.stringify(TARGETS)}\n`;
    default:
      throw new Error(`unknown command: ${String(command)}`);
  }
}

/** CLI entry point; returns the process exit code. */
function main() {
  try {
    process.stdout.write(run(process.argv.slice(2)));
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`release-plan: ${msg.split(/\r?\n/)[0]}\n`);
    return 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}
