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
