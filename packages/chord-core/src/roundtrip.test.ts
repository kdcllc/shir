import { describe, expect, it } from "vitest";
import {
  ALL_FIXTURE_NAMES,
  readCanonical,
  readDiagnostics,
  readFixture,
} from "test-fixtures";
import { META_NAMES, parseSong, serializeSong } from "./index";

const SECTION_ALIASES: Record<string, string> = {
  soc: "chorus",
  sov: "verse",
  sob: "bridge",
  sot: "tab",
  sog: "grid",
};
const COMMENT_ALIASES: Record<string, string> = {
  c: "comment",
  ci: "comment_italic",
  cb: "comment_box",
};
const LITERAL = new Set(["tab", "grid", "abc", "ly", "textblock", "svg"]);
const TAG = /^\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(?::\s*([^}]*?))?\s*\}$/;

/**
 * Independent re-derivation of the documented `## Normalizations` rewrites
 * (docs/CHORDPRO.md), applied line by line to a source text. Handles the
 * rewrites that occur in `aliases_input`: aliases, tag-name case, whitespace
 * around tags, `{meta: N v}`, `{direction: v}`, `label="..."`, whitespace-only
 * lines, end-tag values, chord-only line re-joining, CRLF and final newline.
 */
function applyDocumentedNormalizations(source: string): string {
  const lines = source.split("\n").map((l) => l.replace(/\r+$/, ""));
  if (lines[lines.length - 1] === "") lines.pop();
  let literal: string | null = null;
  const out: string[] = [];
  const fmt = (name: string, value: string): string =>
    value === "" ? `{${name}}` : `{${name}: ${value}}`;
  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.startsWith("{") ? TAG.exec(trimmed) : null;
    if (literal !== null) {
      if (m) {
        const n = (m[1] ?? "").toLowerCase();
        const em = /^(?:end_of_(.+)|e(o[cvbtg]))$/.exec(n);
        const sec =
          em === null
            ? null
            : (em[1] ?? SECTION_ALIASES[`s${em[2] ?? ""}`] ?? null);
        if (sec === literal) {
          out.push(`{end_of_${sec}}`);
          literal = null;
          continue;
        }
      }
      out.push(line);
      continue;
    }
    if (line.startsWith("#")) {
      out.push(line);
      continue;
    }
    if (m) {
      let name = (m[1] ?? "").toLowerCase();
      let value = (m[2] ?? "").trim();
      if (name === "t") name = "title";
      if (name === "st") name = "subtitle";
      if (COMMENT_ALIASES[name]) name = COMMENT_ALIASES[name] as string;
      if (name === "meta" && value !== "") {
        const mm = /^(\S+)\s*(.*)$/.exec(value);
        const inner = (mm?.[1] ?? "").toLowerCase();
        const v = (mm?.[2] ?? "").trim();
        const known = (META_NAMES as readonly string[]).includes(inner);
        out.push(
          known && inner !== "direction"
            ? fmt(inner, v)
            : fmt(`meta`, `${inner}${v ? " " + v : ""}`),
        );
        continue;
      }
      if (name === "direction") {
        out.push(fmt("meta", `direction${value ? " " + value : ""}`));
        continue;
      }
      if ((META_NAMES as readonly string[]).includes(name)) {
        out.push(fmt(name, value));
        continue;
      }
      const alias = /^s(o[cvbtg])$/.exec(name);
      const ealias = /^e(o[cvbtg])$/.exec(name);
      if (alias)
        name = `start_of_${SECTION_ALIASES[`s${alias[1] ?? ""}`] ?? ""}`;
      else if (ealias)
        name = `end_of_${SECTION_ALIASES[`s${ealias[1] ?? ""}`] ?? ""}`;
      if (name.startsWith("end_of_")) {
        out.push(`{${name}}`);
        continue;
      }
      if (name.startsWith("start_of_")) {
        const lm = /^label="(.*)"$/.exec(value);
        if (lm) value = lm[1] ?? "";
        const sec = name.slice("start_of_".length);
        if (LITERAL.has(sec)) literal = sec;
      }
      out.push(fmt(name, value));
      continue;
    }
    if (trimmed === "") {
      out.push("");
      continue;
    }
    if (/^(?:\[[^\][]+\]\s*)+$/.test(trimmed)) {
      const chords = trimmed.match(/\[[^\]]+\]/g) ?? [];
      out.push(chords.join(" "));
      continue;
    }
    out.push(line);
  }
  return out.length === 0 ? "" : out.join("\n") + "\n";
}

describe("cross-module round trip over every fixture", () => {
  it("covers 14 fixtures", () => {
    expect(ALL_FIXTURE_NAMES).toHaveLength(14);
  });

  describe.each([...ALL_FIXTURE_NAMES])("%s", (name) => {
    it("(a) serialize(parse(fixture)) equals the canonical file", () => {
      const { song } = parseSong(readFixture(name));
      expect(serializeSong(song)).toBe(readCanonical(name));
    });

    it("(b) a second parse/serialize cycle is byte-stable", () => {
      const once = serializeSong(parseSong(readFixture(name)).song);
      const twice = serializeSong(parseSong(once).song);
      expect(twice).toBe(once);
    });

    it("(c) the model is stable across serialize then parse", () => {
      const { song } = parseSong(readFixture(name));
      expect(parseSong(serializeSong(song)).song).toEqual(song);
    });

    it("(d) the canonical file yields the golden diagnostics", () => {
      expect(parseSong(readCanonical(name)).diagnostics).toEqual(
        readDiagnostics(name),
      );
    });

    it("(e) a CRLF variant serializes to the canonical file", () => {
      const crlf = readFixture(name).replaceAll("\n", "\r\n");
      expect(serializeSong(parseSong(crlf).song)).toBe(readCanonical(name));
    });

    it("(e) a variant without the final newline serializes to canonical", () => {
      const src = readFixture(name).replace(/\n$/, "");
      expect(serializeSong(parseSong(src).song)).toBe(readCanonical(name));
    });
  });

  describe("aliases_input normalizations", () => {
    const input = readFixture("aliases_input");
    const canonical = readCanonical("aliases_input");

    it("canonical output differs from the input", () => {
      expect(canonical).not.toBe(input);
    });

    it("the canonical text equals the documented rewrites applied to the input", () => {
      expect(applyDocumentedNormalizations(input)).toBe(canonical);
    });

    it("the same derivation holds on the CRLF variant", () => {
      const crlf = input.replaceAll("\n", "\r\n");
      expect(applyDocumentedNormalizations(crlf)).toBe(canonical);
      expect(serializeSong(parseSong(crlf).song)).toBe(canonical);
    });

    it("the derivation helper is not vacuous: skipping a rewrite is detected", () => {
      expect(applyDocumentedNormalizations(canonical)).toBe(canonical);
      expect(applyDocumentedNormalizations(input)).not.toBe(input);
    });
  });

  describe("non-vacuity: mutated canonical input fails (a)", () => {
    it("a character inserted mid-lyric breaks the equality", () => {
      const needle = "Walking down the ";
      const src = readCanonical("slash_chords_key");
      const at = src.indexOf(needle) + needle.length;
      const mutated = src.slice(0, at) + "X" + src.slice(at);
      expect(mutated).not.toBe(src);
      expect(serializeSong(parseSong(src).song)).toBe(src);
      expect(serializeSong(parseSong(mutated).song)).not.toBe(src);
      expect(serializeSong(parseSong(mutated).song)).toBe(mutated);
    });

    it("an extra space mid directive value breaks the equality", () => {
      const src = readCanonical("slash_chords_key");
      const mutated = src.replace(
        "{title: Slash Chords}",
        "{title: Slash  Chords}",
      );
      expect(mutated).not.toBe(src);
      // value interior whitespace is preserved verbatim, so it differs from the original canonical
      expect(serializeSong(parseSong(mutated).song)).not.toBe(src);
    });
  });
});
