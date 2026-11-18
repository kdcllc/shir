# Data model

Normative spec for the desktop song storage (G4) and its G5 search and seeding additions. Code lives in
`apps/desktop/src-tauri/` (Rust: `src/db/`, `src/commands/`, `migrations/`) and
`apps/desktop/src/storage.ts` (typed TypeScript client). The ChordPro source is
stored verbatim; everything else is derived from it on every save.

## Schema

Two migrations in `apps/desktop/src-tauri/migrations/`: `0001_init.sql` (V1) and
`0002_app_meta_fts_rebuild.sql` (V2). They are forward-only: never edit a
shipped migration, append a new one.

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

## Migrations and opening

`src/db/migrations.rs` uses `rusqlite_migration` and embeds `0001_init.sql` and
`0002_app_meta_fts_rebuild.sql` with `include_str!`. V2 is an
`M::up_with_hook` migration: its hook runs `repo::rebuild_fts` inside the
migration transaction, so a failed rebuild rolls back and leaves
`user_version` at 1. The latest `user_version` is 2. `open(path)`:

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
wiring.

## Repository rules

`src/db/repo.rs` provides save, get, list and delete.

- **Save** creates a song when no `id` is given, with a lowercase UUIDv7 id.
  With an `id` it runs an SQL `UPDATE`: a missing id gives `NotFound`, and
  `created_at` is kept. The `songs` row and its `songs_fts` row (same rowid)
  are written in one transaction.
- **Delete** removes both rows in one transaction; a missing id gives
  `NotFound`.
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
`packages/test-fixtures/fixtures/*.cho` (17 today) with `include_str!`.
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

`src/commands/mod.rs` defines five async Tauri commands: `save_song`,
`get_song`, `list_songs`, `delete_song` and `search_songs`. They share one
`DbState` (`src/commands/state.rs`), a `Mutex<Result<Connection, DbError>>`.
A sixth command, `log_webview_error`, is synchronous: it writes one line
`shir: webview: <text>` to stderr, returns nothing and does not use `DbState`.
Control characters in the text become spaces, and the text is capped at 2000
characters with `…` appended when cut.
A seventh command, `read_text_file` (`src/commands/files.rs`), is also
synchronous and does not use `DbState`: it reads a user-picked file as UTF-8
text with plain `std::fs`. Only regular files up to 1 MiB (1,048,576 bytes)
are accepted, one leading BOM is removed and line endings are untouched. A
failure is a `FileError` `{kind, message}` whose `kind` is `TooLarge`,
`NotUtf8` or `Io`.

The database file is `<app_data_dir>/shir.db` (app identifier
`com.kdcllc.shir`). If it cannot be opened, startup logs one line,
`shir: database unavailable: <cause>`, and the five storage commands return
`Unavailable`; `log_webview_error` and `read_text_file` are unaffected because
they do not use `DbState`.
`DbState::open` opens, migrates, then seeds (see Seeding). A
poisoned lock returns `Storage`.

`build.rs` lists the seven commands, and `capabilities/default.json` grants
`core:default`, `dialog:allow-open` (the `tauri-plugin-dialog` file picker,
registered in `src/lib.rs`), `allow-save-song`, `allow-get-song`,
`allow-list-songs`, `allow-delete-song`, `allow-search-songs`,
`allow-read-text-file` and `allow-log-webview-error` to the main window.

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
failed). It also exports `logWebviewError(message)`, which forwards a webview
error to the app's stderr and never rejects; the webview error forwarder uses
it. The desktop app calls `listSongs`, `getSong` and `searchSongs` for the
sidebar, `saveSong` for the editor and file import, and `deleteSong` for song
deletion: once the delete confirmation dialog is confirmed, `deleteMany`
(`apps/desktop/src/deleteSongs.ts`) calls it once per song, one after another
(see [`DESKTOP.md`](DESKTOP.md)).

`apps/desktop/src/files.ts` wraps the generated `readTextFile` command as
`readTextFile(path)` and the dialog plugin as `pickSongFiles()`. A failure of
`readTextFile` throws a `FileReadError` whose `kind` is a `FileErrorKind`
(`TooLarge`, `NotUtf8`, `Io`) or `"Ipc"` (the call itself failed).

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
  no downgrade.
- The V2 rebuild keeps the rowid link: it runs DELETE plus INSERT per rowid,
  never `REPLACE`.
- A future migration that rebuilds the `songs` table must also rebuild
  `songs_fts`.
