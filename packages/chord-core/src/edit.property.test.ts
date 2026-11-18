import { describe, expect, it } from "vitest";
import { ALL_FIXTURE_NAMES, readFixture } from "test-fixtures";
import type { FixtureName } from "test-fixtures";
import {
  applyEdit,
  applyEdits,
  listSections,
  parseSong,
  serializeSong,
  splitGraphemes,
  type EditOp,
  type EditResult,
  type LyricLine,
  type SongModel,
} from "./index";

/** Deterministic PRNG (mulberry32): the same seed always yields the same input. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const int = (r: Rand, lo: number, hi: number): number =>
  lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[int(r, 0, xs.length - 1)]!;

const OP_TYPES = [
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

const CHORDS = ["C", "Am", "G", "G/B", "Dm7", "F#m", "Fmaj7", "Em", "D", "Bb"];
const BAD_CHORDS = ["", "  ", "A]", "[", "X\nY", "[Am]"];
const HEBREW_BASE = Array.from({ length: 27 }, (_, i) =>
  String.fromCodePoint(0x05d0 + i),
);
// Points only (sheva .. qamats, dagesh, shin/sin dots): true combining marks.
const HEBREW_MARKS = [
  0x05b0, 0x05b4, 0x05b5, 0x05b6, 0x05b7, 0x05b8, 0x05b9, 0x05bc, 0x05c1,
  0x05c2,
].map((cp) => String.fromCodePoint(cp));
const LATIN = "abdefghklmnoprstuvwy".split("");
const SYNTAX = ["[", "]", "{", "}", "#", "[Am]", "{title: x}", "{", "\n", "\r"];

function hebrewWord(r: Rand, marks: boolean): string {
  let w = "";
  for (let i = int(r, 2, 6); i > 0; i--) {
    w += pick(r, HEBREW_BASE);
    if (marks && r() < 0.6) w += pick(r, HEBREW_MARKS);
    if (marks && r() < 0.15) w += pick(r, HEBREW_MARKS);
  }
  return w;
}

function latinWord(r: Rand): string {
  let w = "";
  for (let i = int(r, 2, 6); i > 0; i--) w += pick(r, LATIN);
  return w;
}

/** Hebrew, niqqud, Latin and ChordPro syntax characters, in any mix. */
function randomText(r: Rand): string {
  const parts: string[] = [];
  for (let i = int(r, 0, 4); i > 0; i--) {
    const kind = int(r, 0, 4);
    if (kind === 0) parts.push(hebrewWord(r, false));
    else if (kind === 1) parts.push(hebrewWord(r, true));
    else if (kind === 2) parts.push(latinWord(r));
    else if (kind === 3) parts.push(pick(r, SYNTAX));
    else parts.push(" ");
  }
  return parts.join(r() < 0.5 ? " " : "");
}

/** A deliberately ill-typed op, as a UI or JSON file could produce at runtime. */
function loose(op: Record<string, unknown>): EditOp {
  return op as unknown as EditOp;
}

const ODD_NUMBERS = [-1, -7, 1.5, Number.NaN, 1e9, Number.POSITIVE_INFINITY];

/** A line index: mostly a line of one of `kinds`, sometimes anything at all. */
function lineIndex(r: Rand, song: SongModel, kinds: readonly string[]): number {
  const roll = r();
  if (roll < 0.65) {
    const fitting = song.lines
      .map((line, i) => (kinds.includes(line.kind) ? i : -1))
      .filter((i) => i !== -1);
    if (fitting.length > 0) return pick(r, fitting);
  }
  if (roll < 0.9) return int(r, -2, song.lines.length + 2);
  return pick(r, ODD_NUMBERS);
}

function graphemeIndex(r: Rand, song: SongModel, line: number): number {
  const target = song.lines[line];
  const count =
    target?.kind === "lyric" ? splitGraphemes(target.lyric).length : 0;
  const roll = r();
  if (roll < 0.75) return int(r, 0, count);
  if (roll < 0.9) return int(r, -3, count + 3);
  return pick(r, ODD_NUMBERS);
}

function anchorIndex(r: Rand, song: SongModel, line: number): number {
  const target = song.lines[line];
  const count = target?.kind === "lyric" ? target.chords.length : 0;
  const roll = r();
  if (roll < 0.75 && count > 0) return int(r, 0, count - 1);
  if (roll < 0.9) return int(r, -1, count + 1);
  return pick(r, ODD_NUMBERS);
}

const chordText = (r: Rand): string =>
  r() < 0.8 ? pick(r, CHORDS) : pick(r, BAD_CHORDS);

/** One random op against `song`: valid or invalid, indices in or out of range. */
function randomOp(r: Rand, song: SongModel): EditOp {
  if (r() < 0.06) {
    return pick(r, [
      loose({ type: "noSuchOp", line: 0 }),
      loose({ type: "constructor" }),
      loose({ type: "__proto__" }),
      loose({ type: "setLyric", line: "0", text: "x" }),
      loose({ type: "setLyric", line: 0, text: 7 }),
      loose({ type: "addChord", line: 0, index: 0, chord: null }),
      loose({ type: "setMeta", name: "constructor", value: "x" }),
      loose({ type: "setMeta", name: "__proto__", value: "x" }),
      loose({ type: "addSection", at: 0, section: "toString" }),
      loose({ type: "setChordsLine", line: 0, chords: "Am G" }),
      loose({}),
      null as unknown as EditOp,
    ]);
  }
  const type = pick(r, OP_TYPES);
  const sectionStarts = listSections(song).map((s) => s.start);
  const sectionLine = (): number =>
    sectionStarts.length > 0 && r() < 0.7
      ? pick(r, sectionStarts)
      : lineIndex(r, song, ["section"]);
  switch (type) {
    case "setLyric":
      return {
        type,
        line: lineIndex(r, song, ["lyric", "empty", "chords"]),
        text: randomText(r),
      };
    case "addChord": {
      const line = lineIndex(r, song, ["lyric", "empty"]);
      return {
        type,
        line,
        index: graphemeIndex(r, song, line),
        chord: chordText(r),
      };
    }
    case "setChord": {
      const line = lineIndex(r, song, ["lyric"]);
      return {
        type,
        line,
        anchor: anchorIndex(r, song, line),
        chord: chordText(r),
      };
    }
    case "removeChord": {
      const line = lineIndex(r, song, ["lyric"]);
      return { type, line, anchor: anchorIndex(r, song, line) };
    }
    case "moveChord": {
      const line = lineIndex(r, song, ["lyric"]);
      return {
        type,
        line,
        anchor: anchorIndex(r, song, line),
        index: graphemeIndex(r, song, line),
      };
    }
    case "insertLine":
      return { type, at: lineIndex(r, song, ["lyric", "empty"]) };
    case "removeLine":
      return { type, line: lineIndex(r, song, ["lyric", "empty", "comment"]) };
    case "splitLine": {
      const line = lineIndex(r, song, ["lyric"]);
      return { type, line, index: graphemeIndex(r, song, line) };
    }
    case "joinLines":
      return { type, line: lineIndex(r, song, ["lyric", "empty"]) };
    case "setChordsLine": {
      const chords: string[] = [];
      for (let i = int(r, 0, 4); i > 0; i--) {
        chords.push(r() < 0.9 ? pick(r, CHORDS) : pick(r, ["", "A B", "[x"]));
      }
      return { type, line: lineIndex(r, song, ["chords"]), chords };
    }
    case "setComment":
      return {
        type,
        line: lineIndex(r, song, ["comment"]),
        text: randomText(r),
      };
    case "setMeta":
      return {
        type,
        name: pick(r, ["title", "artist", "key", "capo", "tempo"] as const),
        value: pick(r, [
          "",
          "Am",
          "3",
          "120",
          hebrewWord(r, true),
          randomText(r),
        ]),
      };
    case "addSection":
      return {
        type,
        at: lineIndex(r, song, ["lyric", "empty", "section"]),
        section: pick(r, ["verse", "chorus", "bridge"] as const),
        label: r() < 0.5 ? undefined : randomText(r),
      };
    case "renameSection":
      return {
        type,
        line: sectionLine(),
        section: pick(r, ["verse", "chorus", "bridge"] as const),
        label: r() < 0.5 ? undefined : hebrewWord(r, false),
      };
    case "moveSection":
      return {
        type,
        line: sectionLine(),
        direction: pick(r, ["up", "down"] as const),
      };
    case "removeSection":
      return { type, line: sectionLine() };
    case "transpose":
      return { type, semitones: pick(r, [-13, -2, -1, 0, 1, 2, 7, 1.5]) };
  }
}

const SEEDS_PER_FIXTURE = 20;

interface Sequence {
  fixture: FixtureName;
  seed: number;
  ops: EditOp[];
  /** Per op: whether that step changed the text when the sequence was built. */
  stepChanged: boolean[];
  /** Set when `applyEdit` threw while the sequence was built: the op (the last of `ops`) and the error. */
  thrown?: { op: EditOp; error: string };
}

const fixtureSong = (name: FixtureName): SongModel =>
  parseSong(readFixture(name)).song;

/** 1-8 ops, each generated against the song the previous ops produce. */
function generate(fixture: FixtureName, seed: number): Sequence {
  const r = rng(seed);
  let current = fixtureSong(fixture);
  const ops: EditOp[] = [];
  const stepChanged: boolean[] = [];
  for (let i = int(r, 1, 8); i > 0; i--) {
    const op = randomOp(r, current);
    ops.push(op);
    let step: EditResult;
    try {
      step = applyEdit(current, op);
    } catch (error) {
      // Recorded, not rethrown: the test `never throws` reports it by name.
      stepChanged.push(false);
      return {
        fixture,
        seed,
        ops,
        stepChanged,
        thrown: { op, error: String(error) },
      };
    }
    stepChanged.push(step.changed);
    current = step.song;
  }
  return { fixture, seed, ops, stepChanged };
}

let cachedSequences: Sequence[] | undefined;

/** The seeded sequences, built on first use inside a test (never at module load). */
function sequences(): Sequence[] {
  cachedSequences ??= ALL_FIXTURE_NAMES.flatMap((fixture, f) =>
    Array.from({ length: SEEDS_PER_FIXTURE }, (_, i) =>
      generate(fixture, 1000 * (f + 1) + i),
    ),
  );
  return cachedSequences;
}

const label = (s: Sequence): string =>
  `${s.fixture} seed ${s.seed}: ${JSON.stringify(s.ops)}`;

describe("applyEdits properties (seeded)", () => {
  it("the generator is deterministic", () => {
    expect(JSON.stringify(generate("he_plain", 7))).toBe(
      JSON.stringify(generate("he_plain", 7)),
    );
    expect(JSON.stringify(generate("he_plain", 7).ops)).not.toBe(
      JSON.stringify(generate("he_plain", 8).ops),
    );
  });

  it("runs at least 200 sequences of 1-8 ops over every fixture", () => {
    expect(sequences().length).toBeGreaterThanOrEqual(200);
    expect(new Set(sequences().map((s) => s.fixture)).size).toBe(
      ALL_FIXTURE_NAMES.length,
    );
    const lengths = sequences().map((s) => s.ops.length);
    expect(Math.min(...lengths)).toBe(1);
    expect(Math.max(...lengths)).toBe(8);
  });

  it("the generator reaches every op type with valid and invalid ops, Hebrew, niqqud, Latin and syntax characters", () => {
    const typeOf = (op: EditOp): string =>
      String((op as { type?: unknown } | null)?.type);
    const all = sequences().flatMap((s) =>
      s.ops.map((op, i) => ({ type: typeOf(op), changed: s.stepChanged[i]! })),
    );
    for (const type of OP_TYPES) {
      const mine = all.filter((o) => o.type === type);
      expect(
        mine.some((o) => o.changed),
        `${type} valid`,
      ).toBe(true);
      expect(
        mine.some((o) => !o.changed),
        `${type} rejected or no-op`,
      ).toBe(true);
    }
    expect(all.some((o) => o.type === "noSuchOp")).toBe(true);
    const texts = JSON.stringify(sequences().map((s) => s.ops));
    expect(/[א-ת]/u.test(texts)).toBe(true);
    expect(/[ְ-ׂ]/u.test(texts)).toBe(true);
    expect(/[a-z]{2}/.test(texts)).toBe(true);
    for (const ch of ["[", "]", "{", "}"]) {
      expect(
        sequences().some((s) =>
          s.ops.some(
            (op) =>
              op !== null &&
              "text" in op &&
              typeof op.text === "string" &&
              op.text.includes(ch),
          ),
        ),
        ch,
      ).toBe(true);
    }
    const outOfRange = sequences()
      .flatMap((s) => s.ops)
      .filter((op) => op !== null && "line" in op && (op.line as number) < 0);
    expect(outOfRange.length).toBeGreaterThan(5);
  });

  it("never throws", () => {
    for (const s of sequences()) {
      expect(
        s.thrown,
        `${s.fixture} seed ${s.seed}: applyEdit threw ${String(s.thrown?.error)} on op ${JSON.stringify(s.thrown?.op)} while generating ${JSON.stringify(s.ops)}`,
      ).toBeUndefined();
      const input = fixtureSong(s.fixture);
      expect(() => applyEdits(input, s.ops), label(s)).not.toThrow();
    }
  });

  it("never mutates the input song", () => {
    for (const s of sequences()) {
      const input = fixtureSong(s.fixture);
      const snapshot = structuredClone(input);
      applyEdits(input, s.ops);
      expect(input, label(s)).toEqual(snapshot);
    }
  });

  it("the returned song is the parse of the returned text", () => {
    for (const s of sequences()) {
      const result = applyEdits(fixtureSong(s.fixture), s.ops);
      expect(parseSong(result.text).song, label(s)).toEqual(result.song);
    }
  });

  it("every single step returns the parse of its text", () => {
    for (const s of sequences()) {
      let current = fixtureSong(s.fixture);
      for (const op of s.ops) {
        const step = applyEdit(current, op);
        expect(parseSong(step.text).song, label(s)).toEqual(step.song);
        current = step.song;
      }
    }
  });

  it("changed is exactly: the text differs from the input song's text", () => {
    let changed = 0;
    let unchanged = 0;
    for (const s of sequences()) {
      const input = fixtureSong(s.fixture);
      const before = serializeSong(input);
      const result = applyEdits(input, s.ops);
      expect(result.changed, label(s)).toBe(result.text !== before);
      if (result.changed) changed++;
      else unchanged++;
    }
    // Both outcomes are reached, so the equality above is not one-sided.
    expect(changed).toBeGreaterThan(50);
    expect(unchanged).toBeGreaterThan(5);
  });

  it("an empty op list returns the input song itself, unchanged", () => {
    for (const name of ALL_FIXTURE_NAMES) {
      const input = fixtureSong(name);
      const result = applyEdits(input, []);
      expect(result.song).toBe(input);
      expect(result.text).toBe(serializeSong(input));
      expect(result.changed).toBe(false);
    }
  });
});

// ---- inverse pairs -----------------------------------------------------------------------

const RTL_FIXTURES = [
  "he_plain",
  "he_niqqud",
  "mixed_he_en",
  "sections_he",
] as const satisfies readonly FixtureName[];

function lyricLines(song: SongModel): { i: number; line: LyricLine }[] {
  return song.lines.flatMap((line, i) =>
    line.kind === "lyric" ? [{ i, line }] : [],
  );
}

const hasText = (graphemes: readonly string[]): boolean =>
  graphemes.some((g) => g.trim() !== "");

describe("inverse edit pairs restore the text exactly", () => {
  describe.each(RTL_FIXTURES)("%s", (name) => {
    const input = fixtureSong(name);
    const before = serializeSong(input);
    const lyrics = lyricLines(input);

    it("has lyric lines with chords", () => {
      expect(lyrics.length).toBeGreaterThanOrEqual(2);
      expect(lyrics.some(({ line }) => line.chords.length >= 2)).toBe(true);
    });

    it("splitLine then joinLines, at every index that leaves text in both halves", () => {
      let points = 0;
      for (const { i, line } of lyrics) {
        const graphemes = splitGraphemes(line.lyric);
        for (let index = 1; index < graphemes.length; index++) {
          if (
            !hasText(graphemes.slice(0, index)) ||
            !hasText(graphemes.slice(index))
          )
            continue;
          points++;
          const where = `line ${i} index ${index}`;
          const split = applyEdit(input, { type: "splitLine", line: i, index });
          expect(split.changed, where).toBe(true);
          expect(split.song.lines, where).toHaveLength(input.lines.length + 1);
          const [first, second] = [
            split.song.lines[i],
            split.song.lines[i + 1],
          ];
          if (first?.kind !== "lyric" || second?.kind !== "lyric")
            throw new Error(`${where}: halves are not lyric lines`);
          expect(first.lyric + second.lyric, where).toBe(line.lyric);
          expect(first.chords.length + second.chords.length, where).toBe(
            line.chords.length,
          );
          const joined = applyEdit(split.song, { type: "joinLines", line: i });
          expect(joined.text, where).toBe(before);
          expect(joined.song, where).toEqual(input);
          const both = applyEdits(input, [
            { type: "splitLine", line: i, index },
            { type: "joinLines", line: i },
          ]);
          expect(both.text, where).toBe(before);
          expect(both.changed, where).toBe(false);
        }
      }
      expect(points).toBeGreaterThan(30);
    });

    it("addChord then removeChord of the added anchor, at every position", () => {
      let points = 0;
      for (const { i, line } of lyrics) {
        const count = splitGraphemes(line.lyric).length;
        expect(count).toBeGreaterThan(0);
        for (let index = 0; index <= count; index++) {
          points++;
          const where = `line ${i} index ${index}`;
          const added = applyEdit(input, {
            type: "addChord",
            line: i,
            index,
            chord: "Xadd9",
          });
          expect(added.changed, where).toBe(true);
          const target = added.song.lines[i];
          if (target?.kind !== "lyric")
            throw new Error(`${where}: not a lyric line`);
          const anchor = target.chords.findIndex((a) => a.chord === "Xadd9");
          expect(target.chords[anchor], where).toEqual({
            index,
            chord: "Xadd9",
          });
          expect(target.chords, where).toHaveLength(line.chords.length + 1);
          // It stands after every anchor at or before its own index.
          expect(anchor, where).toBe(
            line.chords.filter((c) => c.index <= index).length,
          );
          const removed = applyEdit(added.song, {
            type: "removeChord",
            line: i,
            anchor,
          });
          expect(removed.text, where).toBe(before);
          expect(removed.song, where).toEqual(input);
        }
      }
      expect(points).toBeGreaterThan(40);
    });

    it("setLyric with the unchanged lyric changes nothing", () => {
      for (const { i, line } of lyrics) {
        const result = applyEdit(input, {
          type: "setLyric",
          line: i,
          text: line.lyric,
        });
        expect(result.changed, `line ${i}`).toBe(false);
        expect(result.text, `line ${i}`).toBe(before);
        expect(result.song, `line ${i}`).toEqual(input);
      }
    });
  });

  it("moveSection up then down, and down then up, on sections_he", () => {
    const input = fixtureSong("sections_he");
    const before = serializeSong(input);
    const spans = listSections(input);
    expect(spans.map((s) => s.section)).toEqual(["verse", "chorus", "bridge"]);
    for (let n = 1; n < spans.length; n++) {
      const own = spans[n]!;
      const above = spans[n - 1]!;
      const up = applyEdit(input, {
        type: "moveSection",
        line: own.start,
        direction: "up",
      });
      expect(up.changed).toBe(true);
      // The moved section now starts where the one above started.
      expect(up.song.lines[above.start]).toEqual(input.lines[own.start]);
      expect(listSections(up.song).map((s) => s.section)).not.toEqual(
        spans.map((s) => s.section),
      );
      const down = applyEdit(up.song, {
        type: "moveSection",
        line: above.start,
        direction: "down",
      });
      expect(down.text).toBe(before);
      expect(down.song).toEqual(input);
    }
    for (let n = 0; n < spans.length - 1; n++) {
      const own = spans[n]!;
      const down = applyEdit(input, {
        type: "moveSection",
        line: own.start,
        direction: "down",
      });
      expect(down.changed).toBe(true);
      const moved = listSections(down.song)[n + 1]!;
      expect(moved.section).toBe(own.section);
      const up = applyEdit(down.song, {
        type: "moveSection",
        line: moved.start,
        direction: "up",
      });
      expect(up.text).toBe(before);
    }
  });
});

// ---- setLyric re-anchoring ---------------------------------------------------------------

/** Distinct chord names, so every anchor can be followed through the edit. */
const TRACKED = ["C", "Dm", "Em", "F", "G", "Am", "Bb", "D7"];

interface Reanchor {
  seed: number;
  oldLyric: string;
  newLyric: string;
  /** Old anchors, in `chords` order. */
  anchors: { index: number; chord: string }[];
  kind: "insert" | "delete";
}

/** Words of at least two graphemes: deleting one never leaves an empty word. */
function niqqudLyric(r: Rand): string[] {
  const words: string[] = [];
  for (let i = int(r, 1, 4); i > 0; i--) words.push(hebrewWord(r, true));
  return splitGraphemes(words.join(" "));
}

function reanchorCase(seed: number): Reanchor {
  const r = rng(seed);
  const before = niqqudLyric(r);
  const after = [...before];
  const kind = r() < 0.5 ? "insert" : "delete";
  if (kind === "insert") {
    // Sometimes a copy of a neighbour: then `p` is not the edit position.
    const at = int(r, 0, before.length);
    const neighbour = before[Math.min(at, before.length - 1)]!;
    const g =
      r() < 0.3 && neighbour !== " "
        ? neighbour
        : pick(r, HEBREW_BASE) + (r() < 0.5 ? pick(r, HEBREW_MARKS) : "");
    after.splice(at, 0, g);
  } else {
    const letters = before
      .map((g, i) => (g === " " ? -1 : i))
      .filter((i) => i !== -1);
    after.splice(pick(r, letters), 1);
  }
  const names = [...TRACKED];
  const anchors: { index: number; chord: string }[] = [];
  for (let i = int(r, 1, 6); i > 0; i--) {
    const chord = names.splice(int(r, 0, names.length - 1), 1)[0]!;
    anchors.push({ index: int(r, 0, before.length), chord });
  }
  anchors.sort((a, b) => a.index - b.index);
  return {
    seed,
    oldLyric: before.join(""),
    newLyric: after.join(""),
    anchors,
    kind,
  };
}

/** ChordPro text of one lyric line with `anchors` (sorted by index). */
function lineText(lyric: string, anchors: Reanchor["anchors"]): string {
  const graphemes = splitGraphemes(lyric);
  let out = "";
  for (let i = 0; i <= graphemes.length; i++) {
    for (const a of anchors) if (a.index === i) out += `[${a.chord}]`;
    out += graphemes[i] ?? "";
  }
  return out;
}

/** `p` and `s` exactly as task 02 defines them, from the two strings only. */
function prefixSuffix(
  oldLyric: string,
  newLyric: string,
): { p: number; s: number; oldCount: number; newCount: number } {
  const a = splitGraphemes(oldLyric);
  const b = splitGraphemes(newLyric);
  const shortest = Math.min(a.length, b.length);
  let p = 0;
  while (p < shortest && a[p] === b[p]) p++;
  let s = 0;
  while (s < shortest - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { p, s, oldCount: a.length, newCount: b.length };
}

const REANCHOR_SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe("setLyric re-anchoring (seeded, Hebrew with niqqud)", () => {
  const cases = REANCHOR_SEEDS.map(reanchorCase);

  it("the generator is deterministic and reaches insertions, deletions, niqqud and neighbour copies", () => {
    expect(reanchorCase(11)).toEqual(reanchorCase(11));
    expect(cases.filter((c) => c.kind === "insert").length).toBeGreaterThan(80);
    expect(cases.filter((c) => c.kind === "delete").length).toBeGreaterThan(80);
    expect(cases.every((c) => /[ְ-ׂ]/u.test(c.oldLyric))).toBe(true);
    for (const c of cases) {
      const delta =
        splitGraphemes(c.newLyric).length - splitGraphemes(c.oldLyric).length;
      expect(delta, `seed ${c.seed}`).toBe(c.kind === "insert" ? 1 : -1);
    }
    // All three anchor classes are exercised.
    let kept = 0;
    let shifted = 0;
    let between = 0;
    for (const c of cases) {
      const { p, s, oldCount } = prefixSuffix(c.oldLyric, c.newLyric);
      for (const a of c.anchors) {
        if (a.index < p) kept++;
        else if (a.index >= oldCount - s && a.index > p) shifted++;
        else between++;
      }
    }
    expect(kept).toBeGreaterThan(100);
    expect(shifted).toBeGreaterThan(100);
    expect(between).toBeGreaterThan(20);
  });

  it("anchors before the change keep index and grapheme, anchors after it shift with their grapheme, the rest stay in range", () => {
    for (const c of cases) {
      const where = `seed ${c.seed}: ${c.oldLyric} -> ${c.newLyric}`;
      const input = parseSong(`${lineText(c.oldLyric, c.anchors)}\n`).song;
      const line = input.lines[0];
      // Precondition: the song really holds this lyric and these anchors.
      if (line?.kind !== "lyric") throw new Error(`${where}: not a lyric`);
      expect(line.lyric, where).toBe(c.oldLyric);
      expect(line.chords, where).toEqual(c.anchors);

      const result = applyEdit(input, {
        type: "setLyric",
        line: 0,
        text: c.newLyric,
      });
      expect(result.changed, where).toBe(true);
      const edited = result.song.lines[0];
      if (edited?.kind !== "lyric") throw new Error(`${where}: lost the line`);
      expect(edited.lyric, where).toBe(c.newLyric);
      expect(edited.chords.map((a) => a.chord).sort(), where).toEqual(
        c.anchors.map((a) => a.chord).sort(),
      );

      const { p, s, oldCount, newCount } = prefixSuffix(c.oldLyric, c.newLyric);
      const oldG = splitGraphemes(c.oldLyric);
      const newG = splitGraphemes(c.newLyric);
      for (const a of c.anchors) {
        const now = edited.chords.find((x) => x.chord === a.chord);
        if (now === undefined) throw new Error(`${where}: lost ${a.chord}`);
        const which = `${where} [${a.chord}]@${a.index} p=${p} s=${s}`;
        if (a.index < p) {
          expect(now.index, which).toBe(a.index);
          expect(newG[now.index], which).toBe(oldG[a.index]);
        } else if (a.index >= oldCount - s && a.index > p) {
          expect(now.index, which).toBe(a.index + (newCount - oldCount));
          expect(newG[now.index], which).toBe(oldG[a.index]);
        } else {
          expect(Number.isInteger(now.index), which).toBe(true);
          expect(now.index, which).toBeGreaterThanOrEqual(0);
          expect(now.index, which).toBeLessThanOrEqual(newCount);
        }
      }
    }
  });
});

// ---- boundary cases ----------------------------------------------------------------------

describe("index clamping", () => {
  it("five anchors on a lyric cut down to one grapheme all stay inside the line", () => {
    const input = parseSong("[A]a[B]a[C]a[D]a[E]\n").song;
    expect(input.lines[0]).toMatchObject({
      kind: "lyric",
      lyric: "aaaa",
      chords: [
        { index: 0, chord: "A" },
        { index: 1, chord: "B" },
        { index: 2, chord: "C" },
        { index: 3, chord: "D" },
        { index: 4, chord: "E" },
      ],
    });
    const result = applyEdit(input, { type: "setLyric", line: 0, text: "a" });
    expect(result.text).toBe("[A]a[B][C][D][E]\n");
    expect(result.song.lines[0]).toEqual({
      kind: "lyric",
      lyric: "a",
      chords: [
        { index: 0, chord: "A" },
        { index: 1, chord: "B" },
        { index: 1, chord: "C" },
        { index: 1, chord: "D" },
        { index: 1, chord: "E" },
      ],
    });
  });

  it("insertLine at -3 on a ten-line song inserts one empty line at the top", () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    const input = parseSong(`${text}\n`).song;
    expect(input.lines).toHaveLength(10);
    const result = applyEdit(input, { type: "insertLine", at: -3 });
    expect(result.changed).toBe(true);
    expect(result.text).toBe(`\n${text}\n`);
    expect(result.song.lines).toHaveLength(11);
    expect(result.song.lines[0]).toEqual({ kind: "empty" });
    expect(result.song.lines.slice(1)).toEqual(input.lines);
  });

  it("insertLine past the end appends, and at a fraction is rejected", () => {
    const input = parseSong("one\ntwo\n").song;
    const appended = applyEdit(input, { type: "insertLine", at: 99 });
    expect(appended.song.lines.map((l) => l.kind)).toEqual([
      "lyric",
      "lyric",
      "empty",
    ]);
    const rejected = applyEdit(input, { type: "insertLine", at: 0.5 });
    expect(rejected.changed).toBe(false);
    expect(rejected.song).toBe(input);
  });

  it("splitLine at -4 splits at the start: an empty line, then the whole line", () => {
    const input = parseSong("[C]hello [G]world\n").song;
    const result = applyEdit(input, { type: "splitLine", line: 0, index: -4 });
    expect(result.text).toBe("\n[C]hello [G]world\n");
    expect(result.song.lines).toEqual([{ kind: "empty" }, input.lines[0]]);
  });

  it("anchors inside a replaced span move to its start, the others keep their grapheme", () => {
    const input = parseSong("a[B]b[C]c[D]d[E]e[F]f\n").song;
    expect(input.lines[0]).toMatchObject({
      lyric: "abcdef",
      chords: [
        { index: 1, chord: "B" },
        { index: 2, chord: "C" },
        { index: 3, chord: "D" },
        { index: 4, chord: "E" },
        { index: 5, chord: "F" },
      ],
    });
    const result = applyEdit(input, { type: "setLyric", line: 0, text: "aXf" });
    expect(result.text).toBe("a[B][C][D][E]X[F]f\n");
    expect(result.song.lines[0]).toMatchObject({
      lyric: "aXf",
      chords: [
        { index: 1, chord: "B" },
        { index: 1, chord: "C" },
        { index: 1, chord: "D" },
        { index: 1, chord: "E" },
        { index: 2, chord: "F" },
      ],
    });
  });

  it("splitLine at 1.7 splits after the first grapheme and keeps every anchor on its grapheme", () => {
    const input = parseSong("[C]hello [G]world\n").song;
    const result = applyEdit(input, { type: "splitLine", line: 0, index: 1.7 });
    expect(result.text).toBe("[C]h\nello [G]world\n");
    expect(result.song.lines).toEqual([
      { kind: "lyric", lyric: "h", chords: [{ index: 0, chord: "C" }] },
      {
        kind: "lyric",
        lyric: "ello world",
        chords: [{ index: 5, chord: "G" }],
      },
    ]);
  });
});
