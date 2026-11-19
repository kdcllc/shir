import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { firstStrongDirection, splitGraphemes } from "chord-core";
import type { SongLine, SongModel, TextDirection } from "chord-core";
import { FIXTURE_NAMES, readGolden } from "test-fixtures";
import type { FixtureName } from "test-fixtures";

export interface Rect {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Every fixture the checklists iterate: the G1 set plus the RTL line with an LTR tail. */
export const CHECKLIST_FIXTURES = [
  ...FIXTURE_NAMES,
  "rtl_ltr_tail",
] as const satisfies readonly FixtureName[];

export const CHORDED_FIXTURES = [
  "he_plain",
  "he_niqqud",
  "en_plain",
  "mixed_he_en",
  "sharp_flat_extensions",
  "long_wrap_line",
  "dense_chords",
  "chord_only_line",
  "rtl_ltr_tail",
] as const satisfies readonly FixtureName[];

export function golden(name: FixtureName): SongModel {
  return readGolden(name) as SongModel;
}

/** True when SongView renders a `[data-line]` element for this golden line. */
export function isRendered(l: SongLine): boolean {
  return !(
    l.kind === "meta" ||
    l.kind === "remark" ||
    l.kind === "directive" ||
    (l.kind === "section" && l.edge === "end")
  );
}

/** The golden lines that produce a `[data-line]` element, in order. */
export function renderedLines(song: SongModel): SongLine[] {
  return song.lines.filter(isRendered);
}

/** Direction the renderer resolves for a lyric line (amended B3 / B5). */
export function lineDirection(song: SongModel, i: number): TextDirection {
  const line = renderedLines(song)[i];
  if (!line || line.kind !== "lyric") return song.direction ?? "ltr";
  return (
    line.direction ??
    song.direction ??
    firstStrongDirection(line.lyric) ??
    "ltr"
  );
}

export async function open(
  page: Page,
  fixture: FixtureName | string,
  opts: { width?: number; nofonts?: boolean; editing?: boolean } = {},
): Promise<void> {
  const q = new URLSearchParams({ fixture });
  if (opts.width !== undefined) q.set("width", String(opts.width));
  if (opts.nofonts) q.set("nofonts", "1");
  if (opts.editing) q.set("editing", "1");
  await page.goto(`/?${q.toString()}`);
  await page.waitForSelector('body[data-ready="1"]');
  // R5: every spec asserts the bundled fonts are really in use.
  if (!opts.nofonts) expect(await fontsInUse(page)).toBe(true);
}

/** Opens the harness on an ad-hoc ChordPro source instead of a fixture. */
export async function openSource(
  page: Page,
  cho: string,
  opts: { width?: number } = {},
): Promise<void> {
  const q = new URLSearchParams({ cho });
  if (opts.width !== undefined) q.set("width", String(opts.width));
  await page.goto(`/?${q.toString()}`);
  await page.waitForSelector('body[data-ready="1"]');
  expect(await fontsInUse(page)).toBe(true);
}

/** R5: the bundled Noto Sans Hebrew is loaded AND applied to lyric lines. */
export async function fontsInUse(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const loaded = [...document.fonts].some(
      (f) =>
        f.family.replace(/["']/g, "") === "Noto Sans Hebrew" &&
        f.status === "loaded",
    );
    const lyric = document.querySelector('[data-line="lyric"]');
    if (!lyric) return false;
    const family = getComputedStyle(lyric).fontFamily;
    return loaded && /^["']?Noto Sans Hebrew/.test(family);
  });
}

export async function overlapPass(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number(
      document.querySelector("[data-song]")?.getAttribute("data-overlap-pass"),
    ),
  );
}

export interface GraphemeMeasure {
  text: string;
  rect: Rect;
  rectCount: number;
}
export interface BoxMeasure {
  index: number;
  dir: TextDirection;
  rect: Rect;
}
export interface LineMeasure {
  kind: string;
  lineHeight: number;
  graphemes: GraphemeMeasure[];
  boxes: BoxMeasure[];
}

/**
 * Measures every `[data-line]` of the page. `graphemes[i]` is the golden
 * grapheme list of line i (null for non-lyric lines); graphemes are located by
 * walking the line text excluding `[data-chord-box]` subtrees.
 */
export async function measure(
  page: Page,
  song: SongModel,
): Promise<LineMeasure[]> {
  const graphemes = renderedLines(song).map((l) =>
    l.kind === "lyric" ? splitGraphemes(l.lyric) : null,
  );
  return page.evaluate((all) => {
    const lines = [...document.querySelectorAll<HTMLElement>("[data-line]")];
    if (lines.length !== all.length) {
      throw new Error(`line count ${lines.length} != golden ${all.length}`);
    }
    const toRect = (r: DOMRect) => ({
      xMin: r.left,
      xMax: r.right,
      yMin: r.top,
      yMax: r.bottom,
    });
    return lines.map((line, i) => {
      const gs = all[i];
      const boxes = [...line.querySelectorAll<HTMLElement>("[data-chord-box]")];
      const base = {
        kind: line.getAttribute("data-line") ?? "",
        lineHeight: parseFloat(getComputedStyle(line).lineHeight) || 0,
        boxes: boxes.map((b) => ({
          index: Number(b.parentElement?.getAttribute("data-index")),
          dir: (b.getAttribute("dir") ?? "ltr") as "rtl" | "ltr",
          rect: toRect(b.getBoundingClientRect()),
        })),
      };
      if (!gs) return { ...base, graphemes: [] };
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          n.parentElement?.closest("[data-chord-box]")
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      const nodes: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push(n as Text);
      }
      let cn = 0;
      let co = 0;
      const out = gs.map((g) => {
        while (nodes[cn] && co >= (nodes[cn] as Text).length) {
          cn += 1;
          co = 0;
        }
        const node = nodes[cn] as Text;
        const range = document.createRange();
        range.setStart(node, co);
        range.setEnd(node, co + g.length);
        co += g.length;
        return {
          text: g,
          rect: toRect(range.getBoundingClientRect()),
          rectCount: range.getClientRects().length,
        };
      });
      return { ...base, graphemes: out };
    });
  }, graphemes);
}

/** Expected inline-start edge x of the anchor for chord at `index` (checklist 2). */
export function expectedEdge(
  line: LineMeasure,
  index: number,
  lineDir: TextDirection,
): number {
  const gs = line.graphemes;
  if (index >= gs.length) {
    // Visual inline-end of the last row: an LTR tail inside an RTL line ends at the
    // row's left edge, not at the last grapheme's own edge.
    const rows = groupRows(gs);
    const last = rows[rows.length - 1];
    if (!last) return Number.NaN;
    return lineDir === "rtl"
      ? Math.min(...last.map((g) => g.rect.xMin))
      : Math.max(...last.map((g) => g.rect.xMax));
  }
  const g = gs[index];
  if (!g) return Number.NaN;
  const dir = firstStrongDirection(g.text) ?? lineDir;
  return dir === "rtl" ? g.rect.xMax : g.rect.xMin;
}

export interface EdgeError {
  line: number;
  index: number;
  error: number;
}

/** Checklist 2: per-chord edge errors (px) for the chosen lyric lines. */
export function anchorEdgeErrors(
  song: SongModel,
  lines: LineMeasure[],
): EdgeError[] {
  const errors: EdgeError[] = [];
  renderedLines(song).forEach((sl, i) => {
    const lm = lines[i];
    if (sl.kind !== "lyric" || !lm) return;
    const lineDir = lineDirection(song, i);
    const seen = new Set<number>();
    for (const { index } of sl.chords) {
      if (seen.has(index)) continue;
      seen.add(index);
      const box = lm.boxes.find((b) => b.index === index);
      if (!box) {
        errors.push({ line: i, index, error: Number.POSITIVE_INFINITY });
        continue;
      }
      const want = expectedEdge(lm, index, lineDir);
      const got = box.dir === "rtl" ? box.rect.xMax : box.rect.xMin;
      errors.push({ line: i, index, error: Math.abs(got - want) });
    }
  });
  return errors;
}

export function intersects(a: Rect, b: Rect, eps = 0.01): boolean {
  return (
    a.xMin < b.xMax - eps &&
    b.xMin < a.xMax - eps &&
    a.yMin < b.yMax - eps &&
    b.yMin < a.yMax - eps
  );
}

/** Groups rects into visual rows (tops within `tol` px). */
export function groupRows<T extends { rect: Rect }>(
  items: T[],
  tol = 2,
): T[][] {
  const rows: { top: number; items: T[] }[] = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.top - it.rect.yMin) <= tol);
    if (row) row.items.push(it);
    else rows.push({ top: it.rect.yMin, items: [it] });
  }
  return rows.map((r) => r.items);
}

/** Checklist 3: number of intersecting chord-box pairs on the same visual row. */
export function overlapCount(lines: LineMeasure[]): number {
  let n = 0;
  for (const line of lines) {
    for (const row of groupRows(line.boxes)) {
      for (let a = 0; a < row.length; a++) {
        for (let b = a + 1; b < row.length; b++) {
          if (
            intersects((row[a] as BoxMeasure).rect, (row[b] as BoxMeasure).rect)
          ) {
            n += 1;
          }
        }
      }
    }
  }
  return n;
}

export interface WrapReport {
  rows: number;
  /** chord boxes whose bottom is outside the anchored grapheme's visual line */
  misplaced: number;
  /** chord boxes intersecting a lyric grapheme on a different visual row */
  crossRow: number;
}

/** Checklist 5 (and 6 for `misplaced`): chord boxes versus their anchored grapheme rows. */
export function wrapReport(song: SongModel, lines: LineMeasure[]): WrapReport {
  let rows = 0;
  let misplaced = 0;
  let crossRow = 0;
  renderedLines(song).forEach((sl, i) => {
    const lm = lines[i];
    if (sl.kind !== "lyric" || !lm) return;
    rows = Math.max(rows, groupRows(lm.graphemes).length);
    for (const box of lm.boxes) {
      const anchored =
        lm.graphemes[Math.min(box.index, lm.graphemes.length - 1)];
      if (!anchored) continue;
      const top = anchored.rect.yMin;
      if (box.rect.yMax > top + 2 || box.rect.yMax < top - lm.lineHeight) {
        misplaced += 1;
      }
      const other = lm.graphemes.some(
        (g) =>
          Math.abs(g.rect.yMin - top) > 2 &&
          g.rect.xMax > g.rect.xMin &&
          intersects(box.rect, g.rect),
      );
      if (other) crossRow += 1;
    }
  });
  return { rows, misplaced, crossRow };
}

/** Print check: boxes whose bottom exceeds anchored grapheme top + 2px. */
export function boxesBelowAnchor(
  song: SongModel,
  lines: LineMeasure[],
): number {
  let n = 0;
  renderedLines(song).forEach((sl, i) => {
    const lm = lines[i];
    if (sl.kind !== "lyric" || !lm) return;
    for (const box of lm.boxes) {
      const g = lm.graphemes[Math.min(box.index, lm.graphemes.length - 1)];
      if (g && box.rect.yMax > g.rect.yMin + 2) n += 1;
    }
  });
  return n;
}

export interface WordRect {
  word: string;
  rect: Rect;
}

/** Rects of whitespace-separated words of lyric line `lineIndex` (text excluding chord boxes). */
export async function wordRects(
  page: Page,
  lineIndex: number,
): Promise<WordRect[]> {
  return page.evaluate((idx) => {
    const line = document.querySelectorAll<HTMLElement>("[data-line]")[idx];
    if (!line) throw new Error("no such line");
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement?.closest("[data-chord-box]")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const nodes: { node: Text; start: number }[] = [];
    let text = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n as Text, start: text.length });
      text += (n as Text).data;
    }
    const locate = (offset: number, end: boolean) => {
      for (const e of nodes) {
        const len = e.node.length;
        const inside = end
          ? offset > e.start && offset <= e.start + len
          : offset >= e.start && offset < e.start + len;
        if (inside) return { node: e.node, offset: offset - e.start };
      }
      throw new Error("offset out of range");
    };
    const out: { word: string; rect: Rect }[] = [];
    for (const m of text.matchAll(/\S+/g)) {
      const s = m.index ?? 0;
      const a = locate(s, false);
      const b = locate(s + m[0].length, true);
      const r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      const d = r.getBoundingClientRect();
      out.push({
        word: m[0],
        rect: { xMin: d.left, xMax: d.right, yMin: d.top, yMax: d.bottom },
      });
    }
    return out;
  }, lineIndex);
}

/** `.chord` textContent values in DOM order. */
export async function chordTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".chord")].map((e) => e.textContent ?? ""),
  );
}

/** Golden chords in golden order (lyric anchors and chord-only lines). */
export function goldenChords(song: SongModel): string[] {
  return renderedLines(song).flatMap((l) =>
    l.kind === "lyric"
      ? l.chords.map((c) => c.chord)
      : l.kind === "chords"
        ? l.chords
        : [],
  );
}

/** Per-character x of the first `.chord` whose text equals `chord`. */
export async function charXs(page: Page, chord: string): Promise<number[]> {
  return page.evaluate((c) => {
    const el = [...document.querySelectorAll(".chord")].find(
      (e) => e.textContent === c,
    );
    const node = el?.firstChild;
    if (!el || !(node instanceof Text)) throw new Error(`no chord ${c}`);
    return Array.from(c, (_, i) => {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      return r.getBoundingClientRect().left;
    });
  }, chord);
}
