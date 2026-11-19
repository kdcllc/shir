// G5b cross-task contract: log_webview_error wiring, main.tsx install order, twin samples, seeded first title.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- brings in import.meta.glob typings for the apps/desktop/src/library.ts import
/// <reference path="../apps/desktop/node_modules/vite/client.d.ts" />
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildLibrary } from "../apps/desktop/src/library";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

const BUILD_RS = "apps/desktop/src-tauri/build.rs";
const MOD_RS = "apps/desktop/src-tauri/src/commands/mod.rs";
const CAPABILITY = "apps/desktop/src-tauri/capabilities/default.json";
const BINDINGS = "apps/desktop/src/bindings.ts";
const MAIN_TSX = "apps/desktop/src/main.tsx";
const TWIN_HE = "samples/demo-twin-he.cho";
const TWIN_TR = "samples/demo-twin-translit.cho";
const GOLDEN = "apps/desktop/src-tauri/tests/golden/extract.json";

// ---- (a) log_webview_error wiring ------------------------------------------------------

function buildRsProblems(src: string): string[] {
  const m = /\.commands\(&\[([\s\S]*?)\]\)/.exec(src);
  return m && /"log_webview_error"/.test(m[1]!)
    ? []
    : ["build.rs AppManifest list lacks log_webview_error"];
}

function collectCommandsProblems(src: string): string[] {
  const m = /collect_commands!\[([\s\S]*?)\]/.exec(src);
  return m && /\blog_webview_error\b/.test(m[1]!)
    ? []
    : ["collect_commands! lacks log_webview_error"];
}

function capabilityProblems(src: string): string[] {
  const perms = (JSON.parse(src) as { permissions: unknown[] }).permissions;
  return perms.includes("allow-log-webview-error")
    ? []
    : ["capability lacks allow-log-webview-error"];
}

function bindingsProblems(src: string): string[] {
  return /^\s*logWebviewError: .*__TAURI_INVOKE<void>\("log_webview_error"/m.test(
    src,
  )
    ? []
    : ["bindings.ts logWebviewError does not invoke log_webview_error"];
}

describe("(a) log_webview_error is wired end to end", () => {
  it("is in build.rs AppManifest, collect_commands!, the capability, and bindings", () => {
    expect(buildRsProblems(read(BUILD_RS))).toEqual([]);
    expect(collectCommandsProblems(read(MOD_RS))).toEqual([]);
    expect(capabilityProblems(read(CAPABILITY))).toEqual([]);
    expect(bindingsProblems(read(BINDINGS))).toEqual([]);
    expect(read(BINDINGS)).toMatch(/export const commands = \{/);
  });

  it("negative: build.rs without the command is reported", () => {
    const src = read(BUILD_RS);
    const mutated = src.replace('"log_webview_error",', "");
    expect(mutated).not.toBe(src);
    expect(buildRsProblems(mutated).join("\n")).toContain("build.rs");
  });

  it("negative: collect_commands! without the command is reported", () => {
    const src = read(MOD_RS);
    const mutated = src.replace(/,\s*log_webview_error\s*\]/, "]");
    expect(mutated).not.toBe(src);
    expect(collectCommandsProblems(mutated).join("\n")).toContain(
      "collect_commands!",
    );
  });

  it("negative: a capability without the permission is reported", () => {
    const src = read(CAPABILITY);
    const mutated = src.replace("allow-log-webview-error", "allow-other");
    expect(mutated).not.toBe(src);
    expect(capabilityProblems(mutated).join("\n")).toContain("capability");
  });

  it("bindings regex tolerates tab and space indentation", () => {
    const line = (indent: string): string =>
      `${indent}logWebviewError: (m: string) => __TAURI_INVOKE<void>("log_webview_error", { m }),`;
    expect(bindingsProblems(line("\t"))).toEqual([]);
    expect(bindingsProblems(line("  "))).toEqual([]);
    expect(bindingsProblems(line("    "))).toEqual([]);
    expect(bindingsProblems(line(""))).toEqual([]);
    expect(
      bindingsProblems(line("\t").replace("log_webview_error", "x")),
    ).toHaveLength(1);
  });

  it("negative: bindings invoking another command are reported", () => {
    const src = read(BINDINGS);
    const mutated = src.replace('"log_webview_error"', '"other_command"');
    expect(mutated).not.toBe(src);
    expect(bindingsProblems(mutated).join("\n")).toContain("logWebviewError");
  });
});

// ---- (b) main.tsx install order --------------------------------------------------------

function mainProblems(src: string): string[] {
  const problems: string[] = [];
  if (!/import \{[^}]*\binstallWebviewErrorForwarder\b[^}]*\} from /.test(src))
    problems.push("main.tsx does not import installWebviewErrorForwarder");
  if (!/import \{[^}]*\blogWebviewError\b[^}]*\} from /.test(src))
    problems.push("main.tsx does not import logWebviewError");
  const install = src.search(/^\s*installWebviewErrorForwarder\(/m);
  const rootCall = src.search(/^\s*createRoot\(/m);
  if (install < 0) problems.push("main.tsx never calls the install function");
  else if (rootCall < 0 || install > rootCall)
    problems.push("install call does not precede createRoot(");
  return problems;
}

describe("(b) main.tsx installs the forwarder before createRoot", () => {
  const src = read(MAIN_TSX);

  it("imports both and installs first", () => {
    expect(mainProblems(src)).toEqual([]);
  });

  it("negative: a missing import is reported", () => {
    const mutated = src.replace(
      /import \{ logWebviewError \} from "\.\/storage";\n/,
      "",
    );
    expect(mutated).not.toBe(src);
    expect(mainProblems(mutated).join("\n")).toContain("logWebviewError");
  });

  it("negative: install after createRoot is reported", () => {
    const line = "installWebviewErrorForwarder(window, logWebviewError);\n";
    expect(src).toContain(line);
    const mutated = `${src.replace(line, "")}\n${line}`;
    expect(mainProblems(mutated).join("\n")).toContain("precede createRoot");
  });
});

// ---- (d) twin samples ------------------------------------------------------------------

const PROGRESSION = /\[Am\][^[]*\[D\][^[]*\[G\][^[]*\[Em\]/;
const CREDIT = 'נכתב ע"י צוות';

function twinProblems(he: string, tr: string): string[] {
  const problems: string[] = [];
  if (he.includes(CREDIT)) problems.push("he twin has the credit formula");
  if (!he.includes('ע"י')) problems.push('he twin lacks ע"י');
  if (!he.includes("לעד")) problems.push("he twin lacks לעד");
  if (PROGRESSION.test(he))
    problems.push("he twin has the Am-D-G-Em progression");
  if (PROGRESSION.test(tr))
    problems.push("translit twin has the Am-D-G-Em progression");
  return problems;
}

describe("(d) twin samples", () => {
  const he = read(TWIN_HE);
  const tr = read(TWIN_TR);

  it('have no credit formula, keep ע"י and לעד, and avoid the progression', () => {
    expect(twinProblems(he, tr)).toEqual([]);
  });

  it("negative: the credit formula is reported", () => {
    const mutated = `${he}\n${CREDIT}\n`;
    expect(twinProblems(mutated, tr).join("\n")).toContain("credit formula");
  });

  it('negative: a missing ע"י or לעד is reported', () => {
    const a = he.replaceAll('ע"י', "x");
    expect(a).not.toBe(he);
    expect(twinProblems(a, tr).join("\n")).toContain('lacks ע"י');
    const b = he.replaceAll("לעד", "x");
    expect(b).not.toBe(he);
    expect(twinProblems(b, tr).join("\n")).toContain("lacks לעד");
  });

  it("negative: the progression across line breaks is reported in each twin", () => {
    const prog = "[Am]a\n[D]b\n[G]c\n[Em]d\n";
    expect(twinProblems(`${he}\n${prog}`, tr).join("\n")).toContain("he twin");
    expect(twinProblems(he, `${tr}\n${prog}`).join("\n")).toContain(
      "translit twin",
    );
  });
});

// ---- (c) B31 first library title -------------------------------------------------------

function firstSampleFile(): string {
  const dir = path.join(repoRoot, "samples");
  const sources: Record<string, string> = {};
  for (const n of readdirSync(dir)) {
    if (n.endsWith(".cho"))
      sources[`samples/${n}`] = readFileSync(path.join(dir, n), "utf8");
  }
  return `samples/${buildLibrary(sources, "samples")[0]!.fileName}`;
}

function titleOf(cho: string): string | undefined {
  return /^\{title:\s*(.+?)\s*\}\s*$/m.exec(cho)?.[1];
}

function goldenProblems(cho: string, golden: string, file: string): string[] {
  const entry = (JSON.parse(golden) as { file: string; title: string }[]).find(
    (e) => e.file === file,
  );
  const title = titleOf(cho);
  if (!entry) return [`golden has no entry for ${file}`];
  if (title === undefined) return [`${file} has no title`];
  return title === entry.title
    ? []
    : [`title ${title} differs from golden ${entry.title}`];
}

describe("(c) B31 first library song title matches the golden", () => {
  const file = firstSampleFile();
  const cho = read(file);
  const golden = read(GOLDEN);

  it("first sample is demo-shir-bilingual.cho and its title equals the golden title", () => {
    expect(file).toBe("samples/demo-shir-bilingual.cho");
    expect(goldenProblems(cho, golden, file)).toEqual([]);
  });

  it("negative: a changed song title is reported", () => {
    const mutated = cho.replace(/^\{title:/m, "{title: X");
    expect(mutated).not.toBe(cho);
    expect(goldenProblems(mutated, golden, file).join("\n")).toContain(
      "differs from golden",
    );
  });

  it("negative: a golden without the entry is reported", () => {
    expect(goldenProblems(cho, "[]", file).join("\n")).toContain("no entry");
  });
});
