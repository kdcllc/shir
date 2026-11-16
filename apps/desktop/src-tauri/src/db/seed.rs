//! First-run seeding of the bundled sample songs into an empty library.
use super::error::DbError;
use rusqlite::Connection;

/// `app_meta` key whose presence records that the bundled songs were already seeded.
pub const SEED_FLAG_KEY: &str = "bundled_seeded";

/// A sample song compiled into the binary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BundledSong {
    /// Repo-relative source path, e.g. `samples/demo-shir-bilingual.cho`.
    pub path: &'static str,
    /// Full ChordPro text of the song.
    pub chordpro: &'static str,
}

/// The bundled sample songs, in seeding order.
pub fn bundled_songs() -> &'static [BundledSong] {
    &[]
}

/// Seed every bundled song exactly once, in a single transaction, when the
/// [`SEED_FLAG_KEY`] `app_meta` flag is absent; the flag is set in the same transaction.
/// Returns the number of songs seeded. Returns `Ok(0)` and changes nothing when the flag
/// is already present. On any error the transaction is rolled back (no songs, no flag).
pub fn seed_bundled(_conn: &mut Connection) -> Result<usize, DbError> {
    Ok(0)
}
