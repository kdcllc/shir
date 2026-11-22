//! `extract_document_impl` through the public crate API: every fixture in every format, the size
//! limits and the failure kinds, in temp dirs only.
use shir_lib::commands::documents::{
    extract_document_impl, DocBlock, DocErrorKind, DocFormat, MAX_DOCUMENT_BYTES,
    MAX_EXTRACTED_TEXT_BYTES,
};
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;

/// Equal to `DOC_FIXTURE_NAMES` in `packages/test-fixtures/src/index.ts`.
const FIXTURE_NAMES: [&str; 3] = ["he_chords_above", "en_table", "songbook_mixed"];

/// PDF lines (name, 0-based index) that cannot match the oracle with marks kept. Same single
/// entry, and same cause, as `KNOWN_LOSSY_PDF_LINES` in `commands/documents/pdf.rs`; never widen.
const KNOWN_LOSSY_PDF_LINES: &[(&str, usize)] = &[("he_chords_above", 5)];

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packages/test-fixtures/doc")
}

fn fixture(name: &str, ext: &str) -> PathBuf {
    fixture_dir().join(format!("{name}.{ext}"))
}

fn is_hebrew_mark(c: char) -> bool {
    matches!(c, '\u{0591}'..='\u{05BD}' | '\u{05BF}' | '\u{05C1}'..='\u{05C2}')
        || matches!(c, '\u{05C4}'..='\u{05C5}' | '\u{05C7}' | '\u{FB1E}')
}

fn strip_marks(s: &str) -> String {
    s.chars().filter(|c| !is_hebrew_mark(*c)).collect()
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn blocks_json(path: &Path) -> serde_json::Value {
    let doc = extract_document_impl(path).expect("extract");
    serde_json::to_value(doc.blocks).expect("json")
}

fn read_json(path: &Path) -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(path).expect("read")).expect("parse")
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

fn make_zip(entries: &[(&str, &[u8])], method: zip::CompressionMethod) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default().compression_method(method);
    for (name, data) in entries {
        w.start_file(*name, opts).expect("start");
        w.write_all(data).expect("write");
    }
    w.finish().expect("finish").into_inner()
}

fn docx_with_xml(xml: &[u8], method: zip::CompressionMethod) -> Vec<u8> {
    make_zip(&[("word/document.xml", xml)], method)
}

#[test]
fn every_docx_odt_rtf_fixture_equals_its_expected_blocks() {
    for name in FIXTURE_NAMES {
        let want = read_json(&fixture(name, "expected.json"));
        assert!(want.as_array().is_some_and(|a| !a.is_empty()), "{name}");
        for ext in ["docx", "odt", "rtf"] {
            assert_eq!(blocks_json(&fixture(name, ext)), want, "{name}.{ext}");
        }
    }
}

#[test]
fn formats_are_reported_per_extension() {
    let want = [
        ("docx", DocFormat::Docx),
        ("odt", DocFormat::Odt),
        ("rtf", DocFormat::Rtf),
        ("pdf", DocFormat::Pdf),
    ];
    for (ext, format) in want {
        let doc = extract_document_impl(&fixture("en_table", ext)).expect("extract");
        assert_eq!(doc.format, format, "{ext}");
    }
}

#[test]
fn every_pdf_fixture_equals_its_oracle_lines() {
    for name in FIXTURE_NAMES {
        let want: Vec<String> =
            serde_json::from_value(read_json(&fixture(name, "pdf.lines.json"))).expect("lines");
        let got = pdf_lines(&fixture(name, "pdf"));

        // (a) with niqqud and marks stripped, every line matches.
        let g: Vec<String> = got.iter().map(|l| strip_marks(l)).collect();
        let w: Vec<String> = want.iter().map(|l| strip_marks(l)).collect();
        assert_eq!(g, w, "fixture {name} without marks");

        // (b) with marks kept, every line matches except the known lossy one.
        assert_eq!(got.len(), want.len(), "fixture {name}: line count");
        for (i, (g, w)) in got.iter().zip(&want).enumerate() {
            if KNOWN_LOSSY_PDF_LINES.contains(&(name, i)) {
                assert_ne!(g, w, "fixture {name} line {i} now matches: drop the entry");
            } else {
                assert_eq!(g, w, "fixture {name} line {i}");
            }
        }
    }
    assert_eq!(KNOWN_LOSSY_PDF_LINES.len(), 1);
}

#[test]
fn an_upper_case_extension_still_extracts() {
    let dir = tempfile::tempdir().expect("tempdir");
    for ext in ["docx", "odt", "rtf", "pdf"] {
        let upper = dir.path().join(format!("copy.{}", ext.to_uppercase()));
        std::fs::copy(fixture("en_table", ext), &upper).expect("copy");
        let doc = extract_document_impl(&upper).expect("extract");
        assert!(!doc.blocks.is_empty(), "{ext}");
    }
    let docx = dir.path().join("copy.DOCX");
    assert_eq!(
        blocks_json(&docx),
        read_json(&fixture("en_table", "expected.json"))
    );
}

#[test]
fn one_byte_over_the_file_cap_is_too_large() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("big.docx");
    let f = std::fs::File::create(&path).expect("create");
    f.set_len(MAX_DOCUMENT_BYTES + 1).expect("sparse");
    drop(f);
    let err = extract_document_impl(&path).expect_err("too large");
    assert_eq!(err.kind, DocErrorKind::TooLarge);
}

#[test]
fn a_doc_file_is_unsupported() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("old.doc");
    std::fs::write(&path, b"\xD0\xCF\x11\xE0 legacy").expect("write");
    let err = extract_document_impl(&path).expect_err("unsupported");
    assert_eq!(err.kind, DocErrorKind::Unsupported);
}

#[test]
fn a_truncated_docx_is_corrupt() {
    let bytes = std::fs::read(fixture("en_table", "docx")).expect("read");
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("half.docx");
    std::fs::write(&path, &bytes[..bytes.len() / 2]).expect("write");
    let err = extract_document_impl(&path).expect_err("corrupt");
    assert_eq!(err.kind, DocErrorKind::Corrupt);
}

#[test]
fn a_zip_bomb_entry_over_the_cap_is_refused() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("bomb.docx");
    let zeros = vec![b' '; MAX_DOCUMENT_BYTES as usize + 1];
    let bytes = docx_with_xml(&zeros, zip::CompressionMethod::Deflated);
    assert!((bytes.len() as u64) < MAX_DOCUMENT_BYTES, "must compress");
    std::fs::write(&path, bytes).expect("write");
    let err = extract_document_impl(&path).expect_err("refused");
    assert_eq!(err.kind, DocErrorKind::TextTooLarge);
}

#[test]
fn a_generated_docx_over_the_text_cap_is_text_too_large() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("long.docx");
    let para = format!("<w:p><w:r><w:t>{}</w:t></w:r></w:p>", "a".repeat(1000));
    let count = MAX_EXTRACTED_TEXT_BYTES / 1000 + 2;
    let xml = format!(
        "<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{}</w:body></w:document>",
        para.repeat(count)
    );
    std::fs::write(
        &path,
        docx_with_xml(xml.as_bytes(), zip::CompressionMethod::Deflated),
    )
    .expect("write");
    let err = extract_document_impl(&path).expect_err("text too large");
    assert_eq!(err.kind, DocErrorKind::TextTooLarge);
}

#[test]
fn a_generated_docx_under_the_text_cap_extracts() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("small.docx");
    let xml = "<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>";
    std::fs::write(
        &path,
        docx_with_xml(xml.as_bytes(), zip::CompressionMethod::Stored),
    )
    .expect("write");
    let doc = extract_document_impl(&path).expect("extract");
    assert_eq!(
        doc.blocks,
        vec![DocBlock::Paragraph {
            text: "hello".into()
        }]
    );
}

#[test]
fn a_directory_is_io() {
    let dir = tempfile::tempdir().expect("tempdir");
    let err = extract_document_impl(dir.path()).expect_err("io");
    assert_eq!(err.kind, DocErrorKind::Io);
}

#[test]
fn a_missing_file_is_io() {
    let dir = tempfile::tempdir().expect("tempdir");
    let err = extract_document_impl(&dir.path().join("nope.pdf")).expect_err("io");
    assert_eq!(err.kind, DocErrorKind::Io);
}
