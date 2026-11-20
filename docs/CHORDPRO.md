# ChordPro in chord-core

This page is the normative spec for the ChordPro subset handled by `packages/chord-core`. It covers the parse mapping, the canonical save form, the normalizations, and the transpose and capo semantics.

The parser is a line-oriented parser written in chord-core. It uses no parsing library, and in particular no chordsheetjs (Q&A 14). `serializeSong(parseSong(x).song)` is the canonical form of `x`; it equals `x` except for the cases in `## Normalizations`.

## Line kinds

`LINE_KINDS` lists the kinds in this order. Each source line maps to exactly one kind.

| Kind        | Source form(s)                                                                                                                                        | Canonical saved form                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `lyric`     | text with optional `[chord]` anchors, e.g. `Mo[C]rning`                                                                                               | text with each anchor as `[chord]` before its grapheme                          |
| `chords`    | only chords and whitespace, e.g. `[Am] [G]`                                                                                                           | chords as `[X]` joined by single spaces                                         |
| `empty`     | empty or whitespace-only line without `[`                                                                                                             | empty line                                                                      |
| `meta`      | `{title: x}`, `{subtitle: x}` and the other `META_NAMES` tags; aliases `{t: x}` (title), `{st: x}` (subtitle); `{meta: name value}`; `{direction: v}` | `{name: value}`; `direction` and non-`META_NAMES` names as `{meta: name value}` |
| `comment`   | `{comment: t}` / `{c: t}`, `{comment_italic: t}` / `{ci: t}`, `{comment_box: t}` / `{cb: t}`                                                          | `{comment: t}`, `{comment_italic: t}`, `{comment_box: t}`                       |
| `section`   | `{start_of_X}`, `{start_of_X: label}`, `{end_of_X}`, aliases `soc`/`eoc`, `sov`/`eov`, `sob`/`eob`, `sot`/`eot`, `sog`/`eog`                          | `{start_of_X}`, `{start_of_X: label}`, `{end_of_X}` (long form)                 |
| `tab`       | any line inside an open literal section (`tab`, `grid`, `abc`, `ly`, `textblock`, `svg`) other than its end tag                                       | the text verbatim                                                               |
| `remark`    | a line whose first character is `#`                                                                                                                   | `#` + text                                                                      |
| `directive` | any other well-formed tag, e.g. `{new_key: G}`                                                                                                        | `{name}` or `{name: value}`                                                     |
| `raw`       | a line the parser could not accept (malformed tag, unterminated chord, `[]`, nested `[`)                                                              | the text verbatim                                                               |

## Lines

- The source is split on `\n`; every `\r` directly before a `\n` is stripped, not only one (`a\r\r\n` gives `a`); so CRLF is the same as LF.
- When the source ends with `\n`, the final empty element is dropped. `""` gives no lines.
- Every source line maps to exactly one `SongLine`, in order. Line N of the source is `song.lines[N-1]`.
- Classification is evaluated in this order:
  1. Inside an open literal section (see `## Tags`), the line is either the matching end tag or a `tab` line with its text verbatim.
  2. A line whose first character is `#` is a `remark`; its text is everything after the first `#`. A `#` anywhere else is ordinary text.
  3. A line whose whitespace-trimmed form starts with `{` is a tag line. If it matches the tag grammar `^\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(?::\s*([^}]*?))?\s*\}$`, it is a tag. The grammar is matched against the whitespace-trimmed line. Otherwise it is `raw` plus a `syntax` diagnostic. The value cannot contain `}`, so `{title: a} {artist: b}` is a malformed tag line and becomes `raw`.
  4. A line that is empty or whitespace-only and has no `[` is `empty`.
  5. Anything else is a lyric line (see `## Lyric lines`).

## Tags

- Tag names are matched case-insensitively and stored lowercase. The value is trimmed. There is no `value` key when there is no `:`.
- An empty value (`{x:}` or `{x:   }`) is the same as no value for every tag. A section gets no `label`, a directive gets no `value`, a comment's text is `""`, and a meta value is `""`. Every tag with no value saves in its no-value form from `## Canonical form`: `{name}`, except that a `meta` line named `direction` or with a non-`META_NAMES` name saves as `{meta: n}`.
- `meta` with value `<n> <v>` (split at the first run of whitespace; `v` is the rest, trimmed) gives a `meta` line with `name: n` and `value: v` (`""` when there is no `v`). The inner name `n` is lowercased. `{meta}` or `{meta:}` with no inner name is a `directive` named `meta` with no value. Example: `{meta: direction rtl}` gives `{ kind: "meta", name: "direction", value: "rtl" }`.
- Names in `META_NAMES` give a `meta` line. The aliases `t` (title) and `st` (subtitle) are also `meta`, stored under the long name.
- `comment`/`c` give a `comment` line with style `normal`; `comment_italic`/`ci` give `italic`; `comment_box`/`cb` give `box`. The text is the value, or `""`.
- `start_of_X` and `end_of_X` for any `X` matching `[a-z0-9_]+` give a `section` line, as do the aliases `soc`/`eoc` (chorus), `sov`/`eov` (verse), `sob`/`eob` (bridge), `sot`/`eot` (tab) and `sog`/`eog` (grid).
  - On a start tag, the label is the value. When the value has the form `label="…"`, the label is the quoted text; any other attribute form keeps the whole value as the label.
  - There is no `label` key when there is no value. An empty quoted label (`label=""`) also gives no `label` key.
  - An end tag never has a label; a value on an end tag is dropped (see `## Normalizations`).
- Literal sections are `tab`, `grid`, `abc`, `ly`, `textblock` and `svg`. After their start tag, every line up to and including the first line whose whitespace-trimmed form is a valid matching end tag (long form or alias, any name case) is either that end tag or `tab`. An indented `  {end_of_tab}` therefore closes the section; it is saved as `{end_of_tab}`, per the whitespace normalization.
- Every other tag gives a `directive` line.

## Lyric lines

- `[` opens a chord, which ends at the next `]` on the same line. The chord text between them is verbatim (B1).
- Text outside brackets is lyric text, verbatim, including `#`, `{`, `}` and a stray `]`.
- An anchor's `index` is the `splitGraphemes` length of the lyric text before it (B2). Anchors keep source order.
- A `[` with no closing `]` gives `raw` plus a `syntax` diagnostic. So does an empty `[]` or a `[` inside a chord.
- When the lyric text is whitespace-only and there is at least one chord, the line is `chords` with the chord list. Whitespace-only text with no chord was already handled as `empty`.
- Otherwise the line is `lyric`; `direction` is never set.

## Song fields

- `title` and `key` come from the first `meta` line with that name.
- `capo` comes from the first `capo` `meta` line when its value matches `^\d+$` and is 0-24, as a number. Otherwise there is an `invalid-capo` diagnostic and no `capo`.
- `direction`: values are trimmed and lower-cased, and only `rtl`/`ltr` count. The value comes from all `meta` lines named `direction`, in either source form. If any value is invalid, or the values conflict, `direction` is absent. This matches G1, where `rtl` plus `up` gives absent.
  - This is a deliberate change from G1, and it settles G1 follow-up #14. In G1, `{meta: direction …}` beat a plain `{direction: …}`, as a ChordSheetJS side effect.
  - Both forms serialize to the same `{meta: direction …}`, so a precedence that depends on the form would break model stability.
  - Every G1 test case (repeated equal values, conflicting values, an unknown value, `{direction: RTL}`) keeps its G1 result.
- An empty `title` or `key` value leaves that field absent. An empty `capo` value gets an `invalid-capo` diagnostic.
- Absent fields are omitted.

## Diagnostics

- `line` and `column` are absolute 1-based source coordinates. `column` is a UTF-16 code-unit offset plus 1.
- Diagnostics are sorted by line, then column, then emission order.
- A `raw` line gets exactly one `syntax` diagnostic, for the first error from left to right. Example: `[]x [A` gives `Empty chord` at column 1 only.
- An unterminated chord that contains an inner `[` (for example `[A[B`) reports `Nested chord bracket` at the inner `[` (column 3), not `Unterminated chord`.
- Exact message templates:

  | code               | trigger                                          | column                   | message                                                                                           |
  | ------------------ | ------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------- |
  | `syntax`           | malformed tag line                               | first `{`                | `Malformed directive`                                                                             |
  | `syntax`           | unterminated chord                               | that `[`                 | `Unterminated chord`                                                                              |
  | `syntax`           | `[]`                                             | that `[`                 | `Empty chord`                                                                                     |
  | `syntax`           | `[` inside a chord                               | the inner `[`            | `Nested chord bracket`                                                                            |
  | `section-unopened` | `end_of_X` with no open section                  | `{`                      | `end_of_X without an open section`, with X the canonical section name                             |
  | `section-mismatch` | `end_of_X` while `Y` is open                     | `{`                      | `end_of_X while Y is open` (the open section is closed); X and Y are both canonical section names |
  | `section-unclosed` | at EOF, or a `start_of_` while a section is open | the open start tag's `{` | `Y section is not closed` (reported at the start line; a new `start_of_` then opens)              |
  | `invalid-capo`     | invalid capo value                               | `{`                      | `Invalid capo value "<v>"`                                                                        |
  | `unknown-chord`    | transforms only                                  | per the `Diagnostic` doc | `Unrecognized chord "<c>"`                                                                        |

- A literal section left unclosed at EOF keeps its remaining lines as `tab` and reports `section-unclosed`.

## Canonical form

`serializeSong` emits each kind exactly as follows.

- LF only, a single trailing `\n` when `lines` is non-empty, and `""` for no lines.
- `meta`: `title`, `subtitle`, … `copyright` (`META_NAMES` minus `direction`) give `{<name>: <value>}`. `direction` and any non-`META_NAMES` name give `{meta: <name> <value>}` (or `{meta: <name>}` when the value is `""`). A `META_NAMES` line (not `direction`) with value `""` gives `{<name>}`.
- `comment` gives `{comment: t}`, `{comment_italic: t}` or `{comment_box: t}`, or `{comment}` etc. when the text is `""`.
- `section` gives `{start_of_X}`, `{start_of_X: label}` or `{end_of_X}`. The long form is always used; the `label="…"` attribute form is saved as the plain value.
- `directive` gives `{name}` or `{name: value}`.
- `lyric`: each anchor `[chord]` is emitted immediately before the grapheme at its index; anchors at `graphemeCount` go at the end; equal indices are adjacent, in array order; out-of-range indices are clamped.
- `chords` gives the chords joined by single spaces in `[X]` form.
- `empty` gives `""`.
- `remark` gives `#` + text.
- `tab` and `raw` give the text verbatim.
- Top-level song fields are never emitted on their own.
- Model-only edge (not produced by `parseSong`): a chordless `lyric` whose text starts with `#` or `{`, or is whitespace-only, is emitted verbatim and is not guaranteed to round-trip.

## Normalizations

These are every case where `serializeSong(parseSong(x).song) !== x`, listed explicitly and exhaustively:

- CRLF becomes LF; a missing final newline is added.
- Aliases become long names (`t` to `title`, `st` to `subtitle`, `c` to `comment`, `ci` to `comment_italic`, `cb` to `comment_box`, `soc`/`eoc`, `sov`/`eov`, `sob`/`eob`, `sot`/`eot`, `sog`/`eog` to `start_of_*`/`end_of_*`). Tag-name case becomes lowercase.
- Whitespace around `{…}`, around `:` and around the value becomes canonical spacing.
- `{meta: title x}` (any `META_NAMES` name except `direction`) becomes `{title: x}`; `{direction: v}` becomes `{meta: direction v}`.
- `label="…"` becomes a plain label.
- Whitespace-only lines become empty.
- A value on an end tag (`{end_of_X: v}`, `{eoc: v}`) is dropped.
- A chord placed inside a grapheme cluster (for example between a letter and its niqqud, `ש[Am]ָלום`) moves to the start of the next cluster (`שָ[Am]לום`, B2).
- `{name:}` (or `{name:   }`) with an empty value becomes the no-value form for every tag: `{name}`, or `{meta: name}` for `direction` and non-`META_NAMES` meta names (`{comment:}` becomes `{comment}`, `{title:}` becomes `{title}`, `{direction:}` becomes `{meta: direction}`).
- The inner name of `{meta: N v}` is lowercased (`{meta: Direction rtl}` becomes `{meta: direction rtl}`).
- Every `\r` directly before a `\n` is stripped, not only one: `a\r\r\n` becomes `a\n` (follow-up #4).
- Chord-only lines are re-joined with exactly one space between chords. This inserts a space in `[Am][G]` to give `[Am] [G]`; leading and trailing whitespace is dropped.
- an empty quoted label (`label=""`) is the same as no label: `{start_of_X: label=""}` becomes `{start_of_X}`.
- U+FEFF (byte-order mark) counts as whitespace in every rule above, as in JavaScript `trim()`: it is dropped around a tag or its value (`﻿{title: x}` becomes `{title: x}`), on a whitespace-only line, and around the chords of a chord-only line; inside other lyric and `raw` lines, and in `remark` and `tab` lines, it is kept.
- no-value forms follow the same rules: `{direction}` (no colon) becomes `{meta: direction}`, and `{meta: title}` (an inner `META_NAMES` name with no value) becomes `{title}`.

Everything else, including `#` inside lyrics and `{…}` text inside a lyric line, is preserved byte-exactly.

## API

Every exported function of chord-core:

| Function               | Signature                                                                                                       | Purpose                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `parseSong`            | `parseSong(source: string): ParseResult`                                                                        | Parse ChordPro source into the line model plus diagnostics; never throws.                                              |
| `serializeSong`        | `serializeSong(song: SongModel): string`                                                                        | Write a song model as canonical ChordPro.                                                                              |
| `parseChord`           | `parseChord(text: string): ParsedChord \| null`                                                                 | Split chord text into root, suffix and bass; `null` when unparseable.                                                  |
| `formatChord`          | `formatChord(chord: ParsedChord): string`                                                                       | Join a parsed chord back into text.                                                                                    |
| `noteToPitchClass`     | `noteToPitchClass(note: NoteName): number \| null`                                                              | Pitch class 0-11 of a note name.                                                                                       |
| `transposeKey`         | `transposeKey(key: string, semitones: number, prefer?: SpellingPreference): string \| null`                     | Transpose a key name.                                                                                                  |
| `transposeChord`       | `transposeChord(chord: string, semitones: number, options?: TransposeOptions): { chord: string; ok: boolean }`  | Transpose one chord; unparseable chords pass through with `ok: false`.                                                 |
| `transposeSong`        | `transposeSong(song: SongModel, semitones: number, options?: { prefer?: SpellingPreference }): TransformResult` | Return a transposed copy of a song, rewriting key metadata.                                                            |
| `viewSong`             | `viewSong(song: SongModel, options?: ViewOptions): ViewResult`                                                  | Build the view-only transposed and capo-shaped song.                                                                   |
| `firstStrongDirection` | `firstStrongDirection(text: string): TextDirection \| null`                                                     | First-strong direction of a text (G1).                                                                                 |
| `splitGraphemes`       | `splitGraphemes(text: string): string[]`                                                                        | Split text into grapheme clusters (G1).                                                                                |
| `importText`           | `importText(text: string, options?: ImportOptions): ImportResult`                                               | Convert pasted ChordPro or chords-over-lyrics text to ChordPro.                                                        |
| `isValidChordText`     | `isValidChordText(chord: string): boolean`                                                                      | Whether a text is accepted as a chord by the edit operations.                                                          |
| `listSections`         | `listSections(song: SongModel): SectionSpan[]`                                                                  | List the well-formed sections of a song, in line order.                                                                |
| `applyEdit`            | `applyEdit(song: SongModel, op: EditOp): EditResult`                                                            | Apply one edit and reparse the result; never throws.                                                                   |
| `applyEdits`           | `applyEdits(song: SongModel, ops: readonly EditOp[]): EditResult`                                               | Apply edits in order, each to the previous result's song.                                                              |
| `songChords`           | `songChords(song: SongModel): string[]`                                                                         | The distinct chords a song uses, in order of first appearance.                                                         |
| `suggestChords`        | `suggestChords(song: SongModel, prefix: string, limit?: number): string[]`                                      | Suggest chords for a prefix: used chords, then the key's triads.                                                       |
| `exportSongDirection`  | `exportSongDirection(song: SongModel): TextDirection`                                                           | Resolved song direction: `song.direction`, else the first strong lyric direction, else `"ltr"`.                        |
| `exportLineDirection`  | `exportLineDirection(line: LyricLine, songDirection?: TextDirection): TextDirection`                            | Line direction: `line.direction`, else the song direction, else the first strong direction of the lyric, else `"ltr"`. |
| `buildExportSong`      | `buildExportSong(song: SongModel, opts?: { transpose?: number; capo?: number }): ExportSong`                    | Build the export form of one song at a transpose and capo.                                                             |
| `buildExportDocument`  | `buildExportDocument(title: string, entries: readonly ExportEntry[]): ExportDocument`                           | Build a titled export document: songs in entry order, each with its own transpose and capo.                            |
| `directionalCells`     | `directionalCells(line: Extract<ExportLine, { kind: "lyric" }>): ExportCell[]`                                  | Split a lyric line's segments at direction-run boundaries into single-direction cells, in logical order.               |

The export functions live in `packages/chord-core/src/export.ts`, with the `ExportSegment`, `ExportLine`, `ExportCell`, `ExportSong`, `ExportEntry` and `ExportDocument` types. `buildExportSong` maps the viewed model (`viewSong`) to `ExportLine` values; `ExportSong` also carries the effective `capo` and `transpose` and the resolved `direction`. `packages/chord-render/src/exportParity.test.tsx` tests that these direction rules match chord-render's.

### Editing

The edit functions live in `packages/chord-core/src/edit.ts`. An edit is an `EditOp` value applied with `applyEdit` or `applyEdits`. In an op, `line` is an index into `song.lines`, `anchor` is an index into that line's `chords` array, and `index` is a grapheme index.

`EditOp` has 17 op types:

| Op type         | Fields                              | Effect                                                                                   |
| --------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `setLyric`      | `line`, `text`                      | Set the lyric text of a `lyric`, `empty` or `chords` line.                               |
| `addChord`      | `line`, `index`, `chord`            | Add a chord at a grapheme index of a `lyric` or `empty` line.                            |
| `setChord`      | `line`, `anchor`, `chord`           | Replace the text of one chord of a `lyric` line.                                         |
| `removeChord`   | `line`, `anchor`                    | Remove one chord of a `lyric` line.                                                      |
| `moveChord`     | `line`, `anchor`, `index`           | Move one chord of a `lyric` line to another grapheme index.                              |
| `insertLine`    | `at`                                | Insert an `empty` line.                                                                  |
| `removeLine`    | `line`                              | Remove a line of any kind except `section`.                                              |
| `splitLine`     | `line`, `index`                     | Split a `lyric` line in two at a grapheme index.                                         |
| `joinLines`     | `line`                              | Join a line with the next one; each must be `lyric` or `empty`.                          |
| `setChordsLine` | `line`, `chords`                    | Replace the chord list of a `chords` line.                                               |
| `setComment`    | `line`, `text`                      | Set the text of a `comment` line; its style is kept.                                     |
| `setMeta`       | `name`, `value`                     | Set or remove a `meta` line; `name` is one of `EDIT_META_NAMES`.                         |
| `addSection`    | `at`, `section`, optional `label`   | Insert a start tag, an `empty` line and an end tag; `section` is one of `SECTION_KINDS`. |
| `renameSection` | `line`, `section`, optional `label` | Rewrite both tags of a section; `section` is one of `SECTION_KINDS`.                     |
| `moveSection`   | `line`, `direction`                 | Exchange a section with the previous (`"up"`) or next (`"down"`) one.                    |
| `removeSection` | `line`                              | Remove a section: its start tag, body and end tag.                                       |
| `transpose`     | `semitones`                         | Transpose the song with `transposeSong`.                                                 |

`SECTION_KINDS` is `verse`, `chorus`, `bridge`. `EDIT_META_NAMES` is `title`, `artist`, `key`, `capo`, `tempo`.

Result and reparse guarantee:

- `EditResult` is `{ song, text, changed }`.
- For a valid edit, `text` is `serializeSong` of the edited song, and `song` is `parseSong(text).song`. So the returned song always has the line kinds and song fields of a fresh parse. Example: `addChord` on an `empty` line gives the text `[Am]`, and the returned line is a `chords` line.
- `changed` is `true` when `text` differs from `serializeSong` of the input song. The text is always the canonical form, so the first edit of a non-canonical source also applies `## Normalizations`: `insertLine` at 2 on `{t: A}\r\n[Am][G]\r\n` gives `{title: A}\n[Am] [G]\n\n`.
- An invalid edit returns the input song itself, `text` as `serializeSong` of the input, and `changed: false`. A `null` or non-object op is invalid. `applyEdit` never throws and never mutates its input.
- `applyEdits` applies each op to the previous result's song; an invalid op is skipped and the rest still apply. `changed` compares the final text with the input song's text. With no ops, or an `ops` value that is not an array, it returns the input song itself with `changed: false` and never throws.

Clamping:

- A grapheme `index` (`addChord`, `moveChord`, `splitLine`) is truncated to an integer and clamped to 0 to the line's grapheme count. `NaN` or a non-number is invalid.
- `insertLine` needs an integer `at`, clamped to 0 to the line count. `addSection` truncates and clamps `at` the same way; an `at` inside a well-formed section moves to just after that section's end tag.
- `setLyric` and `addChord` accept `line` from 0 to the line count; `line` equal to the line count appends a line. Every other `line` must be the integer index of an existing line.
- Chord text is trimmed. Line breaks are removed from `setLyric` text. Comment text, meta values and section labels lose line breaks, `{` and `}`, and are trimmed; an empty label is omitted.

Rejection (the edit is invalid):

- The line has the wrong kind for the op (see the table), or `line` or `anchor` is out of range or not an integer.
- The chord fails `isValidChordText`: it is empty after trimming, or contains `[`, `]` or a line break. A `setChordsLine` entry that contains whitespace after trimming, or is not a string, is also rejected; empty entries are dropped.
- `setMeta` with a `name` outside `EDIT_META_NAMES`; `addSection` or `renameSection` with a `section` outside `SECTION_KINDS`; `transpose` with non-integer `semitones`; a `text` or `value` that is not a string.
- `setChordsLine` with a `chords` value that is not an array; `moveSection` with a `direction` other than `"up"` or `"down"`; an op whose `type` is not one of the 17 op types.
- `addSection` with an `at` that is `NaN` or not a number.
- `renameSection`, `moveSection` and `removeSection` when `line` is not the start line of a well-formed section (see `listSections` below). `renameSection` also rejects a literal section. `moveSection` is rejected when there is no previous or next well-formed section.

Other rules:

- `setLyric` keeps chords in place. With `p` the common grapheme prefix of the old and new text, `s` the common suffix of the remainders and `oldCount` the grapheme count of the old text, an anchor at `index <= p` stays, one at `index >= oldCount - s` shifts by the length change, and any other moves to `p`. On a `chords` line, non-empty text gives a `lyric` line with every chord at index 0, in order. On an `empty` line, text that is whitespace only (after line breaks are removed) changes nothing; this includes `line` equal to the line count, which appends nothing. Empty text on a `chords` line changes nothing.
- A lyric line left with no text and no chords becomes an `empty` line. A `chords` line left with no chords becomes an `empty` line.
- An added or moved chord goes after every anchor of the line whose index is less than or equal to its own.
- `splitLine` keeps the anchors with an index below the split index on the first line; the others move to the second line, shifted. `joinLines` shifts the second line's anchors by the first line's grapheme count.
- `setMeta` with an empty value removes every `meta` line of that name. Otherwise it replaces the first `meta` line of that name, or inserts a new line after the leading run of `meta` lines.
- `moveSection` keeps the lines between the two sections in place.

`listSections` returns one `SectionSpan` (`{ start, end, section, label?, literal }`) per well-formed section: a start tag whose next section tag is the matching end tag. `start` and `end` are the indices of the two tag lines. `literal` is `true` for the literal sections of `## Tags` (`LITERAL_SECTIONS` in `song.ts`). Unclosed, unopened and mismatched tags give no span. A start tag inside an open section drops the outer section: only the inner one can give a span.

`suggestChords` lists the chords the song uses (`songChords`), then the six diatonic triads of `song.key`, and keeps those that start with the trimmed `prefix`, ignoring ASCII case. It returns at most `limit` chords; the default is 12, and a non-integer `limit` or one below 1 also means 12. When `song.key` is absent or not a key, only the used chords are offered. The triads follow the accidental in the key name: when the tonic has `b` they are spelled from the flat table, and when it has `#` from the sharp table (key `Gb` gives `Gb`, `Abm`, `Bbm`, `B`, `Db`, `Ebm`); a key without an accidental spells them in that key's own style. The tables are the spelling tables of `## Chords and transpose`.

Shared edit cases live in `packages/test-fixtures/edit/cases.json` (`EDIT_CASES_PATH`, read with `readEditCases`). Each case is `{ name, fixture, ops, expected }`: the `ops` applied to the parsed `fixture` give the ChordPro text `expected`.

Shared export goldens are `EXPORT_GOLDEN_CASES` (`packages/test-fixtures/src/index.ts`), one `{ fixture, transpose, capo, file }` per `packages/test-fixtures/export/*.export.json`. Exporting the `fixture` at that `transpose` and `capo` gives the `ExportSong` JSON, without `model`, in `file`; read one with `readExportGolden`.

## Import

`importText(text, options?)` (`packages/chord-core/src/import.ts`) turns pasted text into ChordPro. It never throws. `options.rtlColumns` is `'mirror'` (default) or `'logical'`; see `BIDI.md` `## Importer column mapping (B9)`. The result is `{ chordpro, format, hasRtlChords, warnings }`.

- Input is normalized first: one leading U+FEFF is dropped, and CRLF and lone CR become LF. The trailing-newline state is kept.
- Detection is per line, not per file. These lines pass through unchanged: empty or whitespace-only lines, lines starting with `#`, whole-line `{…}` directives, and lines that already hold an inline `[chord]` (a bracket whose text `parseChord` accepts).
- Literal sections (`tab`, `grid`, `abc`, `ly`, `textblock`, `svg`, plus the `sot`/`sog` start aliases) pass through from the start tag to the first matching end tag, which must be the same kind. An unterminated section passes through to the end of the text.
- A chord line is a non-empty line whose whitespace-separated tokens all parse as chords (`parseChord`); tabs are expanded to 8-column stops first. A chord line followed by a lyric line (a line that is not passthrough and not itself a chord line) is merged: each chord becomes an inline `[chord]` anchor at the lyric grapheme under its column. A chord line with no such following line becomes a chord-only line, `[Am] [G]`.
- Chord columns are counted in code points of the chord line; anchors are placed at grapheme indices of the lyric line, so a chord never lands inside a grapheme cluster. A column that falls on whitespace snaps forward to the next non-whitespace grapheme (or to the end of the line when only whitespace follows), never backward. Chords at the same index keep their source order.
- `format` is `"chords-over-lyrics"` when at least one chord line was converted (mixed input included), else `"chordpro"`, in which case the text is returned as normalized and `hasRtlChords` is `false`.
- `hasRtlChords` is `true` when a merged lyric line has first-strong direction `rtl`.
- Warnings are `{ line, code, message }` with a 1-based source line:
  - `chord-past-end`: a chord column lies beyond the end of its lyric line (the chord is clamped).
  - `no-chords`: nothing was converted and no non-directive line holds an inline chord. It fires at line 1. Inline chords that sit only in directives or literal sections do not count, so such a text still gets `no-chords`.

## Unicode

- Lyric codepoints are never normalized (no NFC). Niqqud order is preserved.
- Normalization is a DB and search concern, not a chord-core concern; see [`DATA_MODEL.md`](DATA_MODEL.md).

## Chords and transpose

- Chord grammar: `^([A-G])(#|b)?(\S*?)(?:/([A-G])(#|b)?)?$`. The suffix is kept verbatim and may contain `/` when what follows is not a note: `C6/9` has suffix `6/9`, and `C/9` has suffix `/9`. Any whitespace makes the chord unparseable.
- An unparseable chord passes through verbatim with `ok: false` and gets an `unknown-chord` diagnostic in transforms.
- Semitones are taken mod 12. A non-integer raises `RangeError`. A shift of 0 mod 12 returns chords verbatim.
- Key tables (major): 0 C, 1 Db, 2 D, 3 Eb, 4 E, 5 F, 6 F#/Gb (tie: `prefer`, default sharp), 7 G, 8 Ab, 9 A, 10 Bb, 11 B. Minor: Cm, C#m, Dm, Ebm/D#m (tie), Em, Fm, F#m, Gm, G#m, Am, Bbm, Bm.
- Both tie keys (F#/Gb major, D#m/Ebm minor) default to the sharp name unless `prefer` is `flat`.
- Spelling tables. Sharp: C C# D D# E F F# G G# A A# B. Flat: C Db D Eb E F Gb G Ab A Bb B.
- `transposeChord` picks its spelling style from the target key, `transposeKey(key, n, prefer)`.
- Flat-style keys (F Bb Eb Ab Db Gb, Dm Gm Cm Fm Bbm Ebm) use flats. Sharp-style keys (G D A E B F#, Em Bm F#m C#m G#m D#m) use sharps.
- C/Am, or no key: the `prefer` option when given, else the default table C C# D Eb E F F# G Ab A Bb B.
- The bass note follows the same spelling as the root.
- Guarantee: for every table key, +n then -n returns the original text of each in-key chord spelled per that key's style, excluding chords that would need E#/B#/Cb/Fb. Out-of-key chords may be respelled (for example `F#m7b5` in Bb comes back as `Gbm7b5`).

## Capo

- Capo is view-only: shapes = the sounding chord transposed by -capo.
- `viewSong` shapes = chords transposed by (`transpose` - `capo`).
- `soundingKey` = key + `transpose`; `shapeKey` = key + `transpose` - `capo`. Shapes are spelled per `shapeKey`.
- `viewSong` never rewrites `meta` lines or `song.key`. A `capo` outside 0-24 or non-integer raises `RangeError`.
- `transposeSong` returns a new model:
  - chords are transposed;
  - every `meta` `key` line value, every `directive` named `new_key` (the ChordSheetJS #2327 caveat in `hebrew-rtl-chords`) and `song.key` are rewritten;
  - `capo` is unchanged.

  The input is never mutated.
