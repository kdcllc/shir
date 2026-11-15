//! Full-text song search.
use super::error::DbError;
use super::model::SongSummary;
use rusqlite::Connection;

/// Maximum number of search results returned.
pub const SEARCH_LIMIT: usize = 100;

/// Search songs by normalized query, at most `SEARCH_LIMIT` results. Task 04.
pub fn search_songs(_conn: &Connection, _query: &str) -> Result<Vec<SongSummary>, DbError> {
    todo!("task 04")
}
