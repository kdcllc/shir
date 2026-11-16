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
- The app heading `<h1>`, the `<nav>`, the search box, the search status
  element, the search-unavailable
  notice, the loading text, the view controls and the diagnostics panel carry
  the `data-ui-chrome` attribute, so the existing print CSS
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

The sidebar lists the songs stored in the database (`listSongs`), ordered by
title with `Intl.Collator(["he", "en"])` (sensitivity `base`, numeric), ties
broken by `id`, as one flat list with no group headings. Selecting a song loads
it with `getSong` and parses it with `parseSong`.

The bundled library described below is only the read-only fallback, used when
`listSongs` fails: the sidebar then shows the `searchUnavailable` notice and the
search box is disabled.

Bundled sources are loaded at build time with Vite `import.meta.glob(…)`, using
the options `{ query: "?raw", import: "default", eager: true }`:

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

In database mode, selection starts on the first title-sorted song whose title
equals the title of the bundled fallback's first song
(`samples/demo-shir-bilingual.cho`); otherwise on the first title-sorted song. In the
bundled fallback it starts on the first song of the first non-empty group. When
the library is empty there is no selection, and the song pane shows only
`Select a song` (`noSongSelected`).

Loading state (before database mode): while `listSongs` is pending, the sidebar
shows `loadingLibrary` and the pane shows `noSongSelected`.

Database-mode states:

- An empty database list shows `libraryEmpty`.
- Once the search for a non-blank (trimmed) query completes, the results list
  (`search-results`), `search-empty` or the `searchFailed` alert replaces the
  library. During the debounce and the first in-flight request the library stays
  visible, and while a newer search loads the previous results stay. Clearing
  the box, pressing Esc or typing a whitespace-only query restores the library.
- A persistent status element (`search-pending`, `role="status"`, carrying
  `data-ui-chrome`) sits between the search box and the `<nav>` in database mode
  only. It shows `searching` while a non-blank query is pending (debouncing or
  loading) and is empty otherwise. While a query is pending, a shown results
  list carries `aria-busy="true"` and keeps the previous results; on the first
  in-flight request the library stays
  visible and only the status text appears.
- A `getSong` failure shows the `songLoadFailed` alert in the pane.

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

- `SearchBox`: an `<input type="search" dir="auto">` carrying `data-ui-chrome`.
  Esc clears it, and it is disabled in the bundled fallback.
- `SongIndex` (`variant: "library" | "results"`): renders the `song-index`
  (library) or `search-results` (results) list. Each row shows the title and,
  when present, the artist and the snippet (search hits only), each with
  `dir="auto"`; the snippet renders as text only. The optional `busy` prop sets
  `aria-busy="true"` on the `search-results` list; the `library` list never
  carries it.
- `songSource` (`apps/desktop/src/songSource.ts`): `sortByTitle` orders
  summaries as described in § Library. `createDebouncedSearch` waits 150 ms by
  default and trims the query; an empty or whitespace-only query goes idle with
  no call. Stale responses and stale errors are dropped. A current error becomes
  `{status:"error"}`, which `App` shows as the `searchFailed` alert.
- `SongList` (bundled fallback only): groups render in `SongGroup` order with
  their group label, and empty groups are omitted. Each song is a
  `<button type="button">` showing the
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
SearchBox { value: string; disabled?: boolean; onChange(next: string): void }
SongIndexItem { id: string; title: string; artist?: string | null | undefined;
  snippet?: string | null | undefined }
SongIndex { items: readonly SongIndexItem[]; selectedId: string | undefined;
  variant: "library" | "results"; busy?: boolean | undefined;
  onSelect(id: string): void }
SongHeader { title: string; artist?: string; soundingKey?: string;
  capo: number }
ViewControls { transpose: number; capo: number;
  capoOptions: readonly number[]; shapeKey?: string;
  onTranspose(next: number): void; onCapo(next: number): void;
  onReset(): void }
DiagnosticsPanel { diagnostics: readonly Diagnostic[] }
```

## Webview errors

`apps/desktop/src/main.tsx` installs `installWebviewErrorForwarder(window,
logWebviewError)` before rendering, in every build. It forwards window `error`
events, `unhandledrejection` events and `console.error` calls (the original
`console.error` still runs) through `logWebviewError` in `storage.ts`, which
never rejects. The native side writes each one to stderr as
`shir: webview: <text>`. The forwarder never throws, ignores an error raised
while it is itself forwarding (on the same call stack), and includes the error
message even when a JavaScriptCore stack omits it.

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

| Test id               | Element                    | Meaning                                                          |
| --------------------- | -------------------------- | ---------------------------------------------------------------- |
| `song-list`           | `<nav>`                    | The song list                                                    |
| `song-item`           | song `<button>`            | One per song; `aria-current="true"` on the selected one          |
| `song-header`         | header container           | Song pane header                                                 |
| `song-title`          | `<h2>`                     | Song title                                                       |
| `song-artist`         | artist element             | Song artist, present only when the song has one                  |
| `sounding-key`        | `<span>`                   | Sounding key (`<bdi dir="ltr">`) or the `No key` text            |
| `shape-key`           | `<bdi>`                    | Shape key in the controls, present only when defined             |
| `capo-value`          | header capo display        | Current capo (view state), shown only when > 0                   |
| `transpose-down`      | `<button>`                 | Transpose down by one semitone                                   |
| `transpose-up`        | `<button>`                 | Transpose up by one semitone                                     |
| `transpose-value`     | value element              | Current signed transpose (`0`, `+2`, `-3`)                       |
| `capo-select`         | `<select>`                 | Capo choice                                                      |
| `reset-view`          | `<button>`                 | Resets transpose to 0 and capo to the song's capo                |
| `diagnostics`         | diagnostics panel          | The diagnostics panel, absent when there are no diagnostics      |
| `diagnostic-item`     | list item                  | One per diagnostic                                               |
| `song-pane`           | `<main>`                   | The song pane                                                    |
| `search-input`        | `<input type="search">`    | The sidebar search box (disabled in bundled mode)                |
| `search-empty`        | `<p>`                      | Shown when a search has zero hits                                |
| `search-unavailable`  | `<p>`                      | Notice shown in bundled mode: search is unavailable              |
| `song-snippet`        | `<span>`                   | Lyric line of a search hit, rendered as text, only when non-null |
| `song-index`          | `<ul>`                     | The `SongIndex` list of all DB songs, sorted by title            |
| `search-results`      | `<ul>`                     | The `SongIndex` list holding the ranked search hits              |
| `search-pending`      | `<p role="status">`        | Live region: `Searching…` while a query is pending, else empty   |
| `new-song`            | `<button>`                 | Sidebar: opens an empty editor (database mode only)              |
| `open-files`          | `<button>`                 | Sidebar: picks song files and imports them (database mode only)  |
| `import-report`       | `<section>`                | Sidebar summary of the last file import                          |
| `import-summary`      | `<p role="status">`        | `Imported N of M files` (saved files only)                       |
| `import-queued`       | `<p role="status">`        | `N files need alignment review`, only when files are queued      |
| `import-converted`    | `<div>`                    | File names of converted `.txt` files that were saved at once     |
| `import-skipped`      | `<div>`                    | File names of queued files skipped without saving                |
| `import-failed`       | `<p role="alert">`         | One per failed file: file name and error message                 |
| `app-notice`          | `<p role="alert">`         | Sidebar error: file dialog, edit load or list refresh failure    |
| `edit-song`           | `<button>`                 | Next to the song header: opens the selected song in the editor   |
| `editor`              | `<section>`                | The editor pane (replaces the song view while editing)           |
| `reviewing-file`      | `<p>`                      | Name of the queued file under review, only for queued files      |
| `editor-save`         | `<button>`                 | Saves the text; disabled while saving                            |
| `editor-cancel`       | `<button>`                 | Cancels the editor (skips a queued file)                         |
| `editor-paste`        | `<button>`                 | Reads the clipboard and converts it through the importer         |
| `editor-convert`      | `<button>`                 | Converts the current text through the importer                   |
| `editor-flip`         | `<button>`                 | Flip alignment, only after an import with RTL chords             |
| `editor-status`       | `<p role="status">`        | Live region: `Already ChordPro` message, else empty              |
| `editor-paste-error`  | `<p role="alert">`         | Shown when the clipboard cannot be read                          |
| `editor-save-error`   | `<p role="alert">`         | Shown when saving failed, with the error message                 |
| `import-warnings`     | `<section>`                | The list of import warnings                                      |
| `import-warning`      | list item                  | One per import warning, with its line number                     |
| `editor-input`        | `<textarea dir="auto">`    | The ChordPro text area                                           |
| `editor-preview`      | `<div role="region">`      | Live preview rendered by `SongView` after a 300 ms debounce      |
| `confirm-discard`     | `<div role="alertdialog">` | Unsaved-changes confirmation dialog                              |
| `confirm-keep`        | `<button>`                 | Keep editing                                                     |
| `confirm-discard-yes` | `<button>`                 | Discard the changes and continue                                 |

## Strings

| Key                   | Value                                                                              |
| --------------------- | ---------------------------------------------------------------------------------- |
| `appName`             | `Shir`                                                                             |
| `appNameHebrew`       | `שיר`                                                                              |
| `groupSamples`        | `Samples`                                                                          |
| `groupTestSongs`      | `Test songs`                                                                       |
| `songList`            | `Songs`                                                                            |
| `transpose`           | `Transpose`                                                                        |
| `transposeDown`       | `Transpose down`                                                                   |
| `transposeUp`         | `Transpose up`                                                                     |
| `capo`                | `Capo`                                                                             |
| `reset`               | `Reset`                                                                            |
| `key`                 | `Key`                                                                              |
| `shapes`              | `Shapes`                                                                           |
| `diagnostics`         | `Diagnostics`                                                                      |
| `noSongSelected`      | `Select a song`                                                                    |
| `searchLabel`         | `Search songs`                                                                     |
| `searchPlaceholder`   | `Search title, artist or lyrics`                                                   |
| `searchResults`       | `Search results`                                                                   |
| `noResults`           | `No songs match`                                                                   |
| `searchFailed`        | `Search failed`                                                                    |
| `searchUnavailable`   | `Search unavailable: the song library could not be opened. Showing bundled songs.` |
| `loadingLibrary`      | `Loading songs…`                                                                   |
| `searching`           | `Searching…`                                                                       |
| `libraryEmpty`        | `No songs in the library`                                                          |
| `songLoadFailed`      | `Could not open this song`                                                         |
| `noKey`               | `No key`                                                                           |
| `separator`           | `·`                                                                                |
| `transposeDownGlyph`  | `−`                                                                                |
| `transposeUpGlyph`    | `+`                                                                                |
| `newSong`             | `New song`                                                                         |
| `editSong`            | `Edit`                                                                             |
| `openFiles`           | `Open files…`                                                                      |
| `editorLabel`         | `ChordPro text`                                                                    |
| `previewLabel`        | `Preview`                                                                          |
| `save`                | `Save`                                                                             |
| `cancel`              | `Cancel`                                                                           |
| `paste`               | `Paste`                                                                            |
| `convert`             | `Convert`                                                                          |
| `flipAlignment`       | `Flip alignment`                                                                   |
| `alreadyChordPro`     | `Already ChordPro, nothing to convert`                                             |
| `pasteFailed`         | `Could not read the clipboard. Paste with Ctrl+V, then use Convert.`               |
| `importWarnings`      | `Import warnings`                                                                  |
| `saveFailed`          | `Could not save the song`                                                          |
| `discardTitle`        | `Discard unsaved changes?`                                                         |
| `discardBody`         | `Your changes to this song have not been saved.`                                   |
| `keepEditing`         | `Keep editing`                                                                     |
| `discard`             | `Discard`                                                                          |
| `reviewingFile`       | `Reviewing file`                                                                   |
| `importConverted`     | `Converted from chords over lyrics`                                                |
| `importSkipped`       | `Skipped files`                                                                    |
| `importPickFailed`    | `Could not open files`                                                             |
| `libraryReloadFailed` | `Could not refresh the song list`                                                  |

`diagnosticsCount(n: number): string` returns `1 problem` for n = 1 and
`${n} problems` otherwise.

## Out of scope

- Opening files, importing, editing, saving and deleting songs.
- TanStack Router, Zustand, i18next and a Hebrew UI locale (planned G7).
- Persistence of the last song or view settings.
- Chord diagrams (G3).
- Print layout.
