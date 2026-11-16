//! Managed database state shared by the Tauri commands.
use crate::db::ErrorKind;
use crate::db::{migrations, seed, DbError};
use rusqlite::Connection;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

/// The app's single SQLite connection, or the error that kept it from opening.
pub struct DbState {
    conn: Mutex<Result<Connection, DbError>>,
}

impl DbState {
    /// Open (and migrate) the database at `path`, then seed the bundled songs once. An open
    /// failure is stored, not returned; a seeding failure is logged and the connection kept.
    pub fn open(path: &Path) -> Self {
        Self::open_with_log(path, &mut std::io::stderr())
    }

    /// Like [`DbState::open`], writing the seeding-failure line to `log` (injectable for tests).
    pub fn open_with_log(path: &Path, log: &mut dyn Write) -> Self {
        let mut opened = migrations::open(path);
        if let Ok(conn) = opened.as_mut() {
            if let Err(e) = seed::seed_bundled(conn) {
                // Best effort: a closed log must not fail startup.
                let _ = writeln!(log, "shir: seeding failed: {e}");
            }
        }
        Self {
            conn: Mutex::new(opened),
        }
    }

    /// A migrated in-memory database, for tests.
    pub fn in_memory() -> Self {
        Self {
            conn: Mutex::new(migrations::open_in_memory()),
        }
    }

    /// A state whose every use fails with `Unavailable` carrying `err`.
    pub fn unavailable(err: DbError) -> Self {
        Self {
            conn: Mutex::new(Err(err)),
        }
    }

    /// Run `f` on the connection. Never panics.
    pub fn with_conn<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<T, DbError>,
    ) -> Result<T, DbError> {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| DbError::storage("database lock poisoned"))?;
        match guard.as_mut() {
            Ok(conn) => f(conn),
            Err(e) => Err(DbError::unavailable(format!("database unavailable: {e}"))),
        }
    }

    /// The startup stderr line for an unopenable database, or `None` when it is healthy.
    pub fn unavailable_line(&self) -> Option<String> {
        let guard = self.conn.lock().ok()?;
        let e = guard.as_ref().err()?;
        // An `Unavailable` error already is the cause (app-data-dir branch); any other kind
        // keeps its own `Kind:` prefix. Either way no outer `Unavailable:` is added.
        let cause = if e.kind == ErrorKind::Unavailable {
            e.message.clone()
        } else {
            e.to_string()
        };
        Some(format!("shir: database unavailable: {cause}"))
    }

    #[cfg(test)]
    pub(crate) fn poison(&self) {
        let _ = std::thread::scope(|s| {
            s.spawn(|| {
                let _g = self.conn.lock();
                panic!("poison the lock");
            })
            .join()
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::list_songs_impl;
    use crate::db::seed::{bundled_songs, SEED_FLAG_KEY};
    use rusqlite::OptionalExtension;

    fn flag(state: &DbState) -> Option<String> {
        state
            .with_conn(|c| {
                Ok(c.query_row(
                    "SELECT value FROM app_meta WHERE key = ?1",
                    [SEED_FLAG_KEY],
                    |r| r.get::<_, String>(0),
                )
                .optional()?)
            })
            .unwrap()
    }

    #[test]
    fn open_seeds_and_reopen_keeps_count() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shir.db");
        let n = bundled_songs().len();
        {
            let state = DbState::open(&path);
            assert_eq!(list_songs_impl(&state).unwrap().len(), n);
        }
        let state = DbState::open(&path);
        assert_eq!(list_songs_impl(&state).unwrap().len(), n);
        assert_eq!(flag(&state), Some(n.to_string()));
    }

    #[test]
    fn seeding_failure_leaves_db_usable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shir.db");
        {
            let conn = migrations::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TRIGGER block_seed BEFORE INSERT ON songs \
                 WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'bundled_seeded') \
                 BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
            )
            .unwrap();
        }
        let state = DbState::open(&path);
        assert_eq!(list_songs_impl(&state).unwrap().len(), 0);
        assert_eq!(flag(&state), None);
    }

    #[test]
    fn seeding_failure_writes_exactly_one_line_to_the_log() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shir.db");
        {
            let conn = migrations::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TRIGGER block_seed BEFORE INSERT ON songs \
                 WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'bundled_seeded') \
                 BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
            )
            .unwrap();
        }
        let mut log: Vec<u8> = Vec::new();
        let _state = DbState::open_with_log(&path, &mut log);
        let text = String::from_utf8(log).unwrap();
        assert_eq!(text.lines().count(), 1, "{text:?}");
        assert!(text.ends_with('\n'));
        assert!(text.starts_with("shir: seeding failed: "), "{text:?}");
        assert!(text.contains("blocked"), "{text:?}");
    }

    #[test]
    fn successful_open_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let mut log: Vec<u8> = Vec::new();
        let _state = DbState::open_with_log(&dir.path().join("shir.db"), &mut log);
        assert!(log.is_empty(), "{log:?}");
    }

    #[test]
    fn unavailable_line_is_none_when_healthy() {
        assert_eq!(DbState::in_memory().unavailable_line(), None);
    }

    #[test]
    fn unavailable_line_for_directory_at_path() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("shir.db");
        std::fs::create_dir(&bad).unwrap();
        let line = DbState::open(&bad).unavailable_line().unwrap();
        let cause = migrations::open(&bad).unwrap_err();
        assert_eq!(line, format!("shir: database unavailable: {cause}"));
        assert!(line.contains("Storage: "), "{line}");
        assert!(!line.contains("Unavailable"), "{line}");
        assert_eq!(line.matches("database unavailable").count(), 1, "{line}");
    }

    #[test]
    fn unavailable_line_for_app_dir_branch() {
        let err = DbError::unavailable("cannot resolve app data dir: nope");
        let line = DbState::unavailable(err).unavailable_line().unwrap();
        assert_eq!(
            line,
            "shir: database unavailable: cannot resolve app data dir: nope"
        );
    }

    #[test]
    fn with_conn_error_stays_unavailable_and_starts_with_database_unavailable() {
        let st = DbState::unavailable(DbError::unavailable("x"));
        let e = st.with_conn(|_| Ok(())).unwrap_err();
        assert_eq!(e.kind, ErrorKind::Unavailable);
        assert!(e.message.starts_with("database unavailable"));
    }

    #[test]
    fn in_memory_does_not_seed() {
        let state = DbState::in_memory();
        assert_eq!(list_songs_impl(&state).unwrap().len(), 0);
        assert_eq!(flag(&state), None);
    }

    #[test]
    fn unavailable_does_not_seed() {
        let state = DbState::unavailable(DbError::storage("x"));
        assert!(list_songs_impl(&state).is_err());
    }
}
