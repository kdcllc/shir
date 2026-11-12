---
name: hebrew-rtl-chords
description: Rules and verification for rendering guitar chords over Hebrew (RTL), English (LTR) and mixed lyrics, incl. niqqud, import, and search normalization. Use for any change to chord rendering, import, editor preview, print CSS, or search normalization. Criteria skill — the evaluator MUST load it for any task touching packages/chord-render, the importer, styles, or print CSS.
---

# hebrew-rtl-chords

Normative rules for Shir. Code, tests and evaluator verdicts cite rule ids (B1–B10).
`docs/BIDI.md` expands these rules; if the two disagree, raise it — do not silently pick one.

## Rules B1–B10

- **B1** Chord symbols are always LTR: render inside an element with
  `direction:ltr; unicode-bidi:isolate` (or `<bdi dir="ltr">`). "F#m7(b5)"
  must never display as "#F…" or "(5b)…".
- **B2** Chord positions are grapheme indices into the LOGICAL lyric string
  (Intl.Segmenter / unicode-segmentation). Never store visual columns.
- **B3** Each lyric line renders as ONE inline bidi run with zero-width anchors
  (`position:relative; display:inline`) at chord offsets; chord is absolutely
  positioned above the anchor. No flex/inline-block "chunk" layout for lines
  containing both strong RTL and strong LTR characters.
- **B4** After layout, a measure pass prevents chord overlap by adding
  padding-inline-end to the preceding text segment; re-run on resize/font change.
- **B5** Line base direction: line.direction if set, else song.base_direction, else
  `dir="auto"` (first strong char). Song container uses `unicode-bidi:isolate`.
- **B6** Chord-only lines (instrumental) follow the song direction for ordering of
  bars but each chord is LTR (B1).
- **B7** Inputs/textarea use dir="auto"; the ChordPro editor is a code-style LTR
  editor whose lyric preview pane applies B1–B5.
- **B8** UI chrome mirrors via `<html dir>` from UI language; only logical CSS props;
  directional icons flip; numbers/times/keys stay LTR.
- **B9** Importer: for RTL lyric lines in chords-over-lyrics text, chord columns are
  measured from the RIGHT edge; snap to nearest grapheme/word start; preview +
  "flip alignment" toggle before save.
- **B10** Niqqud: marks stay with base letter; font fallback chain must render
  dagesh/shin-dot/holam positions (verified by visual fixture).

## Fixture set (packages/test-fixtures — original text only)

| Fixture | Purpose |
|---------|---------|
| `he_plain` | Hebrew lyrics, chords on word starts and mid-word |
| `he_niqqud` | Hebrew with niqqud incl. dagesh, shin-dot, holam; chords before marked letters (B2, B10) |
| `en_plain` | English baseline |
| `mixed_he_en` | Hebrew line containing the English phrase "rock and roll" with chords on both scripts |
| `chord_only_line` | Instrumental bars in an RTL song (B6) |
| `sharp_flat_extensions` | `C#`, `Bb`, `F#m7(b5)`, `Dsus4/F#` (B1) |
| `dense_chords` | A chord on every syllable (B4 overlap) |
| `long_wrap_line` | Line that wraps at narrow widths; chords must stay with their graphemes |

All fixture text is written for this repo (or public domain with a `samples/LICENSES.md`
entry). Never use copyrighted lyrics.

## Evaluator verification checklist

Each item is a command or an assertion the evaluator checks; a missing item for a task in scope is a NEEDS FIXES.

1. **textContent equality** — every `.chord` node's `textContent` === source chord string.
2. **Anchor edge ≤ 2px** — chord box inline-start edge within 2px of its anchor's x for
   the anchored grapheme (RTL: right edge). Runs in Playwright `chromium` AND `webkit`
   (`pnpm --filter chord-render test:bidi`).
3. **No overlap** — no two chord boxes on the same visual line intersect.
4. **Mixed word order** — in `mixed_he_en`, "rock and roll" is visually LTR (word boxes increase in x).
5. **Wrap** — after wrapping `long_wrap_line`, each chord sits on the same visual line as its anchor grapheme.
6. **Print CSS** — print stylesheet keeps chords above lyrics and hides UI chrome (snapshot).
7. **normalize_he unit tests** — NFD → strip U+0591–U+05C7 → NFC → final letters ך→כ ם→מ ן→נ ף→פ ץ→צ → casefold; same fn on queries; "שלום" matches "שָׁלוֹם", "מלך" matches "מֶלֶךְ".
8. **Importer golden files both directions** — chords-over-lyrics → ChordPro for RTL and LTR inputs; flip-alignment toggle covered (B9).
9. **No physical CSS** — `pnpm stylelint` exits 0.

## Anti-patterns (reject on sight)

- Storing visual columns or pixel offsets for chords.
- Flex / inline-block chunks on mixed-direction lines.
- Physical CSS props (`left`, `right`, `margin-left`, `padding-right`, `text-align: left` …).
- Using ChordSheetJS `HtmlDivFormatter` / `HtmlTableFormatter` for display (parsing/serializing with ChordSheetJS is fine).
- Dropping niqqud from stored lyrics — strip ONLY in `*_norm` columns.
- Any network fetch of lyrics; scraping or site-specific fetchers.
- Reversing strings in code to "fix" display order.

## Known library caveats

- ChordSheetJS **#2327**: transpose leaves `{new_key}` untransposed — update key directives ourselves.
- ChordSheetJS **#2328**: HTML formatters drop conditional sections — another reason not to use them for display.
