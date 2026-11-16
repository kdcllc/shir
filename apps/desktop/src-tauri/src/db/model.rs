//! Frozen storage types shared with the UI through the generated bindings.
use serde::{Deserialize, Serialize};
use specta::Type;

/// Maximum accepted size of a ChordPro document, in bytes.
pub const MAX_CHORDPRO_BYTES: usize = 1_048_576;

/// Dominant script of a song's lyrics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    He,
    En,
    Mixed,
}

/// A stored song with its full ChordPro source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub id: String,
    pub chordpro: String,
    pub title: String,
    pub artist: Option<String>,
    pub key: Option<String>,
    pub capo: Option<u8>,
    pub language: Language,
    pub created_at: String,
    pub updated_at: String,
}

/// A song as shown in lists and search results (no ChordPro body).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SongSummary {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub key: Option<String>,
    pub language: Language,
    pub updated_at: String,
}

/// Input for saving a song. `id: None` creates a new song.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveSongInput {
    #[serde(default)]
    pub id: Option<String>,
    pub chordpro: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn language_serializes_lowercase() {
        assert_eq!(serde_json::to_value(Language::He).unwrap(), json!("he"));
        assert_eq!(serde_json::to_value(Language::En).unwrap(), json!("en"));
        assert_eq!(
            serde_json::to_value(Language::Mixed).unwrap(),
            json!("mixed")
        );
    }

    #[test]
    fn song_uses_camel_case_and_null_options() {
        let song = Song {
            id: "i".into(),
            chordpro: "c".into(),
            title: "t".into(),
            artist: None,
            key: None,
            capo: None,
            language: Language::He,
            created_at: "a".into(),
            updated_at: "b".into(),
        };
        assert_eq!(
            serde_json::to_value(&song).unwrap(),
            json!({
                "id": "i", "chordpro": "c", "title": "t", "artist": null,
                "key": null, "capo": null, "language": "he",
                "createdAt": "a", "updatedAt": "b"
            })
        );
        let back: Song = serde_json::from_value(serde_json::to_value(&song).unwrap()).unwrap();
        assert_eq!(back, song);
    }

    #[test]
    fn summary_uses_camel_case() {
        let s = SongSummary {
            id: "i".into(),
            title: "t".into(),
            artist: Some("a".into()),
            key: Some("G".into()),
            language: Language::Mixed,
            updated_at: "u".into(),
        };
        assert_eq!(
            serde_json::to_value(&s).unwrap(),
            json!({"id":"i","title":"t","artist":"a","key":"G","language":"mixed","updatedAt":"u"})
        );
    }

    #[test]
    fn save_input_id_defaults_to_none() {
        let input: SaveSongInput = serde_json::from_value(json!({"chordpro": "x"})).unwrap();
        assert_eq!(input.id, None);
        let with_id: SaveSongInput =
            serde_json::from_value(json!({"id": "7", "chordpro": "x"})).unwrap();
        assert_eq!(with_id.id.as_deref(), Some("7"));
    }

    #[test]
    fn max_chordpro_bytes_is_one_mib() {
        assert_eq!(MAX_CHORDPRO_BYTES, 1_048_576);
    }
}
