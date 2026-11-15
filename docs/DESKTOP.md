# Desktop song viewer

Normative spec for the desktop song viewer. Code lives in `apps/desktop/src/`;
all UI strings live in `apps/desktop/src/strings.ts`.

## Layout

Two panes. The song list (`<nav>`, accessible name `Songs`) sits on the
inline-start side under the app heading `<h1>`, rendered as
`Shir · <bdi lang="he">שיר</bdi>`. The song pane is `<main>`.

- App chrome is `lang="en" dir="ltr"`, taken from `apps/desktop/index.html` (B8).
- CSS uses logical properties only.
- The production CSP `style-src 'self'` forbids `<style>` elements, `style="…"`
  attribute strings and `dangerouslySetInnerHTML`.
- The `<nav>`, the view controls and the diagnostics panel carry the
  `data-ui-chrome` attribute, so the existing print CSS (`docs/BIDI.md` § Print
  CSS) hides them.

## Library

Sources are bundled at build time with Vite `import.meta.glob(…, { query: "?raw", import: "default", eager: true })`:

- group `samples`: `samples/*.cho`;
- group `test-songs`: `packages/test-fixtures/fixtures/*.cho`.

Groups appear in that order. Only `.cho` files are kept; `.canonical.cho` files
are excluded. Songs inside a group sort by `fileName` in UTF-16 code-unit order.

- `id` is `${group}:${baseName}` (e.g. `samples:demo-shir-bilingual`,
  `test-songs:he_plain`).
- `title` is `song.title` when non-empty after trimming; otherwise the base name.
- `artist` is the first `meta` line named `artist` with a non-empty trimmed
  value; the field is absent otherwise.
- `song` and `diagnostics` come from `parseSong(source)`, which never throws.

Selection starts on the first song of the first non-empty group.

## Song pane

The header shows:

- the title `<h2 dir="auto">`;
- the artist when present (`dir="auto"`);
- the label `Key`, followed by `<span data-testid="sounding-key">`. When there is
  a sounding key, the span contains `<bdi dir="ltr">{key}</bdi>`; otherwise it
  contains the plain text `No key`, with no `bdi`;
- the label `Capo` followed by `<bdi dir="ltr" data-testid="capo-value">{capo}</bdi>`, where `capo` is the current capo (view state, the `capo-select` value), shown only when it is > 0.

Then come the view controls, the diagnostics panel when there are diagnostics,
and `SongView` with the viewed song.

## View controls

- A visible `Transpose` label, then transpose −1/+1 buttons (aria-labels `Transpose down` / `Transpose up`), with the current signed value shown as `0`, `+2` or
  `-3`, clamped to −11..+11 (the button at a limit is `disabled`).
- A capo `<select>` labelled `Capo` (a `<label>` bound to the select), with options 0–12, plus the song's own capo when it is above
  12 (integer only, at most 24), initialised to `song.capo ?? 0`.
- The sounding key (`viewSong(...).soundingKey`) appears only in the song header
  (`sounding-key`, label `Key`); the controls show `Shapes` with
  `viewSong(...).shapeKey` (`shape-key`) only when it is defined. Both values sit
  in `<bdi dir="ltr">` (B1/B8).
- `Reset` sets transpose 0 and capo to the song's capo.

Selecting another song applies the same reset. The rendered song is
`viewSong(song, { transpose, capo }).song`. The library `song` is never mutated.

## Components

Each component lives at `apps/desktop/src/components/<Name>.tsx`.

- `SongList { songs: readonly LibrarySong[]; selectedId: string | undefined; onSelect(id: string): void }`:
  groups render in `SongGroup` order with their group label, and empty groups are
  omitted. Each song is a `<button type="button">` showing the title
  (`dir="auto"`) and, when present, the artist (`dir="auto"`). Group labels: `samples` → `Samples`, `test-songs` → `Test songs`.
- `SongHeader { title: string; artist?: string; soundingKey?: string; capo: number }`.
- `ViewControls { transpose: number; capo: number; capoOptions: readonly number[]; shapeKey?: string; onTranspose(next: number): void; onCapo(next: number): void; onReset(): void }`:
  it calls back with the clamped next value and never with a value outside
  −11..+11.
- `DiagnosticsPanel { diagnostics: readonly Diagnostic[] }`: it renders `null`
  for an empty array.
- `capoOptions(songCapo: number | undefined): number[]` is exported from
  `apps/desktop/src/library.ts` as a pure helper. It returns `0..12` ascending,
  plus `songCapo` appended when it is an integer in 13..24.

## Diagnostics panel

The list is the parse diagnostics followed by the view diagnostics. Each item
reads `` `${line}:${column} ${message}` `` in `<bdi dir="ltr">` for the
coordinates and `dir="auto"` for the message. The heading shows `Diagnostics`
and `diagnosticsCount(n)`. The panel is absent when n = 0.

## Test ids

| Test id           | Element             | Meaning                                                     |
| ----------------- | ------------------- | ----------------------------------------------------------- |
| `song-list`       | `<nav>`             | The song list                                               |
| `song-item`       | song `<button>`     | One per song; `aria-current="true"` on the selected one     |
| `song-header`     | header container    | Song pane header                                            |
| `song-title`      | `<h2>`              | Song title                                                  |
| `song-artist`     | artist element      | Song artist, present only when the song has one             |
| `sounding-key`    | `<span>`            | Sounding key (`<bdi dir="ltr">`) or the `No key` text       |
| `shape-key`       | `<bdi>`             | Shape key in the controls, present only when defined        |
| `capo-value`      | header capo display | Current capo (view state), shown only when > 0              |
| `transpose-down`  | `<button>`          | Transpose down by one semitone                              |
| `transpose-up`    | `<button>`          | Transpose up by one semitone                                |
| `transpose-value` | value element       | Current signed transpose (`0`, `+2`, `-3`)                  |
| `capo-select`     | `<select>`          | Capo choice                                                 |
| `reset-view`      | `<button>`          | Resets transpose to 0 and capo to the song's capo           |
| `diagnostics`     | diagnostics panel   | The diagnostics panel, absent when there are no diagnostics |
| `diagnostic-item` | list item           | One per diagnostic                                          |
| `song-pane`       | `<main>`            | The song pane                                               |

## Strings

| Key              | Value            |
| ---------------- | ---------------- |
| `appName`        | `Shir`           |
| `appNameHebrew`  | `שיר`            |
| `groupSamples`   | `Samples`        |
| `groupTestSongs` | `Test songs`     |
| `songList`       | `Songs`          |
| `transpose`      | `Transpose`      |
| `transposeDown`  | `Transpose down` |
| `transposeUp`    | `Transpose up`   |
| `capo`           | `Capo`           |
| `reset`          | `Reset`          |
| `key`            | `Key`            |
| `shapes`         | `Shapes`         |
| `diagnostics`    | `Diagnostics`    |
| `noSongSelected` | `Select a song`  |
| `noKey`          | `No key`         |

`diagnosticsCount(n: number): string` returns `1 problem` for n = 1 and
`${n} problems` otherwise.

## Out of scope

- Opening, importing or saving files, because Tauri commands need tauri-specta
  bindings (planned G4).
- TanStack Router, Zustand, i18next and a Hebrew UI locale (planned G7).
- Persistence of the last song or view settings.
- No npm or Rust dependency changes and no change under `apps/desktop/src-tauri/`.
- Chord diagrams (G3).
- Print layout.
