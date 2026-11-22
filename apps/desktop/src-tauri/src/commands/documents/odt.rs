//! ODT text extraction: `content.xml` streamed with quick-xml.
use super::zipxml::{attr, read_entry, resolve_ref, xml_err, Builder};
use super::{DocError, DocErrorKind, DocFormat, DocumentText, MAX_DOCUMENT_BYTES};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

/// Most cells kept per table row (bounds `number-columns-repeated`).
const MAX_CELLS_PER_ROW: usize = 1_024;

pub(super) fn extract(bytes: &[u8]) -> Result<DocumentText, DocError> {
    let xml = read_entry(bytes, "content.xml", MAX_DOCUMENT_BYTES)?;
    walk(&xml)
}

struct Walker {
    b: Builder,
    skip_depth: usize,
    /// Repeat count of each open cell (innermost last); `None` marks a covered cell.
    cells: Vec<Option<usize>>,
}

fn parse_count(v: Option<String>) -> usize {
    v.and_then(|s| s.trim().parse::<usize>().ok())
        .unwrap_or(1)
        .clamp(1, MAX_CELLS_PER_ROW)
}

impl Walker {
    /// Handle an opening tag. Returns `true` when its subtree must be skipped.
    fn start(&mut self, e: &BytesStart<'_>) -> Result<bool, DocError> {
        let name = e.local_name();
        match name.as_ref() {
            "annotation" | "tracked-changes" => return Ok(true),
            "frame" | "image" => {
                self.b
                    .warn_skipped("image", "an embedded image was skipped");
                return Ok(true);
            }
            "p" | "h" => self.b.begin_para(),
            "tab" => self.b.push_str("\t"),
            "line-break" => self.b.push_str("\n"),
            "s" => {
                let n = parse_count(attr(e, "c")?);
                self.b.push_str(&" ".repeat(n));
            }
            "table" => self.b.begin_table(),
            "table-row" => self.b.begin_row(),
            "table-cell" => {
                self.cells
                    .push(Some(parse_count(attr(e, "number-columns-repeated")?)));
                self.b.begin_cell();
            }
            "covered-table-cell" => {
                self.cells.push(None);
                self.b.begin_cell();
            }
            _ => {}
        }
        Ok(false)
    }

    fn end(&mut self, local: &str) {
        match local {
            "p" | "h" => self.b.end_para(),
            "table" => self.b.end_table(),
            "table-row" => self.b.end_row(),
            "table-cell" | "covered-table-cell" => {
                let repeat = self.cells.pop().flatten();
                self.b
                    .end_cell(repeat.unwrap_or(1), repeat.is_none(), MAX_CELLS_PER_ROW);
            }
            _ => {}
        }
    }
}

fn walk(xml: &[u8]) -> Result<DocumentText, DocError> {
    let mut reader = Reader::from_reader(xml);
    let mut buf = Vec::new();
    let mut w = Walker {
        b: Builder::default(),
        skip_depth: 0,
        cells: Vec::new(),
    };
    let mut depth = 0usize;
    loop {
        let ev = reader.read_event_into(&mut buf).map_err(xml_err)?;
        match ev {
            Event::Eof => break,
            Event::Start(e) => {
                depth += 1;
                if w.skip_depth > 0 {
                    w.skip_depth += 1;
                } else if w.start(&e)? {
                    w.skip_depth = 1;
                }
            }
            Event::Empty(e) => {
                if w.skip_depth == 0 && !w.start(&e)? {
                    w.end(e.local_name().as_ref());
                }
            }
            Event::End(e) => {
                depth = depth.saturating_sub(1);
                if w.skip_depth > 0 {
                    w.skip_depth -= 1;
                } else {
                    w.end(e.local_name().as_ref());
                }
            }
            Event::Text(t) if w.skip_depth == 0 => w.b.push_str(&t.xml10_content()),
            Event::CData(t) if w.skip_depth == 0 => w.b.push_str(&t.xml10_content()),
            Event::GeneralRef(r) if w.skip_depth == 0 => {
                let s = resolve_ref(&r)?;
                w.b.push_str(&s);
            }
            _ => {}
        }
        buf.clear();
    }
    if depth != 0 {
        return Err(DocError {
            kind: DocErrorKind::Corrupt,
            message: "malformed XML: unclosed element".to_string(),
        });
    }
    let (blocks, warnings) = w.b.finish();
    Ok(DocumentText {
        format: DocFormat::Odt,
        blocks,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::super::zipxml::test_util::{fixture_dir, make_zip, FIXTURE_NAMES};
    use super::super::{enforce_text_cap, DocBlock, DocWarningKind};
    use super::*;

    fn odt(body: &str) -> Vec<u8> {
        let xml = format!(
            "<?xml version=\"1.0\"?><office:document-content xmlns:office=\"o\" xmlns:text=\"t\" \
             xmlns:table=\"tb\" xmlns:draw=\"d\"><office:body><office:text>{body}</office:text></office:body>\
             </office:document-content>"
        );
        make_zip(&[("content.xml", xml.as_bytes())])
    }

    fn blocks(body: &str) -> Vec<DocBlock> {
        extract(&odt(body)).unwrap().blocks
    }

    fn para(t: &str) -> DocBlock {
        DocBlock::Paragraph { text: t.into() }
    }

    fn table(rows: &[&[&str]]) -> DocBlock {
        DocBlock::Table {
            rows: rows
                .iter()
                .map(|r| r.iter().map(|c| c.to_string()).collect())
                .collect(),
        }
    }

    #[test]
    fn paragraph_tab_break_spaces_and_heading() {
        let b = blocks(
            "<text:h>H</text:h><text:p>a<text:tab/>b<text:line-break/>c<text:s/>d<text:s text:c=\"3\"/>e\
             <text:span>f</text:span><text:a>g</text:a></text:p>",
        );
        assert_eq!(b, vec![para("H"), para("a\tb\nc d   efg")]);
    }

    #[test]
    fn table_rows_and_repeated_cells() {
        let b = blocks(
            "<table:table><table:table-row>\
             <table:table-cell table:number-columns-repeated=\"2\"><text:p>x</text:p></table:table-cell>\
             <table:table-cell table:number-columns-repeated=\"5\"><text:p/></table:table-cell>\
             <table:covered-table-cell/></table:table-row>\
             <table:table-row><table:table-cell><text:p>a</text:p><text:p>b</text:p></table:table-cell></table:table-row>\
             </table:table>",
        );
        assert_eq!(b, vec![table(&[&["x", "x", "", ""], &["a\nb"]])]);
    }

    #[test]
    fn repeated_cells_are_bounded() {
        let b = blocks(
            "<table:table><table:table-row><table:table-cell table:number-columns-repeated=\"99999999\">\
             <text:p>x</text:p></table:table-cell></table:table-row></table:table>",
        );
        match &b[0] {
            DocBlock::Table { rows } => assert_eq!(rows[0].len(), MAX_CELLS_PER_ROW),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn nested_table_is_flattened_into_the_cell() {
        let b = blocks(
            "<table:table><table:table-row><table:table-cell><text:p>top</text:p>\
             <table:table><table:table-row><table:table-cell><text:p>a</text:p></table:table-cell>\
             <table:table-cell><text:p>b</text:p></table:table-cell></table:table-row></table:table>\
             </table:table-cell></table:table-row></table:table>",
        );
        assert_eq!(b, vec![table(&[&["top\na\tb"]])]);
    }

    #[test]
    fn skipped_content_and_warnings() {
        let d = extract(&odt(
            "<text:p>keep<text:soft-page-break/><office:annotation><text:p>note</text:p></office:annotation>\
             <draw:frame><draw:image/><text:p>cap</text:p></draw:frame><draw:frame/></text:p>\
             <text:tracked-changes><text:changed-region><text:p>del</text:p></text:changed-region></text:tracked-changes>",
        ))
        .unwrap();
        assert_eq!(d.blocks, vec![para("keep")]);
        assert_eq!(d.warnings.len(), 1);
        assert_eq!(d.warnings[0].kind, DocWarningKind::Skipped);
        assert!(d.warnings[0].message.contains("image"));
    }

    #[test]
    fn entities_and_preserved_whitespace() {
        let b = blocks("<text:p>  A &amp; B &lt;c&gt;  </text:p>");
        assert_eq!(b, vec![para("  A & B <c>  ")]);
    }

    #[test]
    fn malformed_xml_is_corrupt() {
        for body in [
            "<text:p><text:span></text:p>",
            "<text:p>",
            "<text:p>&bogus;</text:p>",
        ] {
            let e = extract(&odt(body)).unwrap_err();
            assert_eq!(e.kind, DocErrorKind::Corrupt, "{body}");
        }
    }

    #[test]
    fn missing_entry_and_non_zip_are_corrupt() {
        let z = make_zip(&[("other.xml", b"<a/>")]);
        let e = extract(&z).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Corrupt);
        assert!(e.message.contains("content.xml"), "{}", e.message);
        assert_eq!(extract(b"nope").unwrap_err().kind, DocErrorKind::Corrupt);
    }

    #[test]
    fn fixture_expectations_hold() {
        for name in FIXTURE_NAMES {
            let dir = fixture_dir();
            let bytes = std::fs::read(dir.join(format!("{name}.odt"))).unwrap();
            let expected: Vec<DocBlock> = serde_json::from_slice(
                &std::fs::read(dir.join(format!("{name}.expected.json"))).unwrap(),
            )
            .unwrap();
            let got = enforce_text_cap(extract(&bytes).unwrap()).unwrap();
            assert_eq!(got.blocks, expected, "{name}");
        }
    }
}
