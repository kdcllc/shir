// Cross-workspace contracts no single task owns: workspace shape, Tauri fence,
// CI <-> root scripts, kit-doc script references, layout and config values.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkSamples } from "./check-samples.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const abs = (rel: string): string => path.join(repoRoot, rel);
const read = (rel: string): string => readFileSync(abs(rel), "utf8");

interface Manifest {
  name: string;
  scripts?: Record<string, string>;
  [field: string]: unknown;
}
const readManifest = (dir: string): Manifest =>
  JSON.parse(read(`${dir}/package.json`)) as Manifest;

const WORKSPACES: Record<string, string> = {
  "apps/desktop": "desktop",
  "packages/chord-core": "chord-core",
  "packages/chord-render": "chord-render",
  "packages/test-fixtures": "test-fixtures",
};

const rootScripts = readManifest(".").scripts ?? {};

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// pnpm / cargo command extraction helpers
// ---------------------------------------------------------------------------

/** Commands from `run:` steps of a GitHub workflow (inline and block scalars). */
function workflowRunCommands(yamlText: string): string[] {
  const lines = yamlText.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i] ?? "");
    if (!m) continue;
    const indent = (m[1] ?? "").length;
    const value = (m[2] ?? "").trim();
    if (value === "|" || value === ">") {
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j] ?? "";
        if (l.trim() !== "" && /^\s*/.exec(l)![0].length <= indent) break;
        if (l.trim() !== "") out.push(l.trim());
      }
    } else if (value !== "") {
      out.push(value);
    }
  }
  return out;
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

/** Root scripts invoked as `pnpm <script>` / `pnpm run <script>` in CI commands. */
function ciPnpmScripts(commands: string[]): string[] {
  const out = new Set<string>();
  for (const cmd of commands) {
    for (const m of cmd.matchAll(/\bpnpm\s+(?:run\s+)?(-{0,2}[a-z][\w:-]*)/g)) {
      const script = m[1] ?? "";
      if (!PNPM_BUILTINS.has(script)) out.add(script);
    }
  }
  return [...out].sort();
}

/** Frozen kit-doc extraction regex from the task contract. */
const KIT_PNPM = /\bpnpm\s+(?:--filter\s+(\S+)\s+)?([a-z][\w:-]*)/g;

function markdownCommandContexts(md: string): string[] {
  const contexts: string[] = [];
  const outside: string[] = [];
  let fence: string | undefined;
  let block: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (fence === undefined) {
        fence = f[1];
        block = [];
      } else {
        contexts.push(block.join("\n"));
        fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) block.push(line);
    else outside.push(line);
  }
  for (const m of outside.join("\n").matchAll(/`([^`\n]+)`/g)) {
    if (m[1]) contexts.push(m[1]);
  }
  return contexts;
}

function backtickSpans(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].flatMap((m) =>
    m[1] ? [m[1]] : [],
  );
}

function stringValues(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(stringValues);
  if (v && typeof v === "object") {
    return Object.values(v as Record<string, unknown>).flatMap(stringValues);
  }
  return [];
}

function manifestCommandContexts(manifestJson: string): string[] {
  const parsed = JSON.parse(manifestJson) as {
    answers: { tokens: Record<string, unknown>; bootstrap: unknown };
  };
  const tokens = parsed.answers.tokens;
  const contexts: string[] = [];
  for (const key of [
    "LINT_COMMAND",
    "FULL_TEST_COMMAND",
    "TYPECHECK_COMMAND",
    "SETUP_COMMANDS",
    "TARGETED_TEST_COMMAND",
  ]) {
    const v = tokens[key];
    if (typeof v === "string") contexts.push(v);
  }
  for (const s of [
    ...stringValues(parsed.answers.tokens),
    ...stringValues(parsed.answers.bootstrap),
  ]) {
    contexts.push(...backtickSpans(s));
  }
  return contexts;
}

/** `root:<script>` or `<pkg>:<script>` pairs referenced in command contexts. */
function extractPnpmPairs(contexts: string[]): Set<string> {
  const pairs = new Set<string>();
  for (const ctx of contexts) {
    for (const m of ctx.matchAll(KIT_PNPM)) {
      const filter = m[1];
      const script = m[2] ?? "";
      if (filter?.includes("<")) continue;
      if (PNPM_BUILTINS.has(script)) continue;
      pairs.add(`${filter ?? "root"} ${script}`);
    }
  }
  return pairs;
}

function resolvePair(pair: string): boolean {
  const [scope = "", script = ""] = pair.split(" ");
  if (scope === "root") return script in rootScripts;
  const dir = Object.keys(WORKSPACES).find((d) => WORKSPACES[d] === scope);
  if (!dir) return false;
  return script in (readManifest(dir).scripts ?? {});
}

// ---------------------------------------------------------------------------

describe("workspace packages", () => {
  it("are exactly the four expected directories with the expected names", () => {
    const found = ["apps", "packages"].flatMap((group) =>
      readdirSync(abs(group), { withFileTypes: true })
        .filter(
          (e) =>
            e.isDirectory() &&
            existsSync(abs(`${group}/${e.name}/package.json`)),
        )
        .map((e) => `${group}/${e.name}`),
    );
    expect(found.sort()).toEqual(Object.keys(WORKSPACES).sort());
    for (const [dir, name] of Object.entries(WORKSPACES)) {
      expect(readManifest(dir).name, dir).toBe(name);
    }
  });

  it.each(Object.keys(WORKSPACES))(
    "%s has test and typecheck scripts and a real test with expect()",
    (dir) => {
      const scripts = readManifest(dir).scripts ?? {};
      expect(scripts.test, `${dir} test script`).toBeTruthy();
      expect(scripts.typecheck, `${dir} typecheck script`).toBeTruthy();
      const tests = listFiles(abs(`${dir}/src`)).filter((f) =>
        /\.test\.tsx?$/.test(f),
      );
      expect(tests.length, `${dir} test files`).toBeGreaterThan(0);
      expect(
        tests.some((f) => readFileSync(f, "utf8").includes("expect(")),
        `${dir} has an expect( call`,
      ).toBe(true);
    },
  );
});

describe("Tauri fence (manifest and source level)", () => {
  it.each(["packages/chord-core", "packages/chord-render"])(
    "%s lists no @tauri-apps dependency and no source mentions it",
    (dir) => {
      const manifest = readManifest(dir);
      for (const field of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ]) {
        const deps = Object.keys(
          (manifest[field] as Record<string, string> | undefined) ?? {},
        );
        expect(
          deps.filter((d) => d.startsWith("@tauri-apps/")),
          `${dir} ${field}`,
        ).toEqual([]);
      }
      const offenders = listFiles(abs(`${dir}/src`)).filter((f) =>
        readFileSync(f, "utf8").includes("@tauri-apps"),
      );
      expect(offenders).toEqual([]);
    },
  );

  it("eslint.config.js restricts @tauri-apps/* for chord-core and chord-render", async () => {
    const mod = (await import("../eslint.config.js")) as unknown as {
      default: {
        files?: string[];
        rules?: Record<string, unknown>;
      }[];
    };
    const entry = mod.default.find(
      (c) => c.rules && "no-restricted-imports" in c.rules,
    );
    expect(entry).toBeDefined();
    expect(entry?.files).toEqual([
      "packages/chord-core/**",
      "packages/chord-render/**",
    ]);
    const rule = entry?.rules?.["no-restricted-imports"] as [
      string,
      { patterns: { group: string[] }[] },
    ];
    expect(rule[0]).toBe("error");
    expect(rule[1].patterns.flatMap((p) => p.group)).toContain("@tauri-apps/*");
  });
});

describe("CI workflow <-> root scripts", () => {
  const ci = read(".github/workflows/ci.yml");
  const commands = workflowRunCommands(ci);

  it("extracts run commands and ignores uses: lines", () => {
    expect(commands).toContain("pnpm lint");
    expect(commands.some((c) => c.startsWith("cargo clippy"))).toBe(true);
    expect(commands.join("\n")).not.toContain("action-setup");
  });

  it("every pnpm script CI invokes exists in root package.json", () => {
    const used = ciPnpmScripts(commands);
    for (const s of [
      "lint",
      "typecheck",
      "test",
      "stylelint",
      "check:samples",
      "format:check",
      "tauri",
    ]) {
      expect(used, "CI uses").toContain(s);
    }
    for (const s of used) {
      expect(rootScripts, `root script '${s}' used by CI`).toHaveProperty(s);
    }
  });

  it("the CI extractor flags a missing script (non-vacuous)", () => {
    const used = ciPnpmScripts(
      workflowRunCommands(
        "steps:\n  - uses: pnpm/action-setup@v6\n  - run: pnpm nonexistent-gate\n  - run: |\n      pnpm install --frozen-lockfile\n      pnpm run lint\n",
      ),
    );
    expect(used).toEqual(["lint", "nonexistent-gate"]);
    expect(used.filter((s) => !(s in rootScripts))).toEqual([
      "nonexistent-gate",
    ]);
  });

  it("every cargo invocation uses the desktop manifest path", () => {
    const cargo = commands.filter((c) => /\bcargo\s/.test(c));
    expect(cargo.length).toBeGreaterThanOrEqual(3);
    for (const c of cargo) {
      expect(c).toContain("--manifest-path apps/desktop/src-tauri/Cargo.toml");
    }
  });
});

describe("kit docs reference only resolvable pnpm scripts", () => {
  const mdFiles = [
    ".claude/ORCHESTRATION.md",
    ".claude/skills/test-ladder/SKILL.md",
    ".claude/skills/feature/SKILL.md",
    ".claude/skills/ship-pr/SKILL.md",
    ".claude/skills/hebrew-rtl-chords/SKILL.md",
  ];
  const contexts = [
    ...mdFiles.flatMap((f) => markdownCommandContexts(read(f))),
    ...manifestCommandContexts(read("orchestration-kit.manifest.json")),
  ];
  const pairs = extractPnpmPairs(contexts);
  const allowListed = new Set(["root e2e", "chord-render test:bidi"]);

  it("extracts at least the ten known resolvable pairs", () => {
    for (const p of [
      "root check:samples",
      "root format:check",
      "root lint",
      "root stylelint",
      "root tauri",
      "root test",
      "root typecheck",
      "chord-core test",
      "chord-render test",
      "desktop test",
    ]) {
      expect(pairs, p).toContain(p);
    }
  });

  it("every extracted pair resolves except exactly the G1-planned allow-list", () => {
    const unresolved = [...pairs].filter((p) => !resolvePair(p)).sort();
    expect(unresolved).toEqual([...allowListed].sort());
  });

  it("extractor skips prose, placeholders and builtins, and resolvePair rejects unknowns", () => {
    const found = extractPnpmPairs([
      "pnpm --filter <package> exec vitest",
      "pnpm install",
      "pnpm --filter desktop bogus",
      "pnpm lint",
    ]);
    expect([...found].sort()).toEqual(["desktop bogus", "root lint"]);
    expect(resolvePair("desktop bogus")).toBe(false);
    expect(resolvePair("nopkg test")).toBe(false);
    expect(resolvePair("root lint")).toBe(true);
    expect(
      markdownCommandContexts(
        "a pnpm monorepo\n```\npnpm lint\n```\n`pnpm test`",
      ),
    ).toEqual(["pnpm lint", "pnpm test"]);
  });
});

describe("layout contract", () => {
  it.each([
    "apps/desktop/src",
    "apps/desktop/src-tauri/Cargo.toml",
    "packages/chord-core/src",
    "packages/chord-render/src",
    "packages/test-fixtures/src",
    "docs/STACK.md",
    "samples/LICENSES.md",
  ])("%s exists", (rel) => {
    expect(existsSync(abs(rel)), rel).toBe(true);
  });
});

describe("tauri.conf.json and Cargo contract values", () => {
  const conf = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")) as {
    identifier: string;
    productName: string;
    build: { devUrl: string };
    app: { windows: { label: string }[] };
  };
  const cargoToml = read("apps/desktop/src-tauri/Cargo.toml");
  const section = (name: string): string =>
    new RegExp(
      `^\\[${name}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`,
      "m",
    ).exec(cargoToml)?.[1] ?? "";

  it("has the expected identifier, productName, dev port and window label", () => {
    expect(conf.identifier).toBe("com.kdcllc.shir");
    expect(conf.productName).toBe("Shir");
    expect(new URL(conf.build.devUrl).port).toBe("1420");
    expect(conf.app.windows[0]?.label).toBe("main");
  });

  it("has Cargo package name shir and lib name shir_lib", () => {
    expect(/^name = "([^"]+)"/m.exec(section("package"))?.[1]).toBe("shir");
    expect(/^name = "([^"]+)"/m.exec(section("lib"))?.[1]).toBe("shir_lib");
  });
});

describe("samples licensing", () => {
  it("samples/LICENSES.md lists every file under samples/ with no stale rows", () => {
    expect(checkSamples(abs("samples"))).toEqual({ unlisted: [], stale: [] });
  });
});
