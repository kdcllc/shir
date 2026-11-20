import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FIXTURE_NAMES = [
  "he_plain",
  "he_niqqud",
  "en_plain",
  "mixed_he_en",
  "chord_only_line",
  "sharp_flat_extensions",
  "dense_chords",
  "long_wrap_line",
] as const;

/** G2 round-trip fixtures (sections, tabs, unknown directives, aliases, malformed, RTL line with an LTR tail). */
export const ROUNDTRIP_FIXTURE_NAMES = [
  "sections_he",
  "tab_block",
  "unknown_directives",
  "slash_chords_key",
  "aliases_input",
  "malformed_input",
  "rtl_ltr_tail",
] as const;

/** Every fixture: the G1 rendering set, then the round-trip set. */
export const ALL_FIXTURE_NAMES = [
  ...FIXTURE_NAMES,
  ...ROUNDTRIP_FIXTURE_NAMES,
] as const;

export type FixtureName = (typeof ALL_FIXTURE_NAMES)[number];

export function isFixtureName(value: string): value is FixtureName {
  return (ALL_FIXTURE_NAMES as readonly string[]).includes(value);
}

/** Absolute path of `<package>/fixtures/<name>.cho`. */
export function fixturePath(name: FixtureName): string {
  if (!isFixtureName(name)) {
    throw new TypeError(`Unknown fixture name: ${String(name)}`);
  }
  return fileURLToPath(new URL(`../fixtures/${name}.cho`, import.meta.url));
}

/** Absolute path of `<package>/fixtures/<name>.golden.json`. */
export function goldenPath(name: FixtureName): string {
  if (!isFixtureName(name)) {
    throw new TypeError(`Unknown fixture name: ${String(name)}`);
  }
  return fileURLToPath(
    new URL(`../fixtures/${name}.golden.json`, import.meta.url),
  );
}

/** UTF-8 source of a fixture. */
export function readFixture(name: FixtureName): string {
  return readFileSync(fixturePath(name), "utf8");
}

/** Parsed golden `SongModel` JSON of a fixture. */
export function readGolden(name: FixtureName): unknown {
  return JSON.parse(readFileSync(goldenPath(name), "utf8")) as unknown;
}

/**
 * Absolute path of the expected save output: `<name>.canonical.cho` when that
 * file exists, otherwise the fixture itself (already canonical).
 */
export function canonicalPath(name: FixtureName): string {
  if (!isFixtureName(name)) {
    throw new TypeError(`Unknown fixture name: ${String(name)}`);
  }
  const p = fileURLToPath(
    new URL(`../fixtures/${name}.canonical.cho`, import.meta.url),
  );
  return existsSync(p) ? p : fixturePath(name);
}

/** UTF-8 content of {@link canonicalPath}. */
export function readCanonical(name: FixtureName): string {
  return readFileSync(canonicalPath(name), "utf8");
}

/** Parsed `<name>.diagnostics.json`, or `[]` when the fixture has none. */
export function readDiagnostics(name: FixtureName): unknown[] {
  if (!isFixtureName(name)) {
    throw new TypeError(`Unknown fixture name: ${String(name)}`);
  }
  const p = fileURLToPath(
    new URL(`../fixtures/${name}.diagnostics.json`, import.meta.url),
  );
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8")) as unknown[];
}

/**
 * Importer fixtures (`import/<name>.txt` input, `<name>.cho` golden for the
 * default `rtlColumns: "mirror"`, `<name>.logical.cho` golden for `"logical"`
 * on RTL fixtures). Kept apart from {@link ALL_FIXTURE_NAMES} on purpose.
 */
export const IMPORT_FIXTURE_NAMES = [
  "he_over_lyrics",
  "he_niqqud_over_lyrics",
  "en_over_lyrics",
  "mixed_over_lyrics",
  "chordpro_passthrough",
  "header_he_over_lyrics",
] as const;

export type ImportFixtureName = (typeof IMPORT_FIXTURE_NAMES)[number];

const LOGICAL_GOLDEN_NAMES: ReadonlySet<string> = new Set([
  "he_over_lyrics",
  "he_niqqud_over_lyrics",
  "mixed_over_lyrics",
  "header_he_over_lyrics",
]);

function assertImportName(name: string): void {
  if (!(IMPORT_FIXTURE_NAMES as readonly string[]).includes(name)) {
    throw new TypeError(`Unknown import fixture name: ${String(name)}`);
  }
}

function importFile(file: string): string {
  return fileURLToPath(new URL(`../import/${file}`, import.meta.url));
}

/** True when the fixture is RTL and has a `<name>.logical.cho` golden. */
export function hasLogicalGolden(name: ImportFixtureName): boolean {
  assertImportName(name);
  return LOGICAL_GOLDEN_NAMES.has(name);
}

/** UTF-8 input text (`<name>.txt`) of an import fixture. */
export function readImportInput(name: ImportFixtureName): string {
  assertImportName(name);
  return readFileSync(importFile(`${name}.txt`), "utf8");
}

/**
 * Expected `importText` output. Omitted variant is the default `mirror`
 * golden (`<name>.cho`); `"logical"` reads `<name>.logical.cho`.
 */
export function readImportGolden(
  name: ImportFixtureName,
  variant?: "logical",
): string {
  assertImportName(name);
  if (variant === undefined) {
    return readFileSync(importFile(`${name}.cho`), "utf8");
  }
  if (variant !== "logical" || !LOGICAL_GOLDEN_NAMES.has(name)) {
    throw new TypeError(
      `No ${String(variant)} golden for import fixture: ${name}`,
    );
  }
  return readFileSync(importFile(`${name}.logical.cho`), "utf8");
}

// The URL is built from a variable on purpose: Vite rewrites a static
// `new URL("<literal>", import.meta.url)` into an asset URL, which
// `fileURLToPath` rejects in bundled (jsdom) test runs.
const EDIT_CASES_FILE = "cases.json";

/** Absolute path of the golden edit cases, `<package>/edit/cases.json`. */
export const EDIT_CASES_PATH = fileURLToPath(
  new URL(`../edit/${EDIT_CASES_FILE}`, import.meta.url),
);

/**
 * One golden edit case: `ops` (chord-core `EditOp` values, untyped here
 * because this package must not depend on chord-core) applied to the parsed
 * `fixture` give the ChordPro text `expected`.
 */
export interface EditCase {
  name: string;
  fixture: FixtureName;
  ops: unknown[];
  expected: string;
}

/** The golden edit cases of {@link EDIT_CASES_PATH}. */
export function readEditCases(): EditCase[] {
  return JSON.parse(readFileSync(EDIT_CASES_PATH, "utf8")) as EditCase[];
}

/**
 * One golden export case: `<fixture>` exported at `transpose`/`capo` equals the
 * `ExportSong` JSON (without `model`) in `export/<file>`.
 */
export interface ExportGoldenCase {
  fixture: FixtureName;
  transpose: number;
  capo: number;
  file: string;
}

/** The golden export cases, in a fixed order. */
export const EXPORT_GOLDEN_CASES: readonly ExportGoldenCase[] = [
  {
    fixture: "he_plain",
    transpose: 0,
    capo: 0,
    file: "he_plain.t0c0.export.json",
  },
  {
    fixture: "he_niqqud",
    transpose: 0,
    capo: 0,
    file: "he_niqqud.t0c0.export.json",
  },
  {
    fixture: "mixed_he_en",
    transpose: 2,
    capo: 0,
    file: "mixed_he_en.t2c0.export.json",
  },
  {
    fixture: "chord_only_line",
    transpose: 0,
    capo: 0,
    file: "chord_only_line.t0c0.export.json",
  },
  {
    fixture: "sections_he",
    transpose: -3,
    capo: 2,
    file: "sections_he.t-3c2.export.json",
  },
  {
    fixture: "dense_chords",
    transpose: 0,
    capo: 0,
    file: "dense_chords.t0c0.export.json",
  },
  {
    fixture: "rtl_ltr_tail",
    transpose: 0,
    capo: 0,
    file: "rtl_ltr_tail.t0c0.export.json",
  },
];

/** Absolute path of `<package>/export/<file>`. */
export function exportGoldenPath(file: string): string {
  if (!EXPORT_GOLDEN_CASES.some((c) => c.file === file)) {
    throw new TypeError(`Unknown export golden: ${String(file)}`);
  }
  return fileURLToPath(new URL(`../export/${file}`, import.meta.url));
}

/** Parsed export golden (an `ExportSong` without `model`) of a case or file name. */
export function readExportGolden(
  caseOrFile: ExportGoldenCase | string,
): unknown {
  const file = typeof caseOrFile === "string" ? caseOrFile : caseOrFile.file;
  return JSON.parse(readFileSync(exportGoldenPath(file), "utf8")) as unknown;
}
