// G10 cross-task contract: the 11 new commands registered consistently, no webview-supplied write
// path, migration 0003, the docx dependency, and the core/render purity boundaries.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
const STORAGE = "apps/desktop/src/storage.ts";
const FILES = "apps/desktop/src/files.ts";
const MIGRATIONS_RS = "apps/desktop/src-tauri/src/db/migrations.rs";
const MIGRATION_SQL = "apps/desktop/src-tauri/migrations/0003_setlists.sql";

/** The 11 commands G10 adds (snake_case, as registered in Rust). */
const SETLIST_COMMANDS = [
  "list_setlists",
  "get_setlist",
  "create_setlist",
  "rename_setlist",
  "delete_setlist",
  "duplicate_setlist",
  "add_setlist_items",
  "remove_setlist_item",
  "reorder_setlist_items",
  "update_setlist_item",
] as const;
const NEW_COMMANDS = [...SETLIST_COMMANDS, "save_export_docx"] as const;

const camel = (snake: string): string =>
  snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const kebab = (snake: string): string => snake.replaceAll("_", "-");

// ---- (a) command registration ------------------------------------------------------------

function buildRsProblems(src: string): string[] {
  const m = /\.commands\(&\[([\s\S]*?)\]\)/.exec(src);
  if (!m) return ["build.rs has no AppManifest commands list"];
  const body = m[1] as string;
  return NEW_COMMANDS.filter((c) => !body.includes(`"${c}"`)).map(
    (c) => `build.rs AppManifest list lacks ${c}`,
  );
}

function collectCommandsProblems(src: string): string[] {
  const m = /collect_commands!\[([\s\S]*?)\]/.exec(src);
  if (!m) return ["collect_commands! not found"];
  const names = (m[1] as string)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => s.split("::").pop() as string);
  const problems = NEW_COMMANDS.filter((c) => !names.includes(c)).map(
    (c) => `collect_commands! lacks ${c}`,
  );
  if (names[names.length - 1] !== "log_webview_error") {
    problems.push("collect_commands! does not end with log_webview_error");
  }
  return problems;
}

function capabilityProblems(src: string): string[] {
  const perms = (JSON.parse(src) as { permissions: string[] }).permissions;
  const problems = NEW_COMMANDS.filter(
    (c) => !perms.includes(`allow-${kebab(c)}`),
  ).map((c) => `capability lacks allow-${kebab(c)}`);
  if (perms.includes("dialog:allow-save")) {
    problems.push("capability grants dialog:allow-save");
  }
  for (const p of perms) {
    if (p.startsWith("fs:")) problems.push(`capability grants ${p}`);
  }
  return problems;
}

function bindingsProblems(src: string): string[] {
  const problems: string[] = [];
  for (const c of NEW_COMMANDS) {
    const re = new RegExp(
      `^\\s*${camel(c)}: \\([^\\n]*\\) => typedError<[^\\n]*__TAURI_INVOKE\\("${c}"`,
      "m",
    );
    if (!re.test(src)) {
      problems.push(`bindings.ts ${camel(c)} does not invoke ${c}`);
    }
  }
  return problems;
}

/** The argument list of `saveExportDocx` in bindings.ts, or undefined when absent. */
function saveExportArgs(src: string): string | undefined {
  return /^\s*saveExportDocx: \(([^)]*)\)/m.exec(src)?.[1];
}

function noPathProblems(src: string): string[] {
  const args = saveExportArgs(src);
  if (args === undefined) return ["bindings.ts has no saveExportDocx"];
  return /\b(path|filePath|file_path|filename)\b\s*[:?]/i.test(args)
    ? ["saveExportDocx takes a path argument"]
    : [];
}

function wrapperProblems(storage: string, files: string): string[] {
  const problems: string[] = [];
  for (const c of SETLIST_COMMANDS) {
    const re = new RegExp(`commands\\.${camel(c)}\\(`);
    if (!re.test(storage)) problems.push(`storage.ts never calls ${camel(c)}`);
    if (!new RegExp(`export (async )?function ${camel(c)}\\(`).test(storage)) {
      problems.push(`storage.ts does not export ${camel(c)}`);
    }
  }
  if (!/commands\.saveExportDocx\(/.test(files)) {
    problems.push("files.ts never calls saveExportDocx");
  }
  if (!/export async function saveExportDocx\(/.test(files)) {
    problems.push("files.ts does not export saveExportDocx");
  }
  return problems;
}

describe("(a) the 11 new commands are registered end to end", () => {
  it("are in build.rs, collect_commands! (log_webview_error last), the capability, bindings and the TS wrappers", () => {
    expect(NEW_COMMANDS).toHaveLength(11);
    expect(buildRsProblems(read(BUILD_RS))).toEqual([]);
    expect(collectCommandsProblems(read(MOD_RS))).toEqual([]);
    expect(capabilityProblems(read(CAPABILITY))).toEqual([]);
    expect(bindingsProblems(read(BINDINGS))).toEqual([]);
    expect(wrapperProblems(read(STORAGE), read(FILES))).toEqual([]);
  });

  it("negative: build.rs without a command is reported", () => {
    const src = read(BUILD_RS);
    const mutated = src.replace('"update_setlist_item",', "");
    expect(mutated).not.toBe(src);
    expect(buildRsProblems(mutated)).toEqual([
      "build.rs AppManifest list lacks update_setlist_item",
    ]);
  });

  it("negative: collect_commands! without a command is reported", () => {
    const src = read(MOD_RS);
    const mutated = src.replace(/\s*setlists::get_setlist,/, "");
    expect(mutated).not.toBe(src);
    expect(collectCommandsProblems(mutated)).toEqual([
      "collect_commands! lacks get_setlist",
    ]);
  });

  it("negative: log_webview_error no longer last is reported", () => {
    const src = read(MOD_RS);
    const mutated = src
      .replace(/,\s*log_webview_error(\s*\])/, "$1")
      .replace(
        "collect_commands![",
        "collect_commands![\n            log_webview_error,",
      );
    expect(mutated).not.toBe(src);
    expect(collectCommandsProblems(mutated)).toEqual([
      "collect_commands! does not end with log_webview_error",
    ]);
  });

  it("negative: a capability without the permission is reported", () => {
    const src = read(CAPABILITY);
    const mutated = src.replace('"allow-reorder-setlist-items",', "");
    expect(mutated).not.toBe(src);
    expect(capabilityProblems(mutated)).toEqual([
      "capability lacks allow-reorder-setlist-items",
    ]);
  });

  it("negative: bindings invoking another command are reported", () => {
    const src = read(BINDINGS);
    const mutated = src.replace('"duplicate_setlist"', '"other_command"');
    expect(mutated).not.toBe(src);
    expect(bindingsProblems(mutated)).toEqual([
      "bindings.ts duplicateSetlist does not invoke duplicate_setlist",
    ]);
  });

  it("negative: a missing wrapper is reported", () => {
    const storage = read(STORAGE);
    const mutated = storage.replace(
      /commands\.removeSetlistItem\(/,
      "commands.other(",
    );
    expect(mutated).not.toBe(storage);
    expect(wrapperProblems(mutated, read(FILES))).toContain(
      "storage.ts never calls removeSetlistItem",
    );
    const files = read(FILES);
    const mutatedFiles = files.replace(
      /commands\.saveExportDocx\(/,
      "commands.other(",
    );
    expect(mutatedFiles).not.toBe(files);
    expect(wrapperProblems(storage, mutatedFiles)).toEqual([
      "files.ts never calls saveExportDocx",
    ]);
  });
});

describe("(b) no webview-supplied write path", () => {
  it("saveExportDocx takes no path argument; dialog:allow-save and fs: are absent", () => {
    const args = saveExportArgs(read(BINDINGS));
    expect(args).toMatch(/^defaultName: string, filterName: string, bytes: /);
    expect(noPathProblems(read(BINDINGS))).toEqual([]);
    const perms = (JSON.parse(read(CAPABILITY)) as { permissions: string[] })
      .permissions;
    expect(perms).not.toContain("dialog:allow-save");
    expect(perms.filter((p) => p.startsWith("fs:"))).toEqual([]);
  });

  it("no setlist or export command in bindings has a path-like parameter", () => {
    const src = read(BINDINGS);
    for (const c of NEW_COMMANDS) {
      const args = new RegExp(`^\\s*${camel(c)}: \\(([^)]*)\\)`, "m").exec(
        src,
      )?.[1];
      expect(args, c).toBeDefined();
      expect(args, c).not.toMatch(/\b(path|filePath|filename)\b/i);
    }
  });

  it("negative: a path argument on saveExportDocx is reported", () => {
    const src = read(BINDINGS);
    const mutated = src.replace(
      "saveExportDocx: (defaultName: string,",
      "saveExportDocx: (path: string, defaultName: string,",
    );
    expect(mutated).not.toBe(src);
    expect(noPathProblems(mutated)).toEqual([
      "saveExportDocx takes a path argument",
    ]);
  });

  it("negative: granting dialog:allow-save or an fs permission is reported", () => {
    const src = read(CAPABILITY);
    const a = src.replace(
      '"dialog:allow-open",',
      '"dialog:allow-open", "dialog:allow-save",',
    );
    expect(a).not.toBe(src);
    expect(capabilityProblems(a)).toEqual([
      "capability grants dialog:allow-save",
    ]);
    const b = src.replace('"dialog:allow-open",', '"fs:allow-write-file",');
    expect(b).not.toBe(src);
    expect(capabilityProblems(b)).toEqual([
      "capability grants fs:allow-write-file",
    ]);
  });
});

// ---- (c) migration 0003 ------------------------------------------------------------------

function migrationRsProblems(src: string): string[] {
  const i1 = src.indexOf("0001_init.sql");
  const i2 = src.indexOf("0002_app_meta_fts_rebuild.sql");
  const i3 = src.indexOf("0003_setlists.sql");
  const problems: string[] = [];
  if (i3 < 0) problems.push("migrations.rs does not include 0003_setlists.sql");
  else if (!(i1 >= 0 && i2 > i1 && i3 > i2)) {
    problems.push("0003_setlists.sql is not after 0002");
  }
  return problems;
}

function migrationSqlProblems(sql: string): string[] {
  const problems: string[] = [];
  const cascades = sql.match(
    /REFERENCES\s+\w+\s*\(\s*id\s*\)\s+ON DELETE CASCADE/g,
  );
  if ((cascades?.length ?? 0) !== 2) {
    problems.push("0003_setlists.sql lacks two ON DELETE CASCADE foreign keys");
  }
  if (
    !/setlist_id\s+TEXT NOT NULL REFERENCES setlists \(id\) ON DELETE CASCADE/.test(
      sql,
    )
  ) {
    problems.push("setlist_id does not cascade from setlists");
  }
  if (
    !/song_id\s+TEXT NOT NULL REFERENCES songs \(id\) ON DELETE CASCADE/.test(
      sql,
    )
  ) {
    problems.push("song_id does not cascade from songs");
  }
  return problems;
}

describe("(c) migration 0003", () => {
  it("is included after 0002 and declares both cascading foreign keys", () => {
    expect(migrationRsProblems(read(MIGRATIONS_RS))).toEqual([]);
    expect(migrationSqlProblems(read(MIGRATION_SQL))).toEqual([]);
  });

  it("negative: a missing or misordered include is reported", () => {
    const src = read(MIGRATIONS_RS);
    const dropped = src.replace(
      'M::up(include_str!("../../migrations/0003_setlists.sql")),',
      "",
    );
    expect(dropped).not.toBe(src);
    expect(migrationRsProblems(dropped).join("\n")).toContain(
      "does not include",
    );
    const swapped = src
      .replace("0003_setlists.sql", "TMP")
      .replace("0001_init.sql", "0003_setlists.sql")
      .replace("TMP", "0001_init.sql");
    expect(swapped).not.toBe(src);
    expect(migrationRsProblems(swapped).join("\n")).toContain("not after 0002");
  });

  it("negative: a foreign key without ON DELETE CASCADE is reported", () => {
    const sql = read(MIGRATION_SQL);
    const a = sql.replace(
      "REFERENCES setlists (id) ON DELETE CASCADE",
      "REFERENCES setlists (id)",
    );
    expect(a).not.toBe(sql);
    expect(migrationSqlProblems(a).join("\n")).toContain("setlist_id");
    const b = sql.replace(
      "REFERENCES songs (id) ON DELETE CASCADE",
      "REFERENCES songs (id)",
    );
    expect(b).not.toBe(sql);
    expect(migrationSqlProblems(b).join("\n")).toContain("song_id");
  });
});

// ---- (d) docx dependency -----------------------------------------------------------------

function catalogHasDocx(yaml: string): boolean {
  return /^\s+docx:\s*\S+/m.test(yaml);
}
function desktopDepProblems(pkg: string): string[] {
  const deps = (JSON.parse(pkg) as { dependencies?: Record<string, string> })
    .dependencies;
  return deps?.docx === "catalog:" ? [] : ["desktop package.json lacks docx"];
}
function stackRowProblems(md: string): string[] {
  return /^\|\s*docx[^|]*\|\s*`docx`\s*\|[^|]*\|\s*npm\s*\|\s*installed \(G\d+\)\s*\|/m.test(
    md,
  )
    ? []
    : ["STACK.md has no installed docx row"];
}

describe("(d) docx is catalogued, depended on and documented", () => {
  it("is in the catalog, apps/desktop/package.json and an installed STACK.md row", () => {
    expect(catalogHasDocx(read("pnpm-workspace.yaml"))).toBe(true);
    expect(desktopDepProblems(read("apps/desktop/package.json"))).toEqual([]);
    expect(stackRowProblems(read("docs/STACK.md"))).toEqual([]);
  });

  it("negative: each missing piece is reported", () => {
    const ws = read("pnpm-workspace.yaml");
    const wsMut = ws.replace(/^\s+docx:.*\n/m, "");
    expect(wsMut).not.toBe(ws);
    expect(catalogHasDocx(wsMut)).toBe(false);

    const pkg = read("apps/desktop/package.json");
    const pkgMut = pkg.replace(/\s*"docx": "catalog:",/, "");
    expect(pkgMut).not.toBe(pkg);
    expect(desktopDepProblems(pkgMut)).toEqual([
      "desktop package.json lacks docx",
    ]);

    const md = read("docs/STACK.md");
    const mdMut = md.replace(
      /(\|\s*docx[^\n]*?)installed \(G10\)/,
      "$1planned (G10)  ",
    );
    expect(mdMut).not.toBe(md);
    expect(stackRowProblems(mdMut)).toEqual([
      "STACK.md has no installed docx row",
    ]);
  });
});

// ---- (e) purity boundaries ---------------------------------------------------------------

function listSources(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(path.join(repoRoot, dir))) {
      if (name === "node_modules" || name === "dist") continue;
      const sub = `${dir}/${name}`;
      if (statSync(path.join(repoRoot, sub)).isDirectory()) walk(sub);
      else if (/\.(ts|tsx)$/.test(name)) out.push(sub);
    }
  };
  walk(rel);
  return out;
}

/** Module specifiers imported by a source text (static, dynamic, side-effect and re-export). */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\(\s*)["']([^"']+)["']/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1] as string);
  return out;
}

function purityProblems(
  files: Record<string, string>,
  forbidden: RegExp,
  label: string,
): string[] {
  const problems: string[] = [];
  for (const [file, src] of Object.entries(files)) {
    for (const spec of importSpecifiers(src)) {
      if (forbidden.test(spec))
        problems.push(`${file} imports ${spec} (${label})`);
    }
  }
  return problems;
}

const sourcesOf = (dir: string): Record<string, string> =>
  Object.fromEntries(listSources(dir).map((f) => [f, read(f)]));

describe("(e) chord-core and chord-render stay free of Tauri; chord-core never imports chord-render", () => {
  const core = sourcesOf("packages/chord-core/src");
  const render = sourcesOf("packages/chord-render/src");
  const TAURI = /^@tauri-apps\//;
  const RENDER = /^chord-render(\/|$)/;

  it("precondition: the scans see real source files, including the export module", () => {
    expect(Object.keys(core)).toContain("packages/chord-core/src/export.ts");
    expect(Object.keys(render)).toContain(
      "packages/chord-render/src/SongView.tsx",
    );
  });

  it("import no @tauri-apps/* and chord-core imports nothing from chord-render", () => {
    expect(purityProblems(core, TAURI, "tauri")).toEqual([]);
    expect(purityProblems(render, TAURI, "tauri")).toEqual([]);
    expect(purityProblems(core, RENDER, "render")).toEqual([]);
    for (const dir of ["chord-core", "chord-render"]) {
      const deps = Object.keys(
        (
          JSON.parse(read(`packages/${dir}/package.json`)) as {
            dependencies?: Record<string, string>;
          }
        ).dependencies ?? {},
      );
      expect(
        deps.filter((d) => d.startsWith("@tauri-apps/")),
        dir,
      ).toEqual([]);
    }
  });

  it("import detection sees every import form (so the scan cannot be blind)", () => {
    const src = [
      'import { a } from "@tauri-apps/api/core";',
      'import "@tauri-apps/plugin-dialog";',
      'export * from "chord-render";',
      'const x = await import("@tauri-apps/api/event");',
    ].join("\n");
    expect(importSpecifiers(src)).toEqual([
      "@tauri-apps/api/core",
      "@tauri-apps/plugin-dialog",
      "chord-render",
      "@tauri-apps/api/event",
    ]);
  });

  it("negative: a Tauri import or a chord-render import in chord-core is reported", () => {
    const mutated = {
      ...core,
      "packages/chord-core/src/export.ts": `import { invoke } from "@tauri-apps/api/core";\nimport { x } from "chord-render";\n${core["packages/chord-core/src/export.ts"]}`,
    };
    expect(purityProblems(mutated, TAURI, "tauri")).toEqual([
      "packages/chord-core/src/export.ts imports @tauri-apps/api/core (tauri)",
    ]);
    expect(purityProblems(mutated, RENDER, "render")).toEqual([
      "packages/chord-core/src/export.ts imports chord-render (render)",
    ]);
  });
});
