//! File-backed storage lifecycle over every repository song plus two inline songs.
use shir_lib::db::migrations::open;
use shir_lib::db::repo::{delete_song, get_song, list_songs, save_song};
use shir_lib::db::search::search_songs;
use shir_lib::db::{ErrorKind, SaveSongInput};
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repo root")
}

/// (label, source) for every non-canonical fixture and every sample.
fn repository_songs() -> Vec<(String, String)> {
    let root = repo_root();
    let mut out = Vec::new();
    for dir in ["packages/test-fixtures/fixtures", "samples"] {
        let mut names: Vec<String> = std::fs::read_dir(root.join(dir))
            .expect("read_dir")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".cho") && !n.ends_with(".canonical.cho"))
            .collect();
        names.sort();
        for n in names {
            let src = std::fs::read_to_string(root.join(dir).join(&n)).expect("read song");
            out.push((n, src));
        }
    }
    out
}

fn inline_songs() -> Vec<(String, String)> {
    let crlf = "{title: שיר הערב}\r\n{artist: Dana Test}\r\n\r\n[Am]שָׁלוֹם עֲלֵיכֶם\r\n[G]לַיְלָה טוֹב\r\n";
    let bom = "\u{FEFF}{title: Bridge שיר גשר}\n{key: C}\n\n[C]Hello עולם [G]again\n";
    vec![
        ("inline-crlf-niqqud".to_owned(), crlf.to_owned()),
        ("inline-bom-mixed".to_owned(), bom.to_owned()),
    ]
}

#[test]
fn lifecycle_survives_reopen_byte_identical() {
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join("lib").join("shir.db");

    let mut songs = repository_songs();
    let repo_count = songs.len();
    assert!(repo_count >= 15, "expected the fixture + sample set");
    assert!(songs.iter().any(|(n, _)| n == "he_niqqud.cho"));
    songs.extend(inline_songs());
    // Preconditions: the inline songs really carry CRLF and a BOM.
    assert!(songs[repo_count].1.contains("\r\n"));
    assert!(songs[repo_count + 1].1.starts_with('\u{FEFF}'));

    let mut saved: Vec<(String, String, String)> = Vec::new(); // (label, id, source)
    {
        let mut conn = open(&path).expect("open");
        for (label, src) in &songs {
            let s = save_song(
                &mut conn,
                &SaveSongInput {
                    id: None,
                    chordpro: src.clone(),
                },
            )
            .unwrap_or_else(|e| panic!("save {label}: {e:?}"));
            saved.push((label.clone(), s.id, src.clone()));
        }
    } // connection dropped

    let mut conn = open(&path).expect("reopen");
    let uv: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("user_version");
    assert_eq!(uv, 2);
    for (label, id, src) in &saved {
        let got = get_song(&conn, id).unwrap_or_else(|e| panic!("get {label}: {e:?}"));
        assert_eq!(got.chordpro.as_bytes(), src.as_bytes(), "{label}: bytes");
    }
    assert_eq!(list_songs(&conn).expect("list").len(), songs.len());

    let hits = search_songs(&conn, "שלום").expect("search");
    let niqqud_id = &saved
        .iter()
        .find(|(l, _, _)| l == "he_niqqud.cho")
        .expect("he_niqqud saved")
        .1;
    assert!(
        hits.iter().any(|h| &h.song.id == niqqud_id),
        "search שלום must include he_niqqud.cho"
    );

    delete_song(&mut conn, niqqud_id).expect("delete");
    drop(conn);

    let conn = open(&path).expect("reopen after delete");
    let err = get_song(&conn, niqqud_id).expect_err("deleted song is gone");
    assert_eq!(err.kind, ErrorKind::NotFound);
    assert_eq!(list_songs(&conn).expect("list").len(), songs.len() - 1);
    let hits = search_songs(&conn, "שלום").expect("search");
    assert!(
        hits.iter().all(|h| &h.song.id != niqqud_id),
        "deleted song must leave the search index"
    );
    // The other songs are untouched.
    for (label, id, src) in saved.iter().filter(|(_, id, _)| id != niqqud_id) {
        let got = get_song(&conn, id).expect("get");
        assert_eq!(got.chordpro, *src, "{label}");
    }
}
