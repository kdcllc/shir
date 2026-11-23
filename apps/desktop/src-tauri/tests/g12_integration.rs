//! g12 cross-task integration through the public crate API: the base64 export payload (R6, R7),
//! the PDF ActualText niqqud line (R8) and the renamed songbook title (R9). Temp dirs only; the
//! save dialog is replaced by a closure.
use shir_lib::commands::documents::{extract_document_impl, DocBlock};
use shir_lib::commands::files::{
    decode_export_payload, save_export_with, FileErrorKind, MAX_EXPORT_BASE64_LEN, MAX_EXPORT_BYTES,
};
use std::cell::Cell;
use std::path::{Path, PathBuf};

const BYTES_0_255_BASE64: &str =
    "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==";

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packages/test-fixtures")
}

fn doc_fixture(name: &str, ext: &str) -> PathBuf {
    fixture_dir().join("doc").join(format!("{name}.{ext}"))
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_hebrew_mark(c: char) -> bool {
    ('\u{0591}'..='\u{05C7}').contains(&c)
}

fn pdf_lines(path: &Path) -> Vec<String> {
    extract_document_impl(path)
        .expect("extract pdf")
        .blocks
        .iter()
        .filter_map(|b| match b {
            DocBlock::Paragraph { text } => Some(collapse(text)),
            DocBlock::Table { .. } => None,
        })
        .filter(|t| !t.is_empty())
        .collect()
}

/// All text of a document, one block (or table cell) per line.
fn all_text(path: &Path) -> String {
    let doc = extract_document_impl(path).expect("extract");
    let mut parts: Vec<String> = Vec::new();
    for b in &doc.blocks {
        match b {
            DocBlock::Paragraph { text } => parts.push(text.clone()),
            DocBlock::Table { rows } => {
                for row in rows {
                    parts.extend(row.iter().cloned());
                }
            }
        }
    }
    parts.join("\n")
}

fn read_json(path: &Path) -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(path).expect("read")).expect("parse")
}

/// The `{title: ...}` value of the second song of the AI reply fixture (the renamed songbook title).
fn renamed_title() -> String {
    let songs = read_json(&fixture_dir().join("ai/two_songs_fenced.expected.json"));
    let second = songs[1].as_str().expect("second song").to_string();
    let rest = second.strip_prefix("{title:").expect("title directive");
    rest.split('}')
        .next()
        .expect("closing brace")
        .trim()
        .to_string()
}

fn forbidden() -> String {
    ["Harbor", "Light"].join(" ")
}

#[test]
fn base64_of_every_byte_value_decodes_to_those_bytes() {
    let got = decode_export_payload(BYTES_0_255_BASE64).expect("decode");
    assert_eq!(got, (0u8..=255).collect::<Vec<_>>());
}

#[test]
fn payload_decoding_to_exactly_the_cap_is_accepted() {
    assert_eq!(MAX_EXPORT_BASE64_LEN, 27_962_028);
    let payload = format!("{}AAA=", "A".repeat(27_962_024));
    assert_eq!(payload.len(), MAX_EXPORT_BASE64_LEN);
    let got = decode_export_payload(&payload).expect("at the cap");
    assert_eq!(got.len(), MAX_EXPORT_BYTES);
    assert!(got.iter().all(|b| *b == 0));
}

#[test]
fn payload_decoding_one_byte_past_the_cap_is_invalid() {
    let payload = "A".repeat(27_962_028);
    assert_eq!(payload.len(), MAX_EXPORT_BASE64_LEN);
    // Not `expect_err`: a wrongly accepted 20 MiB payload would be printed in full.
    let Err(err) = decode_export_payload(&payload) else {
        panic!("a payload decoding to MAX_EXPORT_BYTES + 1 bytes was accepted");
    };
    assert_eq!(err.kind, FileErrorKind::Invalid);
}

#[test]
fn payload_over_the_encoded_cap_is_invalid_and_says_encoded() {
    let payload = "A".repeat(27_962_032);
    let err = decode_export_payload(&payload).expect_err("too long");
    assert_eq!(err.kind, FileErrorKind::Invalid);
    assert!(err.message.contains("encoded"), "{}", err.message);
}

#[test]
fn malformed_and_empty_payloads_are_invalid() {
    for bad in ["not base64!", ""] {
        let err = decode_export_payload(bad).expect_err(bad);
        assert_eq!(err.kind, FileErrorKind::Invalid, "{bad:?}");
    }
}

#[test]
fn save_export_with_writes_exactly_the_decoded_bytes() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("out.docx");
    let seen = Cell::new(false);
    let saved = save_export_with("Set", "Word", BYTES_0_255_BASE64, |_, _| {
        seen.set(true);
        Ok(Some(target.clone()))
    })
    .expect("saved");
    assert!(seen.get());
    let written = saved.expect("a path");
    assert_eq!(Path::new(&written), target.as_path());
    assert_eq!(
        std::fs::read(&target).expect("read back"),
        (0u8..=255).collect::<Vec<_>>()
    );
}

#[test]
fn save_export_with_an_invalid_payload_never_asks_for_a_path_and_creates_no_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("never.docx");
    let called = Cell::new(false);
    let err = save_export_with("Set", "Word", "not base64!", |_, _| {
        called.set(true);
        Ok(Some(target.clone()))
    })
    .expect_err("invalid");
    assert_eq!(err.kind, FileErrorKind::Invalid);
    assert!(!called.get(), "pick must not run for an invalid payload");
    assert!(!target.exists());
    assert_eq!(std::fs::read_dir(dir.path()).expect("dir").count(), 0);
}

#[test]
fn pdf_actual_text_keeps_the_niqqud_lines_equal_to_the_oracle() {
    let want: Vec<String> =
        serde_json::from_value(read_json(&doc_fixture("he_chords_above", "pdf.lines.json")))
            .expect("lines");
    let got = pdf_lines(&doc_fixture("he_chords_above", "pdf"));
    assert_eq!(got.len(), want.len(), "{got:?}");
    for (i, (g, w)) in got.iter().zip(&want).enumerate() {
        assert_eq!(g, &collapse(w), "line {i}");
    }
    assert_eq!(got[5], "הַשֶּׁמֶשׁ עַל הַגֶּשֶׁר");
    let marks = |lines: &[String]| {
        lines
            .iter()
            .map(|l| l.chars().filter(|c| is_hebrew_mark(*c)).count())
            .sum::<usize>()
    };
    assert!(marks(&want) > 0);
    assert_eq!(marks(&got), marks(&want));
}

#[test]
fn songbook_extraction_carries_the_renamed_title_and_not_the_old_one() {
    let title = renamed_title();
    assert!(!title.is_empty());
    assert!(!title.contains(&forbidden()));
    for ext in ["docx", "odt", "rtf", "pdf"] {
        let text = all_text(&doc_fixture("songbook_mixed", ext));
        assert!(
            !text.contains(&forbidden()),
            "{ext} still has the old title"
        );
        assert!(text.contains(&title), "{ext} lacks {title:?}");
    }
}
