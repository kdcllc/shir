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

/** G2 round-trip fixtures (sections, tabs, unknown directives, aliases, malformed). */
export const ROUNDTRIP_FIXTURE_NAMES = [
  "sections_he",
  "tab_block",
  "unknown_directives",
  "slash_chords_key",
  "aliases_input",
  "malformed_input",
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
