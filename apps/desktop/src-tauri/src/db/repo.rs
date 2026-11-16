//! Song persistence: CRUD over `songs` with its `songs_fts` search row kept in step.
use super::error::DbError;
use super::extract::extract;
use super::model::{Language, SaveSongInput, Song, SongSummary, MAX_CHORDPRO_BYTES};
use super::normalize::normalize_he;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

/// Current UTC time as exactly `YYYY-MM-DDTHH:MM:SS.mmmZ` (24 bytes), so that
/// lexicographic order equals chronological order.
fn now_timestamp() -> String {
    format_timestamp(OffsetDateTime::now_utc())
}

fn format_timestamp(t: OffsetDateTime) -> String {
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        t.year(),
        u8::from(t.month()),
        t.day(),
        t.hour(),
        t.minute(),
        t.second(),
        t.millisecond()
    )
}

fn language_str(l: Language) -> &'static str {
    match l {
        Language::He => "he",
        Language::En => "en",
        Language::Mixed => "mixed",
    }
}

fn language_from(s: &str) -> Result<Language, DbError> {
    match s {
        "he" => Ok(Language::He),
        "en" => Ok(Language::En),
        "mixed" => Ok(Language::Mixed),
        other => Err(DbError::storage(format!("unknown language {other:?}"))),
    }
}

/// Map a row selected as `id, title, artist, key, language, updated_at`.
pub(crate) fn summary_from_row(row: &Row<'_>) -> rusqlite::Result<SongSummary> {
    let lang: String = row.get(4)?;
    Ok(SongSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        artist: row.get(2)?,
        key: row.get(3)?,
        language: language_from(&lang).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
        })?,
        updated_at: row.get(5)?,
    })
}

fn song_from_row(row: &Row<'_>) -> rusqlite::Result<Song> {
    let lang: String = row.get(6)?;
    Ok(Song {
        id: row.get(0)?,
        chordpro: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        key: row.get(4)?,
        capo: row.get(5)?,
        language: language_from(&lang).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(e))
        })?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn validate_id(id: &str) -> Result<(), DbError> {
    // `Uuid::parse_str` also accepts simple/braced/urn forms; 36 chars means hyphenated.
    if id.len() == 36 && Uuid::parse_str(id).is_ok() {
        Ok(())
    } else {
        Err(DbError::invalid("id must be a hyphenated UUID"))
    }
}

fn validate_chordpro(chordpro: &str) -> Result<(), DbError> {
    if chordpro
        .trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
        .is_empty()
    {
        return Err(DbError::invalid("chordpro is empty"));
    }
    if chordpro.len() > MAX_CHORDPRO_BYTES {
        return Err(DbError::invalid(format!(
            "chordpro exceeds {MAX_CHORDPRO_BYTES} bytes"
        )));
    }
    Ok(())
}

fn fetch_song(conn: &Connection, id: &str) -> Result<Song, DbError> {
    conn.query_row(
        "SELECT id, chordpro, title, artist, key, capo, language, created_at, updated_at \
         FROM songs WHERE id = ?1",
        [id],
        song_from_row,
    )
    .optional()?
    .ok_or_else(|| DbError::not_found(format!("song {id}")))
}

/// Replace the FTS row for `rowid` with the normalized text of `chordpro`.
fn write_fts(
    tx: &Transaction<'_>,
    rowid: i64,
    title: &str,
    artist: Option<&str>,
    lyrics: &str,
) -> Result<(), DbError> {
    tx.execute("DELETE FROM songs_fts WHERE rowid = ?1", [rowid])?;
    tx.execute(
        "INSERT INTO songs_fts (rowid, title_norm, artist_norm, lyrics_norm) \
         VALUES (?1, ?2, ?3, ?4)",
        params![
            rowid,
            normalize_he(title),
            normalize_he(artist.unwrap_or("")),
            normalize_he(lyrics)
        ],
    )?;
    Ok(())
}

/// Create (`id: None`) or update a song; returns the stored row.
pub fn save_song(conn: &mut Connection, input: &SaveSongInput) -> Result<Song, DbError> {
    validate_chordpro(&input.chordpro)?;
    if let Some(id) = &input.id {
        validate_id(id)?;
    }
    let meta = extract(&input.chordpro);
    let now = now_timestamp();
    let tx = conn.transaction()?;
    let (id, rowid) = match &input.id {
        None => {
            let id = Uuid::now_v7().hyphenated().to_string();
            tx.execute(
                "INSERT INTO songs (id, chordpro, title, artist, key, capo, language, \
                 created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                params![
                    id,
                    input.chordpro,
                    meta.title,
                    meta.artist,
                    meta.key,
                    meta.capo,
                    language_str(meta.language),
                    now
                ],
            )?;
            let rowid = tx.last_insert_rowid();
            (id, rowid)
        }
        Some(id) => {
            let changed = tx.execute(
                "UPDATE songs SET chordpro = ?2, title = ?3, artist = ?4, key = ?5, \
                 capo = ?6, language = ?7, updated_at = ?8 WHERE id = ?1",
                params![
                    id,
                    input.chordpro,
                    meta.title,
                    meta.artist,
                    meta.key,
                    meta.capo,
                    language_str(meta.language),
                    now
                ],
            )?;
            if changed == 0 {
                return Err(DbError::not_found(format!("song {id}")));
            }
            let rowid: i64 =
                tx.query_row("SELECT rowid FROM songs WHERE id = ?1", [id], |r| r.get(0))?;
            (id.clone(), rowid)
        }
    };
    write_fts(
        &tx,
        rowid,
        &meta.title,
        meta.artist.as_deref(),
        &meta.lyrics,
    )?;
    let song = fetch_song(&tx, &id)?;
    tx.commit()?;
    Ok(song)
}

/// Fetch one song; `NotFound` when absent.
pub fn get_song(conn: &Connection, id: &str) -> Result<Song, DbError> {
    validate_id(id)?;
    fetch_song(conn, id)
}

/// List all songs, most recently updated first.
pub fn list_songs(conn: &Connection) -> Result<Vec<SongSummary>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, artist, key, language, updated_at FROM songs \
         ORDER BY updated_at DESC, id DESC",
    )?;
    let rows = stmt.query_map([], summary_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Delete a song; `NotFound` when absent.
pub fn delete_song(conn: &mut Connection, id: &str) -> Result<(), DbError> {
    validate_id(id)?;
    let tx = conn.transaction()?;
    let rowid: Option<i64> = tx
        .query_row("SELECT rowid FROM songs WHERE id = ?1", [id], |r| r.get(0))
        .optional()?;
    let Some(rowid) = rowid else {
        return Err(DbError::not_found(format!("song {id}")));
    };
    tx.execute("DELETE FROM songs_fts WHERE rowid = ?1", [rowid])?;
    tx.execute("DELETE FROM songs WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::open_in_memory;
    use crate::db::search::search_songs;
    use crate::db::ErrorKind;

    const NIL_ID: &str = "00000000-0000-7000-8000-000000000000";

    fn db() -> Connection {
        open_in_memory().unwrap()
    }

    fn input(id: Option<&str>, chordpro: &str) -> SaveSongInput {
        SaveSongInput {
            id: id.map(str::to_owned),
            chordpro: chordpro.to_owned(),
        }
    }

    fn count(c: &Connection, table: &str) -> i64 {
        let sql = match table {
            "songs" => "SELECT count(*) FROM songs",
            "songs_fts" => "SELECT count(*) FROM songs_fts",
            other => panic!("unknown table {other}"),
        };
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn ts_ok(s: &str) -> bool {
        let b = s.as_bytes();
        s.len() == 24
            && b.iter().enumerate().all(|(i, &c)| match i {
                4 | 7 => c == b'-',
                10 => c == b'T',
                13 | 16 => c == b':',
                19 => c == b'.',
                23 => c == b'Z',
                _ => c.is_ascii_digit(),
            })
    }

    fn fixture(name: &str) -> String {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/test-fixtures/fixtures")
            .join(name);
        std::fs::read_to_string(p).unwrap()
    }

    #[test]
    fn create_get_round_trip_is_byte_identical() {
        let mut c = db();
        let niqqud = fixture("he_niqqud.cho");
        let samples = [
            niqqud,
            "{title: Crlf Song}\r\n[C]one\r\n[G]two\r\n".to_owned(),
            "\u{FEFF}{title: Bom Song}\n[C]hello\n".to_owned(),
        ];
        for text in samples {
            let saved = save_song(&mut c, &input(None, &text)).unwrap();
            assert_eq!(saved.chordpro, text);
            let got = get_song(&c, &saved.id).unwrap();
            assert_eq!(got.chordpro.as_bytes(), text.as_bytes());
            assert_eq!(got, saved);
        }
    }

    #[test]
    fn create_assigns_uuid_v7_and_equal_timestamps() {
        let mut c = db();
        let s = save_song(&mut c, &input(None, "{title: A}\n[C]x\n")).unwrap();
        let u = Uuid::parse_str(&s.id).unwrap();
        assert_eq!(u.get_version_num(), 7);
        assert_eq!(s.id, s.id.to_lowercase());
        assert_eq!(s.id.len(), 36);
        assert_eq!(s.created_at, s.updated_at);
        assert_eq!(s.title, "A");
    }

    #[test]
    fn format_timestamp_pins_fixed_instants() {
        let at = |nanos: i128| OffsetDateTime::from_unix_timestamp_nanos(nanos).unwrap();
        // 2026-01-02T03:04:05.006Z
        let t1 = at(1_767_323_045_006_000_000);
        assert_eq!(format_timestamp(t1), "2026-01-02T03:04:05.006Z");
        // 2026-01-02T03:04:05.000Z
        let t2 = at(1_767_323_045_000_000_000);
        assert_eq!(format_timestamp(t2), "2026-01-02T03:04:05.000Z");
        // 2026-01-02T03:04:05.120Z
        let t3 = at(1_767_323_045_120_000_000);
        assert_eq!(format_timestamp(t3), "2026-01-02T03:04:05.120Z");
    }

    #[test]
    fn timestamps_have_fixed_shape() {
        assert!(ts_ok(&now_timestamp()));
        let mut c = db();
        let a = save_song(&mut c, &input(None, "{title: A}\nx\n")).unwrap();
        let b = save_song(&mut c, &input(Some(&a.id), "{title: B}\nx\n")).unwrap();
        for s in [&a.created_at, &a.updated_at, &b.created_at, &b.updated_at] {
            assert!(ts_ok(s), "bad timestamp {s}");
        }
        for s in list_songs(&c).unwrap() {
            assert!(ts_ok(&s.updated_at));
        }
    }

    #[test]
    fn update_preserves_created_at_and_reextracts() {
        let mut c = db();
        let a = save_song(&mut c, &input(None, "{title: Old}\n{key: C}\nlyric\n")).unwrap();
        // Age the row so the update's timestamp is strictly newer.
        c.execute(
            "UPDATE songs SET created_at = '2000-01-01T00:00:00.000Z', \
             updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1",
            [&a.id],
        )
        .unwrap();
        let b = save_song(
            &mut c,
            &input(
                Some(&a.id),
                "{title: New}\n{artist: Dana Testwright}\nother\n",
            ),
        )
        .unwrap();
        assert_eq!(b.id, a.id);
        assert_eq!(b.created_at, "2000-01-01T00:00:00.000Z");
        assert!(b.updated_at.as_str() > "2000-01-01T00:00:00.000Z");
        assert_eq!(b.title, "New");
        assert_eq!(b.artist.as_deref(), Some("Dana Testwright"));
        assert_eq!(b.key, None);
        assert_eq!(count(&c, "songs"), 1);
    }

    #[test]
    fn update_updated_at_not_before_previous() {
        let mut c = db();
        let a = save_song(&mut c, &input(None, "{title: A}\nx\n")).unwrap();
        let b = save_song(&mut c, &input(Some(&a.id), "{title: A}\ny\n")).unwrap();
        assert!(b.updated_at >= a.updated_at);
        assert_eq!(b.created_at, a.created_at);
    }

    #[test]
    fn update_keeps_rowid_and_fts_row_in_step() {
        let mut c = db();
        let first = save_song(&mut c, &input(None, "{title: One}\nalpha\n")).unwrap();
        let second = save_song(&mut c, &input(None, "{title: Two}\nbeta\n")).unwrap();
        let rowid = |c: &Connection, id: &str| -> i64 {
            c.query_row("SELECT rowid FROM songs WHERE id = ?1", [id], |r| r.get(0))
                .unwrap()
        };
        let before = rowid(&c, &first.id);
        save_song(&mut c, &input(Some(&first.id), "{title: One}\ngamma\n")).unwrap();
        assert_eq!(rowid(&c, &first.id), before);
        // Every songs rowid has exactly one fts row, and nothing else is in fts.
        let linked: i64 = c
            .query_row(
                "SELECT count(*) FROM songs s JOIN songs_fts f ON f.rowid = s.rowid",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(linked, 2);
        assert_eq!(count(&c, "songs_fts"), 2);
        assert_ne!(rowid(&c, &second.id), before);
        assert!(search_songs(&c, "alpha").unwrap().is_empty());
        assert_eq!(search_songs(&c, "gamma").unwrap()[0].id, first.id);
    }

    #[test]
    fn update_missing_id_is_not_found_and_creates_nothing() {
        let mut c = db();
        save_song(&mut c, &input(None, "{title: A}\nx\n")).unwrap();
        let err = save_song(&mut c, &input(Some(NIL_ID), "{title: B}\ny\n")).unwrap_err();
        assert_eq!(err.kind, ErrorKind::NotFound);
        assert_eq!(count(&c, "songs"), 1);
        assert_eq!(count(&c, "songs_fts"), 1);
    }

    #[test]
    fn get_and_delete_unknown_id_are_not_found() {
        let mut c = db();
        assert_eq!(get_song(&c, NIL_ID).unwrap_err().kind, ErrorKind::NotFound);
        assert_eq!(
            delete_song(&mut c, NIL_ID).unwrap_err().kind,
            ErrorKind::NotFound
        );
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let mut c = db();
        for bad in ["", "   \n\t", "\u{FEFF}", " \u{FEFF}\n "] {
            let e = save_song(&mut c, &input(None, bad)).unwrap_err();
            assert_eq!(e.kind, ErrorKind::Invalid, "{bad:?}");
        }
        let wide = format!("{}a", "א".repeat(MAX_CHORDPRO_BYTES / 2));
        assert_eq!(wide.len(), MAX_CHORDPRO_BYTES + 1);
        let e = save_song(&mut c, &input(None, &wide)).unwrap_err();
        assert_eq!(e.kind, ErrorKind::Invalid);
        let big = "a".repeat(MAX_CHORDPRO_BYTES + 1);
        assert_eq!(
            save_song(&mut c, &input(None, &big)).unwrap_err().kind,
            ErrorKind::Invalid
        );
        for bad_id in [
            "nope",
            "",
            "0000000000007000800000000000000000",
            "00000000000070008000000000000000",
            "{00000000-0000-7000-8000-000000000000}",
        ] {
            assert_eq!(
                save_song(&mut c, &input(Some(bad_id), "x"))
                    .unwrap_err()
                    .kind,
                ErrorKind::Invalid,
                "save {bad_id}"
            );
            assert_eq!(get_song(&c, bad_id).unwrap_err().kind, ErrorKind::Invalid);
            assert_eq!(
                delete_song(&mut c, bad_id).unwrap_err().kind,
                ErrorKind::Invalid
            );
        }
        assert_eq!(count(&c, "songs"), 0);
    }

    #[test]
    fn exactly_max_bytes_is_accepted() {
        let mut c = db();
        let exact = format!(
            "{}{}",
            "{title: Big}\n",
            "a".repeat(MAX_CHORDPRO_BYTES - 13)
        );
        assert_eq!(exact.len(), MAX_CHORDPRO_BYTES);
        let s = save_song(&mut c, &input(None, &exact)).unwrap();
        assert_eq!(s.chordpro.len(), MAX_CHORDPRO_BYTES);
        let over = format!("{exact}a");
        assert_eq!(
            save_song(&mut c, &input(None, &over)).unwrap_err().kind,
            ErrorKind::Invalid
        );
    }

    #[test]
    fn list_orders_by_updated_at_desc_then_id_desc() {
        let mut c = db();
        let a = save_song(&mut c, &input(None, "{title: A}\nx\n")).unwrap();
        let b = save_song(&mut c, &input(None, "{title: B}\nx\n")).unwrap();
        let d = save_song(&mut c, &input(None, "{title: D}\nx\n")).unwrap();
        // The first-inserted tied row gets the larger id, so only `id DESC` yields a, d.
        let big_id = "ffffffff-ffff-7fff-bfff-ffffffffffff";
        let small_id = "00000000-0000-7000-8000-000000000001";
        for (old, new_id, ts) in [
            (&a.id, big_id, "2030-01-01T00:00:00.000Z"),
            (&b.id, b.id.as_str(), "2031-01-01T00:00:00.000Z"),
            (&d.id, small_id, "2030-01-01T00:00:00.000Z"),
        ] {
            c.execute(
                "UPDATE songs SET id = ?2, updated_at = ?3 WHERE id = ?1",
                [old.as_str(), new_id, ts],
            )
            .unwrap();
        }
        let ids: Vec<String> = list_songs(&c).unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(
            ids,
            vec![b.id.clone(), big_id.to_owned(), small_id.to_owned()]
        );
    }

    #[test]
    fn list_empty_db_is_empty() {
        assert!(list_songs(&db()).unwrap().is_empty());
    }

    #[test]
    fn delete_removes_song_and_fts_row() {
        let mut c = db();
        let a = save_song(&mut c, &input(None, "{title: Quokka}\nquokka anthem\n")).unwrap();
        let keep = save_song(&mut c, &input(None, "{title: Keep}\nkeepsake\n")).unwrap();
        assert_eq!(search_songs(&c, "quokka").unwrap().len(), 1);
        delete_song(&mut c, &a.id).unwrap();
        assert!(search_songs(&c, "quokka").unwrap().is_empty());
        assert_eq!(count(&c, "songs"), 1);
        assert_eq!(count(&c, "songs_fts"), 1);
        assert_eq!(search_songs(&c, "keepsake").unwrap()[0].id, keep.id);
    }

    #[test]
    fn failed_fts_write_rolls_back_the_song_row() {
        let mut c = db();
        c.execute_batch("DROP TABLE songs_fts").unwrap();
        let e = save_song(&mut c, &input(None, "{title: A}\nx\n")).unwrap_err();
        assert_eq!(e.kind, ErrorKind::Storage);
        assert_eq!(count(&c, "songs"), 0);
    }
}
