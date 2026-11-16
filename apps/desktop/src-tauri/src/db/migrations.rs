//! Connection opening and schema migrations.
use super::error::DbError;
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::path::Path;

/// The ordered schema migrations. Forward-only: append new entries, never edit old ones.
pub fn migrations() -> Migrations<'static> {
    Migrations::new(vec![M::up(include_str!("../../migrations/0001_init.sql"))])
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
    fn in_memory_applies_v1() {
        let c = open_in_memory().unwrap();
        assert_eq!(user_version(&c), 1);
        assert!(table_exists(&c, "songs"));
        assert!(table_exists(&c, "songs_fts"));
    }

    #[test]
    fn migrate_twice_is_noop() {
        let mut c = open_in_memory().unwrap();
        assert!(migrate(&mut c).is_ok());
        assert!(migrate(&mut c).is_ok());
        assert_eq!(user_version(&c), 1);
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
            assert_eq!(user_version(&c), 1);
        }
        let c = open(&path).unwrap();
        assert_eq!(user_version(&c), 1);
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
}
