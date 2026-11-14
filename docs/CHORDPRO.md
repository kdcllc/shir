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
  - There is no `label` key when there is no value.
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

Everything else, including `#` inside lyrics and `{…}` text inside a lyric line, is preserved byte-exactly.

## API

Every exported function of chord-core:

| Function               | Signature                                                                                                       | Purpose                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `parseSong`            | `parseSong(source: string): ParseResult`                                                                        | Parse ChordPro source into the line model plus diagnostics; never throws. |
| `serializeSong`        | `serializeSong(song: SongModel): string`                                                                        | Write a song model as canonical ChordPro.                                 |
| `parseChord`           | `parseChord(text: string): ParsedChord \| null`                                                                 | Split chord text into root, suffix and bass; `null` when unparseable.     |
| `formatChord`          | `formatChord(chord: ParsedChord): string`                                                                       | Join a parsed chord back into text.                                       |
| `noteToPitchClass`     | `noteToPitchClass(note: NoteName): number \| null`                                                              | Pitch class 0-11 of a note name.                                          |
| `transposeKey`         | `transposeKey(key: string, semitones: number, prefer?: SpellingPreference): string \| null`                     | Transpose a key name.                                                     |
| `transposeChord`       | `transposeChord(chord: string, semitones: number, options?: TransposeOptions): { chord: string; ok: boolean }`  | Transpose one chord; unparseable chords pass through with `ok: false`.    |
| `transposeSong`        | `transposeSong(song: SongModel, semitones: number, options?: { prefer?: SpellingPreference }): TransformResult` | Return a transposed copy of a song, rewriting key metadata.               |
| `viewSong`             | `viewSong(song: SongModel, options?: ViewOptions): ViewResult`                                                  | Build the view-only transposed and capo-shaped song.                      |
| `firstStrongDirection` | `firstStrongDirection(text: string): TextDirection \| null`                                                     | First-strong direction of a text (G1).                                    |
| `splitGraphemes`       | `splitGraphemes(text: string): string[]`                                                                        | Split text into grapheme clusters (G1).                                   |

## Unicode

- Lyric codepoints are never normalized (no NFC). Niqqud order is preserved.
- Normalization is a DB and search concern, not a chord-core concern.

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
