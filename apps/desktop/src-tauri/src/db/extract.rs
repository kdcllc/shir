//! Metadata extraction from ChordPro source.
use super::model::Language;

/// Fields derived from a ChordPro document for indexing.
#[derive(Debug, Clone, PartialEq)]
pub struct Extracted {
    pub title: String,
    pub artist: Option<String>,
    pub key: Option<String>,
    /// Capo fret, 0-24 (docs/CHORDPRO.md § Song fields); absent when invalid.
    pub capo: Option<u8>,
    pub language: Language,
    /// Lyrics text with chords removed, used for search indexing.
    pub lyrics: String,
}

/// Extract title, artist, key, capo, language and lyrics. Implemented in task 02.
pub fn extract(_chordpro: &str) -> Extracted {
    todo!("task 02")
}
