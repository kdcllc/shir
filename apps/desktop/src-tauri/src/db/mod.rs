//! SQLite storage layer: types, migrations, repository and search.
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

pub mod error;
pub mod extract;
pub mod migrations;
pub mod model;
pub mod normalize;
pub mod repo;
pub mod search;

pub use error::{DbError, ErrorKind};
pub use model::{Language, SaveSongInput, Song, SongSummary, MAX_CHORDPRO_BYTES};
