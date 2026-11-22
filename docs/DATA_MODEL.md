# Data model

Normative spec for the desktop song storage (G4) and its G5 search and seeding additions. Code lives in
`apps/desktop/src-tauri/` (Rust: `src/db/`, `src/commands/`, `migrations/`) and
`apps/desktop/src/storage.ts` (typed TypeScript client). The ChordPro source is
stored verbatim; everything else is derived from it on every save.

## Schema

Three migrations in `apps/desktop/src-tauri/migrations/`: `0001_init.sql` (V1),
`0002_app_meta_fts_rebuild.sql` (V2) and `0003_setlists.sql` (V3). They are
forward-only: never edit a shipped migration, append a new one.

`songs` is a `STRICT` table:

| Column       | Type    | Rules                                               |
| ------------ | ------- | --------------------------------------------------- |
| `id`         | TEXT    | Primary key, not null.                              |
| `chordpro`   | TEXT    | Not null. The song source, verbatim.                |
| `title`      | TEXT    | Not null, default `''`.                             |
| `artist`     | TEXT    | Nullable.                                           |
| `key`        | TEXT    | Nullable.                                           |
| `capo`       | INTEGER | Nullable; `CHECK` it is null or between 0 and 24.   |
| `language`   | TEXT    | Not null; `CHECK` it is one of `he`, `en`, `mixed`. |
| `created_at` | TEXT    | Not null.                                           |
| `updated_at` | TEXT    | Not null.                                           |

There is an index `idx_songs_updated_at` on `songs (updated_at)`.

`songs_fts` is an FTS5 virtual table with the columns `title_norm`,
`artist_norm` and `lyrics_norm`, and the tokenizer
`unicode61 remove_diacritics 0`. It holds `normalize_he` text only; these
columns are the only place niqqud-stripped text is stored. There are no
triggers: Rust writes the FTS row, because normalization happens in Rust.

V2 adds `app_meta`, a `STRICT` key-value table: `key` TEXT primary key not
null, `value` TEXT not null.

V3 adds two `STRICT` tables for setlists. `setlists`: `id` TEXT primary key,
`name` TEXT with `CHECK (length(trim(name)) BETWEEN 1 AND 200)`, `created_at`
and `updated_at` TEXT, all not null. `setlist_items` (one entry per song
occurrence):

| Column       | Type    | Rules                                                               |
| ------------ | ------- | ------------------------------------------------------------------- |
| `id`         | TEXT    | Primary key, not null.                                              |
| `setlist_id` | TEXT    | Not null; references `setlists (id)` `ON DELETE CASCADE`.           |
| `song_id`    | TEXT    | Not null; references `songs (id)` `ON DELETE CASCADE`.              |
| `position`   | INTEGER | Not null; `CHECK` it is at least 0; unique per setlist.             |
| `transpose`  | INTEGER | Not null, default 0; `CHECK` it is between -11 and 11.              |
| `capo`       | INTEGER | Nullable (null means the song's own capo); `CHECK` null or 0 to 24. |

The indexes are `idx_setlist_items_song_id` on `setlist_items (song_id)` and
`idx_setlists_updated_at` on `setlists (updated_at)`.

## Migrations and opening

`src/db/migrations.rs` uses `rusqlite_migration` and embeds `0001_init.sql`,
`0002_app_meta_fts_rebuild.sql` and `0003_setlists.sql` with `include_str!`. V2 is an
`M::up_with_hook` migration: its hook runs `repo::rebuild_fts` inside the
migration transaction, so a failed rebuild rolls back and leaves
`user_version` at 1. The latest `user_version` is 3. `open(path)`:

1. Creates the parent directories.
2. Opens the file and sets `journal_mode = WAL`.
3. Sets `foreign_keys = ON` and `busy_timeout = 5000`.
4. Migrates to the latest version.

Migrating is idempotent. A database whose `user_version` is newer than the
latest migration is refused with an error of kind `Migration`.

## normalize_he

`normalize_he` in `src/db/normalize.rs` is the one search normalization
function (hebrew-rtl-chords rule 7). It runs these steps in order:

1. Maqaf (U+05BE) becomes a space, so hyphenated words stay two tokens.
2. NFD.
3. Strip every code point in U+0591 to U+05C7 (cantillation and niqqud).
4. NFC.
5. Delete the marks ׳ U+05F3, ״ U+05F4, `"` U+0022, `'` U+0027, ’ U+2019 and
   ʼ U+02BC when both neighbours, in that step's input, are alphabetic
   (`char::is_alphabetic`) and not themselves one of these marks.
6. Fold the final letters: ך to כ, ם to מ, ן to נ, ף to פ, ץ to צ.
7. `str::to_lowercase`.

Stored text and search queries both go through this same function. Shared
cases live in `packages/test-fixtures/search/normalize_he.cases.json`.

Known limitations: `Ka’tamar` indexes as `katamar`, so `tamar` no longer
prefix-matches it; Hebrew prefix particles (ו ה ב ל מ ש כ) are not stripped
(`חול` does not find `וחול`); there is no cross-script matching (`tamar` does
not find `צדיק כתמר`).

## Metadata extraction

`extract` in `src/db/extract.rs` derives `title`, `artist`, `key`, `capo`,
`language` and the lyrics text (chords removed) that is indexed. It follows the
line rules in [`CHORDPRO.md`](CHORDPRO.md) § Lines. The language comes from the
Hebrew and Latin letters in the lyrics: only Hebrew gives `he`, both give
`mixed`, otherwise `en`. When the lyrics hold no such letters, the title is
scanned instead.

Rust and chord-core must agree on this metadata. The file
`apps/desktop/src-tauri/tests/golden/extract.json` holds `{file, title, artist,
key, capo}` for each song source. It is derived from chord-core, never from
Rust: `parseSong(src).song.{title,key,capo}` plus the first non-empty trimmed
`artist` meta line. Rust `extract()` must match it. The set of golden files
must equal exactly every `.cho` file that is not `.canonical.cho` in both
`packages/test-fixtures/fixtures/` and `samples/`, so adding a sample or
fixture song needs a matching golden entry that matches chord-core output.
`scripts/g4-contract.test.ts` checks both rules. A new bundled song also needs
an entry in `apps/desktop/src-tauri/src/db/seed.rs`, and
`scripts/g5-contract.test.ts` checks that the bindings carry the `SearchHit`
shape, that the embedded seed set equals the songs on disk, that the local QA
directory is ignored and untracked, that 0002 creates `app_meta`, and that the sha256 of
`0001_init.sql` is unchanged. `scripts/g5b-contract.test.ts` pins the `log_webview_error`
wiring. `scripts/g10-contract.test.ts` pins the setlist and export-command
wiring.

## Repository rules

`src/db/repo.rs` provides save, get, list and delete; `src/db/setlists.rs`
provides the setlist operations (see Setlists below).

- **Save** creates a song when no `id` is given, with a lowercase UUIDv7 id.
  With an `id` it runs an SQL `UPDATE`: a missing id gives `NotFound`, and
  `created_at` is kept. The `songs` row and its `songs_fts` row (same rowid)
  are written in one transaction.
- **Delete** removes both rows in one transaction; a missing id gives
  `NotFound`. The `ON DELETE CASCADE` removes the song's setlist entries; in
  the same transaction the affected setlists are renumbered densely and their
  `updated_at` is touched.
- **List** returns summaries ordered by `updated_at DESC, id DESC`.
- The ChordPro text is stored verbatim.
- Save gives `Invalid` for empty, whitespace-only or BOM-only text, and for
  text over 1 048 576 UTF-8 bytes.
- Every operation that takes an id gives `Invalid` unless the id is a
  36-character hyphenated UUID. Simple, braced and urn forms are rejected. An
  uppercase hyphenated UUID passes validation and then gives `NotFound`; ids
  are not case-insensitive.
- Timestamps are UTC, exactly `YYYY-MM-DDTHH:MM:SS.mmmZ`, so text order equals
  time order.

## Setlists

`src/db/setlists.rs` provides:

- **List** returns summaries ordered by `updated_at DESC, id DESC`; **get**
  returns one setlist.
- **Create**, **rename**, **delete** and **duplicate**. Names are trimmed and
  counted in characters (1 to 200).
- **Add items** appends songs at the end; the same song may appear more than
  once.
- **Remove item** renumbers the remaining positions densely.
- **Reorder** takes the exact permutation of the setlist's item ids, or gives
  `Invalid`; it rewrites positions with an offset scheme so the unique
  `(setlist_id, position)` constraint holds throughout.
- **Update item** changes an entry's `transpose` and `capo`.
- Every mutation touches the setlist's `updated_at`.
- A malformed id gives `Invalid`; an unknown id gives `NotFound`.

## Search

`src/db/search.rs` has one shared tokenizer, used for both the `MATCH`
expression and the snippet. It turns the query into an FTS5 expression:

1. Run `normalize_he` on the query.
2. Turn every non-alphanumeric character into a space.
3. Quote each token as a prefix term, `"tok"*`; terms are joined by an
   implicit AND.

A query with no tokens returns no results. The expression is a bound `MATCH`
parameter. Results are ordered by `bm25`, then `updated_at DESC`, then
`id DESC`, and limited to 100 (`SEARCH_LIMIT`). Shared cases live in
`packages/test-fixtures/search/query.cases.json`.

Each result is `SearchHit { song: SongSummary, snippet: string | null }`. The
snippet is the first line of `extract(chordpro).lyrics` that holds a token
starting with any query token, trimmed. It is the original text, so chords are
stripped and niqqud is kept. It is cut to 160 characters without separating a
base letter from its combining marks, with `…` appended only when cut. It is
null when only the title or artist matched. Cases live in
`packages/test-fixtures/search/snippet.cases.json`.

## Seeding

`src/db/seed.rs` embeds every `samples/*.cho` and every non-canonical
`packages/test-fixtures/fixtures/*.cho` (18 today) with `include_str!`.
`DbState::open` (file database only; in-memory states never seed) migrates,
then seeds once in one transaction. The flag `app_meta.bundled_seeded` holds
the count. Once it is present, seeding is a no-op, so deleted songs stay
deleted and bundled updates never reach an existing database. Seeding depends
only on the flag, not on existing rows, so an upgraded G4 database receives the
bundled songs once, alongside its existing songs. A failure logs
`shir: seeding failed: …`, rolls back, keeps the database usable and retries on
the next launch. `DbState::open` writes this line to stderr through
`DbState::open_with_log`, which takes the writer.

## Errors

Every storage failure is `{kind, message}` (`src/db/error.rs`), where `kind` is
one of `NotFound`, `Invalid`, `Storage`, `Migration` or `Unavailable`.

## Commands and startup

There are 19 Tauri commands. `src/commands/mod.rs` defines five async
commands: `save_song`, `get_song`, `list_songs`, `delete_song` and
`search_songs`. They share one `DbState` (`src/commands/state.rs`), a
`Mutex<Result<Connection, DbError>>`. A sixth command, `log_webview_error`, is
synchronous: it writes one line `shir: webview: <text>` to stderr, returns
nothing and does not use `DbState`.
It delegates to `log_webview_error_to(message, &mut dyn Write)`, which takes the
writer and ignores write failures.
Control characters in the text become spaces, and the text is capped at 2000
characters with `…` appended when cut.
A seventh command, `read_text_file` (`src/commands/files.rs`), is also
synchronous and does not use `DbState`: it reads a user-picked file as UTF-8
text with plain `std::fs`. Only regular files up to 1 MiB (1,048,576 bytes)
are accepted, one leading BOM is removed and line endings are untouched. A
failure is a `FileError` `{kind, message}` whose `kind` is `TooLarge`, `NotUtf8` or `Io` (the `FileErrorKind` value `Invalid` is returned only by `save_export_docx`).

`extract_document(path)` (`src/commands/documents/mod.rs`) is
`#[tauri::command(async)]` and does not use `DbState`. It runs the extraction
on `spawn_blocking`, with plain `std::fs` (no fs plugin), and returns
`DocumentText { format, blocks, warnings }`. `format` is `docx`, `odt`, `rtf` or
`pdf`, chosen by the file extension (ASCII case-insensitive). A block is
`{kind: "paragraph", text}` or `{kind: "table", rows}` (`string[][]`); inside a
paragraph or cell a line break is `\n` and a tab is `\t`. Blank paragraphs and
all-empty tables are dropped. A warning is `{kind, message}` where `kind` is
`PdfReordered`, `PdfNoText` or `Skipped`. A failure is a `DocError`
`{kind, message}` whose `kind` is `TooLarge` (the file is over 20 MiB),
`TextTooLarge` (the extracted block text is over 2 MiB, counted in UTF-8
bytes; also a DOCX or ODT XML part over 20 MiB, or a PDF with over 2,000,000 glyphs), `Unsupported` (any other extension), `Corrupt` or `Io` (not a regular
file, or a read failure). The formats:

- DOCX and ODT: paragraphs and tables, with tabs kept.
- RTF: a hand-written tokenizer that decodes `\uN` and hex bytes. The code page
  of a byte comes from the current font's `\fcharset` first: 177 and 181 give
  cp1255 (Hebrew), 178 to 180 give cp1256 (Arabic). Only otherwise does
  `\ansicpg` apply, defaulting to 1252.
- PDF: text PDFs only, run on a worker thread with a 30 second timeout; a
  timeout or a worker failure is `Corrupt`. Lines are rebuilt from glyph
  baselines, and Hebrew runs are converted from visual to logical order with a
  `PdfReordered` warning. A PDF with no extractable text (likely a scan) gives
  zero blocks and a `PdfNoText` warning, not an error.

Ten setlist commands live in `src/commands/setlists.rs`: `list_setlists`,
`get_setlist`, `create_setlist`, `rename_setlist`, `delete_setlist`,
`duplicate_setlist`, `add_setlist_items`, `remove_setlist_item`,
`reorder_setlist_items` and `update_setlist_item`. Each is
`#[tauri::command(async)]` and uses `DbState`.

`save_export_docx(default_name, filter_name, bytes)` (`src/commands/files.rs`)
is `#[tauri::command(async)]` and does not use `DbState`. It validates the bytes
first: empty or over 20 MiB gives a `FileError` of kind `Invalid`. The default
name is sanitized to a bare `.docx` name. The native save dialog is opened in
Rust, so the webview never supplies a path. A cancelled dialog returns `null`. A chosen name that already ends in `.docx` is used as is (the dialog confirmed any overwrite); otherwise `.docx` is appended and, when that path already exists, the first free `<name> (2).docx`, `(3)`, ... is used. The file is written atomically (temporary file, then rename) and never through a
symlink, and the written path is returned.

The database file is `<app_data_dir>/shir.db` (app identifier
`com.kdcllc.shir`). If it cannot be opened, startup logs one line,
`shir: database unavailable: <cause>`, and the five storage commands and the ten
setlist commands return `Unavailable`; `log_webview_error`, `read_text_file`,
`save_export_docx` and `extract_document` are unaffected because they do not use `DbState`. `open_db_state` writes that line through
`report_unavailable(&DbState, &mut dyn Write)` (`src/lib.rs`) with stderr; the
line comes from `DbState::unavailable_line`, which still works after a poisoned
lock.
`DbState::open` opens, migrates, then seeds (see Seeding). In
the commands that use `DbState`, a poisoned lock returns `Storage`.

`build.rs` lists all 19 commands, `collect_commands!` registers them with
`log_webview_error` last, and `capabilities/default.json` grants
`core:default`, `dialog:allow-open` (the `tauri-plugin-dialog` file picker,
registered in `src/lib.rs`), `allow-save-song`, `allow-get-song`,
`allow-list-songs`, `allow-delete-song`, `allow-search-songs`,
`allow-read-text-file`, `allow-save-export-docx`, `allow-extract-document`,
`allow-list-setlists`,
`allow-get-setlist`, `allow-create-setlist`, `allow-rename-setlist`,
`allow-delete-setlist`, `allow-duplicate-setlist`, `allow-add-setlist-items`,
`allow-remove-setlist-item`, `allow-reorder-setlist-items`,
`allow-update-setlist-item` and `allow-log-webview-error` to the main window.
There is no `dialog:allow-save` and no fs plugin: the save dialog is opened from
Rust.

## Bindings

`apps/desktop/src/bindings.ts` is generated by tauri-specta (error handling
mode `Result`). Do not edit it by hand. The test `bindings_are_current` fails
when it is stale. Regenerate it with:

```
SHIR_UPDATE_BINDINGS=1 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml bindings_are_current
```

Debug builds also rewrite the file at startup, only when the content differs.

## TypeScript client

`apps/desktop/src/storage.ts` wraps the generated commands as `saveSong`,
`getSong`, `listSongs`, `deleteSong` and `searchSongs`; `searchSongs` returns
`SearchHit[]`. A failure of one of these five throws a
`StorageError` whose `kind` is an `ErrorKind` or `"Ipc"` (the call itself
failed). It also exports ten setlist wrappers (`listSetlists`, `getSetlist`,
`createSetlist`, `renameSetlist`, `deleteSetlist`, `duplicateSetlist`,
`addSetlistItems`, `removeSetlistItem`, `reorderSetlistItems`,
`updateSetlistItem`) and the `Setlist`, `SetlistSummary` and `SetlistItem`
types. It also exports `logWebviewError(message)`, which forwards a webview
error to the app's stderr and never rejects; the webview error forwarder uses
it. The desktop app calls `listSongs`, `getSong` and `searchSongs` for the
sidebar, `saveSong` for the editor and file import, and `deleteSong` for song
deletion: once the delete confirmation dialog is confirmed, `deleteMany`
(`apps/desktop/src/deleteSongs.ts`) calls it once per song, one after another
(see [`DESKTOP.md`](DESKTOP.md)).

`apps/desktop/src/files.ts` wraps the generated `readTextFile` command as
`readTextFile(path)` and the dialog plugin as `pickSongFiles()`. A failure of
`readTextFile` throws a `FileReadError` whose `kind` is a `FileErrorKind`
(`TooLarge`, `NotUtf8`, `Io`, `Invalid`) or `"Ipc"` (the call itself failed). `readTextFile` itself never receives `Invalid`.
It also exports `saveExportDocx`, which wraps `save_export_docx`; a failure
throws a `FileWriteError` whose `kind` is `Invalid`, `Io` or `"Ipc"`.

It also exports `extractDocument(path)`, which wraps `extract_document` and
resolves a `DocumentText`; a failure throws a `DocumentReadError` whose `kind`
is a `DocErrorKind` (`TooLarge`, `TextTooLarge`, `Unsupported`, `Corrupt`, `Io`)
or `"Ipc"` (the call itself failed). `pickDocumentFile(filterName)` opens the
single-file picker filtered to `DOCUMENT_FILE_EXTENSIONS` (`docx`, `odt`, `rtf`,
`pdf`) and resolves the path, or `undefined` on cancel. `pickSongFiles()`
filters the song extensions (`cho`, `chopro`, `chordpro`, `txt`) together with
`DOCUMENT_FILE_EXTENSIONS`.

## Invariants

- `songs` has an implicit rowid (the primary key is TEXT, and the table is not
  `WITHOUT ROWID`). `songs_fts.rowid` equals `songs.rowid`. This link is
  implicit and is written by Rust only.
- Never run `VACUUM`: it may renumber rowids and break the link. If one is ever
  needed, rebuild `songs_fts` from `songs` afterwards.
- Never use `REPLACE` or `INSERT OR REPLACE` on `songs`; updates use `UPDATE`.
  Rowid reuse after a delete is safe only because the song row and its FTS row
  are deleted in one transaction.
- After V2 a G4 build refuses the database (newer `user_version`), so there is
  no downgrade. V3 is one-way in the same way: an older build refuses a V3
  database.
- Deleting a song or a setlist cascades to `setlist_items`; after a song
  delete the affected setlists are renumbered densely, so positions stay
  contiguous from 0.
- The V2 rebuild keeps the rowid link: it runs DELETE plus INSERT per rowid,
  never `REPLACE`.
- A future migration that rebuilds the `songs` table must also rebuild
  `songs_fts`.
