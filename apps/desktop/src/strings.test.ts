import { describe, expect, it } from "vitest";
import { STRINGS, TEMPLATES } from "./strings";

describe("strings", () => {
  it("keeps the helper templates and the plain strings disjoint", () => {
    const plain = new Set(Object.keys(STRINGS));
    for (const key of Object.keys(TEMPLATES))
      expect(plain.has(key)).toBe(false);
  });

  it("isolates a title with FSI … PDI in the titled templates", () => {
    for (const key of [
      "deleteSongNamed",
      "selectSongNamed",
      "deleteConfirmTitle",
    ] as const) {
      expect(TEMPLATES[key]).toContain("⁨{{title}}⁩");
    }
  });
});
