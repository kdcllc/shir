//! G10 command layer: the pure helpers behind `save_export_docx` (no dialog in tests) and a
//! setlist command round trip over a file database.
use shir_lib::commands::files::{
    resolve_docx_path, sanitize_export_name, validate_export_bytes, write_docx_atomically,
    FileErrorKind, MAX_EXPORT_BYTES,
};
use shir_lib::commands::save_song_impl;
use shir_lib::commands::setlists::{
    add_setlist_items_impl, create_setlist_impl, delete_setlist_impl, duplicate_setlist_impl,
    get_setlist_impl, list_setlists_impl, remove_setlist_item_impl, rename_setlist_impl,
    reorder_setlist_items_impl, update_setlist_item_impl,
};
use shir_lib::commands::state::DbState;
use shir_lib::db::{ErrorKind, SaveSongInput};
use std::path::Path;

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

#[test]
fn write_happy_path_returns_the_path_and_writes_the_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("a.docx");
    let out = write_docx_atomically(&target, b"PK\x03\x04data").unwrap();
    assert_eq!(out, target);
    assert_eq!(std::fs::read(&target).unwrap(), b"PK\x03\x04data");
    assert_eq!(names(dir.path()), ["a.docx"], "no temp file left");
}

#[test]
fn write_overwrites_an_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("a.docx");
    std::fs::write(&target, b"old old old old").unwrap();
    write_docx_atomically(&target, b"new").unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), b"new");
    assert_eq!(names(dir.path()), ["a.docx"]);
}

#[cfg(unix)]
#[test]
fn write_replaces_a_symlink_instead_of_writing_through_it() {
    let dir = tempfile::tempdir().unwrap();
    let real = dir.path().join("real.txt");
    std::fs::write(&real, b"precious").unwrap();
    let link = dir.path().join("link.docx");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    write_docx_atomically(&link, b"docx bytes").unwrap();
    assert_eq!(std::fs::read(&real).unwrap(), b"precious");
    let meta = std::fs::symlink_metadata(&link).unwrap();
    assert!(
        meta.file_type().is_file(),
        "link replaced by a regular file"
    );
    assert_eq!(std::fs::read(&link).unwrap(), b"docx bytes");
}

#[test]
fn write_into_a_missing_directory_is_io_and_leaves_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("missing").join("a.docx");
    let e = write_docx_atomically(&target, b"x").unwrap_err();
    assert_eq!(e.kind, FileErrorKind::Io);
    assert!(!e.message.is_empty());
    assert!(names(dir.path()).is_empty());
}

#[test]
fn failed_rename_removes_the_temp_file() {
    let dir = tempfile::tempdir().unwrap();
    // A non-empty directory at the target makes the rename fail after the temp is written.
    let target = dir.path().join("a.docx");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("keep"), b"k").unwrap();
    let e = write_docx_atomically(&target, b"x").unwrap_err();
    assert_eq!(e.kind, FileErrorKind::Io);
    assert_eq!(names(dir.path()), ["a.docx"], "temp file removed");
}

#[test]
fn resolve_appends_the_extension_and_keeps_an_existing_one() {
    let dir = tempfile::tempdir().unwrap();
    let x = dir.path().join("x");
    assert_eq!(resolve_docx_path(&x).unwrap(), dir.path().join("x.docx"));
    let upper = dir.path().join("x.DOCX");
    assert_eq!(resolve_docx_path(&upper).unwrap(), upper);
    let plain = dir.path().join("x.docx");
    assert_eq!(resolve_docx_path(&plain).unwrap(), plain);
}

#[test]
fn resolve_never_picks_an_existing_name() {
    let dir = tempfile::tempdir().unwrap();
    let x = dir.path().join("x");
    std::fs::write(dir.path().join("x.docx"), b"1").unwrap();
    assert_eq!(
        resolve_docx_path(&x).unwrap(),
        dir.path().join("x (2).docx")
    );
    std::fs::write(dir.path().join("x (2).docx"), b"2").unwrap();
    assert_eq!(
        resolve_docx_path(&x).unwrap(),
        dir.path().join("x (3).docx")
    );
    // An explicit .docx choice was confirmed by the dialog: kept even though it exists.
    let explicit = dir.path().join("x.docx");
    assert_eq!(resolve_docx_path(&explicit).unwrap(), explicit);
}

#[test]
fn byte_limit_boundaries() {
    assert_eq!(MAX_EXPORT_BYTES, 20 * 1_048_576);
    assert_eq!(
        validate_export_bytes(&[]).unwrap_err().kind,
        FileErrorKind::Invalid
    );
    assert!(validate_export_bytes(&[1]).is_ok());
    assert!(validate_export_bytes(&vec![0u8; 20 * 1_048_576]).is_ok());
    assert_eq!(
        validate_export_bytes(&vec![0u8; 20 * 1_048_576 + 1])
            .unwrap_err()
            .kind,
        FileErrorKind::Invalid
    );
}

#[test]
fn default_name_is_always_a_bare_docx_file_name() {
    assert_eq!(sanitize_export_name("../x"), "x.docx");
    assert_eq!(sanitize_export_name("a/b"), "ab.docx");
    assert_eq!(sanitize_export_name("C:\\x"), "Cx.docx");
    assert_eq!(sanitize_export_name(""), "setlist.docx");
    assert_eq!(sanitize_export_name("   "), "setlist.docx");
    assert_eq!(sanitize_export_name("..."), "setlist.docx");
    assert_eq!(sanitize_export_name("שבת שלום"), "שבת שלום.docx");
    assert_eq!(sanitize_export_name("set.docx"), "set.docx");
    assert_eq!(sanitize_export_name("set.DOCX"), "set.docx");
    assert_eq!(sanitize_export_name("a\nb\u{0}*?\"<>|c"), "abc.docx");
    assert_eq!(sanitize_export_name("....//x"), "x.docx");
    for n in ["../../etc/passwd", "a\\..\\b", "x/../y", "con:\\z"] {
        let s = sanitize_export_name(n);
        assert!(!s.contains(['/', '\\', ':']) && !s.contains(".."), "{s}");
        assert!(s.ends_with(".docx"));
    }
}

#[test]
fn setlist_commands_round_trip_on_a_file_database() {
    let dir = tempfile::tempdir().unwrap();
    let st = DbState::open(&dir.path().join("shir.db"));
    let song = save_song_impl(
        &st,
        &SaveSongInput {
            id: None,
            chordpro: "{title: שלום}\n[C]la".into(),
        },
    )
    .unwrap();
    let sl = create_setlist_impl(&st, "שבת").unwrap();
    let added = add_setlist_items_impl(&st, &sl.id, &[song.id.clone(), song.id.clone()]).unwrap();
    let (a, b) = (added.items[0].id.clone(), added.items[1].id.clone());
    let re = reorder_setlist_items_impl(&st, &sl.id, &[b.clone(), a.clone()]).unwrap();
    assert_eq!(re.items[0].id, b);
    let up = update_setlist_item_impl(&st, &sl.id, &a, -1, Some(2)).unwrap();
    assert!(up
        .items
        .iter()
        .any(|i| i.id == a && i.transpose == -1 && i.capo == Some(2)));
    assert_eq!(
        remove_setlist_item_impl(&st, &sl.id, &b)
            .unwrap()
            .items
            .len(),
        1
    );
    let renamed = rename_setlist_impl(&st, &sl.id, "Renamed").unwrap();
    assert_eq!(renamed.name, "Renamed");
    let copy = duplicate_setlist_impl(&st, &sl.id, "Copy").unwrap();
    assert_eq!(get_setlist_impl(&st, &copy.id).unwrap().items.len(), 1);
    assert_eq!(list_setlists_impl(&st).unwrap().len(), 2);
    delete_setlist_impl(&st, &sl.id).unwrap();
    assert_eq!(
        get_setlist_impl(&st, &sl.id).unwrap_err().kind,
        ErrorKind::NotFound
    );
}
