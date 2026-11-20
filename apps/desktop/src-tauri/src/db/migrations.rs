//! Connection opening and schema migrations.
use super::error::DbError;
use super::repo;
use rusqlite::Connection;
use rusqlite_migration::{HookError, Migrations, M};
use std::path::Path;

/// The ordered schema migrations. Forward-only: append new entries, never edit old ones.
pub fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../../migrations/0001_init.sql")),
        // V2 rebuilds the search index because the normalization rule changed.
        M::up_with_hook(
            include_str!("../../migrations/0002_app_meta_fts_rebuild.sql"),
            |tx: &rusqlite::Transaction| {
                repo::rebuild_fts(tx)
                    .map(|_| ())
                    .map_err(|e| HookError::Hook(e.message))
            },
        ),
        M::up(include_str!("../../migrations/0003_setlists.sql")),
    ])
}

/// Open (creating if needed) a file-backed database and migrate it.
pub fn open(path: &Path) -> Result<Connection, DbError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| DbError::storage(format!("create dir {}: {e}", parent.display())))?;
        }
    }
    let mut conn = Connection::open(path)?;
    // journal_mode returns a row, so read it rather than execute it.
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// Open a migrated in-memory database.
pub fn open_in_memory() -> Result<Connection, DbError> {
    let mut conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// Bring the connection's schema up to date. A database written by a newer app
/// (`user_version` beyond the latest migration) is refused with `ErrorKind::Migration`.
pub fn migrate(conn: &mut Connection) -> Result<(), DbError> {
    migrations().to_latest(conn)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ErrorKind;

    fn user_version(c: &Connection) -> i64 {
        c.query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap()
    }

    fn table_exists(c: &Connection, name: &str) -> bool {
        c.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = ?1",
            [name],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            == 1
    }

    fn insert_song(c: &Connection, lang: &str, capo: &str) -> rusqlite::Result<usize> {
        c.execute(
            &format!(
                "INSERT INTO songs (id, chordpro, language, capo, created_at, updated_at) \
                 VALUES ('a', 'x', ?1, {capo}, 't', 't')"
            ),
            [lang],
        )
    }

    #[test]
    fn migrations_validate() {
        assert!(migrations().validate().is_ok());
    }

    #[test]
    fn in_memory_applies_latest() {
        let c = open_in_memory().unwrap();
        assert_eq!(user_version(&c), 3);
        assert!(table_exists(&c, "songs"));
        assert!(table_exists(&c, "songs_fts"));
        assert!(table_exists(&c, "app_meta"));
        let sql: String = c
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name = 'app_meta'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(sql.contains("STRICT"), "app_meta must be STRICT: {sql}");
    }

    #[test]
    fn migrate_twice_is_noop() {
        let mut c = open_in_memory().unwrap();
        assert!(migrate(&mut c).is_ok());
        assert!(migrate(&mut c).is_ok());
        assert_eq!(user_version(&c), 3);
    }

    #[test]
    fn file_db_pragmas_and_reopen() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nested").join("sub").join("shir.db");
        {
            let c = open(&path).unwrap();
            let mode: String = c
                .query_row("PRAGMA journal_mode", [], |r| r.get(0))
                .unwrap();
            assert_eq!(mode.to_lowercase(), "wal");
            let fk: i64 = c
                .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
                .unwrap();
            assert_eq!(fk, 1);
            let bt: i64 = c
                .query_row("PRAGMA busy_timeout", [], |r| r.get(0))
                .unwrap();
            assert_eq!(bt, 5000);
            assert_eq!(user_version(&c), 3);
        }
        let c = open(&path).unwrap();
        assert_eq!(user_version(&c), 3);
        assert!(table_exists(&c, "songs_fts"));
    }

    #[test]
    fn fts5_match_returns_row() {
        let c = open_in_memory().unwrap();
        c.execute(
            "INSERT INTO songs_fts (rowid, title_norm, artist_norm, lyrics_norm) \
             VALUES (7, 'shalom', 'artist', 'hello world')",
            [],
        )
        .unwrap();
        let rowid: i64 = c
            .query_row(
                "SELECT rowid FROM songs_fts WHERE songs_fts MATCH 'hello'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rowid, 7);
    }

    #[test]
    fn constraints_reject_bad_rows() {
        let c = open_in_memory().unwrap();
        assert!(insert_song(&c, "he", "NULL").is_ok());
        c.execute("DELETE FROM songs", []).unwrap();
        assert!(insert_song(&c, "fr", "NULL").is_err(), "language CHECK");
        assert!(insert_song(&c, "en", "25").is_err(), "capo CHECK");
        assert!(insert_song(&c, "en", "1.5").is_err(), "STRICT capo type");
        assert!(insert_song(&c, "en", "-1").is_err(), "capo lower bound");
        assert!(insert_song(&c, "en", "24").is_ok());
        c.execute("DELETE FROM songs", []).unwrap();
        assert!(insert_song(&c, "en", "0").is_ok());
    }

    #[test]
    fn newer_user_version_is_refused() {
        let mut c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "user_version", 99).unwrap();
        let err = migrate(&mut c).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Migration);
    }

    fn v1_only(c: &mut Connection) {
        let v1 = Migrations::new(vec![M::up(include_str!("../../migrations/0001_init.sql"))]);
        v1.to_latest(c).unwrap();
    }

    fn count(c: &Connection, table: &str) -> i64 {
        c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn rerun_is_idempotent() {
        let mut c = open_in_memory().unwrap();
        c.execute_batch(
            "INSERT INTO songs (id, chordpro, language, created_at, updated_at) \
             VALUES ('a', 'x', 'en', 't', 't')",
        )
        .unwrap();
        migrate(&mut c).unwrap();
        assert_eq!(user_version(&c), 3);
        assert_eq!(count(&c, "songs"), 1);
        assert_eq!(count(&c, "app_meta"), 0);
        // The V2 hook does not run again: the song added after V2 stays without an FTS row.
        assert_eq!(count(&c, "songs_fts"), 0);
    }

    #[test]
    fn v1_upgrade_rebuilds_fts_with_new_rule() {
        let mut c = Connection::open_in_memory().unwrap();
        v1_only(&mut c);
        assert_eq!(user_version(&c), 1);
        c.execute(
            "INSERT INTO songs (id, chordpro, title, language, created_at, updated_at) \
             VALUES ('s1', ?1, 'x', 'he', 't', 't')",
            ["{title: x}\nצה\"ל\n"],
        )
        .unwrap();
        c.execute(
            "INSERT INTO songs_fts (rowid, title_norm, artist_norm, lyrics_norm) \
             SELECT rowid, 'x', '', 'צה ל' FROM songs",
            [],
        )
        .unwrap();
        // An orphan FTS row (no songs row) that the rebuild must drop.
        c.execute(
            "INSERT INTO songs_fts (rowid, title_norm, artist_norm, lyrics_norm) \
             VALUES (999, 'orphan', '', 'orphan')",
            [],
        )
        .unwrap();
        assert_eq!(crate::db::search::search_songs(&c, "צהל").unwrap().len(), 0);

        migrate(&mut c).unwrap();

        assert_eq!(user_version(&c), 3);
        assert_eq!(crate::db::search::search_songs(&c, "צהל").unwrap().len(), 1);
        assert_eq!(count(&c, "songs_fts"), count(&c, "songs"));
        let (a, b): (i64, i64) = c
            .query_row(
                "SELECT (SELECT rowid FROM songs), (SELECT rowid FROM songs_fts)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn failed_rebuild_rolls_back_migration() {
        let mut c = Connection::open_in_memory().unwrap();
        v1_only(&mut c);
        c.execute_batch("DROP TABLE songs_fts").unwrap();
        let err = migrate(&mut c).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Migration);
        assert_eq!(user_version(&c), 1);
        assert!(!table_exists(&c, "app_meta"));
    }

    fn v2_only(c: &mut Connection) {
        let all = migrations();
        all.to_version(c, 2).unwrap();
    }

    fn insert_setlist(c: &Connection, name: &str) -> rusqlite::Result<usize> {
        c.execute(
            "INSERT INTO setlists (id, name, created_at, updated_at) VALUES ('l', ?1, 't', 't')",
            [name],
        )
    }

    fn insert_item(
        c: &Connection,
        id: &str,
        position: &str,
        transpose: &str,
        capo: &str,
    ) -> rusqlite::Result<usize> {
        c.execute(
            &format!(
                "INSERT INTO setlist_items (id, setlist_id, song_id, position, transpose, capo) \
                 VALUES ('{id}', 'l', 'a', {position}, {transpose}, {capo})"
            ),
            [],
        )
    }

    #[test]
    fn v2_upgrade_adds_setlists_and_keeps_songs_and_fts() {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        v2_only(&mut c);
        assert_eq!(user_version(&c), 2);
        assert!(!table_exists(&c, "setlists"));
        c.execute(
            "INSERT INTO songs (id, chordpro, title, language, created_at, updated_at) \
             VALUES ('s1', '{title: One}', 'One', 'en', 't1', 't2')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO songs_fts (rowid, title_norm, artist_norm, lyrics_norm) \
             SELECT rowid, 'one', '', 'words' FROM songs",
            [],
        )
        .unwrap();
        let snapshot = |c: &Connection| -> String {
            c.query_row(
                "SELECT s.rowid || '|' || s.id || '|' || s.chordpro || '|' || s.title || '|' || \
                 s.created_at || '|' || s.updated_at || '|' || f.title_norm || '|' || f.lyrics_norm \
                 FROM songs s JOIN songs_fts f ON f.rowid = s.rowid",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        let before = snapshot(&c);
        let (songs_before, fts_before) = (count(&c, "songs"), count(&c, "songs_fts"));

        migrate(&mut c).unwrap();

        assert_eq!(user_version(&c), 3);
        assert!(table_exists(&c, "setlists"));
        assert!(table_exists(&c, "setlist_items"));
        assert_eq!(snapshot(&c), before);
        assert_eq!(count(&c, "songs"), songs_before);
        assert_eq!(count(&c, "songs_fts"), fts_before);
        assert_eq!(count(&c, "setlists"), 0);
        for t in ["setlists", "setlist_items"] {
            let sql: String = c
                .query_row("SELECT sql FROM sqlite_master WHERE name = ?1", [t], |r| {
                    r.get(0)
                })
                .unwrap();
            assert!(sql.contains("STRICT"), "{t} must be STRICT: {sql}");
        }
    }

    #[test]
    fn v3_rerun_keeps_setlist_rows() {
        let mut c = open_in_memory().unwrap();
        insert_song(&c, "en", "NULL").unwrap();
        insert_setlist(&c, "Sunday").unwrap();
        insert_item(&c, "i1", "0", "0", "NULL").unwrap();
        migrate(&mut c).unwrap();
        assert_eq!(user_version(&c), 3);
        assert_eq!(count(&c, "setlists"), 1);
        assert_eq!(count(&c, "setlist_items"), 1);
    }

    #[test]
    fn setlist_name_check_rejects_only_bad_names() {
        let c = open_in_memory().unwrap();
        assert!(insert_setlist(&c, "x").is_ok(), "1 char is valid");
        c.execute("DELETE FROM setlists", []).unwrap();
        assert!(insert_setlist(&c, &"a".repeat(200)).is_ok(), "200 is valid");
        c.execute("DELETE FROM setlists", []).unwrap();
        assert!(insert_setlist(&c, &"a".repeat(201)).is_err(), "201 chars");
        assert!(insert_setlist(&c, "     ").is_err(), "spaces only");
        assert!(insert_setlist(&c, "").is_err(), "empty");
    }

    #[test]
    fn setlist_item_checks_reject_only_their_own_bad_value() {
        let c = open_in_memory().unwrap();
        insert_song(&c, "en", "NULL").unwrap();
        insert_setlist(&c, "Sunday").unwrap();
        // Boundary values that must be accepted.
        assert!(insert_item(&c, "ok1", "0", "11", "24").is_ok());
        assert!(insert_item(&c, "ok2", "1", "-11", "0").is_ok());
        assert!(insert_item(&c, "ok3", "2", "0", "NULL").is_ok());
        // Each row below violates exactly one rule.
        assert!(
            insert_item(&c, "b1", "3", "12", "NULL").is_err(),
            "transpose 12"
        );
        assert!(
            insert_item(&c, "b2", "3", "-12", "NULL").is_err(),
            "transpose -12"
        );
        assert!(insert_item(&c, "b3", "3", "0", "25").is_err(), "capo 25");
        assert!(insert_item(&c, "b4", "3", "0", "-1").is_err(), "capo -1");
        assert!(
            insert_item(&c, "b5", "-1", "0", "NULL").is_err(),
            "position -1"
        );
        assert!(
            insert_item(&c, "b6", "3", "0", "1.5").is_err(),
            "STRICT capo type"
        );
        assert!(
            insert_item(&c, "b7", "2", "0", "NULL").is_err(),
            "duplicate position"
        );
        assert!(
            insert_item(&c, "b8", "3", "0", "NULL").is_ok(),
            "control: 3 is free"
        );
        assert!(
            c.execute(
                "INSERT INTO setlist_items (id, setlist_id, song_id, position) \
                 VALUES ('b9', 'l', 'missing', 4)",
                [],
            )
            .is_err(),
            "song FK"
        );
        assert!(
            c.execute(
                "INSERT INTO setlist_items (id, setlist_id, song_id, position) \
                 VALUES ('b10', 'missing', 'a', 4)",
                [],
            )
            .is_err(),
            "setlist FK"
        );
    }
}
