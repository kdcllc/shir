//! Song persistence.
use super::error::DbError;
use super::model::{SaveSongInput, Song, SongSummary};
use rusqlite::Connection;

/// Create (`id: None`) or update a song; returns the stored row. Task 04.
pub fn save_song(_conn: &mut Connection, _input: &SaveSongInput) -> Result<Song, DbError> {
    todo!("task 04")
}

/// Fetch one song; `NotFound` when absent. Task 04.
pub fn get_song(_conn: &Connection, _id: &str) -> Result<Song, DbError> {
    todo!("task 04")
}

/// List all songs, most recently updated first. Task 04.
pub fn list_songs(_conn: &Connection) -> Result<Vec<SongSummary>, DbError> {
    todo!("task 04")
}

/// Delete a song; `NotFound` when absent. Task 04.
pub fn delete_song(_conn: &mut Connection, _id: &str) -> Result<(), DbError> {
    todo!("task 04")
}
