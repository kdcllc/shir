import { readFileSync } from "node:fs";
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

export type FixtureName = (typeof FIXTURE_NAMES)[number];

export function isFixtureName(value: string): value is FixtureName {
  return (FIXTURE_NAMES as readonly string[]).includes(value);
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
