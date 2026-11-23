//! G10 command layer: the pure helpers behind `save_export_docx` (no dialog in tests) and a
//! setlist command round trip over a file database.
use base64::Engine;
use shir_lib::commands::files::{
    decode_export_payload, publish_docx_with, resolve_docx_path, sanitize_export_name,
    save_export_with, validate_export_bytes, write_docx_atomically, write_docx_atomically_with,
    FileErrorKind, MAX_EXPORT_BASE64_LEN, MAX_EXPORT_BYTES,
};
use shir_lib::commands::save_song_impl;
use shir_lib::commands::setlists::{
    add_setlist_items_impl, create_setlist_impl, delete_setlist_impl, duplicate_setlist_impl,
    get_setlist_impl, list_setlists_impl, remove_setlist_item_impl, rename_setlist_impl,
    reorder_setlist_items_impl, update_setlist_item_impl,
};
use shir_lib::commands::state::DbState;
use shir_lib::db::{ErrorKind, SaveSongInput};
use std::cell::Cell;
use std::path::{Path, PathBuf};

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

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[test]
fn invalid_payload_never_calls_pick() {
    let too_long = "A".repeat(MAX_EXPORT_BASE64_LEN + 4);
    for payload in ["", "!!!", too_long.as_str()] {
        let calls = Cell::new(0);
        let e = save_export_with("x", "Word", payload, |_, _| {
            calls.set(calls.get() + 1);
            Ok(None)
        })
        .unwrap_err();
        assert_eq!(e.kind, FileErrorKind::Invalid);
        assert_eq!(calls.get(), 0, "pick must not run for {:?}", e.message);
    }
    let e = decode_export_payload(&too_long).unwrap_err();
    assert!(e.message.contains("encoded"), "{}", e.message);
    assert_eq!(
        decode_export_payload("!!!").unwrap_err().message,
        "document is not valid base64"
    );
    assert_eq!(
        decode_export_payload("").unwrap_err().message,
        "document is empty"
    );
}

#[test]
fn pick_receives_the_sanitized_name_and_the_filter() {
    let seen = std::cell::RefCell::new(None);
    let out = save_export_with("../a\u{202E}b", "Word", &b64(b"PK"), |name, filter| {
        *seen.borrow_mut() = Some((name, filter));
        Ok(None)
    })
    .unwrap();
    assert_eq!(out, None);
    assert_eq!(
        seen.into_inner(),
        Some(("ab.docx".to_string(), "Word".to_string()))
    );
}

#[test]
fn cancel_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let out = save_export_with("x", "Word", &b64(b"PK"), |_, _| Ok(None)).unwrap();
    assert_eq!(out, None);
    assert!(names(dir.path()).is_empty());
}

#[test]
fn pick_error_is_returned_unchanged() {
    let e = save_export_with("x", "Word", &b64(b"PK"), |_, _| {
        Err(shir_lib::commands::files::FileError {
            kind: FileErrorKind::Io,
            message: "dialog".into(),
        })
    })
    .unwrap_err();
    assert_eq!((e.kind, e.message.as_str()), (FileErrorKind::Io, "dialog"));
}

#[test]
fn happy_path_writes_the_decoded_bytes_at_chosen_docx() {
    let dir = tempfile::tempdir().unwrap();
    let chosen = dir.path().join("out");
    let bytes: Vec<u8> = (0..=255u8).collect();
    let saved = save_export_with("x", "Word", &b64(&bytes), |_, _| Ok(Some(chosen.clone())))
        .unwrap()
        .unwrap();
    let expected = dir.path().join("out.docx");
    assert_eq!(PathBuf::from(&saved), expected);
    assert_eq!(std::fs::read(&expected).unwrap(), bytes);
    assert_eq!(names(dir.path()), ["out.docx"]);
}

#[test]
fn size_boundary_reaches_pick_only_when_within_the_limit() {
    let calls = Cell::new(0);
    let at_limit = b64(&vec![7u8; MAX_EXPORT_BYTES]);
    assert_eq!(at_limit.len(), MAX_EXPORT_BASE64_LEN);
    save_export_with("x", "Word", &at_limit, |_, _| {
        calls.set(calls.get() + 1);
        Ok(None)
    })
    .unwrap();
    assert_eq!(calls.get(), 1);
    let over = b64(&vec![7u8; MAX_EXPORT_BYTES + 1]);
    let e = save_export_with("x", "Word", &over, |_, _| {
        calls.set(calls.get() + 1);
        Ok(None)
    })
    .unwrap_err();
    assert_eq!(e.kind, FileErrorKind::Invalid);
    assert!(e.message.contains("document is larger"), "{}", e.message);
    assert_eq!(calls.get(), 1);
}

#[test]
fn temp_collision_keeps_the_foreign_file() {
    let dir = tempfile::tempdir().unwrap();
    let foreign = dir.path().join("foreign.tmp");
    std::fs::write(&foreign, b"foreign").unwrap();
    let free = dir.path().join("free.tmp");
    let mut names_iter = vec![foreign.clone(), free].into_iter();
    let target = dir.path().join("a.docx");
    let out = write_docx_atomically_with(&target, b"new", || names_iter.next().unwrap()).unwrap();
    assert_eq!(out, target);
    assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign");
    assert_eq!(std::fs::read(&target).unwrap(), b"new");
    assert_eq!(names(dir.path()), ["a.docx", "foreign.tmp"]);
}

#[test]
fn temp_collision_exhaustion_is_io_and_leaves_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let foreign = dir.path().join("foreign.tmp");
    std::fs::write(&foreign, b"foreign").unwrap();
    let calls = Cell::new(0);
    let e = write_docx_atomically_with(&dir.path().join("a.docx"), b"new", || {
        calls.set(calls.get() + 1);
        foreign.clone()
    })
    .unwrap_err();
    assert_eq!(e.kind, FileErrorKind::Io);
    assert_eq!(e.message, "no free temporary file name");
    assert_eq!(calls.get(), 100);
    assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign");
    assert_eq!(names(dir.path()), ["foreign.tmp"]);
}

#[test]
fn publish_never_replaces_a_file_created_after_the_check() {
    let dir = tempfile::tempdir().unwrap();
    let first = Cell::new(true);
    let out = publish_docx_with(&dir.path().join("x"), b"new", |a, b| {
        if first.replace(false) {
            std::fs::write(dir.path().join("x.docx"), b"foreign").unwrap();
        }
        std::fs::hard_link(a, b)
    })
    .unwrap();
    assert_eq!(out, dir.path().join("x (2).docx"));
    assert_eq!(std::fs::read(&out).unwrap(), b"new");
    assert_eq!(
        std::fs::read(dir.path().join("x.docx")).unwrap(),
        b"foreign"
    );
    assert_eq!(names(dir.path()), ["x (2).docx", "x.docx"], "no .tmp left");
}

#[test]
fn publish_falls_back_to_rename_when_links_are_unsupported() {
    let dir = tempfile::tempdir().unwrap();
    let out = publish_docx_with(&dir.path().join("x"), b"new", |_, _| {
        Err(std::io::ErrorKind::Unsupported.into())
    })
    .unwrap();
    assert_eq!(out, dir.path().join("x.docx"));
    assert_eq!(std::fs::read(&out).unwrap(), b"new");
    assert_eq!(names(dir.path()), ["x.docx"]);
}

#[test]
fn publish_exhausting_every_name_is_io_and_leaves_no_temp() {
    let dir = tempfile::tempdir().unwrap();
    let e = publish_docx_with(&dir.path().join("x"), b"new", |_, _| {
        Err(std::io::ErrorKind::AlreadyExists.into())
    })
    .unwrap_err();
    assert_eq!(e.kind, FileErrorKind::Io);
    assert_eq!(e.message, "no free file name available");
    assert!(names(dir.path()).is_empty());
}

#[test]
fn publish_replaces_an_explicit_docx_name() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("x.docx");
    std::fs::write(&target, b"old").unwrap();
    let out =
        publish_docx_with(&target, b"new", |_, _| panic!("explicit names do not link")).unwrap();
    assert_eq!(out, target);
    assert_eq!(std::fs::read(&target).unwrap(), b"new");
    assert_eq!(names(dir.path()), ["x.docx"]);
}

#[test]
fn sanitize_drops_bidi_and_zero_width_format_characters() {
    assert_eq!(sanitize_export_name("abc\u{202E}def"), "abcdef.docx");
    assert_eq!(sanitize_export_name("\u{2067}שיר\u{2069}"), "שיר.docx");
    assert_eq!(sanitize_export_name("a\u{200B}b\u{FEFF}"), "ab.docx");
    assert_eq!(sanitize_export_name("a\u{200F}b"), "a\u{200F}b.docx");
    assert_eq!(sanitize_export_name("a\u{200E}b"), "a\u{200E}b.docx");
}

#[test]
fn sanitize_caps_the_stem_without_splitting_a_combining_cluster() {
    assert_eq!(
        sanitize_export_name(&"ש".repeat(150)),
        format!("{}.docx", "ש".repeat(100))
    );
    assert_eq!(
        sanitize_export_name(&format!("{} .x", "a".repeat(99))),
        format!("{}.docx", "a".repeat(99))
    );
    assert_eq!(
        sanitize_export_name(&format!("a{}", "שָ".repeat(60))),
        format!("a{}.docx", "שָ".repeat(49))
    );
    assert_eq!(
        sanitize_export_name(&format!("ab{}", "שָׁ".repeat(40))),
        format!("ab{}.docx", "שָׁ".repeat(32))
    );
}

#[test]
fn sanitize_defuses_windows_device_names() {
    assert_eq!(sanitize_export_name("CON"), "_CON.docx");
    assert_eq!(sanitize_export_name("nul.docx"), "_nul.docx");
    assert_eq!(sanitize_export_name("com1.txt"), "_com1.txt.docx");
    assert_eq!(sanitize_export_name("lpt9"), "_lpt9.docx");
    assert_eq!(sanitize_export_name("CONCERT"), "CONCERT.docx");
    assert_eq!(sanitize_export_name("com10"), "com10.docx");
}
