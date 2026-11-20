//! G5 file-backed lifecycle: seeding once, snippets through the command layer, V1 -> V2 upgrade.
use rusqlite::{Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use shir_lib::commands::state::DbState;
use shir_lib::commands::{delete_song_impl, get_song_impl, list_songs_impl, search_songs_impl};
use shir_lib::db::seed::{bundled_songs, seed_bundled, SEED_FLAG_KEY};
use shir_lib::db::ErrorKind;

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
        .expect("flag query")
}

#[test]
fn seed_once_across_reopen_and_deletion() {
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join("shir.db");
    let n = bundled_songs().len();
    assert!(n >= 17);

    {
        let state = DbState::open(&path);
        assert_eq!(list_songs_impl(&state).expect("list").len(), n);
    }
    let victim = {
        let state = DbState::open(&path);
        assert_eq!(
            list_songs_impl(&state).expect("list").len(),
            n,
            "no re-seed"
        );
        assert_eq!(flag(&state), Some(n.to_string()));
        // A direct re-seed after reopen must be a no-op (flag present), not rely on the PK.
        assert_eq!(state.with_conn(seed_bundled).expect("re-seed"), 0);
        assert_eq!(list_songs_impl(&state).expect("list").len(), n);
        let victim = list_songs_impl(&state).expect("list").remove(0).id;
        delete_song_impl(&state, &victim).expect("delete");
        victim
    };

    let state = DbState::open(&path);
    assert_eq!(
        list_songs_impl(&state).expect("list").len(),
        n - 1,
        "deleted seeded song must not return"
    );
    assert_eq!(
        get_song_impl(&state, &victim).expect_err("gone").kind,
        ErrorKind::NotFound
    );
    assert_eq!(flag(&state), Some(n.to_string()));
}

/// Open a seeded temp-dir database and search it.
fn seeded() -> (tempfile::TempDir, DbState) {
    let dir = tempfile::TempDir::new().expect("tempdir");
    let state = DbState::open(&dir.path().join("shir.db"));
    (dir, state)
}

fn sample_id(state: &DbState, title: &str) -> String {
    list_songs_impl(state)
        .expect("list")
        .into_iter()
        .find(|s| s.title == title)
        .unwrap_or_else(|| panic!("sample {title} seeded"))
        .id
}

#[test]
fn apostrophe_free_query_finds_translit_sample_with_u2019_snippet() {
    let (_d, state) = seeded();
    let id = sample_id(&state, "Migdalor Ba’arafel");
    // Source has "ha’sela"; the query omits the apostrophe.
    let hits = search_songs_impl(&state, "hasela").expect("search");
    assert_eq!(hits.len(), 1, "hasela is unique among the bundled songs");
    assert_eq!(hits[0].song.id, id);
    let snippet = hits[0].snippet.as_deref().expect("snippet");
    assert!(
        snippet.contains('\u{2019}'),
        "snippet keeps U+2019: {snippet}"
    );
    assert!(snippet.contains("ha’sela"), "{snippet}");
}

#[test]
fn gershayim_free_query_finds_hebrew_sample_with_u05f4_snippet() {
    let (_d, state) = seeded();
    let id = sample_id(&state, "מגדלור בערפל");
    let hits = search_songs_impl(&state, "מתא").expect("search");
    assert_eq!(hits.len(), 1, "מתא is unique among the bundled songs");
    assert_eq!(hits[0].song.id, id);
    let snippet = hits[0].snippet.as_deref().expect("snippet");
    assert!(
        snippet.contains('\u{05F4}'),
        "snippet keeps U+05F4: {snippet}"
    );
}

#[test]
fn title_only_query_has_no_snippet() {
    let (_d, state) = seeded();
    let id = sample_id(&state, "Migdalor Ba’arafel");
    // `Ba’arafel` appears only in the title (lyrics say `ha’arafel`).
    let hits = search_songs_impl(&state, "Baarafel").expect("search");
    assert_eq!(hits.len(), 1, "Baarafel is unique among the bundled songs");
    assert_eq!(hits[0].song.id, id);
    assert_eq!(hits[0].snippet, None);
    let he_id = sample_id(&state, "מגדלור בערפל");
    let he = search_songs_impl(&state, "בערפל").expect("search");
    let he_hit = he
        .iter()
        .find(|h| h.song.id == he_id)
        .expect("he title hit");
    assert_eq!(he_hit.snippet, None);
}

#[test]
fn artist_only_query_has_no_snippet() {
    let (_d, state) = seeded();
    let id = sample_id(&state, "Migdalor Ba’arafel");
    let hits = search_songs_impl(&state, "Nachal").expect("search");
    let hit = hits
        .iter()
        .find(|h| h.song.id == id)
        .expect("artist match finds the sample");
    assert_eq!(hit.snippet, None);
}

#[test]
fn v1_file_upgrades_to_v2_rebuilds_index_and_seeds() {
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join("shir.db");
    {
        let mut c = Connection::open(&path).expect("open");
        let v1 = Migrations::new(vec![M::up(include_str!("../migrations/0001_init.sql"))]);
        v1.to_latest(&mut c).expect("v1");
        let uv: i64 = c
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .expect("uv");
        assert_eq!(uv, 1);
        c.execute(
            "INSERT INTO songs (id, chordpro, title, language, created_at, updated_at) \
             VALUES ('old1', ?1, 'Old', 'he', 't', 't')",
            ["{title: Old}\nצה\"ל\n"],
        )
        .expect("song");
        c.execute(
            "INSERT INTO songs_fts (rowid, title_norm, artist_norm, lyrics_norm) \
             SELECT rowid, 'old', '', 'צה ל' FROM songs",
            [],
        )
        .expect("fts");
        let pre: i64 = c
            .query_row(
                "SELECT count(*) FROM songs_fts WHERE songs_fts MATCH 'צהל'",
                [],
                |r| r.get(0),
            )
            .expect("pre");
        assert_eq!(pre, 0, "old tokens do not match the new rule");
    }

    let state = DbState::open(&path);
    let n = bundled_songs().len();
    let uv: i64 = state
        .with_conn(|c| Ok(c.query_row("PRAGMA user_version", [], |r| r.get(0))?))
        .expect("uv");
    assert_eq!(uv, 3);
    let hits = search_songs_impl(&state, "צהל").expect("search");
    assert!(
        hits.iter().any(|h| h.song.id == "old1"),
        "rebuilt index finds צהל"
    );
    assert_eq!(list_songs_impl(&state).expect("list").len(), 1 + n);
    assert_eq!(flag(&state), Some(n.to_string()));
}
