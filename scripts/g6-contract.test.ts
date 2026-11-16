// G6 cross-task contract: read_text_file wiring, dialog plugin pins/registration, importer export,
// no window.confirm, import fixtures complete.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IMPORT_FIXTURE_NAMES } from "../packages/test-fixtures/src/index";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

const BUILD_RS = "apps/desktop/src-tauri/build.rs";
const MOD_RS = "apps/desktop/src-tauri/src/commands/mod.rs";
const LIB_RS = "apps/desktop/src-tauri/src/lib.rs";
const CAPABILITY = "apps/desktop/src-tauri/capabilities/default.json";
const CARGO_TOML = "apps/desktop/src-tauri/Cargo.toml";
const BINDINGS = "apps/desktop/src/bindings.ts";
const DESKTOP_PKG = "apps/desktop/package.json";
const WORKSPACE = "pnpm-workspace.yaml";
const CORE_INDEX = "packages/chord-core/src/index.ts";
const DESKTOP_SRC = "apps/desktop/src";
const IMPORT_DIR = "packages/test-fixtures/import";

// ---- (a) read_text_file wiring -----------------------------------------------------------

function buildRsProblems(src: string): string[] {
  const m = /\.commands\(&\[([\s\S]*?)\]\)/.exec(src);
  return m && /"read_text_file"/.test(m[1]!)
    ? []
    : ["build.rs AppManifest list lacks read_text_file"];
}

function collectCommandsProblems(src: string): string[] {
  const m = /collect_commands!\[([\s\S]*?)\]/.exec(src);
  return m && /\bread_text_file\b/.test(m[1]!)
    ? []
    : ["collect_commands! lacks read_text_file"];
}

function bindingsProblems(src: string): string[] {
  return /^\treadTextFile: .*typedError<string, FileError>\(__TAURI_INVOKE\("read_text_file"/m.test(
    src,
  )
    ? []
    : ["bindings.ts readTextFile does not return a FileError result"];
}

describe("(a) read_text_file is wired end to end", () => {
  it("is in build.rs AppManifest, collect_commands!, and bindings with FileError", () => {
    expect(buildRsProblems(read(BUILD_RS))).toEqual([]);
    expect(collectCommandsProblems(read(MOD_RS))).toEqual([]);
    expect(bindingsProblems(read(BINDINGS))).toEqual([]);
  });

  it("negative: build.rs without the command is reported", () => {
    const src = read(BUILD_RS);
    const mutated = src.replace('"read_text_file",', "");
    expect(mutated).not.toBe(src);
    expect(buildRsProblems(mutated).join("\n")).toContain("build.rs");
  });

  it("negative: collect_commands! without the command is reported", () => {
    const src = read(MOD_RS);
    const mutated = src.replace("files::read_text_file,", "");
    expect(mutated).not.toBe(src);
    expect(collectCommandsProblems(mutated).join("\n")).toContain(
      "collect_commands!",
    );
  });

  it("negative: bindings with a DbError result or another command are reported", () => {
    const src = read(BINDINGS);
    const a = src.replace(
      "typedError<string, FileError>",
      "typedError<string, DbError>",
    );
    expect(a).not.toBe(src);
    expect(bindingsProblems(a).join("\n")).toContain("readTextFile");
    const b = src.replace('"read_text_file"', '"other_command"');
    expect(b).not.toBe(src);
    expect(bindingsProblems(b).join("\n")).toContain("readTextFile");
  });
});

// ---- (b) capability ----------------------------------------------------------------------

function capabilityProblems(src: string): string[] {
  const perms = (JSON.parse(src) as { permissions: unknown[] }).permissions;
  const problems: string[] = [];
  if (!perms.includes("allow-read-text-file"))
    problems.push("capability lacks allow-read-text-file");
  if (!perms.includes("dialog:allow-open"))
    problems.push("capability lacks dialog:allow-open");
  return problems;
}

describe("(b) capability grants the file permissions", () => {
  it("has allow-read-text-file and dialog:allow-open", () => {
    expect(capabilityProblems(read(CAPABILITY))).toEqual([]);
  });

  it("negative: each missing permission is reported", () => {
    const src = read(CAPABILITY);
    const a = src.replace("allow-read-text-file", "allow-other");
    expect(a).not.toBe(src);
    expect(capabilityProblems(a).join("\n")).toContain("allow-read-text-file");
    const b = src.replace("dialog:allow-open", "dialog:allow-save");
    expect(b).not.toBe(src);
    expect(capabilityProblems(b).join("\n")).toContain("dialog:allow-open");
  });
});

// ---- (c) lib.rs plugin registration ------------------------------------------------------

const countOf = (src: string, needle: string): number =>
  src.split(needle).length - 1;

function libProblems(src: string): string[] {
  const problems: string[] = [];
  const init = countOf(src, "tauri_plugin_dialog::init()");
  if (init !== 1)
    problems.push(`lib.rs registers tauri_plugin_dialog::init() ${init} times`);
  const setup = countOf(src, ".setup(");
  if (setup !== 1) problems.push(`lib.rs has ${setup} .setup( calls`);
  return problems;
}

describe("(c) lib.rs registers the dialog plugin once", () => {
  it("has exactly one dialog init and one .setup(", () => {
    expect(libProblems(read(LIB_RS))).toEqual([]);
  });

  it("negative: a removed init is reported", () => {
    const src = read(LIB_RS);
    const mutated = src.replace(".plugin(tauri_plugin_dialog::init())", "");
    expect(mutated).not.toBe(src);
    expect(libProblems(mutated).join("\n")).toContain("0 times");
  });

  it("negative: a duplicated init or a second .setup( is reported", () => {
    const src = read(LIB_RS);
    const dup = src.replace(
      ".plugin(tauri_plugin_dialog::init())",
      ".plugin(tauri_plugin_dialog::init())\n.plugin(tauri_plugin_dialog::init())",
    );
    expect(libProblems(dup).join("\n")).toContain("2 times");
    expect(libProblems(`${src}\n.setup(|_| Ok(()))`).join("\n")).toContain(
      "2 .setup(",
    );
  });
});

// ---- (d) pins ----------------------------------------------------------------------------

function pinProblems(cargo: string, workspace: string, pkg: string): string[] {
  const problems: string[] = [];
  if (!/^tauri-plugin-dialog = "=\d+\.\d+\.\d+"$/m.test(cargo))
    problems.push("Cargo.toml tauri-plugin-dialog is not an exact =x.y.z pin");
  if (!/^\s*"@tauri-apps\/plugin-dialog": \d+\.\d+\.\d+\s*$/m.test(workspace))
    problems.push("catalog @tauri-apps/plugin-dialog is not a bare x.y.z");
  if (!/"@tauri-apps\/plugin-dialog": "catalog:"/.test(pkg))
    problems.push("desktop package.json does not use catalog: for the dialog");
  return problems;
}

describe("(d) dialog plugin pins are exact", () => {
  it("crate =x.y.z, catalog bare x.y.z, package.json catalog:", () => {
    expect(
      pinProblems(read(CARGO_TOML), read(WORKSPACE), read(DESKTOP_PKG)),
    ).toEqual([]);
  });

  it("negative: caret/loose pins and a direct version are reported", () => {
    const cargo = read(CARGO_TOML);
    const ws = read(WORKSPACE);
    const pkg = read(DESKTOP_PKG);
    const c = cargo.replace('"=2.8.4"', '"2.8.4"');
    expect(c).not.toBe(cargo);
    expect(pinProblems(c, ws, pkg).join("\n")).toContain("Cargo.toml");
    const w = ws.replace(/(plugin-dialog": )(\d)/, "$1^$2");
    expect(w).not.toBe(ws);
    expect(pinProblems(cargo, w, pkg).join("\n")).toContain("catalog");
    const p = pkg.replace(
      '"@tauri-apps/plugin-dialog": "catalog:"',
      '"@tauri-apps/plugin-dialog": "2.8.4"',
    );
    expect(p).not.toBe(pkg);
    expect(pinProblems(cargo, ws, p).join("\n")).toContain("package.json");
  });
});

// ---- (e) chord-core re-exports the importer ----------------------------------------------

function indexProblems(src: string): string[] {
  return /^export \* from "\.\/import";$/m.test(src)
    ? []
    : ["chord-core index.ts does not re-export ./import"];
}

describe("(e) chord-core index re-exports ./import", () => {
  it("has the export", () => {
    expect(indexProblems(read(CORE_INDEX))).toEqual([]);
  });

  it("negative: a missing re-export is reported", () => {
    const src = read(CORE_INDEX);
    const mutated = src.replace('export * from "./import";\n', "");
    expect(mutated).not.toBe(src);
    expect(indexProblems(mutated).join("\n")).toContain("./import");
  });
});

// ---- (f) no window.confirm in app sources ------------------------------------------------

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(repoRoot, dir))) {
    if (name === "node_modules") continue;
    const rel = `${dir}/${name}`;
    if (statSync(path.join(repoRoot, rel)).isDirectory())
      out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

const isAppTsx = (rel: string): boolean =>
  rel.endsWith(".tsx") &&
  !/\.test\.tsx$/.test(rel) &&
  !rel.startsWith(`${DESKTOP_SRC}/test/`);

function confirmProblems(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([rel, text]) => isAppTsx(rel) && text.includes("window.confirm("))
    .map(([rel]) => `${rel} calls window.confirm(`);
}

describe("(f) no window.confirm in desktop tsx sources", () => {
  const files = Object.fromEntries(
    walk(DESKTOP_SRC)
      .filter(isAppTsx)
      .map((rel) => [rel, read(rel)] as const),
  );

  it("scans the app and component sources", () => {
    expect(Object.keys(files)).toContain(`${DESKTOP_SRC}/App.tsx`);
    expect(Object.keys(files)).toContain(
      `${DESKTOP_SRC}/components/ConfirmDiscard.tsx`,
    );
    expect(confirmProblems(files)).toEqual([]);
  });

  it("negative: a window.confirm( call in a source file is reported", () => {
    const mutated = {
      ...files,
      [`${DESKTOP_SRC}/App.tsx`]: `${files[`${DESKTOP_SRC}/App.tsx`]!}\nwindow.confirm("x");`,
    };
    expect(confirmProblems(mutated).join("\n")).toContain("App.tsx");
  });

  it("a window.confirm( in a test file is not reported", () => {
    expect(
      confirmProblems({
        [`${DESKTOP_SRC}/App.test.tsx`]: 'window.confirm("x")',
      }),
    ).toEqual([]);
  });
});

// ---- (g) import fixtures complete --------------------------------------------------------

function fixtureProblems(
  names: readonly string[],
  exists: (rel: string) => boolean,
): string[] {
  const problems: string[] = [];
  for (const name of names) {
    for (const ext of ["txt", "cho"]) {
      if (!exists(`${IMPORT_DIR}/${name}.${ext}`))
        problems.push(`missing ${name}.${ext}`);
    }
  }
  return problems;
}

describe("(g) every import fixture has .txt and .cho", () => {
  const exists = (rel: string): boolean => existsSync(path.join(repoRoot, rel));

  it("lists the fixtures", () => {
    expect(IMPORT_FIXTURE_NAMES.length).toBeGreaterThan(0);
    expect(fixtureProblems(IMPORT_FIXTURE_NAMES, exists)).toEqual([]);
  });

  it("negative: a missing fixture file is reported", () => {
    const first = `${IMPORT_DIR}/${IMPORT_FIXTURE_NAMES[0]}.cho`;
    const problems = fixtureProblems(
      IMPORT_FIXTURE_NAMES,
      (rel) => rel !== first && exists(rel),
    );
    expect(problems).toEqual([`missing ${IMPORT_FIXTURE_NAMES[0]}.cho`]);
  });
});
