//! Extract plain text blocks from a user-picked document (DOCX, ODT, RTF, PDF) for import.
//! Plain `std::fs`; no fs plugin.
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

mod docx;
mod odt;
mod pdf;
mod rtf;
mod zipxml;

use serde::{Deserialize, Serialize};
use specta::Type;
use std::io::Read;
use std::path::Path;
use thiserror::Error;

/// Largest document file accepted, in bytes (20 MiB).
pub const MAX_DOCUMENT_BYTES: u64 = 20 * 1_048_576;

/// Largest total of extracted text, in UTF-8 bytes over every block string (2 MiB).
pub const MAX_EXTRACTED_TEXT_BYTES: usize = 2 * 1_048_576;

/// Supported document format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum DocFormat {
    Docx,
    Odt,
    Rtf,
    Pdf,
}

/// A block of extracted text. Inside a paragraph or cell a line break is `\n` and a tab is
/// `\t`; there is no `\r`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DocBlock {
    Paragraph { text: String },
    Table { rows: Vec<Vec<String>> },
}

/// Category of a non-fatal extraction warning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum DocWarningKind {
    /// Hebrew runs were converted from visual to logical order.
    PdfReordered,
    /// The PDF produced no text (likely a scan).
    PdfNoText,
    /// Content the extractor ignored (for example an embedded image or object).
    Skipped,
}

/// A non-fatal extraction warning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct DocWarning {
    pub kind: DocWarningKind,
    pub message: String,
}

/// The extracted document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentText {
    pub format: DocFormat,
    pub blocks: Vec<DocBlock>,
    pub warnings: Vec<DocWarning>,
}

/// Category of a document failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum DocErrorKind {
    TooLarge,
    TextTooLarge,
    Unsupported,
    Corrupt,
    Io,
}

/// A document-extraction error: serializes as `{"kind":"<Kind>","message":"<text>"}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, Error)]
#[error("{kind:?}: {message}")]
pub struct DocError {
    pub kind: DocErrorKind,
    pub message: String,
}

impl DocError {
    fn new(kind: DocErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn io(e: std::io::Error) -> Self {
        Self::new(DocErrorKind::Io, e.to_string())
    }

    fn too_large() -> Self {
        Self::new(
            DocErrorKind::TooLarge,
            "document is larger than the 20 MB limit",
        )
    }
}

/// The document format for `path`, by extension (ASCII case-insensitive).
pub(crate) fn format_for(path: &Path) -> Option<DocFormat> {
    let ext = path.extension()?.to_str()?;
    if ext.eq_ignore_ascii_case("docx") {
        Some(DocFormat::Docx)
    } else if ext.eq_ignore_ascii_case("odt") {
        Some(DocFormat::Odt)
    } else if ext.eq_ignore_ascii_case("rtf") {
        Some(DocFormat::Rtf)
    } else if ext.eq_ignore_ascii_case("pdf") {
        Some(DocFormat::Pdf)
    } else {
        None
    }
}

fn block_bytes(block: &DocBlock) -> usize {
    match block {
        DocBlock::Paragraph { text } => text.len(),
        DocBlock::Table { rows } => rows.iter().flatten().map(String::len).sum(),
    }
}

/// Drop empty blocks (blank paragraphs, all-empty tables) and enforce
/// `MAX_EXTRACTED_TEXT_BYTES` over the remaining block strings.
fn enforce_text_cap(mut doc: DocumentText) -> Result<DocumentText, DocError> {
    doc.blocks.retain(|b| match b {
        DocBlock::Paragraph { text } => !text.trim().is_empty(),
        DocBlock::Table { rows } => rows.iter().flatten().any(|c| !c.trim().is_empty()),
    });
    let total: usize = doc.blocks.iter().map(block_bytes).sum();
    if total > MAX_EXTRACTED_TEXT_BYTES {
        return Err(DocError::new(
            DocErrorKind::TextTooLarge,
            format!("extracted text is larger than {MAX_EXTRACTED_TEXT_BYTES} bytes"),
        ));
    }
    Ok(doc)
}

/// Read `r` to the end, refusing more than `max` bytes. Reads at most `max + 1` bytes, so a
/// file that grew after the metadata check cannot exhaust memory.
fn read_capped<R: Read>(r: R, max: u64) -> Result<Vec<u8>, DocError> {
    let mut bytes = Vec::new();
    r.take(max.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(DocError::io)?;
    if bytes.len() as u64 > max {
        return Err(DocError::too_large());
    }
    Ok(bytes)
}

/// Extract the text blocks of the document at `path`.
pub fn extract_document_impl(path: &Path) -> Result<DocumentText, DocError> {
    let meta = std::fs::metadata(path).map_err(DocError::io)?;
    if !meta.is_file() {
        return Err(DocError::new(DocErrorKind::Io, "not a regular file"));
    }
    if meta.len() > MAX_DOCUMENT_BYTES {
        return Err(DocError::too_large());
    }
    let Some(format) = format_for(path) else {
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().into_owned())
            .unwrap_or_default();
        return Err(DocError::new(
            DocErrorKind::Unsupported,
            format!("unsupported file extension \"{ext}\""),
        ));
    };
    let file = std::fs::File::open(path).map_err(DocError::io)?;
    let bytes = read_capped(file, MAX_DOCUMENT_BYTES)?;
    let doc = match format {
        DocFormat::Docx => docx::extract(&bytes)?,
        DocFormat::Odt => odt::extract(&bytes)?,
        DocFormat::Rtf => rtf::extract(&bytes)?,
        DocFormat::Pdf => pdf::extract(&bytes)?,
    };
    enforce_text_cap(doc)
}

/// Extract text blocks from a document picked by the user.
#[tauri::command(async)]
#[specta::specta]
pub async fn extract_document(path: String) -> Result<DocumentText, DocError> {
    tauri::async_runtime::spawn_blocking(move || extract_document_impl(Path::new(&path)))
        .await
        .map_err(|e| DocError::new(DocErrorKind::Io, e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    fn doc(blocks: Vec<DocBlock>) -> DocumentText {
        DocumentText {
            format: DocFormat::Docx,
            blocks,
            warnings: vec![],
        }
    }

    fn para(text: &str) -> DocBlock {
        DocBlock::Paragraph { text: text.into() }
    }

    #[test]
    fn missing_path_and_directory_are_io() {
        let dir = tempfile::tempdir().unwrap();
        let e = extract_document_impl(&dir.path().join("nope.docx")).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Io);
        assert!(!e.message.is_empty());
        let e = extract_document_impl(dir.path()).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Io);
    }

    #[test]
    fn oversized_file_is_too_large() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("big.docx");
        let f = std::fs::File::create(&p).unwrap();
        f.set_len(MAX_DOCUMENT_BYTES + 1).unwrap();
        drop(f);
        let e = extract_document_impl(&p).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::TooLarge);
        assert!(e.message.contains("20 MB"), "{}", e.message);
    }

    #[test]
    fn read_capped_refuses_a_reader_longer_than_the_cap() {
        let at_cap = read_capped(std::io::Cursor::new(vec![7u8; 8]), 8).unwrap();
        assert_eq!(at_cap, vec![7u8; 8]);
        let e = read_capped(std::io::Cursor::new(vec![7u8; 9]), 8).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::TooLarge);
        assert!(e.message.contains("20 MB"), "{}", e.message);
    }

    #[test]
    fn unknown_extension_is_unsupported() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        std::fs::write(&p, b"x").unwrap();
        let e = extract_document_impl(&p).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Unsupported);
        assert!(e.message.contains("txt"), "{}", e.message);
    }

    #[test]
    fn format_for_matches_extension_case_insensitively() {
        let f = |s: &str| format_for(&PathBuf::from(s));
        assert_eq!(f("a.DOCX"), Some(DocFormat::Docx));
        assert_eq!(f("a.Odt"), Some(DocFormat::Odt));
        assert_eq!(f("a.rtf"), Some(DocFormat::Rtf));
        assert_eq!(f("a.PDF"), Some(DocFormat::Pdf));
        assert_eq!(f("a.txt"), None);
        assert_eq!(f("a"), None);
        assert_eq!(f("a.docx.txt"), None);
    }

    #[test]
    fn serde_shapes() {
        assert_eq!(
            serde_json::to_value(para("hi")).unwrap(),
            json!({"kind": "paragraph", "text": "hi"})
        );
        assert_eq!(
            serde_json::to_value(DocBlock::Table {
                rows: vec![vec!["a".into(), "b".into()]]
            })
            .unwrap(),
            json!({"kind": "table", "rows": [["a", "b"]]})
        );
        assert_eq!(
            serde_json::to_value(DocErrorKind::TextTooLarge).unwrap(),
            json!("TextTooLarge")
        );
        assert_eq!(serde_json::to_value(DocFormat::Pdf).unwrap(), json!("pdf"));
        assert_eq!(
            serde_json::to_value(DocWarningKind::PdfReordered).unwrap(),
            json!("PdfReordered")
        );
        assert_eq!(
            serde_json::to_value(DocError::new(DocErrorKind::Corrupt, "bad")).unwrap(),
            json!({"kind": "Corrupt", "message": "bad"})
        );
    }

    #[test]
    fn text_cap_boundaries_and_empty_blocks() {
        let at_cap = doc(vec![para(&"a".repeat(MAX_EXTRACTED_TEXT_BYTES))]);
        assert!(enforce_text_cap(at_cap).is_ok());

        let over = doc(vec![
            para(&"a".repeat(MAX_EXTRACTED_TEXT_BYTES - 1)),
            DocBlock::Table {
                rows: vec![vec!["b".into(), "c".into()]],
            },
        ]);
        assert_eq!(
            enforce_text_cap(over).unwrap_err().kind,
            DocErrorKind::TextTooLarge
        );

        let multibyte = doc(vec![para(&"ש".repeat(MAX_EXTRACTED_TEXT_BYTES / 2 + 1))]);
        assert_eq!(
            enforce_text_cap(multibyte).unwrap_err().kind,
            DocErrorKind::TextTooLarge
        );

        let kept = enforce_text_cap(doc(vec![
            para("  "),
            para(""),
            DocBlock::Table {
                rows: vec![vec!["".into(), " ".into()], vec![]],
            },
            para("x"),
        ]))
        .unwrap();
        assert_eq!(kept.blocks, vec![para("x")]);
    }
}
