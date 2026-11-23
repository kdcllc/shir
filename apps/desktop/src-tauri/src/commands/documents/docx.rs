//! DOCX text extraction: `word/document.xml` streamed with quick-xml.
use super::zipxml::{attr, read_entry, resolve_ref, xml_err, Builder};
use super::{DocError, DocErrorKind, DocFormat, DocumentText, MAX_DOCUMENT_BYTES};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

pub(super) fn extract(bytes: &[u8]) -> Result<DocumentText, DocError> {
    let xml = read_entry(bytes, "word/document.xml", MAX_DOCUMENT_BYTES)?;
    walk(&xml)
}

/// Kind of subtree being skipped.
#[derive(Clone, Copy)]
enum Skip {
    Silent,
    Image,
    Object,
}

/// The character of a `w:sym` `w:char` hex value. Word's symbol-font private-use codes
/// (U+F000-U+F0FF) have no plain-text meaning, so they give `None`, like invalid values.
fn sym_char(v: &str) -> Option<char> {
    let n = u32::from_str_radix(v.trim(), 16).ok()?;
    if (0xF000..=0xF0FF).contains(&n) {
        return None;
    }
    char::from_u32(n)
}

struct Walker {
    b: Builder,
    in_t: bool,
    skip_depth: usize,
}

impl Walker {
    fn start(&mut self, e: &BytesStart<'_>) -> Result<bool, DocError> {
        let name = e.local_name();
        let skip = match name.as_ref() {
            "del" | "Fallback" | "tabs" | "moveFrom" => Some(Skip::Silent),
            "drawing" | "pict" => Some(Skip::Image),
            "object" => Some(Skip::Object),
            _ => None,
        };
        if let Some(kind) = skip {
            match kind {
                Skip::Image => self
                    .b
                    .warn_skipped("image", "an embedded image was skipped"),
                Skip::Object => self
                    .b
                    .warn_skipped("object", "an embedded object was skipped"),
                Skip::Silent => {}
            }
            return Ok(true);
        }
        match name.as_ref() {
            "p" => self.b.begin_para(),
            "t" => self.in_t = true,
            "tab" => self.b.push_str("\t"),
            "cr" => self.b.push_str("\n"),
            "noBreakHyphen" => self.b.push_str("\u{2011}"),
            // An optional hyphen is invisible in plain text.
            "softHyphen" => {}
            "sym" => {
                if let Some(c) = attr(e, "char")?.as_deref().and_then(sym_char) {
                    self.b.push_str(c.encode_utf8(&mut [0u8; 4]));
                }
            }
            "br" => {
                if attr(e, "type")?.as_deref() == Some("page") {
                    self.b.break_para();
                } else {
                    self.b.push_str("\n");
                }
            }
            "tbl" => self.b.begin_table(),
            "tr" => self.b.begin_row(),
            "tc" => self.b.begin_cell(),
            _ => {}
        }
        Ok(false)
    }

    fn end(&mut self, local: &str) {
        match local {
            "p" => self.b.end_para(),
            "t" => self.in_t = false,
            "tbl" => self.b.end_table(),
            "tr" => self.b.end_row(),
            "tc" => self.b.end_cell(1, false, usize::MAX),
            _ => {}
        }
    }
}

fn walk(xml: &[u8]) -> Result<DocumentText, DocError> {
    let mut reader = Reader::from_reader(xml);
    let mut buf = Vec::new();
    let mut w = Walker {
        b: Builder::default(),
        in_t: false,
        skip_depth: 0,
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
            Event::Text(t) if w.skip_depth == 0 && w.in_t => {
                w.b.push_str(&t.xml10_content());
            }
            Event::CData(t) if w.skip_depth == 0 && w.in_t => {
                w.b.push_str(&t.xml10_content());
            }
            Event::GeneralRef(r) if w.skip_depth == 0 && w.in_t => {
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
        format: DocFormat::Docx,
        blocks,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::super::zipxml::test_util::{fixture_dir, make_zip, FIXTURE_NAMES};
    use super::super::{enforce_text_cap, DocBlock, DocWarningKind};
    use super::*;

    fn docx(body: &str) -> Vec<u8> {
        let xml = format!(
            "<?xml version=\"1.0\"?><w:document xmlns:w=\"w\" xmlns:mc=\"mc\"><w:body>{body}</w:body></w:document>"
        );
        make_zip(&[("word/document.xml", xml.as_bytes())])
    }

    fn blocks(body: &str) -> Vec<DocBlock> {
        extract(&docx(body)).unwrap().blocks
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
    fn paragraph_with_tab_and_line_break() {
        let b = blocks(
            "<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t><w:cr/><w:t>d</w:t></w:r></w:p>",
        );
        assert_eq!(b, vec![para("a\tb\nc\nd")]);
    }

    #[test]
    fn table_with_two_rows() {
        let b = blocks(
            "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr>\
             <w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p><w:p><w:r><w:t>y</w:t></w:r></w:p></w:tc>\
             <w:tc><w:p><w:r><w:t>z</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
        );
        assert_eq!(b, vec![table(&[&["a", ""], &["x\ny", "z"]])]);
    }

    #[test]
    fn nested_table_is_flattened_into_the_cell() {
        let b = blocks(
            "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>top</w:t></w:r></w:p>\
             <w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr>\
             <w:tr><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl>\
             <w:p/></w:tc></w:tr></w:tbl>",
        );
        assert_eq!(b, vec![table(&[&["top\na\tb\nc"]])]);
    }

    #[test]
    fn page_break_ends_the_paragraph() {
        let b = blocks("<w:p><w:r><w:t>one</w:t><w:br w:type=\"page\"/><w:t>two</w:t></w:r></w:p>");
        assert_eq!(b, vec![para("one"), para("two")]);
        let b = blocks("<w:p><w:r><w:t>last</w:t><w:br w:type=\"page\"/></w:r></w:p>");
        assert_eq!(b, vec![para("last")]);
    }

    #[test]
    fn deleted_text_is_skipped() {
        let b = blocks(
            "<w:p><w:r><w:t>keep</w:t></w:r><w:del><w:r><w:t>gone</w:t></w:r></w:del>\
             <w:r><w:instrText>HYPERLINK</w:instrText></w:r></w:p>\
             <mc:AlternateContent><mc:Choice><w:p><w:r><w:t>c</w:t></w:r></w:p></mc:Choice>\
             <mc:Fallback><w:p><w:r><w:t>fb</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>",
        );
        assert_eq!(b, vec![para("keep"), para("c")]);
    }

    #[test]
    fn moved_from_text_is_skipped() {
        let b = blocks(
            "<w:p><w:moveFrom><w:r><w:t>moved</w:t></w:r></w:moveFrom><w:r><w:t>keep</w:t></w:r></w:p>\
             <w:p><w:moveTo><w:r><w:t>moved</w:t></w:r></w:moveTo></w:p>",
        );
        assert_eq!(b, vec![para("keep"), para("moved")]);
        let b = blocks(
            "<w:p><w:moveFromRangeStart w:id=\"1\"/><w:r><w:t>x</w:t></w:r><w:moveFromRangeEnd w:id=\"1\"/></w:p>",
        );
        assert_eq!(b, vec![para("x")]);
    }

    #[test]
    fn no_break_hyphen_soft_hyphen_and_sym() {
        let b = blocks(
            "<w:p><w:r><w:t>a</w:t><w:noBreakHyphen/><w:t>b</w:t><w:softHyphen/><w:t>c</w:t>\
             <w:sym w:font=\"Symbol\" w:char=\"2665\"/><w:sym w:font=\"Wingdings\" w:char=\"F04A\"/>\
             <w:sym w:char=\"zz\"/><w:sym w:char=\"D800\"/><w:sym/></w:r></w:p>",
        );
        assert_eq!(b, vec![para("a\u{2011}bc\u{2665}")]);
    }

    #[test]
    fn tab_stop_definitions_emit_no_tab() {
        let b = blocks(
            "<w:p><w:pPr><w:tabs><w:tab w:val=\"left\" w:pos=\"720\"/></w:tabs></w:pPr>\
             <w:r><w:t>Am</w:t><w:tab/><w:t>D</w:t></w:r></w:p>",
        );
        assert_eq!(b, vec![para("Am\tD")]);
    }

    #[test]
    fn sdt_content_is_kept() {
        let b = blocks(
            "<w:sdt><w:sdtContent><w:p><w:r><w:t>in sdt</w:t></w:r></w:p></w:sdtContent></w:sdt>",
        );
        assert_eq!(b, vec![para("in sdt")]);
    }

    #[test]
    fn image_and_object_warn_once_each() {
        let d = extract(&docx(
            "<w:p><w:r><w:drawing><w:t>no</w:t></w:drawing></w:r><w:r><w:pict/></w:r>\
             <w:r><w:object/></w:r><w:r><w:drawing/></w:r><w:r><w:t>x</w:t></w:r></w:p>",
        ))
        .unwrap();
        assert_eq!(d.blocks, vec![para("x")]);
        assert_eq!(d.warnings.len(), 2);
        assert!(d.warnings.iter().all(|w| w.kind == DocWarningKind::Skipped));
        assert!(d.warnings[0].message.contains("image"));
        assert!(d.warnings[1].message.contains("object"));
    }

    #[test]
    fn xml_space_preserve_keeps_spaces() {
        let b = blocks("<w:p><w:r><w:t xml:space=\"preserve\">  a  </w:t><w:t xml:space=\"preserve\"> b</w:t></w:r></w:p>");
        assert_eq!(b, vec![para("  a   b")]);
    }

    #[test]
    fn entities_are_decoded() {
        let b = blocks("<w:p><w:r><w:t>A &amp; B &lt;c&gt; &#65;&#x42;</w:t></w:r></w:p>");
        assert_eq!(b, vec![para("A & B <c> AB")]);
    }

    #[test]
    fn malformed_xml_is_corrupt() {
        for body in ["<w:p><w:r></w:p>", "<w:p>", "<w:p><w:t>&bogus;</w:t></w:p>"] {
            let e = extract(&docx(body)).unwrap_err();
            assert_eq!(e.kind, DocErrorKind::Corrupt, "{body}");
        }
    }

    #[test]
    fn missing_entry_and_non_zip_are_corrupt() {
        let z = make_zip(&[("other.xml", b"<a/>")]);
        let e = extract(&z).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Corrupt);
        assert!(e.message.contains("word/document.xml"), "{}", e.message);
        assert_eq!(extract(b"nope").unwrap_err().kind, DocErrorKind::Corrupt);
    }

    #[test]
    fn fixture_expectations_hold() {
        for name in FIXTURE_NAMES {
            let dir = fixture_dir();
            let bytes = std::fs::read(dir.join(format!("{name}.docx"))).unwrap();
            let expected: Vec<DocBlock> = serde_json::from_slice(
                &std::fs::read(dir.join(format!("{name}.expected.json"))).unwrap(),
            )
            .unwrap();
            let got = enforce_text_cap(extract(&bytes).unwrap()).unwrap();
            assert_eq!(got.blocks, expected, "{name}");
        }
    }
}
