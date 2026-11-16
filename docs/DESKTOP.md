# Desktop song viewer

Normative spec for the desktop song viewer. Code lives in `apps/desktop/src/`;
all UI strings live in `apps/desktop/src/strings.ts`.

## Layout

Two panes. The song list (`<nav>`, accessible name `Songs`) sits on the
inline-start side under the app heading `<h1>`, rendered as
`{appName} {separator} <bdi lang="he">{appNameHebrew}</bdi>`, which shows as
`Shir · שיר`. The song pane is `<main>`.

- App chrome is `lang="en" dir="ltr"`, taken from `apps/desktop/index.html`
  (B8).
- CSS uses logical properties only.
- The production CSP `style-src 'self'` forbids `<style>` elements and
  `style="…"` attribute strings. `dangerouslySetInnerHTML` is banned separately
  by project rule.
- The app heading `<h1>`, the `<nav>`, the view controls and the diagnostics
  panel carry the `data-ui-chrome` attribute, so the existing print CSS
  (`docs/BIDI.md` § Print CSS) hides them.
- Colour rule: every colour declaration that uses `color-mix()` or the `Mark`
  system colour has a fallback declaration of the same property, on the same
  selector, outside any `@supports` block. The fallback uses only the colours
  `Canvas`, `CanvasText`, `GrayText`, `Highlight`, `ButtonFace`, `ButtonText`,
  `currentcolor` or `transparent`, plus non-colour tokens such as widths and
  `solid`. The newer value is re-declared inside `@supports (color: <value>)`,
  placed immediately after its base rule. Engines without the feature render
  the fallback, and the existing cascade order between rules is kept.

## Shell signal

The app emits `shir://ui-ready` at most once per page load. Repeated
`signalUiReady()` calls, such as React StrictMode's double effect in dev, emit
nothing after the first emit attempt.

## Library

Sources are bundled at build time with Vite `import.meta.glob(…)`, using the
options `{ query: "?raw", import: "default", eager: true }`:

- group `samples`: `samples/*.cho`;
- group `test-songs`: `packages/test-fixtures/fixtures/*.cho`.

Groups appear in that order. Only `.cho` files are kept; `.canonical.cho` files
are excluded. Songs inside a group sort by `fileName` in UTF-16 code-unit order.

- `fileName` is the source file's name including the `.cho` extension, without
  its directory. `baseName` is `fileName` without the trailing `.cho`.
- `id` is `${group}:${baseName}` (e.g. `samples:demo-shir-bilingual`,
  `test-songs:he_plain`).
- `title` is `song.title` when non-empty after trimming; otherwise the base
  name.
- `artist` is the first `meta` line named `artist` with a non-empty trimmed
  value; the field is absent otherwise.
- `song` and `diagnostics` come from `parseSong(source)`, which never throws.

Selection starts on the first song of the first non-empty group. When the
library is empty there is no selection, and the song pane shows only
`Select a song` (`noSongSelected`).

## Song pane

The header shows:

- the title `<h2 dir="auto">`;
- the artist when present (`dir="auto"`);
- the label `Key`, followed by `<span data-testid="sounding-key">`. When there
  is a sounding key, the span contains `<bdi dir="ltr">{key}</bdi>`; otherwise
  it contains the plain text `No key`, with no `bdi`;
- the label `Capo` followed by
  `<bdi dir="ltr" data-testid="capo-value">{capo}</bdi>`, where `capo` is the
  current capo (view state, the `capo-select` value), shown only when it
  is > 0.

Header alignment:

- The `<header>` carries `dir` equal to `firstStrongDirection(title)` from
  chord-core, and carries no `dir` when that returns `null`.
- Each header line (title, artist, key/capo line) sits at the header's
  inline-start edge and keeps its own text direction.
- The key/capo line is `dir="ltr"`. The title and artist keep `dir="auto"`.

Then come the view controls, the diagnostics panel when there are diagnostics,
and `SongView` with the viewed song.

## View controls

- A visible `Transpose` label, then transpose −1/+1 buttons (aria-labels
  `Transpose down` / `Transpose up`). The buttons show `transposeDownGlyph` and
  `transposeUpGlyph`. The current signed value is shown as `0`, `+2` or `-3`,
  clamped to −11..+11 (the button at a limit is `disabled`).
- A capo `<select>` labelled `Capo` (a `<label>` bound to the select), with
  options 0–12, plus the song's own capo when it is above 12 (integer only, at
  most 24), initialised to `song.capo ?? 0`.
- The sounding key (`viewSong(...).soundingKey`) appears only in the song header
  (`sounding-key`, label `Key`); the controls show `Shapes` with
  `viewSong(...).shapeKey` (`shape-key`) only when it is defined. Both values
  sit in `<bdi dir="ltr">` (B1/B8).
- `Reset` sets transpose 0 and capo to the song's capo.

Selecting another song applies the same reset. The rendered song is
`viewSong(song, { transpose, capo }).song`. The library `song` is never mutated.

## Components

Each component lives at `apps/desktop/src/components/<Name>.tsx`.

- `SongList`: groups render in `SongGroup` order with their group label, and
  empty groups are omitted. Each song is a `<button type="button">` showing the
  title (`dir="auto"`) and, when present, the artist (`dir="auto"`). Group
  labels: `samples` → `Samples`, `test-songs` → `Test songs`.
- `SongHeader`: shows the title, artist, key and capo as described in
  § Song pane.
- `ViewControls`: it calls back with the clamped next value and never with a
  value outside −11..+11.
- `DiagnosticsPanel`: it renders `null` for an empty array.
- `capoOptions(songCapo: number | undefined): number[]` is exported from
  `apps/desktop/src/library.ts` as a pure helper. It returns `0..12` ascending,
  plus `songCapo` appended when it is an integer in 13..24.

Props:

```ts
SongList { songs: readonly LibrarySong[]; selectedId: string | undefined;
  onSelect(id: string): void }
SongHeader { title: string; artist?: string; soundingKey?: string;
  capo: number }
ViewControls { transpose: number; capo: number;
  capoOptions: readonly number[]; shapeKey?: string;
  onTranspose(next: number): void; onCapo(next: number): void;
  onReset(): void }
DiagnosticsPanel { diagnostics: readonly Diagnostic[] }
```

## Diagnostics panel

The list is the parse diagnostics followed by the view diagnostics. Each item
reads `` `${line}:${column} ${message}` `` in `<bdi dir="ltr">` for the
coordinates and `dir="auto"` for the message. The heading renders as
`{diagnostics} {separator} {diagnosticsCount(n)}` (for example
`Diagnostics · 2 problems`). The panel is absent when n = 0.

Coordinates have two meanings:

- Parse diagnostics give the 1-based source line and source column.
- View diagnostics (`unknown-chord` from `viewSong`) give the 1-based index of
  the line in the parsed song model and the 1-based position of the chord
  within that line (the `i + 1, j + 1` arguments in
  `packages/chord-core/src/transpose.ts`).

## Test ids

| Test id              | Element                 | Meaning                                                          |
| -------------------- | ----------------------- | ---------------------------------------------------------------- |
| `song-list`          | `<nav>`                 | The song list                                                    |
| `song-item`          | song `<button>`         | One per song; `aria-current="true"` on the selected one          |
| `song-header`        | header container        | Song pane header                                                 |
| `song-title`         | `<h2>`                  | Song title                                                       |
| `song-artist`        | artist element          | Song artist, present only when the song has one                  |
| `sounding-key`       | `<span>`                | Sounding key (`<bdi dir="ltr">`) or the `No key` text            |
| `shape-key`          | `<bdi>`                 | Shape key in the controls, present only when defined             |
| `capo-value`         | header capo display     | Current capo (view state), shown only when > 0                   |
| `transpose-down`     | `<button>`              | Transpose down by one semitone                                   |
| `transpose-up`       | `<button>`              | Transpose up by one semitone                                     |
| `transpose-value`    | value element           | Current signed transpose (`0`, `+2`, `-3`)                       |
| `capo-select`        | `<select>`              | Capo choice                                                      |
| `reset-view`         | `<button>`              | Resets transpose to 0 and capo to the song's capo                |
| `diagnostics`        | diagnostics panel       | The diagnostics panel, absent when there are no diagnostics      |
| `diagnostic-item`    | list item               | One per diagnostic                                               |
| `song-pane`          | `<main>`                | The song pane                                                    |
| `search-input`       | `<input type="search">` | The sidebar search box (disabled in bundled mode)                |
| `search-empty`       | `<p>`                   | Shown when a search has zero hits                                |
| `search-unavailable` | `<p>`                   | Notice shown in bundled mode: search is unavailable              |
| `song-snippet`       | `<span>`                | Lyric line of a search hit, rendered as text, only when non-null |
| `song-index`         | `<ul>`                  | The `SongIndex` list of all DB songs, sorted by title            |
| `search-results`     | `<ul>`                  | The `SongIndex` list holding the ranked search hits              |

## Strings

| Key                  | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| `appName`            | `Shir`                                                                             |
| `appNameHebrew`      | `שיר`                                                                              |
| `groupSamples`       | `Samples`                                                                          |
| `groupTestSongs`     | `Test songs`                                                                       |
| `songList`           | `Songs`                                                                            |
| `transpose`          | `Transpose`                                                                        |
| `transposeDown`      | `Transpose down`                                                                   |
| `transposeUp`        | `Transpose up`                                                                     |
| `capo`               | `Capo`                                                                             |
| `reset`              | `Reset`                                                                            |
| `key`                | `Key`                                                                              |
| `shapes`             | `Shapes`                                                                           |
| `diagnostics`        | `Diagnostics`                                                                      |
| `noSongSelected`     | `Select a song`                                                                    |
| `searchLabel`        | `Search songs`                                                                     |
| `searchPlaceholder`  | `Search title, artist or lyrics`                                                   |
| `searchResults`      | `Search results`                                                                   |
| `noResults`          | `No songs match`                                                                   |
| `searchFailed`       | `Search failed`                                                                    |
| `searchUnavailable`  | `Search unavailable: the song library could not be opened. Showing bundled songs.` |
| `loadingLibrary`     | `Loading songs…`                                                                   |
| `libraryEmpty`       | `No songs in the library`                                                          |
| `songLoadFailed`     | `Could not open this song`                                                         |
| `noKey`              | `No key`                                                                           |
| `separator`          | `·`                                                                                |
| `transposeDownGlyph` | `−`                                                                                |
| `transposeUpGlyph`   | `+`                                                                                |

`diagnosticsCount(n: number): string` returns `1 problem` for n = 1 and
`${n} problems` otherwise.

## Out of scope

- Opening, importing or saving files. The storage commands and the
  `apps/desktop/src/storage.ts` client exist (see `docs/DATA_MODEL.md`), but the
  viewer does not call them yet.
- TanStack Router, Zustand, i18next and a Hebrew UI locale (planned G7).
- Persistence of the last song or view settings.
- Chord diagrams (G3).
- Print layout.
