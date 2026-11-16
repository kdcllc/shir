//! Managed database state shared by the Tauri commands.
use crate::db::{migrations, DbError};
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

/// The app's single SQLite connection, or the error that kept it from opening.
pub struct DbState {
    conn: Mutex<Result<Connection, DbError>>,
}

impl DbState {
    /// Open (and migrate) the database at `path`. An open failure is stored, not returned.
    pub fn open(path: &Path) -> Self {
        Self {
            conn: Mutex::new(migrations::open(path)),
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
