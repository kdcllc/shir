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

B7 (editor input direction) and B9 (importer) are implemented as described below. B8 (UI chrome) is
not covered by this page.

## Editor input (B7)

The editor is a plain `<textarea dir="auto">` (`apps/desktop/src/components/Editor.tsx`).

## Importer column mapping (B9)

`importText` (`packages/chord-core/src/import.ts`, rules in `docs/CHORDPRO.md` `## Import`) merges a chord
line into the lyric line below it by column. LTR lyric lines always use logical columns: the chord at
code-point column `s` anchors at grapheme `s`. For RTL lyric lines (first-strong direction `rtl`) the
`rtlColumns` option picks the model:

- `logical`: the same as LTR, anchor grapheme index = start column.
- `mirror` (default): columns are read against the order an LTR-paragraph plain-text editor shows, so
  the chord goes over the grapheme visibly under it (a visual bidi map, Q&A row 13, rather than a plain
  right-edge measurement). The visual map is a simplified UAX #9: W7 (digits
  after Latin or with no strong before become L), N1/N2 (a neutral run takes the surrounding direction
  when both sides agree, else L), I1 levels, and L2 reordering. RTL runs are reversed, while embedded
  Latin and digit runs keep their LTR order.
  1. If the chord's start column shows an LTR-level grapheme, anchor on it.
  2. Otherwise anchor on the grapheme shown at the chord's last column. A chord straddling an RTL to
     LTR boundary therefore anchors on the LTR end (`[Dm7]blues` in the `mixed_over_lyrics` fixture).
  3. When neither rule applies because the chord's last column lies beyond the line (its start column not showing an LTR-level grapheme), it clamps: to the grapheme shown at the line's last column when that grapheme is
     RTL-level, else to the end of the line (index 0 for an empty lyric), with a `chord-past-end`
     warning.
- In both models an anchor on whitespace snaps forward to the next non-whitespace grapheme (or to the end of the line when only whitespace follows) (not to the
  nearest, unlike B9's wording), and in `logical` a column past the end clamps to the end of line with
  `chord-past-end`.

Documented gaps of the simplified map (`import.ts`):

- W4/W5 number separators and terminators (`1,000`, `5%` inside RTL text) are plain neutrals, resolved
  by N1/N2 rather than joining the digit run.
- Arabic-Indic digits are classed R like all Hebrew and Arabic script graphemes, not AN.

The editor shows a Flip control when the last import has `hasRtlChords` (`Editor.tsx`), and opened files
whose import has `hasRtlChords` are queued for review (`apps/desktop/src/importFiles.ts`).

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
- `SongView` is also rendered by the desktop app (`apps/desktop/src/App.tsx`), not only by the harness.
- The Vite dev server does not minify CSS, so `test:bidi` and `tauri dev` never exercise the production
  CSS. The production desktop build keeps logical properties because `apps/desktop/vite.config.ts`
  sets `build.cssTarget` (`safari15` on Linux, `chrome105` on Windows). Without it, Vite's CSS
  minifier lowered logical properties to `:lang()`-guarded `left`/`right` rules and misplaced RTL
  chord boxes. Guard: after `pnpm --filter desktop build`, `apps/desktop/dist/assets/*.css` must
  contain no `:lang(`.
