// G1 cross-workspace contract: STACK rows, CSP, smoke event parity, CI wiring, no formatter use, fonts.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

const unquote = (s: string): string => s.replace(/^["']|["']$/g, "");

// ---- (a) STACK rows -------------------------------------------------------

const G1_PACKAGES = [
  "@playwright/test",
  "@fontsource/noto-sans-hebrew",
  "@fontsource/noto-serif-hebrew",
  "@fontsource/heebo",
  "@fontsource/jetbrains-mono",
];

interface StackRow {
  pkg: string;
  version: string;
  ecosystem: string;
  status: string;
}

function parseStackRows(markdown: string): StackRow[] {
  return markdown
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"))
    .map((l) =>
      l
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim()),
    )
    .filter((c) => c.length >= 5)
    .map((c) => ({
      pkg: (c[1] ?? "").replace(/`/g, ""),
      version: c[2] ?? "",
      ecosystem: c[3] ?? "",
      status: c[4] ?? "",
    }));
}

function parseCatalog(yamlText: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inBlock = false;
  for (const line of yamlText.split(/\r?\n/)) {
    if (/^catalog:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^\S/.test(line)) break;
    const m = /^\s+(\S.*?):\s+(\S+)\s*$/.exec(line);
    if (m && m[1] && m[2]) out[unquote(m[1])] = unquote(m[2]);
  }
  return out;
}

/** Violations for the G1 packages against STACK rows and the catalog. */
function checkG1Rows(
  rows: StackRow[],
  catalog: Record<string, string>,
  packages: string[] = G1_PACKAGES,
): string[] {
  const problems: string[] = [];
  for (const pkg of packages) {
    const row = rows.find((r) => r.pkg === pkg);
    if (!row) {
      problems.push(`${pkg}: no STACK row`);
      continue;
    }
    if (row.status !== "installed (G1)")
      problems.push(`${pkg}: status '${row.status}'`);
    if (row.ecosystem !== "npm")
      problems.push(`${pkg}: ecosystem '${row.ecosystem}'`);
    if (catalog[pkg] !== row.version)
      problems.push(
        `${pkg}: STACK ${row.version} != catalog ${catalog[pkg] ?? "(none)"}`,
      );
  }
  return problems;
}

describe("(a) STACK rows for G1 packages", () => {
  const rows = parseStackRows(read("docs/STACK.md"));
  const catalog = parseCatalog(read("pnpm-workspace.yaml"));

  it("are installed (G1), npm, and equal the catalog", () => {
    expect(checkG1Rows(rows, catalog)).toEqual([]);
  });

  it("covers playwright and 4 fontsource packages", () => {
    expect(G1_PACKAGES).toHaveLength(5);
    for (const p of G1_PACKAGES)
      expect(rows.some((r) => r.pkg === p)).toBe(true);
  });

  it("chordsheetjs is removed (G2): STACK row says so and the catalog has no entry", () => {
    expect(rows.find((r) => r.pkg === "chordsheetjs")?.status).toBe(
      "removed (G2)",
    );
    expect("chordsheetjs" in catalog).toBe(false);
  });

  it("self-test: detects wrong status, ecosystem, version drift and missing row", () => {
    const good: StackRow = {
      pkg: "x",
      version: "1.0.0",
      ecosystem: "npm",
      status: "installed (G1)",
    };
    expect(checkG1Rows([good], { x: "1.0.0" }, ["x"])).toEqual([]);
    expect(
      checkG1Rows([{ ...good, status: "planned (G1)" }], { x: "1.0.0" }, ["x"]),
    ).toHaveLength(1);
    expect(
      checkG1Rows([{ ...good, ecosystem: "crate" }], { x: "1.0.0" }, ["x"]),
    ).toHaveLength(1);
    expect(checkG1Rows([good], { x: "2.0.0" }, ["x"])).toHaveLength(1);
    expect(checkG1Rows([], {}, ["x"])).toEqual(["x: no STACK row"]);
  });
});

// ---- (b) CSP ---------------------------------------------------------------

const G0_CSP =
  "default-src 'self' ipc: http://ipc.localhost; connect-src 'self' ipc: http://ipc.localhost; img-src 'self' data:; font-src 'self' data:; style-src 'self'";

function checkCsp(csp: unknown, devCsp: unknown): string[] {
  const problems: string[] = [];
  if (csp !== G0_CSP) problems.push("csp differs from the G0 string");
  if (typeof devCsp !== "string") return [...problems, "devCsp missing"];
  if (!devCsp.includes("ws://localhost:1420"))
    problems.push("devCsp lacks ws://localhost:1420");
  if (!devCsp.includes("script-src 'self' 'unsafe-inline'"))
    problems.push("devCsp lacks script-src 'self' 'unsafe-inline'");
  return problems;
}

describe("(b) tauri.conf.json CSP", () => {
  const conf = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")) as {
    app: { security: { csp: unknown; devCsp: unknown } };
  };

  it("csp equals the G0 string; devCsp allows HMR and inline script", () => {
    expect(checkCsp(conf.app.security.csp, conf.app.security.devCsp)).toEqual(
      [],
    );
  });

  it("self-test: detects csp drift and a devCsp missing HMR / script-src", () => {
    const ok = "ws://localhost:1420; script-src 'self' 'unsafe-inline'";
    expect(checkCsp(G0_CSP, ok)).toEqual([]);
    expect(checkCsp(G0_CSP + " x", ok)).toHaveLength(1);
    expect(checkCsp(G0_CSP, "script-src 'self' 'unsafe-inline'")).toHaveLength(
      1,
    );
    expect(checkCsp(G0_CSP, "ws://localhost:1420")).toHaveLength(1);
    expect(checkCsp(G0_CSP, undefined)).toEqual(["devCsp missing"]);
  });
});

// ---- (c) smoke event parity -----------------------------------------------

function extractEvent(source: string, kind: "ts" | "rs"): string | undefined {
  const re =
    kind === "ts"
      ? /export const UI_READY_EVENT\s*=\s*"([^"]+)"/
      : /pub const UI_READY_EVENT\s*:\s*&str\s*=\s*"([^"]+)"/;
  return re.exec(source)?.[1];
}

describe("(c) UI_READY_EVENT parity", () => {
  it("TS and Rust agree and equal shir://ui-ready", () => {
    const ts = extractEvent(read("apps/desktop/src/uiReady.ts"), "ts");
    const rs = extractEvent(read("apps/desktop/src-tauri/src/smoke.rs"), "rs");
    expect(ts).toBe("shir://ui-ready");
    expect(rs).toBe("shir://ui-ready");
    expect(ts).toBe(rs);
  });

  it("self-test: extractor reads values and returns undefined when absent", () => {
    expect(extractEvent('export const UI_READY_EVENT = "a://b";', "ts")).toBe(
      "a://b",
    );
    expect(
      extractEvent('pub const UI_READY_EVENT: &str = "c://d";', "rs"),
    ).toBe("c://d");
    expect(extractEvent("const other = 1;", "ts")).toBeUndefined();
    expect(
      extractEvent('export const UI_READY_EVENT = "a";', "rs"),
    ).toBeUndefined();
  });
});

// ---- (d) CI wiring ---------------------------------------------------------

interface Step {
  name: string;
  text: string;
}

/** Split ci.yml into steps (each `      - ` list item at 6-space indent). */
function parseSteps(yamlText: string): Step[] {
  const steps: Step[] = [];
  let cur: string[] | undefined;
  for (const line of yamlText.split(/\r?\n/)) {
    if (/^ {6}- /.test(line)) {
      if (cur) steps.push(toStep(cur));
      cur = [line];
    } else if (cur) {
      if (/^\S/.test(line) || /^ {0,5}\S/.test(line)) {
        steps.push(toStep(cur));
        cur = undefined;
      } else cur.push(line);
    }
  }
  if (cur) steps.push(toStep(cur));
  return steps;
}
function toStep(lines: string[]): Step {
  const text = lines.join("\n");
  return { name: /name:\s*(.+)/.exec(text)?.[1]?.trim() ?? "", text };
}
const isLinuxOnly = (s: Step): boolean =>
  /^\s+if:.*runner\.os == 'Linux'/m.test(s.text);

function checkCi(yamlText: string): string[] {
  const problems: string[] = [];
  const steps = parseSteps(yamlText);
  const install = steps.findIndex(
    (s) =>
      isLinuxOnly(s) &&
      /playwright install --with-deps chromium webkit/.test(s.text),
  );
  const bidi = steps.findIndex(
    (s) =>
      isLinuxOnly(s) && /pnpm --filter chord-render test:bidi/.test(s.text),
  );
  if (install < 0) problems.push("no Linux-only playwright install step");
  if (bidi < 0) problems.push("no Linux-only test:bidi step");
  if (install >= 0 && bidi >= 0 && bidi <= install)
    problems.push("test:bidi is not after playwright install");
  for (const s of steps) {
    if (/playwright/i.test(s.text) && !isLinuxOnly(s))
      problems.push(`step '${s.name}' mentions playwright without Linux guard`);
  }
  return problems;
}

describe("(d) ci.yml Linux-only Playwright wiring", () => {
  it("install then test:bidi, both Linux-only; no unguarded playwright", () => {
    expect(checkCi(read(".github/workflows/ci.yml"))).toEqual([]);
  });

  const GOOD = `jobs:
  b:
    steps:
      - name: Install
        if: runner.os == 'Linux'
        run: pnpm --filter chord-render exec playwright install --with-deps chromium webkit

      - name: Bidi
        if: runner.os == 'Linux'
        run: pnpm --filter chord-render test:bidi
`;

  it("self-test: accepts a good synthetic workflow", () => {
    expect(checkCi(GOOD)).toEqual([]);
  });

  it("self-test: detects missing guard, wrong order and missing steps", () => {
    expect(
      checkCi(
        GOOD.replace(
          "        if: runner.os == 'Linux'\n        run: pnpm --filter chord-render test:bidi",
          "        run: pnpm --filter chord-render test:bidi",
        ),
      ).length,
    ).toBeGreaterThan(0);
    const swapped = `jobs:
  b:
    steps:
      - name: Bidi
        if: runner.os == 'Linux'
        run: pnpm --filter chord-render test:bidi
      - name: Install
        if: runner.os == 'Linux'
        run: pnpm --filter chord-render exec playwright install --with-deps chromium webkit
`;
    expect(checkCi(swapped)).toContain(
      "test:bidi is not after playwright install",
    );
    expect(checkCi("jobs:\n  b:\n    steps:\n      - run: echo hi\n")).toEqual([
      "no Linux-only playwright install step",
      "no Linux-only test:bidi step",
    ]);
    const unguarded =
      GOOD +
      `
      - name: Extra
        run: npx playwright test
`;
    expect(checkCi(unguarded)).toEqual([
      "step 'Extra' mentions playwright without Linux guard",
    ]);
  });
});

// ---- (e) no Formatter use; no chordsheetjs import anywhere ------------------

const SCAN_ROOTS = [
  "packages/chord-core/src",
  "packages/chord-render/src",
  "packages/test-fixtures/src",
  "packages/chord-render/harness",
  "apps/desktop/src",
];
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_EXT.test(entry)) out.push(full);
  }
  return out;
}

const FORMATTER_RE = /[A-Za-z]*Formatter\b/;
// Value imports only: `typeof import("chordsheetjs")` type queries do not count.
const CSJS_IMPORT_RE =
  /(?:from\s+|(?<!typeof\s+)import\s*\(\s*|import\s+|require\s*\(\s*)["']chordsheetjs["']/;

interface Source {
  file: string;
  text: string;
}
/** Files with a *Formatter use, and files importing chordsheetjs. */
function checkSources(sources: Source[]): string[] {
  const problems: string[] = [];
  for (const { file, text } of sources) {
    if (FORMATTER_RE.test(text)) problems.push(`${file}: Formatter`);
    if (CSJS_IMPORT_RE.test(text))
      problems.push(`${file}: imports chordsheetjs`);
  }
  return problems;
}

describe("(e) no *Formatter use; no chordsheetjs import anywhere", () => {
  const sources: Source[] = SCAN_ROOTS.flatMap((root) =>
    walk(path.join(repoRoot, root)).map((abs) => ({
      file: path.relative(repoRoot, abs).split(path.sep).join("/"),
      text: readFileSync(abs, "utf8"),
    })),
  );
  // This test file itself lives in scripts/, outside SCAN_ROOTS.

  it("scans a non-trivial file set including song.ts", () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(
      sources.some((s) => s.file === "packages/chord-core/src/song.ts"),
    ).toBe(true);
  });

  it("finds no Formatter and no chordsheetjs importer", () => {
    expect(checkSources(sources)).toEqual([]);
  });

  it("self-test: detects Formatter use and a chordsheetjs import", () => {
    expect(
      checkSources([{ file: "a.ts", text: "new TextFormatter()" }]),
    ).toEqual(["a.ts: Formatter"]);
    expect(
      checkSources([{ file: "b.ts", text: 'import x from "chordsheetjs";' }]),
    ).toEqual(["b.ts: imports chordsheetjs"]);
    expect(
      checkSources([
        { file: "song.ts", text: 'import { P } from "chordsheetjs";' },
      ]),
    ).toEqual(["song.ts: imports chordsheetjs"]);
    expect(
      checkSources([{ file: "d.ts", text: 'import "chordsheetjs";' }]),
    ).toEqual(["d.ts: imports chordsheetjs"]);
    expect(
      checkSources([{ file: "c.ts", text: "const formatted = 1;" }]),
    ).toEqual([]);
  });
});

// ---- (f) fonts.css has no remote URLs -------------------------------------

const hasHttp = (css: string): boolean => css.includes("http");

describe("(f) fonts.css is self-hosted", () => {
  it("contains no http", () => {
    const css = read("packages/chord-render/src/fonts.css");
    expect(css.length).toBeGreaterThan(0);
    expect(hasHttp(css)).toBe(false);
  });

  it("self-test: detects a remote URL", () => {
    expect(hasHttp("@font-face{src:url(https://x/y.woff2)}")).toBe(true);
    expect(hasHttp("@import '@fontsource/heebo/400.css';")).toBe(false);
  });
});
