// G4 cross-artifact contract: golden <-> chord-core, bindings.ts, build.rs, capability, STACK.md.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSong } from "../packages/chord-core/src/index";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

const COMMANDS = [
  "saveSong",
  "getSong",
  "listSongs",
  "deleteSong",
  "searchSongs",
];
const ERROR_KINDS = [
  "NotFound",
  "Invalid",
  "Storage",
  "Migration",
  "Unavailable",
];
const SNAKE = [
  "save_song",
  "get_song",
  "list_songs",
  "delete_song",
  "search_songs",
];
const STACK_PKGS = [
  "rusqlite",
  "rusqlite_migration",
  "specta",
  "tauri-specta",
  "specta-typescript",
];

interface GoldenEntry {
  file: string;
  title: string;
  artist: string | null;
  key: string | null;
  capo: number | null;
}

const sorted = (xs: string[]): string[] => [...xs].sort();

// ---- (a) golden <-> chord-core ---------------------------------------------------------

const GOLDEN_PATH = "apps/desktop/src-tauri/tests/golden/extract.json";

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of ["packages/test-fixtures/fixtures", "samples"]) {
    for (const name of readdirSync(path.join(repoRoot, dir))) {
      if (name.endsWith(".cho") && !name.endsWith(".canonical.cho")) {
        out.push(`${dir}/${name}`);
      }
    }
  }
  return sorted(out);
}

/** The golden value for one source, derived from chord-core like `songMeta`. */
function derive(src: string): Omit<GoldenEntry, "file"> {
  const { song } = parseSong(src);
  let artist: string | null = null;
  for (const line of song.lines) {
    if (line.kind === "meta" && line.name === "artist") {
      const v = line.value.trim();
      if (v !== "") {
        artist = v;
        break;
      }
    }
  }
  return {
    title: song.title ?? "",
    artist,
    key: song.key ?? null,
    capo: song.capo ?? null,
  };
}

/** Mismatch descriptions between golden entries and chord-core / the file set. */
function goldenProblems(
  golden: GoldenEntry[],
  files: string[],
  readSource: (f: string) => string,
): string[] {
  const problems: string[] = [];
  const listed = sorted(golden.map((g) => g.file));
  if (JSON.stringify(listed) !== JSON.stringify(files)) {
    problems.push(
      `golden file set differs: golden=${listed.join(",")} disk=${files.join(",")}`,
    );
  }
  for (const g of golden) {
    if (!files.includes(g.file)) continue;
    const { file, ...rest } = g;
    const want = derive(readSource(file));
    if (JSON.stringify(rest) !== JSON.stringify(want)) {
      problems.push(
        `${file}: golden ${JSON.stringify(rest)} != chord-core ${JSON.stringify(want)}`,
      );
    }
  }
  return problems;
}

describe("(a) extract golden matches chord-core", () => {
  const golden = JSON.parse(read(GOLDEN_PATH)) as GoldenEntry[];

  it("every golden entry equals chord-core and the file set is exact", () => {
    expect(golden.length).toBeGreaterThanOrEqual(15);
    expect(goldenProblems(golden, sourceFiles(), read)).toEqual([]);
  });

  it("negative: a missing golden entry (new fixture) is reported", () => {
    const problems = goldenProblems(golden.slice(1), sourceFiles(), read);
    expect(problems.join("\n")).toContain("golden file set differs");
  });

  it("negative: an extra golden entry is reported", () => {
    const extra = [...golden, { ...golden[0]!, file: "samples/ghost.cho" }];
    const problems = goldenProblems(extra, sourceFiles(), read);
    expect(problems.join("\n")).toContain("golden file set differs");
  });

  it("negative: a tampered value is reported", () => {
    const bad = golden.map((g, i) =>
      i === 0 ? { ...g, title: g.title + "x" } : g,
    );
    const problems = goldenProblems(bad, sourceFiles(), read);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(golden[0]!.file);
  });

  it("negative: a changed capo is reported", () => {
    const bad = golden.map((g) => ({ ...g, capo: (g.capo ?? 0) + 1 }));
    expect(goldenProblems(bad, sourceFiles(), read).length).toBe(golden.length);
  });

  it("derive follows the songMeta artist rule (first non-empty trimmed)", () => {
    const d = derive(
      "{artist:   }\n{artist:  Noa Test }\n{artist: Other}\n{capo: 3}\n{key: Em}\n",
    );
    expect(d).toEqual({ title: "", artist: "Noa Test", key: "Em", capo: 3 });
  });
});

// ---- (b) bindings commands -------------------------------------------------------------

function bindingsCommands(src: string): string[] {
  const start = src.indexOf("export const commands = {");
  if (start < 0) throw new Error("bindings.ts: commands object missing");
  const end = src.indexOf("\n};", start);
  const block = src.slice(start, end);
  return [...block.matchAll(/^\t([A-Za-z0-9_]+): /gm)].map((m) => m[1]!);
}

describe("(b) bindings.ts commands", () => {
  const src = read("apps/desktop/src/bindings.ts");

  it("exports exactly the five storage commands", () => {
    expect(sorted(bindingsCommands(src))).toEqual(sorted(COMMANDS));
  });

  it("negative: a sixth command is detected", () => {
    const mutated = src.replace(
      "export const commands = {\n",
      "export const commands = {\n\tpurgeAll: () => 1,\n",
    );
    expect(mutated).not.toBe(src);
    expect(sorted(bindingsCommands(mutated))).not.toEqual(sorted(COMMANDS));
  });

  it("negative: a missing command is detected", () => {
    const mutated = src.replace(/^\tdeleteSong: .*\n/m, "");
    expect(mutated).not.toBe(src);
    expect(sorted(bindingsCommands(mutated))).not.toEqual(sorted(COMMANDS));
  });
});

// ---- (c) ErrorKind ---------------------------------------------------------------------

function errorKinds(src: string): string[] {
  const m = /export type ErrorKind = ([^;]+);/.exec(src);
  if (!m) throw new Error("bindings.ts: ErrorKind missing");
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

describe("(c) ErrorKind union", () => {
  const src = read("apps/desktop/src/bindings.ts");

  it("is exactly the five kinds", () => {
    expect(sorted(errorKinds(src))).toEqual(sorted(ERROR_KINDS));
  });

  it("negative: a missing kind is detected", () => {
    const mutated = src.replace(' | "Unavailable"', "");
    expect(mutated).not.toBe(src);
    expect(sorted(errorKinds(mutated))).not.toEqual(sorted(ERROR_KINDS));
  });

  it("negative: an extra kind is detected", () => {
    const mutated = src.replace('"Unavailable"', '"Unavailable" | "Timeout"');
    expect(mutated).not.toBe(src);
    expect(sorted(errorKinds(mutated))).not.toEqual(sorted(ERROR_KINDS));
  });
});

// ---- (d) build.rs + capability ---------------------------------------------------------

function buildRsCommands(src: string): string[] {
  const m = /\.commands\(&\[([\s\S]*?)\]\)/.exec(src);
  if (!m) throw new Error("build.rs: AppManifest commands list missing");
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

const kebab = (s: string): string => `allow-${s.replace(/_/g, "-")}`;

function capabilityPermissions(json: string): string[] {
  const parsed = JSON.parse(json) as { permissions: unknown[] };
  return parsed.permissions.map(String);
}

const expectedPermissions = (): string[] => [
  "core:default",
  ...SNAKE.map(kebab),
];

describe("(d) build.rs and capability", () => {
  const build = read("apps/desktop/src-tauri/build.rs");
  const cap = read("apps/desktop/src-tauri/capabilities/default.json");

  it("build.rs lists exactly the five snake_case commands", () => {
    expect(sorted(buildRsCommands(build))).toEqual(sorted(SNAKE));
  });

  it("capability holds allow-<kebab> for each and core:default only", () => {
    expect(sorted(capabilityPermissions(cap))).toEqual(
      sorted(expectedPermissions()),
    );
  });

  it("negative: a sixth build.rs command is detected", () => {
    const mutated = build.replace(
      '"search_songs",',
      '"search_songs",\n"purge_all",',
    );
    expect(mutated).not.toBe(build);
    expect(sorted(buildRsCommands(mutated))).not.toEqual(sorted(SNAKE));
  });

  it("negative: a removed build.rs command is detected", () => {
    const mutated = build.replace('"get_song",', "");
    expect(mutated).not.toBe(build);
    expect(sorted(buildRsCommands(mutated))).not.toEqual(sorted(SNAKE));
  });

  it("negative: a missing allow permission is detected", () => {
    const mutated = cap.replace('"allow-get-song",', "");
    expect(mutated).not.toBe(cap);
    expect(sorted(capabilityPermissions(mutated))).not.toEqual(
      sorted(expectedPermissions()),
    );
  });

  it("negative: an extra permission is detected", () => {
    const mutated = cap.replace(
      '"core:default"',
      '"core:default", "fs:default"',
    );
    expect(mutated).not.toBe(cap);
    expect(sorted(capabilityPermissions(mutated))).not.toEqual(
      sorted(expectedPermissions()),
    );
  });
});

// ---- (e) STACK.md rows -----------------------------------------------------------------

function stackStatus(markdown: string, pkg: string): string | undefined {
  for (const line of markdown.split(/\r?\n/)) {
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length >= 5 && cells[1] === `\`${pkg}\``) return cells[4];
  }
  return undefined;
}

describe("(e) STACK.md rows", () => {
  const stack = read("docs/STACK.md");

  it.each(STACK_PKGS)("%s is installed (G4)", (pkg) => {
    expect(stackStatus(stack, pkg)).toBe("installed (G4)");
  });

  it("negative: a planned row is detected", () => {
    const mutated = stack.replace(
      /(\| `rusqlite_migration`[^\n]*?)installed \(G4\)/,
      "$1planned (G4)",
    );
    expect(mutated).not.toBe(stack);
    expect(stackStatus(mutated, "rusqlite_migration")).not.toBe(
      "installed (G4)",
    );
  });

  it("negative: a missing row is detected", () => {
    const mutated = stack.replace(/^\| [^\n]*`specta-typescript`[^\n]*\n/m, "");
    expect(mutated).not.toBe(stack);
    expect(stackStatus(mutated, "specta-typescript")).toBeUndefined();
  });

  it("stackStatus does not confuse specta with tauri-specta", () => {
    expect(stackStatus(stack, "specta")).toBe("installed (G4)");
    const mutated = stack.replace(
      /(\| `specta` [^\n]*?)installed \(G4\)/,
      "$1planned (G4)",
    );
    expect(stackStatus(mutated, "specta")).toBe("planned (G4)");
    expect(stackStatus(mutated, "tauri-specta")).toBe("installed (G4)");
  });
});
