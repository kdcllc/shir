//! Connection opening and schema migrations.
use super::error::DbError;
use rusqlite::Connection;
use rusqlite_migration::Migrations;
use std::path::Path;

/// The ordered schema migrations. Implemented in task 03.
pub fn migrations() -> Migrations<'static> {
    todo!("task 03")
}

/// Open (creating if needed) a file-backed database and migrate it. Task 03.
pub fn open(_path: &Path) -> Result<Connection, DbError> {
    todo!("task 03")
}

/// Open a migrated in-memory database. Task 03.
pub fn open_in_memory() -> Result<Connection, DbError> {
    todo!("task 03")
}

/// Bring the connection's schema up to date. Task 03.
pub fn migrate(_conn: &mut Connection) -> Result<(), DbError> {
    todo!("task 03")
}
