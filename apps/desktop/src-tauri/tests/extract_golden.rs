//! Rust <-> chord-core metadata parity. `golden/extract.json` is derived from chord-core
//! (`parseSong(src).song.{title,key,capo}` and the `songMeta` artist rule), never from Rust.
use serde_json::Value;
use shir_lib::db::extract::extract;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repo root")
}

fn golden() -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/extract.json");
    let text = std::fs::read_to_string(path).expect("read golden");
    match serde_json::from_str::<Value>(&text).expect("golden is JSON") {
        Value::Array(a) => a,
        other => panic!("golden must be an array, got {other}"),
    }
}

#[test]
fn golden_is_nonempty_and_has_expected_shape() {
    let entries = golden();
    assert!(entries.len() >= 15, "golden too small: {}", entries.len());
    for e in &entries {
        let obj = e.as_object().expect("entry is an object");
        let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["artist", "capo", "file", "key", "title"]);
        assert!(e["title"].is_string(), "title is always a string");
    }
}

#[test]
fn rust_extract_matches_chord_core_golden() {
    let root = repo_root();
    for e in golden() {
        let file = e["file"].as_str().expect("file");
        let src = std::fs::read_to_string(root.join(file)).expect("read source");
        let got = extract(&src);
        assert_eq!(
            got.title,
            e["title"].as_str().expect("title"),
            "{file}: title"
        );
        assert_eq!(
            got.artist.as_deref(),
            e["artist"].as_str(),
            "{file}: artist"
        );
        assert_eq!(got.key.as_deref(), e["key"].as_str(), "{file}: key");
        assert_eq!(got.capo.map(u64::from), e["capo"].as_u64(), "{file}: capo");
    }
}

#[test]
fn golden_covers_exactly_the_repository_files() {
    let root = repo_root();
    let mut on_disk: Vec<String> = Vec::new();
    for dir in ["packages/test-fixtures/fixtures", "samples"] {
        for ent in std::fs::read_dir(root.join(dir)).expect("read_dir") {
            let name = ent
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned();
            if name.ends_with(".cho") && !name.ends_with(".canonical.cho") {
                on_disk.push(format!("{dir}/{name}"));
            }
        }
    }
    on_disk.sort();
    let mut listed: Vec<String> = golden()
        .iter()
        .map(|e| e["file"].as_str().expect("file").to_owned())
        .collect();
    listed.sort();
    assert_eq!(listed, on_disk);
}
