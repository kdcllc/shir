// G9 contract: .github/workflows/release.yml (trigger and gate, least privilege,
// script delegation, native targets, no expression interpolation in `run:`,
// publish command) and ci.yml's debug-bundle upload. Every check is a pure
// helper `(yamlText) => string[]` of problems, asserted empty on the real file,
// empty on a minimal good sample (true negative) and non-empty on synthetic
// violating samples (true positives). No YAML library: line/regex parsing.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TARGETS } from "./release/release-plan.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const abs = (rel: string): string => path.join(repoRoot, rel);
const read = (rel: string): string => readFileSync(abs(rel), "utf8");

interface Manifest {
  scripts?: Record<string, string>;
}
const readManifest = (dir: string): Manifest =>
  JSON.parse(read(`${dir}/package.json`)) as Manifest;
const rootScripts = readManifest(".").scripts ?? {};

const WORKSPACES: Record<string, string> = {
  "apps/desktop": "desktop",
  "packages/chord-core": "chord-core",
  "packages/chord-render": "chord-render",
  "packages/test-fixtures": "test-fixtures",
  e2e: "e2e",
};

const RELEASE = ".github/workflows/release.yml";
const CI = ".github/workflows/ci.yml";

// ---------------------------------------------------------------------------
// line-based YAML helpers
// ---------------------------------------------------------------------------

const indentOf = (l: string): number => /^ */.exec(l)?.[0].length ?? 0;
const lines = (t: string): string[] => t.split(/\r?\n/);
const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Lines after `lines[idx]` that are blank or indented deeper than it. */
function bodyAfter(all: string[], idx: number): string[] {
  const base = indentOf(all[idx] ?? "");
  const out: string[] = [];
  for (let j = idx + 1; j < all.length; j++) {
    const l = all[j] ?? "";
    if (l.trim() !== "" && indentOf(l) <= base) break;
    out.push(l);
  }
  return out;
}

interface Key {
  value: string;
  body: string[];
}

/** Key at exactly `indent` columns within `all`; undefined when absent. */
function keyAt(all: string[], key: string, indent: number): Key | undefined {
  const re = new RegExp(`^ {${indent}}${key}:\\s*(.*)$`);
  for (let i = 0; i < all.length; i++) {
    const m = re.exec(all[i] ?? "");
    if (m) return { value: (m[1] ?? "").trim(), body: bodyAfter(all, i) };
  }
  return undefined;
}

const topKey = (yaml: string, key: string): Key | undefined =>
  keyAt(lines(yaml), key, 0);

function jobs(yaml: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const section = topKey(yaml, "jobs");
  if (!section) return out;
  let name: string | undefined;
  for (const l of section.body) {
    const m = /^ {2}([\w-]+):\s*$/.exec(l);
    if (m) {
      name = m[1];
      out.set(name ?? "", []);
    } else if (name !== undefined) {
      out.get(name)?.push(l);
    }
  }
  return out;
}

const jobKey = (job: string[], key: string): Key | undefined =>
  keyAt(job, key, 4);

/** Steps of a job as arrays of lines (each step starts at `      - `). */
function stepsOf(job: string[]): string[][] {
  const steps = jobKey(job, "steps");
  if (!steps) return [];
  const out: string[][] = [];
  for (const l of steps.body) {
    if (/^ {6}- /.test(l)) out.push([l]);
    else if (l.trim() !== "") out.at(-1)?.push(l);
  }
  return out;
}

function allSteps(yaml: string): { job: string; text: string }[] {
  return [...jobs(yaml)].flatMap(([job, jl]) =>
    stepsOf(jl).map((s) => ({ job, text: s.join("\n") })),
  );
}

/** Flow-sequence value `[a, b]` -> items; undefined when not a flow sequence. */
function flowList(value: string | undefined): string[] | undefined {
  const m = /^\[(.*)\]$/.exec((value ?? "").trim());
  if (!m) return undefined;
  return (m[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** `key: value` pairs of a simple mapping body. */
function mapOf(key: Key | undefined): Record<string, string> | undefined {
  if (!key) return undefined;
  if (key.value !== "") return { "*": key.value };
  const out: Record<string, string> = {};
  for (const l of key.body) {
    const m = /^\s+([\w-]+):\s*(.*)$/.exec(l);
    if (m) out[m[1] ?? ""] = (m[2] ?? "").trim();
  }
  return out;
}

/** Scalar text of a key: a block scalar's body (folded) or the inline value. */
function scalarOf(key: Key | undefined): string {
  if (!key) return "";
  if (/^[|>]/.test(key.value)) return squash(key.body.join(" "));
  return squash(key.value);
}

/** Every `run:` value (inline, `- run:`, block-scalar bodies) as joined lines. */
function runTexts(yaml: string): string[] {
  const all = lines(yaml);
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const m = /^(\s*)(-\s+)?run:\s*(.*)$/.exec(all[i] ?? "");
    if (!m) continue;
    const keyCol = (m[1] ?? "").length + (m[2] ?? "").length;
    const value = (m[3] ?? "").trim();
    const parts: string[] = /^[|>]/.test(value) || value === "" ? [] : [value];
    let j = i + 1;
    for (; j < all.length; j++) {
      const l = all[j] ?? "";
      if (l.trim() === "") continue;
      if (indentOf(l) <= keyCol) break;
      parts.push(l.trim());
    }
    i = j - 1;
    out.push(parts.join("\n"));
  }
  return out;
}

/** Run commands with backslash continuations joined onto one line. */
const runCommands = (yaml: string): string[] =>
  runTexts(yaml)
    .join("\n")
    .replace(/\\\r?\n\s*/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

// ---------------------------------------------------------------------------
// checks on release.yml
// ---------------------------------------------------------------------------

/** 1. Only `workflow_run` on the CI workflow, completed, branches [main]. */
function checkTrigger(release: string, ciName: string): string[] {
  const p: string[] = [];
  const on = topKey(release, "on");
  if (!on) return ["no top-level `on:`"];
  if (on.value !== "") return [`\`on:\` must be a mapping, got '${on.value}'`];
  const keys = on.body.flatMap((l) => {
    const m = /^ {2}([\w-]+):/.exec(l);
    return m ? [m[1] ?? ""] : [];
  });
  if (keys.join(",") !== "workflow_run") {
    p.push(`triggers must be only workflow_run, got [${keys.join(", ")}]`);
  }
  const wr = keyAt(on.body, "workflow_run", 2);
  const sub = (k: string): string[] | undefined => {
    const v = keyAt(wr?.body ?? [], k, 4)?.value;
    return flowList(v);
  };
  const workflows = sub("workflows");
  if (workflows?.join(",") !== ciName) {
    p.push(
      `workflows must be [${ciName}] (ci.yml name), got ${String(workflows)}`,
    );
  }
  if (sub("types")?.join(",") !== "completed")
    p.push("types must be [completed]");
  if (sub("branches")?.join(",") !== "main") p.push("branches must be [main]");
  return p;
}

/** 2. Gate on the plan job; build and publish depend on the plan decision. */
function checkGate(release: string): string[] {
  const p: string[] = [];
  const all = jobs(release);
  const plan = all.get("plan");
  if (!plan) return ["no plan job"];
  const gate = scalarOf(jobKey(plan, "if"));
  for (const needle of [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    "github.event.workflow_run.head_repository.full_name == github.repository",
  ]) {
    if (!gate.includes(needle)) p.push(`plan gate lacks: ${needle}`);
  }
  for (const name of ["build", "publish"]) {
    const g = scalarOf(jobKey(all.get(name) ?? [], "if"));
    if (g !== "needs.plan.outputs.release == 'true'") {
      p.push(`${name} must be gated on needs.plan.outputs.release == 'true'`);
    }
  }
  return p;
}

/** 3. Serialised releases that never cancel an in-flight publish. */
function checkConcurrency(release: string): string[] {
  const p: string[] = [];
  const m = mapOf(topKey(release, "concurrency"));
  if (!m?.group) p.push("concurrency group is not set");
  if (m?.["cancel-in-progress"] !== "false") {
    p.push("concurrency cancel-in-progress must be false");
  }
  return p;
}

/** 4. Least privilege (Phase 3 note N-b). */
function checkPermissions(release: string): string[] {
  const p: string[] = [];
  const same = (
    got: Record<string, string> | undefined,
    want: Record<string, string>,
  ): boolean =>
    got !== undefined &&
    JSON.stringify(Object.entries(got).sort()) ===
      JSON.stringify(Object.entries(want).sort());
  if (!same(mapOf(topKey(release, "permissions")), { contents: "read" })) {
    p.push("top-level permissions must be exactly {contents: read}");
  }
  const allowed: Record<string, Record<string, string>> = {
    plan: { contents: "read", "pull-requests": "read" },
    build: { contents: "read" },
    publish: { contents: "write" },
  };
  for (const [name, job] of jobs(release)) {
    const got = mapOf(jobKey(job, "permissions"));
    const want = allowed[name];
    if (!want) {
      p.push(`unexpected job '${name}'`);
      continue;
    }
    if (!same(got, want)) {
      p.push(
        `job '${name}' permissions must be exactly ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
      );
    }
  }
  for (const [name, job] of jobs(release)) {
    if (name === "publish") continue;
    if (
      /\bwrite(-all)?\b/.test(jobKey(job, "permissions")?.body.join("\n") ?? "")
    ) {
      p.push(`job '${name}' grants a write permission`);
    }
  }
  return p;
}

/** 5. Delegation to release-plan.mjs and a matrix from the plan's output. */
function checkScriptDelegation(release: string): string[] {
  const p: string[] = [];
  const cmds = runCommands(release);
  const find = (sub: string): string | undefined =>
    cmds.find((c) => new RegExp(`release-plan\\.mjs\\s+${sub}\\b`).test(c));
  const plan = find("plan");
  if (!plan) p.push("no `release-plan.mjs plan` invocation");
  else {
    for (const f of [
      "--commits-file",
      "--pulls-dir",
      "--merged-tags-file",
      "--head-tags-file",
    ]) {
      if (!plan.includes(f)) p.push(`plan invocation lacks ${f}`);
    }
  }
  for (const sub of ["targets", "version-config", "asset-name"]) {
    if (!find(sub)) p.push(`no \`release-plan.mjs ${sub}\` invocation`);
  }
  const notes = find("notes");
  if (!notes?.includes("--sums-file")) {
    p.push("no `release-plan.mjs notes --sums-file` invocation");
  }
  const all = jobs(release);
  const build = all.get("build") ?? [];
  const matrix = keyAt(keyAt(build, "strategy", 4)?.body ?? [], "matrix", 6);
  const target = keyAt(matrix?.body ?? [], "target", 8)?.value ?? "";
  if (
    !/^\$\{\{\s*fromJSON\(needs\.plan\.outputs\.targets\)\s*\}\}$/.test(target)
  ) {
    p.push("matrix.target must be fromJSON(needs.plan.outputs.targets)");
  }
  if (
    (matrix?.body ?? []).some((l) => /\b(include|runner|runs-on|os):/.test(l))
  ) {
    p.push("matrix must not hard-code a runner list");
  }
  const outputs = jobKey(all.get("plan") ?? [], "outputs")?.body.join("\n");
  if (!/^\s+targets:\s*\S/m.test(outputs ?? "")) {
    p.push("plan job lacks a `targets` output");
  }
  return p;
}

interface TargetLike {
  runner: string;
  bundle: string;
  rustTriple: string;
  os: string;
}

/** 6. The four Phase 1 native targets (takes the script's TARGETS array). */
function checkTargets(targets: readonly TargetLike[]): string[] {
  const p: string[] = [];
  const want: Record<string, { triple: string; bundle: string }> = {
    "windows-latest": {
      triple: "x86_64-pc-windows-msvc",
      bundle: "nsis",
    },
    "windows-11-arm": {
      triple: "aarch64-pc-windows-msvc",
      bundle: "nsis",
    },
    "ubuntu-22.04": {
      triple: "x86_64-unknown-linux-gnu",
      bundle: "appimage",
    },
    "ubuntu-22.04-arm": {
      triple: "aarch64-unknown-linux-gnu",
      bundle: "appimage",
    },
  };
  if (targets.length !== 4) p.push(`expected 4 targets, got ${targets.length}`);
  const runners = targets.map((t) => t.runner).sort();
  if (runners.join(",") !== Object.keys(want).sort().join(",")) {
    p.push(`runners differ: ${runners.join(", ")}`);
  }
  for (const t of targets) {
    const w = want[t.runner];
    if (!w) continue;
    if (t.rustTriple !== w.triple) {
      p.push(`${t.runner}: rustTriple ${t.rustTriple} != ${w.triple}`);
    }
    if (t.bundle !== w.bundle) {
      p.push(`${t.runner}: bundle ${t.bundle} != ${w.bundle}`);
    }
  }
  const bundles = [...new Set(targets.map((t) => t.bundle))].sort();
  if (bundles.join(",") !== "appimage,nsis") {
    p.push(`bundles must be {nsis, appimage}, got {${bundles.join(", ")}}`);
  }
  return p;
}

/** 7. Architecture guard precedes a correctly shaped tauri build step. */
function checkBuildSteps(release: string): string[] {
  const p: string[] = [];
  const build = jobs(release).get("build");
  if (!build) return ["no build job"];
  const steps = stepsOf(build).map((s) => s.join("\n"));
  const guard = steps.findIndex(
    (s) =>
      /rustc -vV/.test(s) &&
      /host:/.test(s) &&
      /matrix\.target\.rustTriple/.test(s) &&
      /exit 1/.test(s),
  );
  const tauri = steps.findIndex((s) => /pnpm tauri build\b/.test(s));
  if (guard < 0) p.push("no step compares rustc -vV host with rustTriple");
  if (tauri < 0) p.push("no `pnpm tauri build` step");
  if (guard >= 0 && tauri >= 0 && guard >= tauri) {
    p.push("architecture guard must come before the build step");
  }
  const cmd = runCommands(steps[tauri] ?? "").find((c) =>
    /pnpm tauri build\b/.test(c),
  );
  if (cmd) {
    if (!/--bundles\s/.test(cmd)) p.push("build lacks --bundles");
    if (!/--config\s/.test(cmd)) p.push("build lacks --config");
    if (/--debug\b/.test(cmd)) p.push("build must not use --debug");
    if (/--target\b/.test(cmd)) p.push("build must not use --target");
  }
  return p;
}

/** 8. No `${{` inside any `run:` value (TS port of task 02 AC4's awk scanner). */
function checkRunInterpolation(yaml: string): string[] {
  const p: string[] = [];
  const all = lines(yaml);
  for (let i = 0; i < all.length; i++) {
    const m = /^(\s*)(-\s+)?run:\s*(.*)$/.exec(all[i] ?? "");
    if (!m) continue;
    const keyCol = (m[1] ?? "").length + (m[2] ?? "").length;
    const value = m[3] ?? "";
    if (!/^[|>]/.test(value) && value.includes("${{")) {
      p.push(`line ${i + 1}: ${all[i]?.trim()}`);
    }
    // Block-scalar body, or continuation lines of a multi-line plain scalar
    // (note N-g): everything indented deeper than the `run:` key.
    let j = i + 1;
    for (; j < all.length; j++) {
      const l = all[j] ?? "";
      if (l.trim() === "") continue;
      if (indentOf(l) <= keyCol) break;
      if (l.includes("${{")) p.push(`line ${j + 1}: ${l.trim()}`);
    }
    i = j - 1;
  }
  return p;
}

/** 9. Publish step: `gh release create` flags, checksum asset and notes. */
function checkPublish(release: string): string[] {
  const p: string[] = [];
  const publish = jobs(release).get("publish");
  if (!publish) return ["no publish job"];
  const cmds = runCommands(publish.join("\n"));
  const create = cmds.find((c) => /\bgh release create\b/.test(c));
  if (!create) return ["no `gh release create` command in publish"];
  for (const f of [
    "--target",
    "--generate-notes",
    "--latest",
    "--notes-file",
  ]) {
    if (!new RegExp(`${f}(\\s|$)`).test(create))
      p.push(`gh release create lacks ${f}`);
  }
  if (!/\bSHA256SUMS\.txt\b/.test(create)) {
    p.push("SHA256SUMS.txt is not uploaded by gh release create");
  }
  const notes = cmds.find((c) => /release-plan\.mjs\s+notes\b/.test(c));
  if (!notes?.includes("--sums-file")) {
    p.push("notes are not produced by `notes --sums-file`");
  }
  const notesOut = /--notes-file\s+(\S+)/
    .exec(create)?.[1]
    ?.replace(/^\.\.\//, "");
  if (notes && notesOut && !new RegExp(`>\\s*${notesOut}\\b`).test(notes)) {
    p.push(`--notes-file ${notesOut} is not what the notes command writes`);
  }
  if (!cmds.some((c) => /\bsha256sum\b.*>\s*SHA256SUMS\.txt/.test(c))) {
    p.push("SHA256SUMS.txt is not written with sha256sum");
  }
  return p;
}

/** 10. Every actions/checkout step sets persist-credentials: false. */
function checkCheckout(yaml: string): string[] {
  const steps = allSteps(yaml).filter((s) =>
    /uses:\s*actions\/checkout@/.test(s.text),
  );
  const p = steps
    .filter((s) => !/persist-credentials:\s*false\b/.test(s.text))
    .map((s) => `${s.job}: checkout without persist-credentials: false`);
  if (steps.length === 0) p.push("no actions/checkout step found");
  return p;
}

const PNPM_BUILTINS = new Set([
  "install",
  "i",
  "add",
  "exec",
  "dlx",
  "store",
  "config",
  "run",
  "-v",
  "--version",
]);

function pnpmPairs(commands: string[]): string[] {
  const out = new Set<string>();
  for (const cmd of commands) {
    for (const m of cmd.matchAll(
      /\bpnpm\s+(?:--filter\s+(\S+)\s+)?(?:run\s+)?(-{0,2}[a-z][\w:-]*)/g,
    )) {
      const script = m[2] ?? "";
      if (PNPM_BUILTINS.has(script)) continue;
      out.add(`${m[1] ?? "root"} ${script}`);
    }
  }
  return [...out].sort();
}

function resolvePair(pair: string): boolean {
  const [scope = "", script = ""] = pair.split(" ");
  if (scope === "root") return script in rootScripts;
  const dir = Object.keys(WORKSPACES).find((d) => WORKSPACES[d] === scope);
  return dir !== undefined && script in (readManifest(dir).scripts ?? {});
}

/** 11. Every pnpm script invoked in `run:` resolves to an existing script. */
function checkPnpmScripts(yaml: string): string[] {
  return pnpmPairs(runCommands(yaml))
    .filter((pair) => !resolvePair(pair))
    .map((pair) => `pnpm script does not resolve: ${pair}`);
}

/** ci.yml: the debug-bundle upload stays, skipped only on pull requests. */
function checkCiDebugBundle(ci: string): string[] {
  const step = allSteps(ci).find((s) =>
    /name:\s*Upload debug bundles\b/.test(s.text),
  );
  if (!step) return ["no `Upload debug bundles` step"];
  const p: string[] = [];
  if (!/^\s*if:\s*github\.event_name != 'pull_request'\s*$/m.test(step.text)) {
    p.push(
      "Upload debug bundles lacks `if: github.event_name != 'pull_request'`",
    );
  }
  if (!/uses:\s*actions\/upload-artifact@/.test(step.text)) {
    p.push("Upload debug bundles does not use actions/upload-artifact");
  }
  return p;
}

// ---------------------------------------------------------------------------
// synthetic samples (`@{{` stands for the expression opener)
// ---------------------------------------------------------------------------

const y = (s: string): string => s.replaceAll("@{{", "${{");

const GOOD_RELEASE = y(String.raw`name: Release
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
permissions:
  contents: read
concurrency:
  group: release
  cancel-in-progress: false
jobs:
  plan:
    if: >-
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'push' &&
      github.event.workflow_run.head_branch == 'main' &&
      github.event.workflow_run.head_repository.full_name == github.repository
    runs-on: ubuntu-22.04
    permissions:
      contents: read
      pull-requests: read
    outputs:
      targets: @{{ steps.targets.outputs.targets }}
    steps:
      - uses: actions/checkout@v7
        with:
          ref: @{{ github.event.workflow_run.head_sha }}
          persist-credentials: false
      - name: Plan release
        id: plan
        run: |
          node scripts/release/release-plan.mjs plan \
            --commits-file c.txt \
            --pulls-dir pulls \
            --tags-file t.txt \
            --merged-tags-file m.txt \
            --head-tags-file h.txt
      - name: Build target list
        id: targets
        run: echo "targets=$(node scripts/release/release-plan.mjs targets)" >> "$GITHUB_OUTPUT"
  build:
    needs: plan
    if: needs.plan.outputs.release == 'true'
    runs-on: @{{ matrix.target.runner }}
    permissions:
      contents: read
    strategy:
      matrix:
        target: @{{ fromJSON(needs.plan.outputs.targets) }}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - name: Assert host architecture
        env:
          EXPECTED_TRIPLE: @{{ matrix.target.rustTriple }}
        run: |
          host="$(rustc -vV | sed -n 's/^host: //p')"
          if [ "$host" != "$EXPECTED_TRIPLE" ]; then
            exit 1
          fi
      - name: Build bundle
        env:
          VERSION: @{{ needs.plan.outputs.version }}
        run: |
          node scripts/release/release-plan.mjs version-config --version "$VERSION" --out v.json
          pnpm tauri build --bundles "$BUNDLE" --config v.json
      - name: Collect asset
        run: |
          asset="$(node scripts/release/release-plan.mjs asset-name --target "$T" --version "$V")"
  publish:
    needs: [plan, build]
    if: needs.plan.outputs.release == 'true'
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - name: Checksums
        run: |
          sha256sum a b > SHA256SUMS.txt
          node scripts/release/release-plan.mjs notes --version "$V" --sums-file SHA256SUMS.txt > notes.md
      - name: Create release
        run: |
          gh release create "$TAG" a SHA256SUMS.txt \
            --target "$SHA" \
            --notes-file notes.md \
            --generate-notes \
            --latest
`);

/** Replace `from` with `to`; throws when `from` is absent so a TP cannot go vacuous. */
function mutate(text: string, from: string, to: string): string {
  if (!text.includes(from))
    throw new Error(`mutation target not found: ${from}`);
  return text.replace(from, to);
}

type Check = (yaml: string) => string[];
type Mutation = [name: string, from: string, to: string];

function describeCheck(
  title: string,
  check: Check,
  mutations: Mutation[],
  real: () => string = () => read(RELEASE),
): void {
  describe(title, () => {
    it("passes on the real file", () => {
      expect(check(real())).toEqual([]);
    });
    it("passes on the minimal good sample (true negative)", () => {
      expect(check(GOOD_RELEASE)).toEqual([]);
    });
    it.each(mutations)("flags %s (true positive)", (_name, from, to) => {
      expect(
        check(mutate(GOOD_RELEASE, y(from), y(to))).length,
      ).toBeGreaterThan(0);
    });
  });
}

// ---------------------------------------------------------------------------

describe("release.yml contract", () => {
  const release = read(RELEASE);
  const ciName = /^name:\s*(.+?)\s*$/m.exec(read(CI))?.[1] ?? "";

  it("reads the CI workflow name from ci.yml", () => {
    expect(ciName).toBe("CI");
  });

  describe("1. trigger", () => {
    it("passes on the real file", () => {
      expect(checkTrigger(release, ciName)).toEqual([]);
    });
    it("passes on the good sample (true negative)", () => {
      expect(checkTrigger(GOOD_RELEASE, "CI")).toEqual([]);
    });
    it.each<Mutation>([
      [
        "an added push trigger",
        "on:\n  workflow_run:",
        "on:\n  push:\n    branches: [main]\n  workflow_run:",
      ],
      [
        "workflow_dispatch",
        "on:\n  workflow_run:",
        "on:\n  workflow_dispatch:\n  workflow_run:",
      ],
      [
        "pull_request",
        "on:\n  workflow_run:",
        "on:\n  pull_request:\n  workflow_run:",
      ],
      ["another workflow name", "workflows: [CI]", "workflows: [Build]"],
      ["other types", "types: [completed]", "types: [requested]"],
      ["other branches", "branches: [main]", "branches: [main, dev]"],
    ])("flags %s (true positive)", (_n, from, to) => {
      expect(
        checkTrigger(mutate(GOOD_RELEASE, from, to), "CI").length,
      ).toBeGreaterThan(0);
    });
    it("flags a workflow name that differs from ci.yml's name", () => {
      expect(checkTrigger(GOOD_RELEASE, "Other").length).toBeGreaterThan(0);
    });
    it("flags the inline `on: push` form", () => {
      expect(checkTrigger("name: R\non: push\njobs:\n", "CI")).not.toEqual([]);
    });
  });

  describeCheck("2. gate condition", checkGate, [
    [
      "a missing conclusion clause",
      "github.event.workflow_run.conclusion == 'success' &&\n      ",
      "",
    ],
    [
      "a missing event clause",
      "github.event.workflow_run.event == 'push'",
      "true",
    ],
    [
      "a missing branch clause",
      "github.event.workflow_run.head_branch == 'main'",
      "true",
    ],
    [
      "a missing fork guard",
      "github.event.workflow_run.head_repository.full_name == github.repository",
      "true",
    ],
    [
      "an ungated build job",
      "    needs: plan\n    if: needs.plan.outputs.release == 'true'",
      "    needs: plan",
    ],
  ]);

  describeCheck("3. concurrency", checkConcurrency, [
    [
      "cancel-in-progress: true",
      "cancel-in-progress: false",
      "cancel-in-progress: true",
    ],
    ["a missing group", "  group: release\n", ""],
  ]);

  it("3b. flags cancel-in-progress: true substituted into the real file (mutation)", () => {
    const mutated = mutate(
      release,
      "cancel-in-progress: false",
      "cancel-in-progress: true",
    );
    expect(checkConcurrency(mutated)).toEqual([
      "concurrency cancel-in-progress must be false",
    ]);
  });

  describeCheck("4. permissions", checkPermissions, [
    [
      "a top-level write",
      "permissions:\n  contents: read\nconcurrency",
      "permissions:\n  contents: write\nconcurrency",
    ],
    [
      "write-all at the top",
      "permissions:\n  contents: read\nconcurrency",
      "permissions: write-all\nconcurrency",
    ],
    [
      "contents: write on the build job",
      "    permissions:\n      contents: read\n    strategy",
      "    permissions:\n      contents: write\n    strategy",
    ],
    [
      "an extra grant on the publish job",
      "      contents: write\n",
      "      contents: write\n      id-token: write\n",
    ],
    [
      "pull-requests: write on the plan job",
      "pull-requests: read",
      "pull-requests: write",
    ],
    [
      "an extra grant on the build job",
      "    permissions:\n      contents: read\n    strategy",
      "    permissions:\n      contents: read\n      actions: read\n    strategy",
    ],
    [
      "a publish job without contents: write",
      "      contents: write\n",
      "      contents: read\n",
    ],
  ]);

  describeCheck("5. script delegation and matrix", checkScriptDelegation, [
    ["a missing --commits-file", "--commits-file c.txt", "--other c.txt"],
    ["a missing --pulls-dir", "--pulls-dir pulls", "--other pulls"],
    [
      "a missing --merged-tags-file",
      "--merged-tags-file m.txt",
      "--other m.txt",
    ],
    ["a missing --head-tags-file", "--head-tags-file h.txt", "--other h.txt"],
    [
      "a missing targets command",
      "release-plan.mjs targets",
      "release-plan.mjs list",
    ],
    [
      "a missing version-config command",
      "release-plan.mjs version-config",
      "release-plan.mjs other",
    ],
    [
      "a missing asset-name command",
      "release-plan.mjs asset-name",
      "release-plan.mjs other",
    ],
    [
      "notes without --sums-file",
      "--sums-file SHA256SUMS.txt",
      "--other SHA256SUMS.txt",
    ],
    [
      "a hard-coded matrix",
      "target: @{{ fromJSON(needs.plan.outputs.targets) }}",
      "target:\n          - runner: ubuntu-22.04",
    ],
    [
      "a matrix include list",
      "      matrix:\n",
      "      matrix:\n        include:\n          - os: x\n",
    ],
    [
      "a missing targets output",
      "      targets: @{{ steps.targets.outputs.targets }}",
      "      other: x",
    ],
  ]);

  describe("6. TARGETS from release-plan.mjs", () => {
    it("are exactly the four Phase 1 native targets", () => {
      expect(checkTargets(TARGETS)).toEqual([]);
      expect(
        TARGETS.map((t) => `${t.runner}|${t.bundle}|${t.rustTriple}`).sort(),
      ).toEqual(
        [
          "ubuntu-22.04|appimage|x86_64-unknown-linux-gnu",
          "ubuntu-22.04-arm|appimage|aarch64-unknown-linux-gnu",
          "windows-11-arm|nsis|aarch64-pc-windows-msvc",
          "windows-latest|nsis|x86_64-pc-windows-msvc",
        ].sort(),
      );
    });
    it("flags a missing target, a wrong triple and a wrong bundle (true positives)", () => {
      const list = TARGETS.map((t) => ({ ...t }));
      expect(checkTargets(list.slice(1)).length).toBeGreaterThan(0);
      expect(
        checkTargets(
          list.map((t, i) =>
            i === 0 ? { ...t, rustTriple: "x86_64-apple-darwin" } : t,
          ),
        ).length,
      ).toBeGreaterThan(0);
      expect(
        checkTargets(list.map((t) => ({ ...t, bundle: "msi" }))).length,
      ).toBeGreaterThan(0);
      expect(
        checkTargets(
          list.map((t, i) => (i === 0 ? { ...t, runner: "macos-latest" } : t)),
        ).length,
      ).toBeGreaterThan(0);
    });
  });

  describeCheck("7. architecture guard and build step", checkBuildSteps, [
    ["a missing guard", "rustc -vV", "rustc --version"],
    [
      "a guard without the expected triple",
      "matrix.target.rustTriple",
      "matrix.target.id",
    ],
    [
      "a guard that never fails",
      "            exit 1\n",
      "            echo mismatch\n",
    ],
    [
      "--debug on the build",
      '--bundles "$BUNDLE"',
      '--bundles "$BUNDLE" --debug',
    ],
    [
      "--target on the build",
      '--bundles "$BUNDLE"',
      '--bundles "$BUNDLE" --target x',
    ],
    ["a build without --config", " --config v.json", ""],
    ["a build without --bundles", '--bundles "$BUNDLE" ', ""],
    [
      "a guard after the build",
      "      - name: Assert host architecture",
      "      - name: Build bundle early\n        run: pnpm tauri build --bundles x --config y\n      - name: Assert host architecture",
    ],
  ]);

  describe("8. no ${{ }} inside run:", () => {
    const TN = y(String.raw`jobs:
  a:
    if: @{{ github.event_name == 'push' }}
    runs-on: @{{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
        with:
          ref: @{{ github.sha }}
      - name: ok
        env:
          REASON: @{{ steps.plan.outputs.reason }}
        run: |
          echo "$REASON"
      - run: echo "$BRANCH"
        env:
          BRANCH: @{{ github.head_ref }}
      - name: folded
        run: >
          echo "$REASON"
        if: @{{ always() }}
`);
    it("passes on the real file", () => {
      expect(checkRunInterpolation(release)).toEqual([]);
    });
    it("passes on a sample with expressions only in if/env/with/runs-on (true negative)", () => {
      expect(checkRunInterpolation(TN)).toEqual([]);
    });
    it.each<[string, string]>([
      [
        "a block-scalar body",
        y(
          `jobs:\n  a:\n    steps:\n      - name: x\n        run: |\n          set -e\n          echo "@{{ steps.plan.outputs.reason }}"\n`,
        ),
      ],
      [
        "an inline `- run:`",
        y(
          `jobs:\n  a:\n    steps:\n      - run: echo @{{ github.event.workflow_run.head_branch }}\n`,
        ),
      ],
      [
        "an inline `run:` key",
        y(
          `jobs:\n  a:\n    steps:\n      - name: x\n        run: echo @{{ github.sha }}\n`,
        ),
      ],
      [
        "a folded block",
        y(
          `jobs:\n  a:\n    steps:\n      - name: x\n        run: >\n          echo @{{ needs.plan.outputs.tag }}\n`,
        ),
      ],
      [
        "a continuation line of a multi-line plain scalar (note N-g)",
        y(
          `jobs:\n  a:\n    steps:\n      - name: x\n        run: echo one\n          two @{{ github.sha }}\n`,
        ),
      ],
      [
        "a continuation line after an inline `- run:` (note N-g)",
        y(
          `jobs:\n  a:\n    steps:\n      - run: echo one\n          two @{{ github.sha }}\n`,
        ),
      ],
    ])("flags %s (true positive)", (_n, sample) => {
      expect(checkRunInterpolation(sample).length).toBeGreaterThan(0);
    });
    it("stops at the next key, so a sibling env expression is not flagged", () => {
      const sample = y(
        `jobs:\n  a:\n    steps:\n      - run: echo one\n        env:\n          X: @{{ github.sha }}\n`,
      );
      expect(checkRunInterpolation(sample)).toEqual([]);
    });
    it("reports the offending line number", () => {
      const sample = y(`a:\n  - run: |\n      echo @{{ x }}\n`);
      expect(checkRunInterpolation(sample)).toEqual(["line 3: echo ${{ x }}"]);
    });
    it("flags an interpolation injected into the real file's run block (mutation)", () => {
      const mutated = mutate(
        release,
        '          set -euo pipefail\n          inputs="$RUNNER_TEMP/release-inputs"\n          node scripts',
        y(
          '          set -euo pipefail\n          echo "@{{ steps.plan.outputs.reason }}"\n          inputs="$RUNNER_TEMP/release-inputs"\n          node scripts',
        ),
      );
      expect(checkRunInterpolation(mutated).length).toBe(1);
    });
  });

  describeCheck("9. publish command", checkPublish, [
    ["a missing --target", '            --target "$SHA" \\\n', ""],
    ["a missing --generate-notes", "            --generate-notes \\\n", ""],
    ["a missing --latest", " \\\n            --latest", ""],
    ["a missing --notes-file", "            --notes-file notes.md \\\n", ""],
    ["SHA256SUMS.txt not uploaded", "a SHA256SUMS.txt \\\n", "a \\\n"],
    [
      "notes without checksums",
      "--sums-file SHA256SUMS.txt > notes.md",
      "> notes.md",
    ],
    ["notes written elsewhere", "> notes.md", "> body.md"],
    ["no checksum file written", "sha256sum a b > SHA256SUMS.txt", "echo skip"],
  ]);

  describeCheck("10. checkout credentials", checkCheckout, [
    [
      "a checkout that keeps credentials",
      "      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n      - name: Checksums",
      "      - uses: actions/checkout@v7\n      - name: Checksums",
    ],
    [
      "persist-credentials: true",
      "persist-credentials: false\n      - name: Assert",
      "persist-credentials: true\n      - name: Assert",
    ],
  ]);

  describe("11. pnpm scripts resolve", () => {
    it("passes on the real file and sees the root tauri script", () => {
      expect(checkPnpmScripts(release)).toEqual([]);
      expect(pnpmPairs(runCommands(release))).toContain("root tauri");
    });
    it("passes on the good sample (true negative)", () => {
      expect(checkPnpmScripts(GOOD_RELEASE)).toEqual([]);
    });
    it("flags a missing root script and a missing workspace script (true positives)", () => {
      expect(
        checkPnpmScripts("steps:\n  - run: pnpm nonexistent-gate\n"),
      ).toEqual(["pnpm script does not resolve: root nonexistent-gate"]);
      expect(
        checkPnpmScripts(
          "steps:\n  - run: |\n      pnpm --filter desktop bogus\n      pnpm install\n",
        ),
      ).toEqual(["pnpm script does not resolve: desktop bogus"]);
    });
    it("resolves a real workspace script and ignores builtins/exec", () => {
      expect(
        checkPnpmScripts(
          "steps:\n  - run: pnpm --filter chord-render test:bidi\n  - run: pnpm --filter chord-render exec playwright install\n",
        ),
      ).toEqual([]);
    });
  });
});

describe("ci.yml debug-bundle upload", () => {
  const ci = read(CI);
  const GOOD_CI = [
    "name: CI",
    "jobs:",
    "  build:",
    "    steps:",
    "      - name: Upload debug bundles",
    "        if: github.event_name != 'pull_request'",
    "        uses: actions/upload-artifact@v7",
    "        with:",
    "          name: bundles",
    "",
  ].join("\n");

  it("passes on the real file", () => {
    expect(checkCiDebugBundle(ci)).toEqual([]);
  });
  it("passes on the good sample (true negative)", () => {
    expect(checkCiDebugBundle(GOOD_CI)).toEqual([]);
  });
  it.each<Mutation>([
    ["a removed step", "Upload debug bundles", "Upload something else"],
    [
      "a removed if guard",
      "        if: github.event_name != 'pull_request'\n",
      "",
    ],
    ["a changed if guard", "!= 'pull_request'", "== 'pull_request'"],
    ["a different action", "actions/upload-artifact@v7", "actions/cache@v4"],
  ])("flags %s (true positive)", (_n, from, to) => {
    expect(
      checkCiDebugBundle(mutate(GOOD_CI, from, to)).length,
    ).toBeGreaterThan(0);
  });
});
