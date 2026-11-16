# Data model

Normative spec for the desktop song storage (G4). Code lives in
`apps/desktop/src-tauri/` (Rust: `src/db/`, `src/commands/`, `migrations/`) and
`apps/desktop/src/storage.ts` (typed TypeScript client). The ChordPro source is
stored verbatim; everything else is derived from it on every save.

## Schema

One migration, `apps/desktop/src-tauri/migrations/0001_init.sql`. It is
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

## Migrations and opening

`src/db/migrations.rs` uses `rusqlite_migration` and embeds `0001_init.sql`
with `include_str!`. `open(path)`:

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
5. Fold the final letters: ך to כ, ם to מ, ן to נ, ף to פ, ץ to צ.
6. `str::to_lowercase`.

Stored text and search queries both go through this same function. Shared
cases live in `packages/test-fixtures/search/normalize_he.cases.json`.

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
`scripts/g4-contract.test.ts` checks both rules.

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

`src/db/search.rs` turns the query into an FTS5 expression:

1. Run `normalize_he` on the query.
2. Turn every non-alphanumeric character into a space.
3. Quote each token as a prefix term, `"tok"*`; terms are joined by an
   implicit AND.

A query with no tokens returns no results. The expression is a bound `MATCH`
parameter. Results are ordered by `bm25`, then `updated_at DESC`, then
`id DESC`, and limited to 100 (`SEARCH_LIMIT`). Shared cases live in
`packages/test-fixtures/search/query.cases.json`.

## Errors

Every storage failure is `{kind, message}` (`src/db/error.rs`), where `kind` is
one of `NotFound`, `Invalid`, `Storage`, `Migration` or `Unavailable`.

## Commands and startup

`src/commands/mod.rs` defines five async Tauri commands: `save_song`,
`get_song`, `list_songs`, `delete_song` and `search_songs`. They share one
`DbState` (`src/commands/state.rs`), a `Mutex<Result<Connection, DbError>>`.

The database file is `<app_data_dir>/shir.db` (app identifier
`com.kdcllc.shir`). If it cannot be opened, startup logs one line,
`shir: database unavailable: …`, and every command returns `Unavailable`. A
poisoned lock returns `Storage`.

`build.rs` lists the five commands, and `capabilities/default.json` grants
`allow-save-song`, `allow-get-song`, `allow-list-songs`, `allow-delete-song` and
`allow-search-songs` to the main window.

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
`getSong`, `listSongs`, `deleteSong` and `searchSongs`. A failure throws a
`StorageError` whose `kind` is an `ErrorKind` or `"Ipc"` (the call itself
failed). No UI uses the client yet.

## Invariants

- `songs` has an implicit rowid (the primary key is TEXT, and the table is not
  `WITHOUT ROWID`). `songs_fts.rowid` equals `songs.rowid`. This link is
  implicit and is written by Rust only.
- Never run `VACUUM`: it may renumber rowids and break the link. If one is ever
  needed, rebuild `songs_fts` from `songs` afterwards.
- Never use `REPLACE` or `INSERT OR REPLACE` on `songs`; updates use `UPDATE`.
  Rowid reuse after a delete is safe only because the song row and its FTS row
  are deleted in one transaction.
- A future migration that rebuilds the `songs` table must also rebuild
  `songs_fts`.
