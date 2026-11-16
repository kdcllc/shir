//! First-run seeding of the bundled sample songs into the library.
use super::error::DbError;
use super::repo;
use rusqlite::{Connection, OptionalExtension};

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

/// One embedded song; the path is relative to the repo root (and to this file via `../`).
macro_rules! song {
    ($path:literal) => {
        BundledSong {
            path: $path,
            chordpro: include_str!(concat!("../../../../../", $path)),
        }
    };
}

/// Every bundled song, sorted by `path` in byte order.
static BUNDLED: &[BundledSong] = &[
    song!("packages/test-fixtures/fixtures/aliases_input.cho"),
    song!("packages/test-fixtures/fixtures/chord_only_line.cho"),
    song!("packages/test-fixtures/fixtures/dense_chords.cho"),
    song!("packages/test-fixtures/fixtures/en_plain.cho"),
    song!("packages/test-fixtures/fixtures/he_niqqud.cho"),
    song!("packages/test-fixtures/fixtures/he_plain.cho"),
    song!("packages/test-fixtures/fixtures/long_wrap_line.cho"),
    song!("packages/test-fixtures/fixtures/malformed_input.cho"),
    song!("packages/test-fixtures/fixtures/mixed_he_en.cho"),
    song!("packages/test-fixtures/fixtures/sections_he.cho"),
    song!("packages/test-fixtures/fixtures/sharp_flat_extensions.cho"),
    song!("packages/test-fixtures/fixtures/slash_chords_key.cho"),
    song!("packages/test-fixtures/fixtures/tab_block.cho"),
    song!("packages/test-fixtures/fixtures/unknown_directives.cho"),
    song!("samples/demo-shir-bilingual.cho"),
    song!("samples/demo-twin-he.cho"),
    song!("samples/demo-twin-translit.cho"),
];

/// The bundled sample songs, sorted by path, in seeding order.
pub fn bundled_songs() -> &'static [BundledSong] {
    BUNDLED
}

/// Seed every bundled song exactly once, in a single transaction, when the
/// [`SEED_FLAG_KEY`] `app_meta` flag is absent; the flag is set in the same transaction.
/// Returns the number of songs seeded. Returns `Ok(0)` and changes nothing when the flag
/// is already present. On any error the transaction is rolled back (no songs, no flag).
pub fn seed_bundled(conn: &mut Connection) -> Result<usize, DbError> {
    let tx = conn.transaction()?;
    let seeded: Option<String> = tx
        .query_row(
            "SELECT value FROM app_meta WHERE key = ?1",
            [SEED_FLAG_KEY],
            |r| r.get(0),
        )
        .optional()?;
    if seeded.is_some() {
        return Ok(0);
    }
    let songs = bundled_songs();
    for song in songs {
        repo::insert_song_tx(&tx, song.chordpro)?;
    }
    let count = songs.len();
    tx.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2)",
        rusqlite::params![SEED_FLAG_KEY, count.to_string()],
    )?;
    tx.commit()?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{extract::extract, migrations, repo, search, SaveSongInput};
    use std::collections::BTreeSet;
    use std::path::PathBuf;

    fn conn() -> Connection {
        migrations::open_in_memory().unwrap()
    }

    fn count(c: &Connection, table: &str) -> i64 {
        c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    fn flag(c: &Connection) -> Option<String> {
        c.query_row(
            "SELECT value FROM app_meta WHERE key = ?1",
            [SEED_FLAG_KEY],
            |r| r.get(0),
        )
        .optional()
        .unwrap()
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
    }

    /// Repo-relative, `/`-separated paths of the `.cho` files that must be bundled.
    fn disk_paths() -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        for dir in ["samples", "packages/test-fixtures/fixtures"] {
            for entry in std::fs::read_dir(repo_root().join(dir)).unwrap() {
                let name = entry.unwrap().file_name().into_string().unwrap();
                if name.ends_with(".cho") && !name.ends_with(".canonical.cho") {
                    out.insert(format!("{dir}/{name}"));
                }
            }
        }
        out
    }

    #[test]
    fn embedded_set_equals_disk_and_bytes_match() {
        let embedded: BTreeSet<String> =
            bundled_songs().iter().map(|s| s.path.to_string()).collect();
        assert_eq!(embedded.len(), bundled_songs().len(), "duplicate paths");
        assert_eq!(embedded, disk_paths());
        for s in bundled_songs() {
            let on_disk = std::fs::read_to_string(repo_root().join(s.path)).unwrap();
            assert_eq!(s.chordpro, on_disk, "{} differs from disk", s.path);
        }
    }

    #[test]
    fn bundled_paths_are_sorted_and_scoped() {
        let paths: Vec<&str> = bundled_songs().iter().map(|s| s.path).collect();
        let mut sorted = paths.clone();
        sorted.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
        assert_eq!(paths, sorted);
        assert!(!paths.is_empty());
        for p in paths {
            assert!(
                p.starts_with("samples/") || p.starts_with("packages/test-fixtures/fixtures/"),
                "unexpected bundled path {p}"
            );
            assert!(!p.contains('\\'), "path must use / separators: {p}");
        }
    }

    #[test]
    fn first_seed_inserts_all_and_sets_flag() {
        let mut c = conn();
        let n = bundled_songs().len();
        assert_eq!(seed_bundled(&mut c).unwrap(), n);
        assert_eq!(repo::list_songs(&c).unwrap().len(), n);
        assert_eq!(count(&c, "songs_fts"), n as i64);
        assert_eq!(flag(&c), Some(n.to_string()));
    }

    #[test]
    fn second_seed_is_a_no_op() {
        let mut c = conn();
        let n = bundled_songs().len();
        seed_bundled(&mut c).unwrap();
        assert_eq!(seed_bundled(&mut c).unwrap(), 0);
        assert_eq!(count(&c, "songs"), n as i64);
        assert_eq!(count(&c, "songs_fts"), n as i64);
        assert_eq!(flag(&c), Some(n.to_string()));
    }

    #[test]
    fn deleted_seeded_song_stays_deleted() {
        let mut c = conn();
        let n = bundled_songs().len();
        seed_bundled(&mut c).unwrap();
        let first = repo::list_songs(&c).unwrap().remove(0);
        repo::delete_song(&mut c, &first.id).unwrap();
        assert_eq!(seed_bundled(&mut c).unwrap(), 0);
        let after = repo::list_songs(&c).unwrap();
        assert_eq!(after.len(), n - 1);
        assert!(after.iter().all(|s| s.id != first.id));
    }

    #[test]
    fn failure_rolls_back_songs_fts_and_flag() {
        let mut c = conn();
        c.execute_batch(
            "CREATE TEMP TRIGGER limit_songs BEFORE INSERT ON songs \
             WHEN (SELECT count(*) FROM songs) >= 3 \
             BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
        )
        .unwrap();
        assert!(seed_bundled(&mut c).is_err());
        assert_eq!(count(&c, "songs"), 0);
        assert_eq!(count(&c, "songs_fts"), 0);
        assert_eq!(flag(&c), None);
        c.execute_batch("DROP TRIGGER limit_songs;").unwrap();
        let n = bundled_songs().len();
        assert_eq!(seed_bundled(&mut c).unwrap(), n);
        assert_eq!(count(&c, "songs"), n as i64);
    }

    #[test]
    fn flag_is_written_in_the_same_transaction_as_the_songs() {
        let mut c = conn();
        c.execute_batch(
            "CREATE TEMP TRIGGER block_flag BEFORE INSERT ON app_meta \
             BEGIN SELECT RAISE(ABORT, 'no flag'); END;",
        )
        .unwrap();
        assert!(seed_bundled(&mut c).is_err());
        assert_eq!(count(&c, "songs"), 0);
        assert_eq!(count(&c, "songs_fts"), 0);
        assert_eq!(flag(&c), None);
        c.execute_batch("DROP TRIGGER block_flag;").unwrap();
        let n = bundled_songs().len();
        assert_eq!(seed_bundled(&mut c).unwrap(), n);
        assert_eq!(flag(&c), Some(n.to_string()));
    }

    #[test]
    fn user_song_is_kept_and_seed_still_runs() {
        let mut c = conn();
        let user = repo::save_song(
            &mut c,
            &SaveSongInput {
                id: None,
                chordpro: "{title: My Own Song}\n[C]hello".to_string(),
            },
        )
        .unwrap();
        let n = bundled_songs().len();
        assert_eq!(seed_bundled(&mut c).unwrap(), n);
        let all = repo::list_songs(&c).unwrap();
        assert_eq!(all.len(), n + 1);
        assert!(all.iter().any(|s| s.id == user.id));
    }

    #[test]
    fn seeded_hebrew_fixture_is_searchable() {
        let mut c = conn();
        seed_bundled(&mut c).unwrap();
        let niqqud = bundled_songs()
            .iter()
            .find(|s| s.path.ends_with("he_niqqud.cho"))
            .unwrap();
        let title = extract(niqqud.chordpro).title;
        let hits = search::search_songs(&c, "שלום").unwrap();
        assert!(
            hits.iter().any(|h| h.song.title == title),
            "he_niqqud ({title}) not found among {} hits",
            hits.len()
        );
    }
}
