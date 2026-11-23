//! Shared ZIP/XML helpers for the DOCX and ODT extractors: bounded entry reading, XML event
//! helpers and the block builder both walkers drive.
use super::{DocBlock, DocError, DocErrorKind, DocWarning, DocWarningKind};
use quick_xml::events::{BytesRef, BytesStart};
use quick_xml::XmlVersion;
use std::io::{Cursor, Read};

/// Largest number of entries an archive may hold.
const MAX_ENTRIES: usize = 10_000;

fn corrupt(message: impl Into<String>) -> DocError {
    DocError {
        kind: DocErrorKind::Corrupt,
        message: message.into(),
    }
}

fn text_too_large(name: &str, max: u64) -> DocError {
    DocError {
        kind: DocErrorKind::TextTooLarge,
        message: format!("\"{name}\" is larger than {max} bytes"),
    }
}

/// Read the archive entry `name` from the ZIP `bytes`, refusing more than `max` bytes.
pub(super) fn read_entry(bytes: &[u8], name: &str, max: u64) -> Result<Vec<u8>, DocError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| corrupt(format!("not a valid archive: {e}")))?;
    if archive.len() > MAX_ENTRIES {
        return Err(corrupt("archive has too many entries"));
    }
    let entry = archive
        .by_name(name)
        .map_err(|e| corrupt(format!("cannot read archive entry \"{name}\": {e}")))?;
    if entry.size() > max {
        return Err(text_too_large(name, max));
    }
    let mut out = Vec::new();
    entry
        .take(max.saturating_add(1))
        .read_to_end(&mut out)
        .map_err(|e| corrupt(format!("cannot read archive entry \"{name}\": {e}")))?;
    // No post-read length check: a forged declared size makes the zip crate itself fail the
    // read (`Corrupt`), so more than `max` bytes never arrive; see
    // `forged_entry_size_is_still_capped`. The `take` above stays as defense in depth.
    Ok(out)
}

/// Map an XML parse error to `Corrupt`.
pub(super) fn xml_err(e: impl std::fmt::Display) -> DocError {
    corrupt(format!("malformed XML: {e}"))
}

/// The value of the attribute whose local name is `local`, if present.
pub(super) fn attr(e: &BytesStart<'_>, local: &str) -> Result<Option<String>, DocError> {
    for a in e.attributes() {
        let a = a.map_err(xml_err)?;
        if a.key.local_name().as_ref() == local {
            let v = a
                .normalized_value(XmlVersion::Implicit1_0)
                .map_err(xml_err)?;
            return Ok(Some(v.into_owned()));
        }
    }
    Ok(None)
}

/// Resolve a character or predefined entity reference to its text.
pub(super) fn resolve_ref(r: &BytesRef<'_>) -> Result<String, DocError> {
    if let Some(c) = r.resolve_char_ref().map_err(xml_err)? {
        return Ok(c.to_string());
    }
    match &**r {
        "amp" => Ok("&".into()),
        "lt" => Ok("<".into()),
        "gt" => Ok(">".into()),
        "quot" => Ok("\"".into()),
        "apos" => Ok("'".into()),
        other => Err(corrupt(format!("unknown entity \"&{other};\""))),
    }
}

#[derive(Default)]
struct TableState {
    rows: Vec<Vec<String>>,
    row: Vec<String>,
    /// Paragraph texts of the open cell.
    cell: Option<Vec<String>>,
}

/// Collects paragraphs and tables in document order.
#[derive(Default)]
pub(super) struct Builder {
    blocks: Vec<DocBlock>,
    pub(super) warnings: Vec<DocWarning>,
    tables: Vec<TableState>,
    cur: String,
    para_depth: usize,
    broke: bool,
    warned: Vec<&'static str>,
}

impl Builder {
    /// Add a `Skipped` warning once per `what`.
    pub(super) fn warn_skipped(&mut self, what: &'static str, message: &str) {
        if !self.warned.contains(&what) {
            self.warned.push(what);
            self.warnings.push(DocWarning {
                kind: DocWarningKind::Skipped,
                message: message.to_string(),
            });
        }
    }

    pub(super) fn begin_para(&mut self) {
        if self.para_depth == 0 {
            self.cur.clear();
            self.broke = false;
        }
        self.para_depth += 1;
    }

    pub(super) fn end_para(&mut self) {
        if self.para_depth == 0 {
            return;
        }
        self.para_depth -= 1;
        if self.para_depth == 0 {
            if !(self.broke && self.cur.is_empty()) {
                self.flush_para();
            }
            self.cur.clear();
        }
    }

    /// End the current paragraph now and start a new one (page break).
    pub(super) fn break_para(&mut self) {
        if self.para_depth > 0 {
            self.flush_para();
            self.cur.clear();
            self.broke = true;
        }
    }

    fn flush_para(&mut self) {
        let text = std::mem::take(&mut self.cur);
        self.push_text_block(text);
    }

    fn push_text_block(&mut self, text: String) {
        match self.tables.last_mut().and_then(|t| t.cell.as_mut()) {
            Some(cell) => cell.push(text),
            None => self.blocks.push(DocBlock::Paragraph { text }),
        }
    }

    /// Append text to the open paragraph; `\r` is dropped. Ignored outside a paragraph.
    pub(super) fn push_str(&mut self, s: &str) {
        if self.para_depth > 0 {
            self.cur.extend(s.chars().filter(|&c| c != '\r'));
        }
    }

    pub(super) fn begin_table(&mut self) {
        self.tables.push(TableState::default());
    }

    pub(super) fn begin_row(&mut self) {
        if let Some(t) = self.tables.last_mut() {
            t.row.clear();
        }
    }

    pub(super) fn begin_cell(&mut self) {
        if let Some(t) = self.tables.last_mut() {
            t.cell = Some(Vec::new());
        }
    }

    /// Close the open cell. `repeat` copies are added when the cell has text (at most
    /// `max_cells` cells per row); `force_empty` adds one empty cell.
    pub(super) fn end_cell(&mut self, repeat: usize, force_empty: bool, max_cells: usize) {
        let Some(t) = self.tables.last_mut() else {
            return;
        };
        // Word requires a `<w:p/>` after a nested table in a cell; drop that one trailing
        // empty paragraph so the flattened cell has no trailing newline.
        let text = t
            .cell
            .take()
            .map(|mut p| {
                if p.len() > 1 && p.last().is_some_and(String::is_empty) {
                    p.pop();
                }
                p.join("\n")
            })
            .unwrap_or_default();
        let n = if force_empty || text.is_empty() {
            1
        } else {
            repeat.max(1)
        };
        let text = if force_empty { String::new() } else { text };
        for _ in 0..n {
            if t.row.len() >= max_cells {
                break;
            }
            t.row.push(text.clone());
        }
    }

    pub(super) fn end_row(&mut self) {
        if let Some(t) = self.tables.last_mut() {
            let row = std::mem::take(&mut t.row);
            t.rows.push(row);
        }
    }

    /// Close the innermost table: a `Table` block, or flattened text inside an enclosing cell.
    pub(super) fn end_table(&mut self) {
        let Some(t) = self.tables.pop() else {
            return;
        };
        let nested = self
            .tables
            .last()
            .map(|p| p.cell.is_some())
            .unwrap_or(false);
        if nested {
            let flat = t
                .rows
                .iter()
                .map(|r| r.join("\t"))
                .collect::<Vec<_>>()
                .join("\n");
            self.push_text_block(flat);
        } else {
            self.blocks.push(DocBlock::Table { rows: t.rows });
        }
    }

    pub(super) fn finish(mut self) -> (Vec<DocBlock>, Vec<DocWarning>) {
        while !self.tables.is_empty() {
            self.end_table();
        }
        (self.blocks, self.warnings)
    }
}

#[cfg(test)]
pub(super) mod test_util {
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    /// The fixture names (`packages/test-fixtures/doc/<name>.*`).
    pub const FIXTURE_NAMES: [&str; 3] = ["he_chords_above", "en_table", "songbook_mixed"];

    /// Fixtures that exist only as RTF (`<name>.rtf` and `<name>.expected.json`).
    pub const RTF_ONLY_FIXTURE_NAMES: [&str; 1] = ["he_word_cp1255"];

    /// Directory of the document fixtures.
    pub fn fixture_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packages/test-fixtures/doc")
    }

    /// Build a stored ZIP archive in memory.
    pub fn make_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, data) in entries {
            w.start_file(*name, opts).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }
}

#[cfg(test)]
mod tests {
    use super::test_util::make_zip;
    use super::*;

    #[test]
    fn reads_an_entry() {
        let z = make_zip(&[("a.xml", b"<a/>")]);
        assert_eq!(read_entry(&z, "a.xml", 100).unwrap(), b"<a/>");
    }

    #[test]
    fn entry_exactly_max_is_ok_and_over_is_too_large() {
        let z = make_zip(&[("a.xml", b"12345")]);
        assert_eq!(read_entry(&z, "a.xml", 5).unwrap().len(), 5);
        let e = read_entry(&z, "a.xml", 4).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::TextTooLarge);
    }

    #[test]
    fn missing_entry_names_it() {
        let z = make_zip(&[("a.xml", b"x")]);
        let e = read_entry(&z, "b.xml", 100).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Corrupt);
        assert!(e.message.contains("b.xml"), "{}", e.message);
    }

    #[test]
    fn too_many_entries_is_corrupt() {
        let names: Vec<String> = (0..=MAX_ENTRIES).map(|i| format!("e{i}")).collect();
        let entries: Vec<(&str, &[u8])> = names.iter().map(|n| (n.as_str(), &b"x"[..])).collect();
        let z = make_zip(&entries);
        let e = read_entry(&z, "e0", 100).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Corrupt);
        assert!(e.message.contains("too many entries"), "{}", e.message);

        let z = make_zip(&entries[..MAX_ENTRIES]);
        assert_eq!(read_entry(&z, "e0", 100).unwrap(), b"x");
    }

    /// Overwrite the little-endian u32 at `offset` after each `sig` in `zip`.
    fn patch_u32(zip: &mut [u8], sig: &[u8; 4], offset: usize, value: u32) {
        let mut patched = 0;
        let mut i = 0;
        while i + offset + 4 <= zip.len() {
            if zip[i..i + 4] == sig[..] {
                zip[i + offset..i + offset + 4].copy_from_slice(&value.to_le_bytes());
                patched += 1;
            }
            i += 1;
        }
        assert_eq!(
            patched, 1,
            "expected exactly one header with signature {sig:?}"
        );
    }

    #[test]
    fn forged_entry_size_is_still_capped() {
        use std::io::Write;
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        w.start_file("a.xml", opts).unwrap();
        w.write_all(&[b'a'; 100]).unwrap();
        let mut z = w.finish().unwrap().into_inner();
        // The honest archive is refused by the declared size.
        assert_eq!(
            read_entry(&z, "a.xml", 50).unwrap_err().kind,
            DocErrorKind::TextTooLarge
        );
        // Forge the uncompressed size (local header offset 22, central directory offset 24).
        patch_u32(&mut z, b"PK\x03\x04", 22, 10);
        patch_u32(&mut z, b"PK\x01\x02", 24, 10);
        // Observed: zip 9.4.2 itself fails the read once the data outgrows the declared size,
        // so the result is `Corrupt`, never more than `max` bytes.
        let e = read_entry(&z, "a.xml", 50).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Corrupt);
        assert!(
            e.message.contains("declared uncompressed size"),
            "{}",
            e.message
        );
    }

    #[test]
    fn not_a_zip_is_corrupt() {
        let e = read_entry(b"this is not a zip", "a.xml", 100).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Corrupt);
    }
}
