import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_NAMES,
  fixturePath,
  isFixtureName,
  type FixtureName,
} from "./index";

describe("test-fixtures", () => {
  it("freezes the eight fixture names in order", () => {
    expect([...FIXTURE_NAMES]).toEqual([
      "he_plain",
      "he_niqqud",
      "en_plain",
      "mixed_he_en",
      "chord_only_line",
      "sharp_flat_extensions",
      "dense_chords",
      "long_wrap_line",
    ]);
  });
  it("has unique, well-formed names", () => {
    expect(new Set(FIXTURE_NAMES).size).toBe(FIXTURE_NAMES.length);
    for (const n of FIXTURE_NAMES) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });
  it("isFixtureName discriminates", () => {
    expect(isFixtureName("he_plain")).toBe(true);
    expect(isFixtureName("nope")).toBe(false);
    expect(isFixtureName("")).toBe(false);
  });
  it("resolves absolute fixture paths", () => {
    const p = fixturePath("he_plain");
    expect(isAbsolute(p)).toBe(true);
    expect(p.replaceAll("\\", "/").endsWith("fixtures/he_plain.cho")).toBe(
      true,
    );
  });
  it("throws TypeError for non-fixture names at runtime", () => {
    expect(() => fixturePath("nope" as FixtureName)).toThrow(TypeError);
    expect(() => fixturePath("nope" as FixtureName)).toThrow(/nope/);
  });
});
