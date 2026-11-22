# Desktop song viewer

Normative spec for the desktop song viewer. Code lives in `apps/desktop/src/`;
all UI strings come from i18next resources (`apps/desktop/src/i18n/`): the
English source is `STRINGS` and `TEMPLATES` in `apps/desktop/src/strings.ts`,
and the Hebrew resource is `apps/desktop/src/i18n/he.ts`.

## Layout

Two panes. The song list (`<nav>`, accessible name `Songs`) sits on the
inline-start side under the app heading `<h1>`, rendered as
`{appName} {separator} <bdi lang="he">{appNameHebrew}</bdi>`, which shows as
`Shir · שיר`. In database mode a Songs / Setlists switch (`SidebarTabs`) sits
under the heading; the Setlists view shows `SetlistsPanel` in the sidebar and
`SetlistEditor` in the song pane (§ Setlists view). The song pane is `<main>`. While the editor is open (database
mode only), it replaces the song view in the song pane (see § Editor and
import).

- App chrome starts as `lang="en" dir="ltr"` from `apps/desktop/index.html`
  (B8); the interface language is then set at startup from the stored or
  system locale.
- The sidebar heading row holds the `<h1>` and the language toggle
  (`locale-toggle`: an `עב` / `EN` button pair in a `role="group"` named
  `uiLanguage`, the current language `aria-pressed="true"`). The row wraps at
  the 12rem minimum sidebar width. Clicking the other language switches the
  interface at once, stores `shir.locale`, and sets `<html lang dir>`
  (`he` / `rtl`, `en` / `ltr`).
- Mirroring comes only from the document direction plus logical CSS: in Hebrew
  the sidebar sits on the right of the song pane with its border on the
  inline-end side. There is no `scaleX(-1)`, no `direction:` override and no
  `:lang()` selector; the Hebrew chrome font stack (`"Noto Sans Hebrew"`,
  `heebo`, then the system stack) is applied by `html[lang="he"]`. Songs keep
  their own direction (`SongView` root and lines, B1–B8), user-text inputs keep
  `dir="auto"`, and chord names, diagrams and the `−` `+` `←` `→` glyphs are
  not mirrored.
- CSS uses logical properties only.
- The production CSP `style-src 'self'` forbids `<style>` elements and
  `style="…"` attribute strings. `dangerouslySetInnerHTML` is banned separately
  by project rule. In dev, `devCsp` in `apps/desktop/src-tauri/tauri.conf.json`
  replaces `csp`; Tauri sends it only with pages served through its `tauri://`
  protocol, so the pages the Vite dev server serves at `devUrl` get no CSP
  from Tauri.
- The app heading `<h1>`, the `<nav>`, the search box, the search status
  element, the search-unavailable notice, the loading text, the view controls,
  the diagnostics panel, the New song / Open files / Import with AI actions, the
  import report, the app notice, the Edit button, the editor toolbar, status,
  labels and alerts, the reviewing-file line, the import warnings, the notes
  section of a document under review, the discard dialog and the Import with AI
  dialog carry the `data-ui-chrome` attribute, so the existing print CSS
  (`docs/BIDI.md` § Print CSS) hides them. So do the selection bar, the row
  checkbox and the row delete button, the delete status, the header delete
  button, the delete dialog, the editor tabs, the song-details form, the chord
  picker, the section controls and the visual editor's row buttons, inputs,
  hint and footer. The setlist surfaces carry it too: the Songs / Setlists
  switch, the setlists panel and its rows, the setlist editor's export buttons
  and entries, the add-to-setlist and delete-setlist dialogs, the open song's
  Add to setlist, Print, Export PDF and Export Word buttons with their PDF hint,
  the setlist PDF hint and the app-status line.
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

The sidebar lists the songs stored in the database (`listSongs`) as one flat
list with no group headings, in the persisted sort order (default `title`) with
the persisted language filter applied (see Library controls below). The `title`
order uses `Intl.Collator(["he", "en"])` (sensitivity `base`, numeric), ties
broken by `id`. Selecting a song loads it with `getSong` and parses it with
`parseSong`.

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

Library controls (database mode only, `LibraryControls`, `data-ui-chrome`): a
`role="group"` named `libraryView` sits between the search status line and the
selection bar. It holds a native sort `<select>` (`library-sort`, label
`sortLabel`, options `title` / `artist` / `updated`) and a language filter, a
`role="radiogroup"` named `filterLanguage` with four `role="radio"` buttons
(`library-filter-all`, `-he`, `-en`, `-mixed`; exactly one `aria-checked`,
roving `tabIndex`). Arrow keys move and select within the group; ArrowLeft and
ArrowRight follow the visual order, so they swap under `dir="rtl"`. Both
choices are read once on mount and stored on every change with
`readLibraryPrefs` / `storeLibraryPrefs` (`libraryView.ts`, key `shir.library`).
The library list is `filterSummaries(sortSummaries(summaries, sort), language)`,
re-derived after a save, import or delete. Search results are filtered by
language only (`filterHits`) and keep relevance order; the sort never reorders
them. When the unfiltered list or hit list is non-empty but the filtered one is
empty, the sidebar shows `filter-empty` (`noFilterMatches`) instead of the list.
Each `SongIndex` row shows, after title and artist, the key (`song-row-key`,
`dir="ltr"`) when non-empty and a language badge (`song-language`, text
`badgeHebrew` / `badgeEnglish` / `badgeMixed`, `title` and accessible name
`filterHebrew` / `filterEnglish` / `filterMixed`). Select all selects only the
listed (filtered) rows. The bundled fallback has no controls.

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
- Delete controls: every row of the library and of the results list has a
  delete button (`song-delete`, showing `removeGlyph`, accessible name
  `deleteSongNamed`), and the `Delete` button (`delete-song`) next to
  `Edit` deletes the open song. While a delete is running these buttons, `Edit`
  (`edit-song`) and `Delete selected` are disabled.
- Select mode: the selection bar (`selection-bar`) sits between the search
  status and the delete status (`delete-status`), above the `<nav>`. `Select`
  (`select-songs`) enters select mode. In select mode the bar shows
  `selectedCount` (`selection-count`), `Select all` (`select-all`, adds the
  rows now listed: the search hits once a search has completed, or the listed
  (filtered) library rows while the library is shown, and nothing while the
  search error or the empty-result message is shown),
  `Add to setlist` (`add-selected-to-setlist`, disabled when nothing is
  selected; opens `AddToSetlistDialog` for the selected songs),
  `Delete selected` (`delete-selected`, disabled when nothing is selected) and
  `Done` (`select-done`, leaves select mode and clears the selection). Each row
  shows a checkbox (`song-check`, accessible name `selectSongNamed`)
  instead of its delete button, and clicking the row toggles the song instead
  of opening it.
- Every delete first opens `ConfirmDelete` (`confirm-delete`,
  `role="alertdialog"`). Its heading is `deleteConfirmTitle` for one song
  and `deleteManyTitle` for several, its body is `deleteConfirmBody`, and its
  buttons are `Cancel` (first) and `Delete`. Focus moves to the dialog when it
  opens and back to the previously focused element when it closes; Esc cancels.
  After any confirmed delete (row, header or bulk), when focus is left on the
  page body, it moves to the `song-item` button of the row now at the position
  the first deleted row had in the listed (filtered) rows (the last row when
  that was past the end, the same row when its delete failed), or to the search
  input when the list is empty or the deleted song was not listed (a header
  delete of a song the filter or the results hide). The request is cleared once
  applied, so a later re-render never moves focus again. Nothing is deleted
  before `Delete` is clicked. Deletion is permanent: there is
  no trash and no undo.
- An Edit whose `getSong` answers after the song was deleted, after another song
  was selected, or after a newer Edit started opens no editor; the late result
  is dropped silently. The set of ids deleted in this session is kept for the
  whole session: ids are UUIDv7 and never reused.
- A confirmed delete runs `deleteMany(ids, deleteSong)`
  (`apps/desktop/src/deleteSongs.ts`): one `deleteSong` call per id, one after
  another. A `NotFound` error counts as deleted; any other failure is collected
  and never stops the remaining ids.
- After a delete the list reloads with `listSongs`; when the reload fails, the
  deleted songs are removed from the shown list and the `app-notice` alert shows
  `libraryReloadFailed`. Shown search hits lose the deleted songs without a new
  search, a search response that arrives after a delete never shows a deleted
  song, and deleted songs leave the selection. `delete-status` shows
  `deletedCount`; it is emptied when the next delete dialog opens.
- When the open song was deleted, the next song among the listed (filtered)
  rows opens (otherwise the nearest earlier one); when none is left, or the open
  song was not among the listed rows, the selection is cleared.
  When the song being edited was deleted, the editor closes without the discard
  dialog.
- After a delete from select mode with no failure, the selection is cleared and
  select mode ends. When a delete fails, the `app-notice` alert shows
  `deleteFailed` (one song asked) or `deleteManyFailed` (several),
  followed by a colon and the first failure's message; select mode stays on, with
  the songs that failed still selected.

## Song pane

The header shows:

- the title `<h2 dir="auto">`;
- the artist when present (`dir="auto"`);
- the label `Key`, followed by `<span data-testid="sounding-key">`. When there
  is a sounding key, the span contains `<bdi dir="ltr">{key}</bdi>`; otherwise
  it contains the plain text `No key`, with no `bdi`. Without a sounding key the
  `Key` label and the span carry `data-ui-chrome`, so `No key` is not printed;
  with a key neither does, and the key prints;
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

The header actions (`data-ui-chrome`) hold, in database mode, `Edit`, `Delete`
and `Add to setlist` (`song-add-to-setlist`, opens `AddToSetlistDialog` for the
open song), and in both modes `Print`, `Export PDF`, `Export Word` and the
`pdfHint` text (`song-pdf-hint`). The three export buttons are disabled while a
setlist call or export is running.

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

## Setlists view

Database mode only. The `SidebarTabs` switch chooses between the Songs view
(search, library controls and song list) and the Setlists view. In the Setlists
view the sidebar shows `SetlistsPanel`; opening a setlist shows `SetlistEditor`
in the song pane, with the `pdfHint` text (`setlist-pdf-hint`) above it (§
Components, Setlists). `App` owns the state and runs one setlist call or export
at a time; a failed setlist call leaves the state as it was and shows an
`app-notice` alert.

- Add to setlist: `AddToSetlistDialog` adds the open song (header) or the
  selected songs (select mode, in library order) to an existing setlist or to a
  newly created one. After a successful add the `app-status` line (`role="status"`,
  `data-ui-chrome`, shown in database and bundled mode) shows `addedToSetlist`.
- Opening an entry (the entry's title button) opens its song in the Songs view
  at that entry's transpose and capo, found by the entry's item id, so a song
  that appears twice opens at the entry clicked.
- Print, Export PDF and Export Word on the open setlist export a cover page plus
  one song per page; the entries use their own transpose and capo, and a `null`
  capo falls back to the song's own capo, then 0
  (`apps/desktop/src/setlists.ts`, `entriesToExport`).

`apps/desktop/src/setlists.ts` also exports `moveItem` (one-place reorder that
ignores a move past either end), `duplicateName` (name, a space and the suffix,
cut on a grapheme boundary to at most 200 characters) and `songToExport`.

## Print and export

Available in both database and bundled modes for the open song, and in database
mode for the open setlist. Both go through the shared document model of
chord-core (`buildExportDocument`, `buildExportSong`, `directionalCells`;
`packages/chord-core/src/export.ts`). The open song exports at its current
transpose and capo, without a cover page, under the song's title. A failure
shows the `exportFailed` alert in `app-notice`.

- Print and Export PDF (`apps/desktop/src/export/printExport.ts`): both open
  the webview's print dialog; Export PDF additionally sets `document.title` to
  the export file name (without extension) while the dialog is open, so the
  dialog proposes it, and the `pdfHint` text tells the user to choose "Save as
  PDF". `printExport` mounts `PrintDocument` (`data-print-root`) appended to
  `<body>`, laid out off-screen at 180 mm (A4 minus 15 mm margins) so that
  chord-render's overlap pass runs, sets `:root[data-printing="export"]`, waits for the fonts, the overlap pass (2 s cap) and two animation frames, and calls `window.print()`. The print CSS hides `#root`, shows the print root,
  starts every song on a new page (`break-before: page`) and sets
  `@page { size: A4; margin: 15mm }`, which is global. Cleanup runs on
  `afterprint` or, for webviews that never fire it, on the first pointer or key
  input after `print()` returned.
- Export Word (`apps/desktop/src/export/docx.ts`, `buildDocx`; `saveDocx.ts`):
  a cover page (setlist only) and one song per page. Lyric lines with at least one chord are borderless
  two-row tables of single-direction cells from `directionalCells`; RTL tables
  are `w:bidiVisual` with the table right-aligned, and cell groups of the
  opposite direction are reversed as whole cells, never as strings. `w:bidi` /
  `w:rtl` are set only on RTL lyric cells inside those tables; chord paragraphs
  are never bidi (B1) and sit right-aligned in RTL cells; a chord-only line is
  a one-row table in the song direction (B6). Outside those tables a paragraph is bidirectional / right-to-left when its own direction is RTL: a section label takes the song direction, a comment the first strong direction of its text, a chordless lyric line its line direction, and the setlist cover the interface language's direction (`ExportMeta.dir`). Column widths come from Liberation Sans advance widths
  (`fontMetrics.ts`) times 1.1 plus 60 twips, scaled down proportionally only
  when the sum exceeds 9638 twips (`columnWidths.ts`).
- `exportFileName(title, ext)` (`fileName.ts`) replaces forbidden characters
  with `-`, collapses whitespace, caps the name at 100 graphemes and falls back
  to `setlist`.
- `saveDocx` builds the file and calls `saveExportDocx(defaultName, filterName,
bytes)` from `files.ts`. The native save dialog opens in the backend; the
  webview never supplies a path. It resolves the saved path, or `null` when the
  user cancels (no status is shown then). A failure throws `FileWriteError`
  whose `kind` is `Invalid` (the backend refused the payload), `Io` or `"Ipc"`;
  the read path (`readTextFile`, § Editor and import) keeps its own list. After
  a save, `app-status` shows `exportSaved` with the file's base name.
- The `apps/desktop/src/export/index.ts` module exports `PrintDocument`,
  `printExport`, `buildDocx`, `exportFileName`, `saveDocx` and the
  `ExportLabels` / `ExportMeta` types.

## Components

Each component lives at `apps/desktop/src/components/<Name>.tsx`.

- `SearchBox`: an `<input type="search" dir="auto">` carrying `data-ui-chrome`.
  Esc clears it, and it is disabled in the bundled fallback.
- `LibraryControls`: the sort `<select>` and language radio group described in
  § Library (`apps/desktop/src/components/LibraryControls.tsx`).
- `LocaleToggle`: the interface-language toggle of § Layout
  (`apps/desktop/src/components/LocaleToggle.tsx`), which reads the current
  language and switches it through `useLocale`.
- `SongIndex` (`variant: "library" | "results"`): renders the `song-index`
  (library) or `search-results` (results) list. Each row shows the title and,
  when present, the artist and the snippet (search hits only), each with
  `dir="auto"`; the snippet renders as text only. The optional `busy` prop sets
  `aria-busy="true"` on the `search-results` list; the `library` list never
  carries it. The optional `onDelete` prop adds the `song-delete` button to
  every row, and `deleteDisabled` disables those buttons. With `selecting`, each
  row shows the `song-check` checkbox (checked when `selected` has the row's
  id) and no delete button, and a click on the row or the checkbox calls
  `onToggle` instead of `onSelect`. The optional `focusIndex` and `focusRef`
  props attach `focusRef` to the main button (`song-item`) of the row at
  `focusIndex`, so that the owner can focus it.
- `SelectionBar`: the `selection-bar` element. It shows `Select` outside select
  mode and the count, `Select all`, `Delete selected` and `Done` in select mode
  (see § Library) and, in select mode, `Add to setlist`
  (`add-selected-to-setlist`, disabled when `count` is 0). `Delete selected` is
  disabled when `count` is 0 or `busy` is set. The optional `startRef` receives the `Select` button, so that the owner
  can focus it.
- `ConfirmDelete`: the delete confirmation dialog described in § Library. It
  never uses `window.confirm`.
- `useDialogFocus(onCancel)` (`apps/desktop/src/components/useDialogFocus.ts`):
  the focus handling shared by `ConfirmDiscard` and `ConfirmDelete`. Focus moves
  to the dialog on mount and back to the previously focused element on unmount,
  `Escape` calls `onCancel`, and `Tab` / `Shift+Tab` cycle between the first and
  the last button.
- `deleteMany` (`apps/desktop/src/deleteSongs.ts`): removes each distinct id
  once, in the given order, and resolves to
  `{ deleted: string[]; failed: { id: string; message: string }[] }`; it never
  rejects. The file also exports the `SongIdSet` type (`ReadonlySet<string>`).
- `songSource` (`apps/desktop/src/songSource.ts`): `sortByTitle` is the title
  order of § Library: `sortSummaries` uses it for the `title` sort, and the
  startup selection uses it. `createDebouncedSearch` waits 150 ms by
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
- `Editor` and `ConfirmDiscard`: see § Editor and import.
- `AiImportDialog`: the Import with AI dialog (§ Import with AI). It is
  controlled by `App`, which supplies `pickDocument` and `onImport` and so owns
  every IPC call; the dialog keeps only its own form state.
- `MetaForm`, `VisualEditor`, `ChordPicker` and `SectionControls`: the parts of
  the editor's Visual tab; see § Editor and import.
- `useDraft(value, commit)` (`apps/desktop/src/components/useDraft.ts`): the
  local draft of a text input, shared by `MetaForm` and `SectionControls`.
  Typing stays local, blur and Enter commit the trimmed draft once when it
  differs from `value`, Esc restores `value`, and an outside change of `value`
  replaces the draft.
- `useHistory(initial)` (`apps/desktop/src/useHistory.ts`): the undo/redo
  history of one text value, returning `value`, `canUndo`, `canRedo`,
  `set(next, options?)`, `undo()` and `redo()`. A `set` with
  `{ coalesce: true }` joins the previous coalescing `set` when it follows it by
  less than `COALESCE_MS` (500 ms); every other `set` is a new entry. A coalescing
  `set` that joins a run and returns to the value the run started from drops
  the run's entry and ends the run. A `set` to the current value changes
  nothing. The undo stack keeps at most
  `HISTORY_LIMIT` (200) entries.
- `visualKeys` (`apps/desktop/src/visualKeys.ts`): pure helpers of the visual
  editor. `visualOrder(graphemes, lineDir)` lists every position of a line from
  visual left to visual right, `visualStep(side, index, graphemes, lineDir)`
  gives the position one step to the visual left or right, and
  `caretMove(key, caret, graphemes, lineDir)` gives the caret position after
  `ArrowLeft`, `ArrowRight`, `Home` or `End`. The order is a simplified bidi
  order: number runs and nested embeddings are not modelled. The file also holds
  the visual editor's UI-state helpers (`initialUi`, `reconcileUi`, `rowClass`,
  `textRows`, `neighbourRow`, `initialRowIds`, `followRowIds`,
  `trackLine`, `lineMap`, `lyricOf`, `graphemeIndexAt`).
- `capoOptions(songCapo: number | undefined): number[]` is exported from
  `apps/desktop/src/library.ts` as a pure helper. It returns `0..12` ascending,
  plus `songCapo` appended when it is an integer in 13..24.

Props:

```ts
SongList { songs: readonly LibrarySong[]; selectedId: string | undefined;
  onSelect(id: string): void }
SearchBox { value: string; disabled?: boolean; onChange(next: string): void }
SongIndexItem { id: string; title: string; artist?: string | null | undefined;
  songKey?: string | null | undefined; language?: Language | undefined;
  snippet?: string | null | undefined }
SongIndex { items: readonly SongIndexItem[]; selectedId: string | undefined;
  variant: "library" | "results"; busy?: boolean | undefined;
  onSelect(id: string): void;
  onDelete?: ((id: string) => void) | undefined;
  selecting?: boolean | undefined; selected?: SongIdSet | undefined;
  onToggle?: ((id: string) => void) | undefined;
  deleteDisabled?: boolean | undefined;
  focusIndex?: number | undefined;
  focusRef?: RefObject<HTMLButtonElement | null> | undefined }
LibraryControls { sort: SortOrder; language: LanguageFilter;
  onSort(next: SortOrder): void; onLanguage(next: LanguageFilter): void }
SelectionBar { selecting: boolean; count: number; busy: boolean;
  onStart(): void; onSelectAll(): void; onDelete(): void;
  onAddToSetlist(): void; onDone(): void;
  startRef?: RefObject<HTMLButtonElement | null> | undefined }
ConfirmDelete { title: string; onCancel(): void; onConfirm(): void }
SongHeader { title: string; artist?: string; soundingKey?: string;
  capo: number }
ViewControls { transpose: number; capo: number;
  capoOptions: readonly number[]; shapeKey?: string;
  onTranspose(next: number): void; onCapo(next: number): void;
  onReset(): void }
DiagnosticsPanel { diagnostics: readonly Diagnostic[] }
Editor { initialText: string; baseline?: string; seed?: ImportSeed;
  titlePath?: string; fileName?: string; notes?: readonly string[];
  onConvertWithAi?(text: string): void; onSave(text: string): Promise<void>;
  onCancel(): void; onDirtyChange?(dirty: boolean): void }
AiImportDialog { initial?: AiDocument;
  pickDocument(): Promise<(AiDocument & { warnings: string[] }) | undefined>;
  onImport(songs: AiReplySong[]): void; onCancel(): void }
ConfirmDiscard { onKeep(): void; onDiscard(): void }
MetaFormValues { readonly [Name in EditMetaName]: string }
MetaForm { values: MetaFormValues;
  onChange(name: EditMetaName, value: string): void }
VisualEditor { id?: string | undefined; song: SongModel;
  onEdit(ops: readonly EditOp[]): void }
ChordPicker { initial?: string | undefined;
  suggestions(prefix: string): readonly string[];
  isValid(chord: string): boolean; isKnown(chord: string): boolean;
  onSubmit(chord: string): void; onRemove?: (() => void) | undefined;
  onMove?: ((side: "left" | "right") => void) | undefined; onClose(): void }
SectionControls { section: string; label?: string | undefined;
  literal: boolean; canMoveUp: boolean; canMoveDown: boolean;
  onRename(section: SectionKind, label: string): void;
  onMove(direction: "up" | "down"): void; onRemove(): void }
```

### Setlists

Controlled components in `apps/desktop/src/components/`; the owner (`App`) holds
every state and calls storage. None of them calls storage or IPC, and every
control carries `data-ui-chrome`.

- `SidebarTabs`: the `sidebar-tabs` `role="tablist"` with a Songs and a Setlists
  tab (`tab-songs`, `tab-setlists`). Arrow keys select the visually next or
  previous tab (`dir="rtl"` swaps them; no wrap), `Home` and `End` jump to the
  ends.
- `SetlistsPanel`: the sidebar list of setlists. Each row (keyed by setlist id)
  shows the name in a `<bdi>` and the `setlistItemCount` text, with Rename
  (inline input, Enter commits the trimmed name, Escape cancels, an empty or
  over-200-character name is rejected), Duplicate and Delete. Delete opens
  `ConfirmDeleteSetlist`; only its confirm button calls `onDelete`. The create
  form's button is disabled while the trimmed name is empty or longer than 200
  characters (counted in characters, not bytes) or `busy`.
- `SetlistEditor`: the main-pane editor. It shows the name, the Print / Export
  PDF / Export Word buttons and an `<ol>` of entries keyed by item id, each with
  position, title (opens the song), artist, effective sounding key
  (`transposeKey(key, transpose)`, only when the song has one), transpose
  (−11..+11), capo (`Song default (N)` = `null`, 0..12 and the song's own capo
  when 13..24), Move up / Move down (disabled at the ends), Remove and a drag
  handle. Alt+ArrowUp / Alt+ArrowDown on a focused row move it and keep focus on
  it after the owner re-renders the new order. Moves are announced in the
  `setlist-announce` live region.
- `useReorderDrag(ids, onReorder)` (`useReorderDrag.ts`): pointer-event
  reordering (no HTML5 drag API). Pointerdown on a handle captures the pointer,
  the target index is the number of other rows whose block-axis midpoint is above
  the pointer (the same in LTR and RTL), the target row gets `data-drop`
  (`before` / `after`), pointerup calls `onReorder(newIds, movedId)` only when the
  order changed, and `Escape` or `pointercancel` aborts without a call.
- `AddToSetlistDialog`: modal (`useDialogFocus`, with Tab cycling over every
  enabled control) with a radio per setlist plus a New setlist radio and name
  input. The confirm button is disabled until the choice is valid (an existing
  setlist, or a new name of 1..200 characters) and while `busy`.
- `ConfirmDeleteSetlist`: an in-app `alertdialog` naming the setlist and stating
  that its songs are not deleted; focus behaves like `ConfirmDelete`.

```ts
SidebarTabs { view: "songs" | "setlists"; onChange(view: "songs" | "setlists"): void }
SetlistsPanel { setlists: readonly SetlistSummary[]; selectedId: string | null;
  busy: boolean; onSelect(id: string): void; onCreate(name: string): void;
  onRename(id: string, name: string): void; onDuplicate(id: string): void;
  onDelete(id: string): void }
SetlistEditor { setlist: Setlist; busy: boolean;
  onReorder(itemIds: string[]): void; onMove(itemId: string, delta: -1 | 1): void;
  onTranspose(itemId: string, transpose: number): void;
  onCapo(itemId: string, capo: number | null): void;
  onRemove(itemId: string): void; onOpenSong(songId: string, itemId: string): void;
  onPrint(): void; onExportPdf(): void; onExportWord(): void }
AddToSetlistDialog { setlists: readonly SetlistSummary[]; songCount: number;
  busy: boolean; onCancel(): void; onAdd(setlistId: string): void;
  onCreateAndAdd(name: string): void }
ConfirmDeleteSetlist { name: string; onCancel(): void; onConfirm(): void }
```

## Editor and import

Database mode only. The sidebar has `New song` (`new-song`), which opens an
empty editor, `Open files…` (`open-files`), which imports files, and
`Import with AI` (`ai-import`, § Import with AI). The
`Edit` button (`edit-song`) next to the song header opens the selected song.
The `Editor` component (`components/Editor.tsx`) replaces the song view while
editing.

Editor:

- The editor has two tabs (a `role="tablist"` named `editorTabs`): `Visual`
  (`editor-tab-visual`, panel `editor-visual`), shown when the editor opens, and
  `Source` (`editor-tab-source`, panel `editor-source`). ArrowLeft and
  ArrowRight on a tab switch to the other tab. Both tabs edit the same ChordPro
  text, so an edit made in one tab shows in the other.
- Source tab: a `<textarea dir="auto">` (`editor-input`) holds the ChordPro
  text. The
  preview (`editor-preview`) renders `parseSong` of the text through
  `SongView`, 300 ms after the last keystroke, with a `DiagnosticsPanel`.
- Visual tab: a `DiagnosticsPanel` for the parsed text, the song-details form
  and the visual editor (both described below).
- The text has one undo history (`useHistory`) shared by both tabs. Typing in
  the Source text area is coalesced; every visual action, song-details change,
  transpose step, `Paste`, `Convert` and `Flip alignment` is one entry.
- The toolbar (`data-ui-chrome`) has `Save`, `Cancel`, `Undo` (`editor-undo`),
  `Redo` (`editor-redo`), the `Transpose` label with its down / up buttons
  (`editor-transpose-down`, `editor-transpose-up`), `Paste`, `Convert` (Source
  tab only)
  and, only after an import with RTL chords, `Flip alignment` (both tabs).
  While a converted document is under review it also has `Convert with AI
instead` (`editor-convert-ai`, § Import with AI).
- `Undo` and `Redo` are disabled when there is nothing to undo or redo.
  Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo. The shortcuts do not
  apply while Alt is held or when the key event's target is an `<input>`
  element, where the browser's own undo stays.
- The transpose buttons (accessible names `transposeSongDown` /
  `transposeSongUp`) apply the chord-core `transpose` edit op, −1 or +1
  semitone, to the text. Unlike the view controls (§ View controls) this changes
  the text that `Save` stores.
- `Paste` reads the clipboard (`navigator.clipboard.readText`) and converts it
  with chord-core `importText`; when the clipboard cannot be read it shows the
  `pasteFailed` alert. `Convert` converts the current text; when the text is
  already ChordPro it changes nothing and `editor-status` shows
  `alreadyChordPro`. Both use the editor's current `rtlColumns` mode, which starts as the review seed's mode (a document's `rtlColumns`) and otherwise as `mirror`. Typing in the
  Source text area, a visual edit that changes the text (song details and
  transpose included), `Undo`, `Redo` and a `Convert` of text that is already
  ChordPro clear the last import.
- `Flip alignment` re-imports the last source with the other `rtlColumns` mode
  (`mirror` or `logical`) and, for a queued file, re-applies the title
  fallback. Import warnings are listed under `Import warnings`
  (`import-warnings`).
- `Save` calls `saveSong(text, id)` (`id` is set when editing an existing song);
  on failure the `saveFailed` alert shows the error message. After a save the
  list reloads and the saved song is selected.
- Leaving a dirty editor (cancel, another song, New, Edit, Open files) shows
  `ConfirmDiscard` (`role="alertdialog"`, `Keep editing` / `Discard`; Esc keeps
  editing). The app never uses `window.confirm`.

Visual tab:

- Every action is a list of chord-core `EditOp`s applied to the parsed song
  with `applyEdits`; the resulting text (`serializeSong` of the edited song)
  becomes the editor text as one history entry. A result that does not change
  the text is ignored. A song saved without any edit is stored byte for byte;
  the first visual edit can also rewrite other lines into the serializer's
  form (for example, lines are joined with LF and the text ends with one).
- Song details (`MetaForm`, `meta-form`, accessible name `metaForm`): `Title`
  (`meta-title`) and `Artist` (`meta-artist`) are `dir="auto"` inputs; `Key`
  (`meta-key`) and `Tempo` (`meta-tempo`) are `dir="ltr"` inputs; `Capo`
  (`meta-capo`) is a `<select>` with the `capoOptions` values. The fields show
  the song's `title`, `artist`, `key`, `capo` and `tempo` values (the first
  `meta` line of that name with a non-empty trimmed value). A text field commits
  its trimmed value on blur or Enter, and Esc restores the stored value; the
  capo select commits on change, and 0 commits an empty value. A stored capo
  that is not an integer 0–24 is shown as an extra first choice with the stored
  text; choosing `0` commits the empty value as above and choosing another
  number replaces the stored text. Each commit is one `setMeta` op.
- `VisualEditor` (`editor-visual`, accessible name `visualLabel`, `dir` equal
  to `song.direction`, or `auto` when the song has none) shows one row
  (`visual-line`) per song line except `meta` lines, followed by one extra
  empty row after the last line, where a new line can be typed. It runs
  chord-render's `useChordOverlap` pass over its rows.
- Lyric and empty rows render the line with chord-render `ChordLine` in editing
  mode, inside a focusable wrapper named by the `lineLabel` template. Clicking a position
  opens the chord picker to add a chord there (`addChord`); clicking a chord
  opens the picker for that chord. Clicking an empty row, double-clicking a
  row, pressing F2 or using `Edit lyrics` (`line-edit-text`) replaces the line
  with a `dir="auto"` text input (`line-input`). A double-click on a lyric row
  leaves no chord picker open: the second click of the double-click does not
  reopen the picker the first click opened, and the `dblclick` closes it as
  lyric-edit mode starts. An empty row (not the extra last row) also has an
  `Add chord` button (`row-add-chord`, accessible name `chordAddEmpty`) that
  opens the picker at position 0, so pointer users can add a chord before
  typing text. Applying a chord (adding, replacing or choosing a suggestion)
  closes the picker. The picker sits in the flow below its row, so it pushes the
  rows after it down instead of covering them (`add-section` stays clickable
  with the picker open on the last row).
- In the `line-input` of a lyric or empty row, blur commits the text (`setLyric`). Enter commits and
  splits the line at the caret (`splitLine`), or inserts a line below
  (`insertLine`) when the caret is at the end, and editing continues on the
  next row. Backspace at the start joins the line to the lyric or empty line
  above (`joinLines`); on the extra last row, while it is empty, it only moves
  editing to that line; Enter there, while it is empty, does nothing (no
  `insertLine`). ArrowUp and ArrowDown commit and move to the nearest
  lyric or empty row. Esc leaves the input without committing.
- Keys on a focused row wrapper: ArrowLeft and ArrowRight move the caret one
  position to the visual left or right, Home and End move it to position 0 and
  to the end of the line, Enter opens the chord picker at the caret, Delete
  removes a chord anchored at the caret, F2 starts editing the lyrics, and
  ArrowUp / ArrowDown focus the nearest lyric or empty row.
- Row buttons: `Edit lyrics` (`line-edit-text`), `Add line below`
  (`line-add-below`, `insertLine`) and `Remove line` (`line-remove`,
  `removeLine`). The extra last row has none.
- `ChordPicker` (`chord-picker`, a non-modal `role="dialog"`): the `chord-input`
  combobox takes the focus, and `chord-option` lists chord-core
  `suggestChords(song, prefix)` for the typed text (the chords the song uses,
  then the diatonic triads of its key). ArrowDown and ArrowUp highlight an
  option; Enter applies the highlighted option, otherwise the typed chord; Esc
  and `Close` (`chord-close`) close the picker. `Apply` (`chord-apply`) is
  disabled unless chord-core `isValidChordText` accepts the text, and
  `chord-warning` shows `chordUnknown` for an accepted chord that `parseChord`
  does not recognise; while it is empty its status region stays in the
  accessibility tree, clipped and out of flow. For an existing chord, applying is `setChord`, and the
  picker also has `Remove chord` (`chord-remove`, `removeChord`) and the
  `chord-move-left` / `chord-move-right` buttons, which move the chord one
  position to the visual left or right (`moveChord`).
- A chords-only row has a `dir="ltr"` input (`chords-input`) holding the chords
  separated by spaces; blur or Enter commits them (`setChordsLine`). Its
  `Edit lyrics` button opens a `line-input` that adds lyrics to the line
  (`setLyric`) on blur or Enter; Esc leaves it without committing. A comment
  row has a `dir="auto"` input (`comment-input`, `setComment`). Both rows have
  `Remove line`.
- A section start row whose section has a matching end shows
  `SectionControls`: the type `<select>` (`section-kind`: `Verse`, `Chorus`,
  `Bridge`, plus `Other` for any other section name), the label input
  (`section-label`, `dir="auto"`, placeholder `noLabel`), `section-up` /
  `section-down` (`moveSection`; disabled for the first / last section) and
  `section-remove` (`removeSection`). The controls form a `role="group"` named
  by the section type label, followed by the section label when it has one.
  Changing the type or committing the
  label is `renameSection`. For a literal section both the type and the label
  are disabled, and the label is also disabled for an `Other` section. The
  matching end row renders empty and is hidden from assistive technology.
- `tab`, `raw`, `remark` and `directive` lines, and section tags without a
  matching start or end, are shown as their ChordPro source in a `<pre>`
  (`visual-verbatim`) with the note `sourceOnly`. They cannot be edited in the
  Visual tab. The first four kinds have `Remove line`; the unpaired section
  tags do not.
- The hint (`visual-hint`, `visualHint`) shows while the song has no lyric,
  empty, chords or comment line.
- The footer has a section type `<select>` (`add-section-kind`) and
  `Add section` (`add-section`), which adds a section (`addSection`) after the
  most recently focused row, or at the end when no row was focused. When that
  row lies inside a section with a matching end, the new section goes after
  that section's end row.
- After a chord is added to an empty row or to the extra last row, focus moves
  to that row's `chords-input`. An open chord picker, the caret and the most
  recently focused row follow their line after the editor's own edits that
  add, remove or move lines, after reorders that keep the line count, and after
  changes from outside the visual editor (Undo, Redo, edits in the Source tab
  and song-details changes); the
  picker closes when its own line is removed. On a reorder that keeps the line
  count, a line follows its content only when that content occurs exactly once
  in the changed span on both sides. Every row has a stable identity (its React
  key) that follows its line through the same moves, so a row that shifts stays
  the same element: an open picker is not remounted, keeps its unsubmitted text,
  and focus stays on the control the user clicked.

Open files (`apps/desktop/src/importFiles.ts`, `importSongFiles`):

- `pickSongFiles()` from `files.ts` opens the native multi-file dialog filtered
  to `.cho`, `.chopro`, `.chordpro`, `.txt`, `.docx`, `.odt`, `.rtf` and `.pdf`.
  `readTextFile(path)` reads each text file through the `read_text_file`
  command (UTF-8, one leading BOM removed,
  at most 1 MiB; a failure throws `FileReadError` whose `kind` is `TooLarge`,
  `NotUtf8`, `Io` or `"Ipc"`).
- `.cho`, `.chopro` and `.chordpro` files are saved as they are. Other text files
  go through `importText`. A file without RTL chords is saved at once; a file
  with RTL chords (`hasRtlChords`) is queued and opened in the editor (on the
  Visual tab), one at a
  time, for alignment review. In the review editor `Cancel` skips the file
  (listed under `import-skipped`) and `Save` saves it and moves on.
- A file whose extension (compared in lower case) is `.docx`, `.odt`, `.rtf` or
  `.pdf` is a document. `extractDocument(path)` (the `extract_document`
  command) returns its blocks and warnings, `documentToText` turns the blocks
  into text and the column order (`rtlColumns`), and `importText` converts that
  text with the same `rtlColumns`. A document is never saved at once: it is
  always queued for review, whether or not it has RTL chords, and the review
  editor shows `Notes on this file` (`editor-notes`) listing the extraction
  warnings of the document, in the current language, then the `docNoteOneSong`
  text. The offline conversion keeps the whole document as one song. When the
  import has RTL chords, `Flip alignment` starts from the document's
  `rtlColumns`, and
  `Convert with AI instead` opens Import with AI for the document (§ Import
  with AI).
- A document that cannot be read is an `import-failed` entry with a `reason`:
  the `kind` of the `DocumentReadError` (`TooLarge`, `TextTooLarge`,
  `Unsupported`, `Corrupt`, `Io` or `"Ipc"`), or `NoText` for a document that
  holds no blocks. The report shows a localized message for every reason
  except `"Ipc"`: `docTooLarge`, `docTextTooLarge`, `docUnsupported`,
  `docCorrupt`, `docIo` and `docNoText`. An `"Ipc"` failure shows the raw
  error message. When `documentToText` or `importText` throws, the file fails
  with no `reason` and the report shows the raw error message.
- `withTitleFallback(chordpro, path)` prepends `{title: <file name without
extension>}` unless the text already has a `{title` or `{t:` directive.
- One file's failure never stops the others; each failure is an
  `import-failed` alert with the file name and message. A failure of the dialog
  itself shows the `app-notice` alert (`importPickFailed`).
- The sidebar report (`import-report`) shows the `importSummary` template
  (`Imported 2 of 3 files`, `Imported 1 of 1 file`), counting saved files, and
  the `importQueued` template (`1 file needs alignment review`, otherwise
  `N files need alignment review`) when files are queued. Converted `.txt`
  files that were saved at once are listed under `importConverted`.

## Import with AI

Database mode only. `Import with AI` (`ai-import`, `data-ui-chrome`) sits after
`Open files…` in the sidebar and is disabled while a file import runs. It
opens `AiImportDialog` (`ai-import-dialog`, a modal `role="dialog"`; Esc and
`Cancel` (`ai-cancel`) close it). Shir makes no network call: the dialog builds
a prompt with chord-core `buildAiPrompt`, the user copies it into any chat AI
and pastes the reply back, and `parseAiReply` splits the reply into songs.
The dialog has three steps:

- `Source`: two radio buttons. `I'll attach the file to the AI chat (images,
scans, .doc and others)` (`ai-source-attach`) is the default when the dialog
  opens empty. `Extract the text from a document` (`ai-source-document`)
  selects text mode, and `Choose a document…` (`ai-pick-document`, which also
  selects text mode) picks one file with `pickDocumentFile`, filtered to
  `.docx`, `.odt`, `.rtf` and `.pdf`. `App` extracts it on this computer
  (`extractDocument`, then the text of `documentToText`). The picked file shows
  as its name, `·` and its character count (`ai-picked`); its extraction
  warnings are listed under `ai-pick-warnings`; a failure shows in `ai-pick-error` the
  message the import report shows for it (Open files, § Editor and import), and
  a document with no blocks shows `docNoText`.
- `Prompt`: a read-only text area (`ai-prompt`, `dir="ltr"`) with the prompt.
  In text mode the prompt holds the extracted text and appears once a
  document is picked; until then `ai-prompt-hint` shows `Choose a document
first, then the prompt appears here.`. In attach mode the prompt asks for the
  attached file, and names the picked document when there is one. `Copy prompt`
  (`ai-copy`) copies it and `ai-copied` shows `Copied`; when the clipboard
  cannot be written, the prompt is selected and `ai-copy-failed` shows `Could
not copy automatically. The prompt is selected: press Ctrl+C.`. The status
  shown belongs to the current prompt only.
- `Reply`: a text area (`ai-reply`, `dir="auto"`, label `Paste the AI reply
here`). `Read songs` (`ai-parse`) is disabled while the reply is blank. It
  lists the songs found (`ai-songs`, one `ai-song` per song): the title, or
  `Song N` when there is none, followed by `·` and the diagnostics count when
  the song has diagnostics. When the reply holds no songs `ai-parse-error` shows
  `aiParseError`; when it holds more than can be imported at once
  `ai-truncated` shows `aiTruncated`. Editing the reply clears the result.
  `Review N songs` (`ai-review`) hands the songs to `App`.

`App` queues every song for review in the editor, and nothing is saved until
the user clicks `Save` on a song, which moves on to the next one. A queued
song's name is `<source> · <title>`: the source is the document name the dialog
was opened with, else `AI`, and the title is the song's title, else `Song N`.
The songs are ChordPro as the AI wrote it, with no RTL-chords flag. Starting
the review from the sidebar abandons the open editor and the rest of its queue
after the usual discard confirmation (§ Editor and import).

Convert with AI: while a converted document is under review, `Convert with AI
instead` (`editor-convert-ai`) opens the dialog in text mode with that
document's name and extracted text already filled in. The songs of the reply
take the place of the document at the head of the queue, ahead of the files
still queued behind it. The discard confirmation appears only when the editor
text was edited since the document was opened; otherwise the songs replace the
document at once.

Limits of document extraction:

- A document over 20 MiB, or one that holds more than 2 MiB of extracted text,
  is refused (`docTooLarge`, `docTextTooLarge`). Attach it in Import with AI
  instead.
- A PDF without a text layer, such as a scan, gives no text: `docNoText` in
  the report, `docWarnPdfNoText` as a warning. Attach it in Import with AI.
- `.doc` files and images are not in the Open files filter. They reach Shir
  only through the attach source of Import with AI. In the Import with AI
  picker, a file with another extension is refused as `Unsupported`
  (`docUnsupported`).
- PDF extraction stops after 30 seconds and fails as `Corrupt`
  (`docCorrupt`).
- Hebrew text in a PDF is reordered from visual to logical order, and the
  `docWarnPdfReordered` warning asks the user to check the lines. A niqqud mark
  can land on the wrong letter when the PDF font maps ligature glyphs
  ambiguously. Chord placement from a PDF is best-effort: the spaces in a line
  are rebuilt from the gaps between glyphs, counted in the page's typical
  character width, so a chord can sit off the letter it was printed over.
  Review the song in the editor, use `Flip alignment`, or attach
  the file to the AI chat instead.

## Webview errors

`apps/desktop/src/main.tsx` installs `installWebviewErrorForwarder(window,
logWebviewError)` before rendering, in every build. It forwards window `error`
events, `unhandledrejection` events and `console.error` calls (the original
`console.error` still runs) through `logWebviewError` in `storage.ts`, which
never rejects. The native side writes each one to stderr as
`shir: webview: <text>`. The forwarder never throws, ignores an error raised
while it is itself forwarding (on the same call stack), and includes the error
message even when a JavaScriptCore stack omits it. An `error` event that is
not an `ErrorEvent` forwards `error event: <type>`. An Error with an empty
message forwards its name; an Error whose `stack`, `message` or `name` getters
throw, or whose `stack` is not a string, forwards a fallback line (the text is
built inside the forwarder's `try`).

## Diagnostics panel

The list is the parse diagnostics followed by the view diagnostics. Each item
reads `` `${line}:${column} ${message}` `` in `<bdi dir="ltr">` for the
coordinates and `dir="auto"` for the message. The heading renders as
`{diagnostics} {separator}` and the `diagnosticsCount` template (for example
`Diagnostics · 2 problems`). The panel is absent when n = 0.

Coordinates have two meanings:

- Parse diagnostics give the 1-based source line and source column.
- View diagnostics (`unknown-chord` from `viewSong`) give the 1-based index of
  the line in the parsed song model and the 1-based position of the chord
  within that line (the `i + 1, j + 1` arguments in
  `packages/chord-core/src/transpose.ts`).

## Test ids

| Test id                         | Element                    | Meaning                                                               |
| ------------------------------- | -------------------------- | --------------------------------------------------------------------- |
| `song-list`                     | `<nav>`                    | The song list                                                         |
| `song-item`                     | song `<button>`            | One per song; `aria-current="true"` on the selected one               |
| `song-header`                   | header container           | Song pane header                                                      |
| `song-title`                    | `<h2>`                     | Song title                                                            |
| `song-artist`                   | artist element             | Song artist, present only when the song has one                       |
| `sounding-key`                  | `<span>`                   | Sounding key (`<bdi dir="ltr">`) or the `No key` text                 |
| `shape-key`                     | `<bdi>`                    | Shape key in the controls, present only when defined                  |
| `capo-value`                    | header capo display        | Current capo (view state), shown only when > 0                        |
| `transpose-down`                | `<button>`                 | Transpose down by one semitone                                        |
| `transpose-up`                  | `<button>`                 | Transpose up by one semitone                                          |
| `transpose-value`               | value element              | Current signed transpose (`0`, `+2`, `-3`)                            |
| `capo-select`                   | `<select>`                 | Capo choice                                                           |
| `reset-view`                    | `<button>`                 | Resets transpose to 0 and capo to the song's capo                     |
| `diagnostics`                   | diagnostics panel          | The diagnostics panel, absent when there are no diagnostics           |
| `diagnostic-item`               | list item                  | One per diagnostic                                                    |
| `song-pane`                     | `<main>`                   | The song pane                                                         |
| `locale-toggle`                 | `<div role="group">`       | The interface-language toggle in the sidebar heading row              |
| `locale-he`                     | `<button>`                 | Switch to Hebrew; `aria-pressed="true"` when Hebrew is current        |
| `locale-en`                     | `<button>`                 | Switch to English; `aria-pressed="true"` when English is current      |
| `search-input`                  | `<input type="search">`    | The sidebar search box (disabled in bundled mode)                     |
| `search-empty`                  | `<p>`                      | Shown when a search has zero hits                                     |
| `search-unavailable`            | `<p>`                      | Notice shown in bundled mode: search is unavailable                   |
| `song-snippet`                  | `<span>`                   | Lyric line of a search hit, rendered as text, only when non-null      |
| `song-index`                    | `<ul>`                     | The `SongIndex` list of the listed (sorted, filtered) DB songs        |
| `search-results`                | `<ul>`                     | The `SongIndex` list holding the ranked search hits                   |
| `search-pending`                | `<p role="status">`        | Live region: `Searching…` while a query is pending, else empty        |
| `new-song`                      | `<button>`                 | Sidebar: opens an empty editor (database mode only)                   |
| `open-files`                    | `<button>`                 | Sidebar: picks song files and imports them (database mode only)       |
| `import-report`                 | `<section>`                | Sidebar summary of the last file import                               |
| `import-summary`                | `<p role="status">`        | `Imported N of M files` (saved files only)                            |
| `import-queued`                 | `<p role="status">`        | `N files need alignment review`, only when files are queued           |
| `import-converted`              | `<div>`                    | File names of converted `.txt` files that were saved at once          |
| `import-skipped`                | `<div>`                    | File names of queued files skipped without saving                     |
| `import-failed`                 | `<p role="alert">`         | One per failed file: file name and error message                      |
| `app-notice`                    | `<p role="alert">`         | Sidebar error: file dialog, edit load, list refresh or delete failure |
| `edit-song`                     | `<button>`                 | Next to the song header: opens the selected song in the editor        |
| `editor`                        | `<section>`                | The editor pane (replaces the song view while editing)                |
| `reviewing-file`                | `<p>`                      | Name of the queued file under review, only for queued files           |
| `editor-save`                   | `<button>`                 | Saves the text; disabled while saving                                 |
| `editor-cancel`                 | `<button>`                 | Cancels the editor (skips a queued file)                              |
| `editor-paste`                  | `<button>`                 | Reads the clipboard and converts it through the importer              |
| `editor-convert`                | `<button>`                 | Converts the current text through the importer                        |
| `editor-flip`                   | `<button>`                 | Flip alignment, only after an import with RTL chords                  |
| `editor-status`                 | `<p role="status">`        | Live region: `Already ChordPro` message, else empty                   |
| `editor-paste-error`            | `<p role="alert">`         | Shown when the clipboard cannot be read                               |
| `editor-save-error`             | `<p role="alert">`         | Shown when saving failed, with the error message                      |
| `import-warnings`               | `<section>`                | The list of import warnings                                           |
| `import-warning`                | list item                  | One per import warning, with its line number                          |
| `editor-input`                  | `<textarea dir="auto">`    | The ChordPro text area                                                |
| `editor-preview`                | `<div role="region">`      | Live preview rendered by `SongView` after a 300 ms debounce           |
| `confirm-discard`               | `<div role="alertdialog">` | Unsaved-changes confirmation dialog                                   |
| `confirm-keep`                  | `<button>`                 | Keep editing                                                          |
| `confirm-discard-yes`           | `<button>`                 | Discard the changes and continue                                      |
| `delete-song`                   | `<button>`                 | Next to the song header: deletes the selected song after confirmation |
| `song-delete`                   | `<button>`                 | Per song row: deletes that song after confirmation                    |
| `song-check`                    | `<input type="checkbox">`  | Per song row in select mode: selects the song                         |
| `selection-bar`                 | `<div>`                    | Sidebar bar holding the select-mode controls                          |
| `select-songs`                  | `<button>`                 | Enters select mode                                                    |
| `library-sort`                  | `<select>`                 | Sidebar: sort order (title, artist, recently updated)                 |
| `library-filter-all`            | `<button role="radio">`    | Language filter: all songs                                            |
| `library-filter-he`             | `<button role="radio">`    | Language filter: Hebrew songs                                         |
| `library-filter-en`             | `<button role="radio">`    | Language filter: English songs                                        |
| `library-filter-mixed`          | `<button role="radio">`    | Language filter: mixed-language songs                                 |
| `filter-empty`                  | `<p>`                      | Shown when the language filter hides every listed song or hit         |
| `song-row-key`                  | `<span dir="ltr">`         | Per song row: the song's key, only when non-empty                     |
| `song-language`                 | `<span>`                   | Per song row: language badge (`HE`, `EN`, `HE+EN`)                    |
| `select-all`                    | `<button>`                 | Select mode: selects every listed song                                |
| `selection-count`               | `<p role="status">`        | Select mode: `N selected`                                             |
| `delete-selected`               | `<button>`                 | Select mode: deletes the selected songs after confirmation            |
| `select-done`                   | `<button>`                 | Leaves select mode and clears the selection                           |
| `confirm-delete`                | `<div role="alertdialog">` | Delete confirmation dialog                                            |
| `confirm-delete-cancel`         | `<button>`                 | Keeps the songs                                                       |
| `confirm-delete-yes`            | `<button>`                 | Deletes the songs                                                     |
| `delete-status`                 | `<p role="status">`        | Live region: `Deleted N songs` after a delete, else empty             |
| `editor-tab-visual`             | `<button role="tab">`      | Shows the visual editor                                               |
| `editor-tab-source`             | `<button role="tab">`      | Shows the ChordPro source editor                                      |
| `editor-visual`                 | `<div role="tabpanel">`    | The visual editor panel                                               |
| `editor-source`                 | `<div role="tabpanel">`    | The source editor panel (text area and preview)                       |
| `editor-undo`                   | `<button>`                 | Undoes the last edit                                                  |
| `editor-redo`                   | `<button>`                 | Redoes the last undone edit                                           |
| `editor-transpose-down`         | `<button>`                 | Transposes the stored chords down one semitone                        |
| `editor-transpose-up`           | `<button>`                 | Transposes the stored chords up one semitone                          |
| `meta-form`                     | `<form>`                   | Song details form                                                     |
| `meta-title`                    | `<input>`                  | Song title                                                            |
| `meta-artist`                   | `<input>`                  | Song artist                                                           |
| `meta-key`                      | `<input>`                  | Song key                                                              |
| `meta-capo`                     | `<select>`                 | Song capo                                                             |
| `meta-tempo`                    | `<input>`                  | Song tempo                                                            |
| `visual-hint`                   | `<p>`                      | Hint shown while no lyric, empty, chords or comment line exists       |
| `visual-line`                   | row container              | One per song line except `meta` lines, plus the extra last row        |
| `line-input`                    | `<input dir="auto">`       | Lyric text of the line being edited                                   |
| `line-edit-text`                | `<button>`                 | Starts editing the line's lyrics                                      |
| `line-add-below`                | `<button>`                 | Inserts an empty line below                                           |
| `line-remove`                   | `<button>`                 | Removes the line                                                      |
| `row-add-chord`                 | `<button>`                 | Opens the chord picker at position 0 of an empty row                  |
| `chords-input`                  | `<input dir="ltr">`        | Chords of a chord-only line, space separated                          |
| `comment-input`                 | `<input dir="auto">`       | Text of a comment line                                                |
| `visual-verbatim`               | `<pre>`                    | A line the visual editor shows read-only                              |
| `section-kind`                  | `<select>`                 | Section type                                                          |
| `section-label`                 | `<input dir="auto">`       | Section label                                                         |
| `section-up`                    | `<button>`                 | Moves the section before the previous section                         |
| `section-down`                  | `<button>`                 | Moves the section after the next section                              |
| `section-remove`                | `<button>`                 | Removes the section and its lines                                     |
| `add-section-kind`              | `<select>`                 | Type of the section to add                                            |
| `add-section`                   | `<button>`                 | Adds a section                                                        |
| `chord-picker`                  | `<div role="dialog">`      | Chord picker popover                                                  |
| `chord-input`                   | `<input role="combobox">`  | Chord name                                                            |
| `chord-option`                  | `<li role="option">`       | One suggested chord                                                   |
| `chord-apply`                   | `<button>`                 | Applies the typed chord                                               |
| `chord-remove`                  | `<button>`                 | Removes the chord                                                     |
| `chord-move-left`               | `<button>`                 | Moves the chord one position to the visual left                       |
| `chord-move-right`              | `<button>`                 | Moves the chord one position to the visual right                      |
| `chord-warning`                 | `<p role="status">`        | `Unrecognized chord` notice                                           |
| `chord-close`                   | `<button>`                 | Closes the picker                                                     |
| `add-to-setlist`                | `<div role="dialog">`      | Add to setlist dialog                                                 |
| `add-to-setlist-cancel`         | `<button>`                 | Closes the dialog                                                     |
| `add-to-setlist-confirm`        | `<button type="submit">`   | Adds to the chosen or new setlist; disabled until the choice is valid |
| `add-to-setlist-name`           | `<input>`                  | Name of the new setlist; typing selects the New setlist option        |
| `add-to-setlist-new-option`     | `<input type="radio">`     | The New setlist choice                                                |
| `add-to-setlist-option`         | `<input type="radio">`     | One per existing setlist                                              |
| `add-selected-to-setlist`       | `<button>`                 | Select mode: adds the selected songs to a setlist; disabled with none |
| `app-status`                    | `<p role="status">`        | Status after adding to a setlist or saving a Word file (its name)     |
| `setlist-pdf-hint`              | `<p>`                      | The `pdfHint` text above the open setlist's export buttons            |
| `song-add-to-setlist`           | `<button>`                 | Open song header: adds the song to a setlist (database mode)          |
| `song-print`                    | `<button>`                 | Open song header: prints the song at its current transpose and capo   |
| `song-export-pdf`               | `<button>`                 | Open song header: PDF through the print dialog (current view)         |
| `song-export-word`              | `<button>`                 | Open song header: Word document (current transpose and capo)          |
| `song-pdf-hint`                 | `<span>`                   | The `pdfHint` text next to the open song's Export PDF button          |
| `confirm-delete-setlist`        | `<div role="alertdialog">` | Setlist delete confirmation dialog                                    |
| `confirm-delete-setlist-cancel` | `<button>`                 | Keeps the setlist                                                     |
| `confirm-delete-setlist-yes`    | `<button>`                 | Deletes the setlist                                                   |
| `setlist-announce`              | `<p aria-live="polite">`   | Announces the last move of an entry                                   |
| `setlist-create`                | `<button type="submit">`   | Creates a setlist from the name input                                 |
| `setlist-delete`                | `<button>`                 | Opens the setlist delete confirmation                                 |
| `setlist-duplicate`             | `<button>`                 | Duplicates the setlist                                                |
| `setlist-editor`                | `<section>`                | The setlist editor in the main pane                                   |
| `setlist-entries`               | `<ol>`                     | The ordered entries of the setlist                                    |
| `setlist-entries-empty`         | `<p>`                      | Empty state of a setlist without entries                              |
| `setlist-entry`                 | `<li>`                     | One per entry; `data-drop` marks the drop target while dragging       |
| `setlist-entry-capo`            | `<select>`                 | Capo of the entry; the empty value is the song default                |
| `setlist-entry-down`            | `<button>`                 | Moves the entry one place down                                        |
| `setlist-entry-handle`          | `<button>`                 | Pointer-drag handle of the entry                                      |
| `setlist-entry-key`             | `<bdi dir="ltr">`          | Sounding key of the entry, only when the song has a key               |
| `setlist-entry-position`        | `<span>`                   | 1-based position of the entry                                         |
| `setlist-entry-remove`          | `<button>`                 | Removes the entry from the setlist                                    |
| `setlist-entry-title`           | `<button>`                 | Opens the entry's song                                                |
| `setlist-entry-transpose-down`  | `<button>`                 | Transposes the entry down by one semitone                             |
| `setlist-entry-transpose-up`    | `<button>`                 | Transposes the entry up by one semitone                               |
| `setlist-entry-transpose-value` | `<bdi>`                    | Signed transpose of the entry                                         |
| `setlist-entry-up`              | `<button>`                 | Moves the entry one place up                                          |
| `setlist-export-pdf`            | `<button>`                 | Exports the setlist as PDF                                            |
| `setlist-export-word`           | `<button>`                 | Exports the setlist as a Word document                                |
| `setlist-name-input`            | `<input>`                  | Name of the setlist to create                                         |
| `setlist-print`                 | `<button>`                 | Prints the setlist                                                    |
| `setlist-rename`                | `<button>`                 | Starts renaming the setlist                                           |
| `setlist-rename-input`          | `<input>`                  | Inline rename field (Enter commits, Escape cancels)                   |
| `setlist-row`                   | `<li>`                     | One per setlist in the sidebar                                        |
| `setlist-select`                | `<button>`                 | Selects the setlist; `aria-current="true"` on the selected one        |
| `setlists-empty`                | `<p>`                      | Empty state of the setlists panel                                     |
| `setlists-panel`                | `<div>`                    | The sidebar setlists panel                                            |
| `sidebar-tabs`                  | `<div role="tablist">`     | The Songs / Setlists switch                                           |
| `tab-setlists`                  | `<button role="tab">`      | The Setlists tab                                                      |
| `tab-songs`                     | `<button role="tab">`      | The Songs tab                                                         |
| `ai-import`                     | `<button>`                 | Opens the Import with AI dialog                                       |
| `ai-import-dialog`              | `<div role="dialog">`      | The Import with AI dialog                                             |
| `ai-source-document`            | `<input type="radio">`     | Source: extract the text from a document                              |
| `ai-source-attach`              | `<input type="radio">`     | Source: attach the file to the AI chat yourself                       |
| `ai-pick-document`              | `<button>`                 | Picks a document and extracts its text                                |
| `ai-picked`                     | `<p>`                      | File name and character count of the picked document                  |
| `ai-pick-error`                 | `<p role="alert">`         | Why the document could not be read                                    |
| `ai-pick-warnings`              | `<ul>`                     | Extraction warnings of the picked document                            |
| `ai-prompt`                     | `<textarea readonly>`      | The prompt to copy                                                    |
| `ai-prompt-hint`                | `<p>`                      | Shown instead of the prompt until a document is picked                |
| `ai-copy`                       | `<button>`                 | Copies the prompt to the clipboard                                    |
| `ai-copied`                     | `<span role="status">`     | The prompt was copied                                                 |
| `ai-copy-failed`                | `<span role="status">`     | Copying failed; the prompt is selected for Ctrl+C                     |
| `ai-reply`                      | `<textarea>`               | Where the AI reply is pasted                                          |
| `ai-parse`                      | `<button>`                 | Splits the reply into songs                                           |
| `ai-parse-error`                | `<p role="alert">`         | The reply holds no songs                                              |
| `ai-truncated`                  | `<p role="status">`        | The reply held more songs than can be listed                          |
| `ai-songs`                      | `<ul>`                     | The songs found in the reply                                          |
| `ai-song`                       | `<li>`                     | One per song found                                                    |
| `ai-review`                     | `<button>`                 | Reviews the songs found, one by one, in the editor                    |
| `ai-cancel`                     | `<button>`                 | Closes the dialog                                                     |
| `editor-convert-ai`             | `<button>`                 | Opens Import with AI with the document under review                   |
| `editor-notes`                  | `<ul>`                     | Notes on the document under review                                    |

## Strings

| Key                    | Value                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `appName`              | `Shir`                                                                                                                       |
| `appNameHebrew`        | `שיר`                                                                                                                        |
| `groupSamples`         | `Samples`                                                                                                                    |
| `groupTestSongs`       | `Test songs`                                                                                                                 |
| `songList`             | `Songs`                                                                                                                      |
| `transpose`            | `Transpose`                                                                                                                  |
| `transposeDown`        | `Transpose down`                                                                                                             |
| `transposeUp`          | `Transpose up`                                                                                                               |
| `capo`                 | `Capo`                                                                                                                       |
| `reset`                | `Reset`                                                                                                                      |
| `key`                  | `Key`                                                                                                                        |
| `shapes`               | `Shapes`                                                                                                                     |
| `diagnostics`          | `Diagnostics`                                                                                                                |
| `noSongSelected`       | `Select a song`                                                                                                              |
| `searchLabel`          | `Search songs`                                                                                                               |
| `searchPlaceholder`    | `Search title, artist or lyrics`                                                                                             |
| `searchResults`        | `Search results`                                                                                                             |
| `noResults`            | `No songs match`                                                                                                             |
| `searchFailed`         | `Search failed`                                                                                                              |
| `searchUnavailable`    | `Search unavailable: the song library could not be opened. Showing bundled songs.`                                           |
| `loadingLibrary`       | `Loading songs…`                                                                                                             |
| `searching`            | `Searching…`                                                                                                                 |
| `libraryEmpty`         | `No songs in the library`                                                                                                    |
| `songLoadFailed`       | `Could not open this song`                                                                                                   |
| `noKey`                | `No key`                                                                                                                     |
| `separator`            | `·`                                                                                                                          |
| `transposeDownGlyph`   | `−`                                                                                                                          |
| `transposeUpGlyph`     | `+`                                                                                                                          |
| `newSong`              | `New song`                                                                                                                   |
| `editSong`             | `Edit`                                                                                                                       |
| `openFiles`            | `Open files…`                                                                                                                |
| `editorLabel`          | `ChordPro text`                                                                                                              |
| `previewLabel`         | `Preview`                                                                                                                    |
| `save`                 | `Save`                                                                                                                       |
| `cancel`               | `Cancel`                                                                                                                     |
| `paste`                | `Paste`                                                                                                                      |
| `convert`              | `Convert`                                                                                                                    |
| `flipAlignment`        | `Flip alignment`                                                                                                             |
| `alreadyChordPro`      | `Already ChordPro, nothing to convert`                                                                                       |
| `pasteFailed`          | `Could not read the clipboard. Paste with Ctrl+V, then use Convert.`                                                         |
| `importWarnings`       | `Import warnings`                                                                                                            |
| `saveFailed`           | `Could not save the song`                                                                                                    |
| `discardTitle`         | `Discard unsaved changes?`                                                                                                   |
| `discardBody`          | `Your changes to this song have not been saved.`                                                                             |
| `keepEditing`          | `Keep editing`                                                                                                               |
| `discard`              | `Discard`                                                                                                                    |
| `reviewingFile`        | `Reviewing file`                                                                                                             |
| `importConverted`      | `Converted from chords over lyrics`                                                                                          |
| `importSkipped`        | `Skipped files`                                                                                                              |
| `importPickFailed`     | `Could not open files`                                                                                                       |
| `libraryReloadFailed`  | `Could not refresh the song list`                                                                                            |
| `deleteAction`         | `Delete`                                                                                                                     |
| `selectSongs`          | `Select`                                                                                                                     |
| `selectAll`            | `Select all`                                                                                                                 |
| `selectDone`           | `Done`                                                                                                                       |
| `deleteSelected`       | `Delete selected`                                                                                                            |
| `deleteConfirmBody`    | `Deleted songs are permanently removed from the library. This cannot be undone.`                                             |
| `deleteFailed`         | `Could not delete the song`                                                                                                  |
| `removeGlyph`          | `×`                                                                                                                          |
| `tabVisual`            | `Visual`                                                                                                                     |
| `tabSource`            | `Source`                                                                                                                     |
| `editorTabs`           | `Editor view`                                                                                                                |
| `undo`                 | `Undo`                                                                                                                       |
| `redo`                 | `Redo`                                                                                                                       |
| `transposeSongDown`    | `Transpose song down`                                                                                                        |
| `transposeSongUp`      | `Transpose song up`                                                                                                          |
| `metaForm`             | `Song details`                                                                                                               |
| `metaTitle`            | `Title`                                                                                                                      |
| `metaArtist`           | `Artist`                                                                                                                     |
| `metaTempo`            | `Tempo`                                                                                                                      |
| `visualLabel`          | `Song lines`                                                                                                                 |
| `visualHint`           | `Type lyrics, then click a letter to add a chord`                                                                            |
| `editLyrics`           | `Edit lyrics`                                                                                                                |
| `lyricsInput`          | `Lyrics`                                                                                                                     |
| `addLineBelow`         | `Add line below`                                                                                                             |
| `removeLine`           | `Remove line`                                                                                                                |
| `editGlyph`            | `✎`                                                                                                                          |
| `addGlyph`             | `+`                                                                                                                          |
| `chordsLineInput`      | `Chords`                                                                                                                     |
| `commentInput`         | `Comment`                                                                                                                    |
| `sourceOnly`           | `Edit in Source`                                                                                                             |
| `addSection`           | `Add section`                                                                                                                |
| `sectionKind`          | `Section type`                                                                                                               |
| `sectionLabel`         | `Section label`                                                                                                              |
| `sectionVerse`         | `Verse`                                                                                                                      |
| `sectionChorus`        | `Chorus`                                                                                                                     |
| `sectionBridge`        | `Bridge`                                                                                                                     |
| `sectionUp`            | `Move section up`                                                                                                            |
| `sectionDown`          | `Move section down`                                                                                                          |
| `sectionRemove`        | `Remove section`                                                                                                             |
| `upGlyph`              | `↑`                                                                                                                          |
| `downGlyph`            | `↓`                                                                                                                          |
| `chordPicker`          | `Chord`                                                                                                                      |
| `chordInput`           | `Chord name`                                                                                                                 |
| `chordSuggestions`     | `Suggestions`                                                                                                                |
| `chordApply`           | `Apply`                                                                                                                      |
| `chordRemove`          | `Remove chord`                                                                                                               |
| `chordMoveLeft`        | `Move chord left`                                                                                                            |
| `chordMoveRight`       | `Move chord right`                                                                                                           |
| `leftGlyph`            | `←`                                                                                                                          |
| `rightGlyph`           | `→`                                                                                                                          |
| `chordUnknown`         | `Unrecognized chord`                                                                                                         |
| `chordClose`           | `Close`                                                                                                                      |
| `noLabel`              | `No label`                                                                                                                   |
| `sectionOther`         | `Other`                                                                                                                      |
| `sortLabel`            | `Sort by`                                                                                                                    |
| `sortTitle`            | `Title`                                                                                                                      |
| `sortArtist`           | `Artist`                                                                                                                     |
| `sortUpdated`          | `Recently updated`                                                                                                           |
| `libraryView`          | `Library view`                                                                                                               |
| `filterLanguage`       | `Language`                                                                                                                   |
| `filterAll`            | `All`                                                                                                                        |
| `filterHebrew`         | `Hebrew`                                                                                                                     |
| `filterEnglish`        | `English`                                                                                                                    |
| `filterMixed`          | `Mixed`                                                                                                                      |
| `badgeHebrew`          | `HE`                                                                                                                         |
| `badgeEnglish`         | `EN`                                                                                                                         |
| `badgeMixed`           | `HE+EN`                                                                                                                      |
| `noFilterMatches`      | `No songs in this language`                                                                                                  |
| `uiLanguage`           | `Interface language`                                                                                                         |
| `localeHebrew`         | `עברית`                                                                                                                      |
| `localeEnglish`        | `English`                                                                                                                    |
| `localeHebrewShort`    | `עב`                                                                                                                         |
| `localeEnglishShort`   | `EN`                                                                                                                         |
| `chordAddEmpty`        | `Add chord`                                                                                                                  |
| `fileFilterSongs`      | `Song files`                                                                                                                 |
| `tabSongs`             | `Songs`                                                                                                                      |
| `tabSetlists`          | `Setlists`                                                                                                                   |
| `sidebarViews`         | `Sidebar view`                                                                                                               |
| `setlistNameLabel`     | `Setlist name`                                                                                                               |
| `createSetlist`        | `Create`                                                                                                                     |
| `renameSetlist`        | `Rename`                                                                                                                     |
| `duplicateSetlist`     | `Duplicate`                                                                                                                  |
| `setlistsEmpty`        | `No setlists yet`                                                                                                            |
| `setlistEmpty`         | `This setlist has no songs`                                                                                                  |
| `setlistEntries`       | `Songs in the setlist`                                                                                                       |
| `deleteSetlistBody`    | `The setlist is removed. The songs in it are not deleted.`                                                                   |
| `addToSetlist`         | `Add to setlist`                                                                                                             |
| `newSetlistOption`     | `New setlist`                                                                                                                |
| `setlistChoice`        | `Setlist`                                                                                                                    |
| `add`                  | `Add`                                                                                                                        |
| `moveUp`               | `Move up`                                                                                                                    |
| `moveDown`             | `Move down`                                                                                                                  |
| `removeFromSetlist`    | `Remove from setlist`                                                                                                        |
| `dragHandle`           | `Drag to reorder`                                                                                                            |
| `dragGlyph`            | `⋮⋮`                                                                                                                         |
| `print`                | `Print`                                                                                                                      |
| `exportPdf`            | `Export PDF`                                                                                                                 |
| `exportWord`           | `Export Word`                                                                                                                |
| `pdfHint`              | `Choose “Save as PDF” in the print dialog`                                                                                   |
| `fileFilterWord`       | `Word document`                                                                                                              |
| `setlistsLoadFailed`   | `Could not load setlists`                                                                                                    |
| `setlistSaveFailed`    | `Could not save the setlist`                                                                                                 |
| `exportFailed`         | `Could not export the setlist`                                                                                               |
| `exportLabelSetlist`   | `Setlist`                                                                                                                    |
| `exportLabelKey`       | `Key`                                                                                                                        |
| `exportLabelCapo`      | `Capo`                                                                                                                       |
| `exportLabelTranspose` | `Transpose`                                                                                                                  |
| `exportLabelSongs`     | `Songs`                                                                                                                      |
| `exportLabelDate`      | `Date`                                                                                                                       |
| `duplicateSuffix`      | `(copy)`                                                                                                                     |
| `importWithAi`         | `Import with AI`                                                                                                             |
| `aiStepSource`         | `Source`                                                                                                                     |
| `aiStepPrompt`         | `Prompt`                                                                                                                     |
| `aiStepReply`          | `Reply`                                                                                                                      |
| `aiSourceDocument`     | `Extract the text from a document`                                                                                           |
| `aiSourceAttach`       | `I'll attach the file to the AI chat (images, scans, .doc and others)`                                                       |
| `aiPickDocument`       | `Choose a document…`                                                                                                         |
| `aiPromptLabel`        | `Prompt to copy`                                                                                                             |
| `aiPromptHint`         | `Choose a document first, then the prompt appears here.`                                                                     |
| `aiCopy`               | `Copy prompt`                                                                                                                |
| `aiCopied`             | `Copied`                                                                                                                     |
| `aiCopyFailed`         | `Could not copy automatically. The prompt is selected: press Ctrl+C.`                                                        |
| `aiReplyLabel`         | `Paste the AI reply here`                                                                                                    |
| `aiParse`              | `Read songs`                                                                                                                 |
| `aiParseError`         | `No songs were found in the reply. Check that the whole reply was pasted.`                                                   |
| `aiTruncated`          | `The reply holds more songs than can be imported at once. Only the first songs are listed.`                                  |
| `aiSongsFound`         | `Songs found`                                                                                                                |
| `aiDefaultSource`      | `AI`                                                                                                                         |
| `convertWithAi`        | `Convert with AI instead`                                                                                                    |
| `importNotes`          | `Notes on this file`                                                                                                         |
| `docNoteOneSong`       | `The offline conversion keeps the whole document as one song. If it holds several songs, use Convert with AI to split them.` |
| `fileFilterDocuments`  | `Documents`                                                                                                                  |
| `docTooLarge`          | `The file is over 20 MB. Attach it in Import with AI instead`                                                                |
| `docTextTooLarge`      | `The file holds more than 2 MB of text. Attach it in Import with AI instead`                                                 |
| `docUnsupported`       | `Unsupported file type`                                                                                                      |
| `docCorrupt`           | `The file is damaged or not in that format`                                                                                  |
| `docIo`                | `Could not read the file`                                                                                                    |
| `docNoText`            | `No text found, likely a scan. Use Import with AI and attach the file`                                                       |
| `docWarnPdfReordered`  | `Hebrew text in this PDF was reordered. Check the lines.`                                                                    |
| `docWarnPdfNoText`     | `This PDF has no text, likely a scan.`                                                                                       |
| `docWarnSkipped`       | `Some content was skipped, for example an image or an object.`                                                               |

`TEMPLATES` (`apps/desktop/src/strings.ts`) holds the i18next templates for
strings with variables (`{{var}}` interpolation, `_one` / `_other` plural
suffixes; Hebrew adds `_two` and `_many`). The English resource is
`{ ...STRINGS, ...TEMPLATES }` (`apps/desktop/src/i18n/en.ts`), and components
read every string with `const t = useT()` and `t("<key>", vars)`:

- `diagnosticsCount` (plural on `count`): `1 problem` / `N problems`.
- `importSummary` (plural on `count` = total files, plus `saved`):
  `Imported 2 of 3 files`, `Imported 1 of 1 file`.
- `importQueued` (plural on `count`): `1 file needs alignment review` /
  `N files need alignment review`.
- `deleteSongNamed`, `selectSongNamed` and `deleteConfirmTitle` (`title`, wrapped
  in the bidi isolates U+2068 / U+2069): `Delete <title>`, `Select <title>`,
  `Delete <title>?`.
- `deleteManyTitle` (`count`): `Delete 3 songs?`; `selectedCount` (`count`):
  `3 selected`.
- `deletedCount` (plural on `count`): `Deleted 1 song` / `Deleted N songs`.
- `deleteManyFailed` (plural on `count` = total, plus `failed`):
  `Could not delete 2 of 5 songs`.
- `lineLabel` (`n`): `Line 4`.
- `setlistItemCount`, `addToSetlistTitle` and `addedToSetlist` (plural on
  `count`): `1 song` / `N songs`, `Add 1 song to a setlist` /
  `Add N songs to a setlist`, `Added 1 song to the setlist` /
  `Added N songs to the setlist`.
- `movedAnnounce` (`title`, wrapped in U+2068 / U+2069; `n` = the new 1-based
  position): `Moved <title> to position 3`.
- `deleteSetlistTitle` (`name`, wrapped in the bidi isolates): `Delete <name>?`.
- `exportSaved` (`name` = the saved file's base name, wrapped in the bidi
  isolates): `Saved <name>`.
- `capoSongDefault` (`n` = the song's own capo): `Song default (5)`.

The native open-files dialog filter name is `fileFilterSongs`, read from the
current language each time the dialog opens.

## Out of scope

- TanStack Router and Zustand.
- Persistence of the last open song and of the transpose and capo view
  settings (only the library sort and filter, `shir.library`, and the interface
  language, `shir.locale`, are stored).
- Chord diagrams.
- Print layout beyond the setlist and song export (§ Print and export).
