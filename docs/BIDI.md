# Bidi and RTL chord rendering

This page describes how Shir renders chords over Hebrew (RTL), English (LTR) and mixed lyrics, as
implemented in `packages/chord-core` and `packages/chord-render`. The normative rules B1–B10 live in
`.claude/skills/hebrew-rtl-chords/SKILL.md`; if the two disagree, raise it.

## Rules as implemented

- **B1** Chord symbols are always LTR. Each chord box holds an inner `<bdi dir="ltr">` with the
  chord text; that `<bdi>` is never positioned.
- **B2** Chord positions are grapheme indices into the logical lyric string, never visual columns.
- **B3** (amended in G1) A lyric line is one inline bidi run. Each chord anchor is a plain
  `display: inline; position: relative` element that wraps exactly the anchored grapheme (base letter
  plus marks); a chord at end of line uses an empty anchor after the last grapheme. The chord box is
  absolutely positioned with `inset-block-end: 100%; inset-inline-start: 0`, and its `dir` is the
  anchored grapheme's direction (neutral grapheme or end of line: the line's resolved direction), so it aligns on that grapheme's inline-start edge even at bidi run
  boundaries. No flex or inline-block chunk layout on mixed lines. Source: `ChordLine.module.css`.
- **B4** See "Overlap pass" below.
- **B5** Line base direction is `line.direction`, else the song direction, else `dir="auto"`
  (`ChordLine.tsx`). The song container uses `unicode-bidi: isolate` (`SongView.module.css`).
- **B6** Chord-only lines order bars in the song direction; each chord stays LTR.
- **B10** Niqqud stays with its base letter (the anchor wraps the whole grapheme cluster); the font
  stack is Noto Sans Hebrew, Heebo, sans-serif.

Non-lyric lines: `SongView` renders `comment` as `<p data-line="comment" data-style dir="auto">`, a
section start as `<p data-line="section" data-section dir="auto">` showing the label or else the
section name, `tab` as `<p data-line="tab" dir="ltr">`, and `raw` as `<p data-line="raw" dir="auto">`,
all as plain text. `meta`, `remark`, `directive` and section ends render nothing. Chord symbols
(`<bdi dir="ltr">`) appear only in lyric and chord-only lines.

B7–B9 (editor, UI chrome, importer) are not part of the G1 rendering spike.

## Overlap pass (B4)

`packages/chord-render/src/overlap.ts`:

- `runOverlapPass` measures each `[data-line="lyric"]`, grouping `[data-chord-box]` elements into
  visual rows by their physical `getBoundingClientRect()` top (1px tolerance). Collisions are detected
  on physical left/right rects with a 4px gap, so mixed-direction rows and dense WebKit rows work.
- A collision is fixed by setting `padding-inline-end` on the element preceding the later chord's
  anchor (text segment or previous anchor). Shifts cascade along the row.
- The measure/pad loop repeats at most 8 iterations per line and stops early when nothing changes.
- `useChordOverlap` re-runs the pass when the root's inline size changes (ResizeObserver), on
  `loadingdone` and on `document.fonts.ready`. The song root exposes the completed-pass count as
  `data-overlap-pass`.
- `computeOverlapPadding` is the pure logical-axis form of the same math.

## Direction detection

- `firstStrongDirection` (`packages/chord-core/src/direction.ts`) returns the first strong direction
  of a text: Hebrew/Arabic letters give `rtl`, other letters `ltr`; digits, punctuation, spaces and
  marks are skipped; `null` if there is no strong character. Explicit marks count like `dir="auto"`:
  RLM (U+200F) and ALM (U+061C) give `rtl`, LRM (U+200E) gives `ltr`.
- `parseSong` (`packages/chord-core/src/song.ts`) returns a `ParseResult`. The song direction is on
  `song.direction`, read from every `direction` meta line in either form (`{meta: direction v}` or
  `{direction: v}`), trimmed and lower-cased. Only `rtl` and `ltr` count; any invalid or conflicting
  value leaves it absent. See `docs/CHORDPRO.md` `## Song fields`.

## Fonts

`packages/chord-render/src/fonts.css` (exported as `chord-render/fonts.css`) imports self-hosted
woff2 files from `@fontsource` packages: Noto Sans Hebrew (400, 700), Noto Serif Hebrew (400), Heebo
(400, 700) and JetBrains Mono (400, 700). Nothing is fetched from the network; the CSP allows
`font-src 'self' data:` (`apps/desktop/src-tauri/tauri.conf.json`).

## Print CSS

Under `@media print` in `SongView.module.css`: black text on no background, `break-inside: avoid`
on lines, chord boxes stay absolutely positioned above their lyric (`inset-block-end: 100%`), and
`[data-ui-chrome]` is hidden. Checklist item 6 covers it.

## Verifying

```sh
pnpm --filter chord-render exec playwright install --with-deps chromium webkit   # one time
pnpm --filter chord-render test:bidi
```

- `test:bidi` runs Playwright (`packages/chord-render/playwright.config.ts`) against a Vite harness
  (`vite.harness.config.ts`, `127.0.0.1:1421`, local files only) in `chromium` and `webkit`. Specs
  are `packages/chord-render/bidi/*.bidi.ts`.
- Checklist items 1–6 (textContent equality, anchor edge within 2px, no overlap including resize
  re-runs, mixed word order, wrap, print CSS), plus B1, B6 and B10 checks and harness self-tests.
- Screenshot snapshots are named per platform; baselines are Linux-only. CI runs this step on
  `ubuntu-22.04` only and uploads `playwright-report/` on failure.
- Unit and render tests (jsdom) run with `pnpm --filter chord-render test`.
