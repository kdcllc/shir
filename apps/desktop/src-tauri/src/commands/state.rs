//! Managed database state shared by the Tauri commands.
use crate::db::{migrations, seed, DbError};
use rusqlite::Connection;
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
        let mut opened = migrations::open(path);
        if let Ok(conn) = opened.as_mut() {
            if let Err(e) = seed::seed_bundled(conn) {
                eprintln!("shir: seeding failed: {e}");
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
