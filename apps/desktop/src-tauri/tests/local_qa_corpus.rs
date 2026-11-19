//! Opt-in probe over the git-ignored local QA corpus (`.local/qa-songs/`).
//! Run: cargo test --test local_qa_corpus -- --ignored --nocapture
use shir_lib::commands::state::DbState;
use shir_lib::commands::{save_song_impl, search_songs_impl};
use shir_lib::db::SaveSongInput;
use std::path::PathBuf;

#[test]
#[ignore = "needs the local-only .local/qa-songs corpus"]
fn local_qa_corpus_probe() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.local/qa-songs");
    if !dir.is_dir() {
        println!("SKIP: {} not present", dir.display());
        return;
    }
    let state = DbState::in_memory();
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .expect("read_dir")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".cho"))
        .collect();
    names.sort();
    let mut ids: Vec<(String, String)> = Vec::new();
    for n in &names {
        let src = std::fs::read_to_string(dir.join(n)).expect("read song");
        let saved = save_song_impl(
            &state,
            &SaveSongInput {
                id: None,
                chordpro: src,
            },
        )
        .unwrap_or_else(|e| panic!("save {n}: {e:?}"));
        ids.push((n.clone(), saved.id));
    }
    let id_of =
        |file: &str| -> Option<&String> { ids.iter().find(|(n, _)| n == file).map(|(_, id)| id) };

    for q in ["katamar", "hanisim", "צדיק", "עי", "צדיקים", "lekha"] {
        let hits = search_songs_impl(&state, q).expect("search");
        println!("query {q:?}: {} hit(s)", hits.len());
        let with_ctx = hits.iter().filter(|h| h.snippet.is_some()).count();
        println!("  {with_ctx} with context");
        if q == "katamar" {
            let want = id_of("qa-02.cho").expect("qa-02.cho present");
            assert!(
                hits.iter().any(|h| &h.song.id == want),
                "katamar -> qa-02.cho"
            );
        }
        if q == "צדיק" {
            let want = id_of("qa-03.cho").expect("qa-03.cho present");
            assert!(hits.iter().any(|h| &h.song.id == want), "צדיק -> qa-03.cho");
        }
    }
}
