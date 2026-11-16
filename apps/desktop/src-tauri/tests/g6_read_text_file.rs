//! `read_text_file_impl` through the public crate API, in temp dirs only.
use shir_lib::commands::files::{read_text_file_impl, FileErrorKind, MAX_TEXT_FILE_BYTES};

#[test]
fn hebrew_file_name_with_niqqud_content_round_trips() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("שיר ישן.txt");
    let content = "{title: שִׁיר}\n[C]שָׁלוֹם עוֹלָם\n";
    std::fs::write(&path, content).expect("write");
    assert_eq!(read_text_file_impl(&path).expect("read"), content);
}

#[test]
fn bom_is_stripped_and_crlf_is_kept() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("bom.txt");
    std::fs::write(&path, "\u{feff}Am G\r\nשלום\r\n").expect("write");
    assert_eq!(
        read_text_file_impl(&path).expect("read"),
        "Am G\r\nשלום\r\n"
    );
}

#[test]
fn max_size_reads_and_one_byte_more_is_too_large() {
    let dir = tempfile::tempdir().expect("tempdir");
    let max = MAX_TEXT_FILE_BYTES as usize;
    let at_max = dir.path().join("max.txt");
    std::fs::write(&at_max, vec![b'a'; max]).expect("write");
    assert_eq!(read_text_file_impl(&at_max).expect("read").len(), max);

    let over = dir.path().join("over.txt");
    std::fs::write(&over, vec![b'a'; max + 1]).expect("write");
    let err = read_text_file_impl(&over).expect_err("too large");
    assert_eq!(err.kind, FileErrorKind::TooLarge);
}

#[test]
fn empty_file_is_an_empty_string() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("empty.txt");
    std::fs::write(&path, b"").expect("write");
    assert_eq!(read_text_file_impl(&path).expect("read"), "");
}

#[test]
fn missing_file_is_io() {
    let dir = tempfile::tempdir().expect("tempdir");
    let err = read_text_file_impl(&dir.path().join("nope.txt")).expect_err("missing");
    assert_eq!(err.kind, FileErrorKind::Io);
}

#[cfg(unix)]
#[test]
fn symlink_to_a_valid_file_reads_the_target() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("target.txt");
    std::fs::write(&target, "Am\nשלום").expect("write");
    let link = dir.path().join("link.txt");
    std::os::unix::fs::symlink(&target, &link).expect("symlink");
    assert_eq!(read_text_file_impl(&link).expect("read"), "Am\nשלום");
}

#[cfg(unix)]
#[test]
fn symlink_to_a_directory_is_io() {
    let dir = tempfile::tempdir().expect("tempdir");
    let sub = dir.path().join("sub");
    std::fs::create_dir(&sub).expect("mkdir");
    let link = dir.path().join("dirlink");
    std::os::unix::fs::symlink(&sub, &link).expect("symlink");
    let err = read_text_file_impl(&link).expect_err("directory");
    assert_eq!(err.kind, FileErrorKind::Io);
}
