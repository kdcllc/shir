// G7 cross-task contract: chord-core re-exports the edit operations, deletion is always confirmed,
// one chord renderer, edit fixtures complete, no new IPC command.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readEditCases } from "../packages/test-fixtures/src/index";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

const CORE_INDEX = "packages/chord-core/src/index.ts";
const DESKTOP_SRC = "apps/desktop/src";
const APP_TSX = `${DESKTOP_SRC}/App.tsx`;
const STORAGE_TS = `${DESKTOP_SRC}/storage.ts`;
const BINDINGS = `${DESKTOP_SRC}/bindings.ts`;
const VISUAL_EDITOR = `${DESKTOP_SRC}/components/VisualEditor.tsx`;
const CONFIRM_DELETE = `${DESKTOP_SRC}/components/ConfirmDelete.tsx`;
const SONG_INDEX = `${DESKTOP_SRC}/components/SongIndex.tsx`;

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

/** A `.ts` / `.tsx` source that is not a test file. */
const isSource = (rel: string): boolean =>
  /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel);

type Sources = Record<string, string>;

const sources: Sources = Object.fromEntries(
  walk(DESKTOP_SRC)
    .filter(isSource)
    .map((rel) => [rel, read(rel)] as const),
);

describe("the scan covers the desktop sources", () => {
  it("includes app, component and plain .ts sources, and no test file", () => {
    const files = Object.keys(sources);
    for (const rel of [
      APP_TSX,
      STORAGE_TS,
      BINDINGS,
      VISUAL_EDITOR,
      CONFIRM_DELETE,
      SONG_INDEX,
      `${DESKTOP_SRC}/deleteSongs.ts`,
    ])
      expect(files).toContain(rel);
    expect(files.filter((rel) => /\.test\.tsx?$/.test(rel))).toEqual([]);
    expect(isSource(`${DESKTOP_SRC}/App.test.tsx`)).toBe(false);
    expect(isSource(`${DESKTOP_SRC}/deleteSongs.test.ts`)).toBe(false);
    expect(isSource(`${DESKTOP_SRC}/App.module.css`)).toBe(false);
  });
});

// ---- (a) chord-core re-exports the edit operations ---------------------------------------

function indexProblems(src: string): string[] {
  return /^export \* from "\.\/edit";$/m.test(src)
    ? []
    : ["chord-core index.ts does not re-export ./edit"];
}

describe("(a) chord-core index re-exports ./edit", () => {
  it("has the export", () => {
    expect(indexProblems(read(CORE_INDEX))).toEqual([]);
  });

  it("negative: a missing re-export is reported", () => {
    const src = read(CORE_INDEX);
    const mutated = src.replace('export * from "./edit";\n', "");
    expect(mutated).not.toBe(src);
    expect(indexProblems(mutated).join("\n")).toContain("./edit");
  });

  it("negative: a commented-out re-export is reported", () => {
    const src = read(CORE_INDEX);
    const mutated = src.replace(
      'export * from "./edit";',
      '// export * from "./edit";',
    );
    expect(mutated).not.toBe(src);
    expect(indexProblems(mutated)).toHaveLength(1);
  });
});

// ---- (b) deletion is always confirmed ----------------------------------------------------

const DELETE_SONG_ALLOWED: ReadonlySet<string> = new Set([
  STORAGE_TS,
  BINDINGS,
  APP_TSX,
]);

function deleteProblems(files: Sources): string[] {
  const problems: string[] = [];
  for (const [rel, text] of Object.entries(files)) {
    if (!isSource(rel)) continue;
    if (/\bdeleteSong\b/.test(text) && !DELETE_SONG_ALLOWED.has(rel))
      problems.push(`${rel} uses deleteSong`);
  }
  const app = files[APP_TSX] ?? "";
  if (app.includes("deleteSong("))
    problems.push(`${APP_TSX} calls deleteSong( directly`);
  if (!app.includes("deleteMany("))
    problems.push(`${APP_TSX} does not delete through deleteMany(`);
  return problems;
}

describe("(b) deletion is always confirmed", () => {
  it("deleteSong is named only in storage.ts, bindings.ts and App.tsx, and App deletes through deleteMany", () => {
    expect(deleteProblems(sources)).toEqual([]);
  });

  it("the precondition holds: the three allowed files do name deleteSong", () => {
    for (const rel of DELETE_SONG_ALLOWED)
      expect(/\bdeleteSong\b/.test(sources[rel]!), rel).toBe(true);
  });

  it("negative: a direct deleteSong(id) call in App.tsx is reported", () => {
    const mutated = {
      ...sources,
      [APP_TSX]: `${sources[APP_TSX]!}\nvoid deleteSong(id);\n`,
    };
    expect(deleteProblems(mutated)).toEqual([
      `${APP_TSX} calls deleteSong( directly`,
    ]);
  });

  it("negative: App.tsx without deleteMany( is reported", () => {
    const src = sources[APP_TSX]!;
    const mutated = src.replaceAll("deleteMany(", "removeAll(");
    expect(mutated).not.toBe(src);
    expect(deleteProblems({ ...sources, [APP_TSX]: mutated })).toEqual([
      `${APP_TSX} does not delete through deleteMany(`,
    ]);
  });

  it("negative: a deleteSong identifier in a component file is reported", () => {
    for (const rel of [CONFIRM_DELETE, SONG_INDEX]) {
      const mutated = {
        ...sources,
        [rel]: `import { deleteSong } from "../storage";\n${sources[rel]!}`,
      };
      expect(deleteProblems(mutated)).toEqual([`${rel} uses deleteSong`]);
    }
  });

  it("deleteSongNamed, deleteSongs and STRINGS.deleteAction are not deleteSong", () => {
    expect(
      deleteProblems({
        ...sources,
        [`${DESKTOP_SRC}/components/Extra.tsx`]:
          'import { deleteMany } from "../deleteSongs";\nconst deleteSongNamed = STRINGS.deleteAction;\n',
      }),
    ).toEqual([]);
  });

  it("a deleteSong in a test file is not reported", () => {
    expect(
      deleteProblems({
        ...sources,
        [`${DESKTOP_SRC}/components/Extra.test.tsx`]: "deleteSong('a')",
      }),
    ).toEqual([]);
  });
});

// ---- (c) one renderer --------------------------------------------------------------------

function rendererProblems(files: Sources): string[] {
  const problems: string[] = [];
  for (const [rel, text] of Object.entries(files)) {
    if (!isSource(rel)) continue;
    for (const needle of ["data-chord-box", "data-anchor="]) {
      if (text.includes(needle)) problems.push(`${rel} contains ${needle}`);
    }
  }
  const visual = files[VISUAL_EDITOR] ?? "";
  const fromRender = [
    ...visual.matchAll(/import\s*\{([^}]*)\}\s*from\s*"chord-render"/g),
  ].flatMap((m) => m[1]!.split(",").map((name) => name.trim()));
  if (!fromRender.includes("ChordLine"))
    problems.push(
      `${VISUAL_EDITOR} does not import ChordLine from chord-render`,
    );
  return problems;
}

describe("(c) the desktop app renders chords through chord-render only", () => {
  it("no desktop source builds chord boxes or anchors, and VisualEditor imports ChordLine", () => {
    expect(rendererProblems(sources)).toEqual([]);
  });

  it("negative: an injected data-chord-box is reported", () => {
    const mutated = {
      ...sources,
      [VISUAL_EDITOR]: `${sources[VISUAL_EDITOR]!}\nconst box = <span data-chord-box="" />;\n`,
    };
    expect(rendererProblems(mutated)).toEqual([
      `${VISUAL_EDITOR} contains data-chord-box`,
    ]);
  });

  it("negative: an injected data-anchor= is reported", () => {
    const mutated = {
      ...sources,
      [APP_TSX]: `${sources[APP_TSX]!}\nconst a = <span data-anchor="" />;\n`,
    };
    expect(rendererProblems(mutated)).toEqual([
      `${APP_TSX} contains data-anchor=`,
    ]);
  });

  it("negative: ChordLine imported from another module is reported", () => {
    const src = sources[VISUAL_EDITOR]!;
    const mutated = src.replace(
      /import \{ ChordLine, ([^}]*)\} from "chord-render";/,
      'import { $1} from "chord-render";\nimport { ChordLine } from "./ChordLine";',
    );
    expect(mutated).not.toBe(src);
    expect(rendererProblems({ ...sources, [VISUAL_EDITOR]: mutated })).toEqual([
      `${VISUAL_EDITOR} does not import ChordLine from chord-render`,
    ]);
  });

  it("data-anchor-index and data-chord-button selectors are allowed", () => {
    expect(
      rendererProblems({
        ...sources,
        [`${DESKTOP_SRC}/components/Extra.tsx`]:
          'q("[data-chord-button][data-anchor-index]")',
      }),
    ).toEqual([]);
  });
});

// ---- (d) edit fixtures -------------------------------------------------------------------

const EDIT_OP_TYPES = [
  "setLyric",
  "addChord",
  "setChord",
  "removeChord",
  "moveChord",
  "insertLine",
  "removeLine",
  "splitLine",
  "joinLines",
  "setChordsLine",
  "setComment",
  "setMeta",
  "addSection",
  "renameSection",
  "moveSection",
  "removeSection",
  "transpose",
] as const;
const EDIT_FIXTURES = ["he_plain", "he_niqqud", "mixed_he_en"] as const;

interface CaseLike {
  fixture: string;
  ops: unknown[];
}

function editCaseProblems(cases: readonly CaseLike[]): string[] {
  const problems: string[] = [];
  const types = new Set(
    cases.flatMap((c) => c.ops.map((op) => (op as { type?: unknown }).type)),
  );
  for (const type of EDIT_OP_TYPES) {
    if (!types.has(type)) problems.push(`no edit case uses ${type}`);
  }
  for (const fixture of EDIT_FIXTURES) {
    if (!cases.some((c) => c.fixture === fixture && c.ops.length > 0))
      problems.push(`no edit case on ${fixture}`);
  }
  return problems;
}

describe("(d) the golden edit cases cover every EditOp and the RTL fixtures", () => {
  const cases = readEditCases();

  it("lists 17 op types, the same ones chord-core declares", () => {
    expect(new Set(EDIT_OP_TYPES).size).toBe(17);
    const declared = [
      ...read("packages/chord-core/src/edit.ts")
        .split("export type EditOp =")[1]!
        .split("/** Result of an edit")[0]!
        .matchAll(/type: "([A-Za-z]+)"/g),
    ].map((m) => m[1]!);
    expect([...declared].sort()).toEqual([...EDIT_OP_TYPES].sort());
  });

  it("covers all 17 op types and he_plain, he_niqqud and mixed_he_en", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(editCaseProblems(cases)).toEqual([]);
  });

  it("negative: a case list without moveChord is reported", () => {
    const without = cases.map((c) => ({
      ...c,
      ops: c.ops.filter((op) => (op as { type: string }).type !== "moveChord"),
    }));
    expect(without).not.toEqual(cases);
    expect(editCaseProblems(without)).toEqual(["no edit case uses moveChord"]);
  });

  it("negative: a case list without a fixture is reported", () => {
    for (const fixture of EDIT_FIXTURES) {
      const without = cases.filter((c) => c.fixture !== fixture);
      expect(without.length).toBeLessThan(cases.length);
      expect(editCaseProblems(without)).toContain(`no edit case on ${fixture}`);
    }
  });
});

// ---- (e) no Rust or IPC surface changed --------------------------------------------------

const COMMANDS = [
  "addSetlistItems",
  "createSetlist",
  "deleteSetlist",
  "deleteSong",
  "duplicateSetlist",
  "extractDocument",
  "getSetlist",
  "getSong",
  "listSetlists",
  "listSongs",
  "logWebviewError",
  "readTextFile",
  "removeSetlistItem",
  "renameSetlist",
  "reorderSetlistItems",
  "saveExportDocx",
  "saveSong",
  "searchSongs",
  "updateSetlistItem",
];

function commandNames(src: string): string[] {
  const body = /export const commands = \{\n([\s\S]*?)\n\};/.exec(src)?.[1];
  if (body === undefined) return [];
  return [...body.matchAll(/^\t([A-Za-z0-9_]+): /gm)].map((m) => m[1]!).sort();
}

function commandProblems(src: string): string[] {
  const names = commandNames(src);
  const problems: string[] = [];
  for (const name of names) {
    if (!COMMANDS.includes(name)) problems.push(`unexpected command ${name}`);
  }
  for (const name of COMMANDS) {
    if (!names.includes(name)) problems.push(`missing command ${name}`);
  }
  const invokes = src.split("__TAURI_INVOKE(").length - 1;
  const typed = src.split("__TAURI_INVOKE<").length - 1;
  if (invokes + typed !== COMMANDS.length)
    problems.push(`bindings.ts invokes ${invokes + typed} commands`);
  return problems;
}

describe("(e) bindings.ts still lists exactly the nineteen commands", () => {
  it("has the nineteen commands and nineteen invokes", () => {
    expect(commandNames(read(BINDINGS))).toEqual(COMMANDS);
    expect(commandProblems(read(BINDINGS))).toEqual([]);
  });

  it("negative: a twentieth command is reported", () => {
    const src = read(BINDINGS);
    const mutated = src.replace(
      "\tdeleteSong: ",
      '\tdeleteSongs: (ids: string[]) => __TAURI_INVOKE("delete_songs", { ids }),\n\tdeleteSong: ',
    );
    expect(mutated).not.toBe(src);
    expect(commandProblems(mutated)).toEqual([
      "unexpected command deleteSongs",
      "bindings.ts invokes 20 commands",
    ]);
  });

  it("negative: a removed command is reported", () => {
    const src = read(BINDINGS);
    const mutated = src.replace(/^\tdeleteSong: .*\n/m, "");
    expect(mutated).not.toBe(src);
    expect(commandProblems(mutated)).toEqual([
      "missing command deleteSong",
      "bindings.ts invokes 18 commands",
    ]);
  });
});
