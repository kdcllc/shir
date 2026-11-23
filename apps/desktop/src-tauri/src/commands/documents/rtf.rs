//! RTF text extraction: a small hand-written tokenizer that decodes `\uN` escapes and `\'hh`
//! bytes (in the document code page, via `encoding_rs`) and keeps paragraphs, line breaks, tabs
//! and tables.
use super::{
    DocBlock, DocError, DocErrorKind, DocFormat, DocWarning, DocWarningKind, DocumentText,
};
use std::collections::HashMap;

/// Deepest group nesting accepted.
const MAX_DEPTH: usize = 512;

/// Destination words whose whole group is skipped.
const SKIPPED: [&str; 24] = [
    "colortbl",
    "stylesheet",
    "info",
    "pict",
    "object",
    "header",
    "headerl",
    "headerr",
    "headerf",
    "footer",
    "footerl",
    "footerr",
    "footerf",
    "footnote",
    "listtable",
    "listoverridetable",
    "rsidtbl",
    "generator",
    "xmlnstbl",
    "themedata",
    "colorschememapping",
    "datastore",
    "latentstyles",
    "fldinst",
];

fn corrupt(message: &str) -> DocError {
    DocError::new(DocErrorKind::Corrupt, message)
}

/// Per-group state (restored on `}`).
#[derive(Clone)]
struct Group {
    /// `\ucN`: fallback characters after each `\uN`.
    uc: u32,
    /// Current `\fN` font.
    font: Option<i64>,
    /// Inside a skipped destination.
    skip: bool,
    /// Inside `\fonttbl`.
    fonttbl: bool,
    /// Current `\afN` associated font (used for the `\rtlch` run).
    af: Option<i64>,
    /// In a `\rtlch` run (the later of `\rtlch` / `\ltrch` wins).
    rtl: bool,
}

#[derive(Default)]
struct Table {
    rows: Vec<Vec<String>>,
    row: Vec<String>,
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
    stack: Vec<Group>,
    ansicpg: Option<u32>,
    deff: Option<i64>,
    fonts: HashMap<i64, i64>,
    /// Pending raw bytes (plain text and `\'hh`) decoded together.
    run: Vec<u8>,
    /// A high surrogate waiting for its low half.
    high: Option<u16>,
    /// Fallback characters still to skip after a `\uN`.
    skip_n: u32,
    blocks: Vec<DocBlock>,
    warnings: Vec<DocWarning>,
    warned: Vec<&'static str>,
    cur: String,
    table: Option<Table>,
    intbl: bool,
    /// The cell text ends with a newline added by `\nestrow`.
    nest_nl: bool,
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

impl<'a> Parser<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            pos: 0,
            stack: Vec::new(),
            ansicpg: None,
            deff: None,
            fonts: HashMap::new(),
            run: Vec::new(),
            high: None,
            skip_n: 0,
            blocks: Vec::new(),
            warnings: Vec::new(),
            warned: Vec::new(),
            cur: String::new(),
            table: None,
            intbl: false,
            nest_nl: false,
        }
    }

    fn skipping(&self) -> bool {
        self.stack.last().is_some_and(|g| g.skip || g.fonttbl)
    }

    fn warn(&mut self, what: &'static str, message: &str) {
        if !self.warned.contains(&what) {
            self.warned.push(what);
            self.warnings.push(DocWarning {
                kind: DocWarningKind::Skipped,
                message: message.to_string(),
            });
        }
    }

    fn close_table(&mut self) {
        if let Some(mut t) = self.table.take() {
            if !t.row.is_empty() {
                t.rows.push(std::mem::take(&mut t.row));
            }
            if !t.rows.is_empty() {
                self.blocks.push(DocBlock::Table { rows: t.rows });
            }
        }
    }

    /// Append text to the current paragraph or cell.
    fn text_push(&mut self, s: &str) {
        if self.table.is_some() && !self.intbl {
            if s.trim().is_empty() {
                return;
            }
            self.close_table();
        }
        self.cur.extend(s.chars().filter(|&c| c != '\r'));
        self.nest_nl = false;
    }

    fn resolve_high(&mut self) {
        if self.high.take().is_some() {
            self.text_push("\u{FFFD}");
        }
    }

    /// Emit decoded text (unless inside a skipped destination).
    fn emit(&mut self, s: &str) {
        if self.skipping() {
            return;
        }
        self.resolve_high();
        self.text_push(s);
    }

    fn codepage(&self) -> u32 {
        // In a right-to-left run the associated font decides, when it is Hebrew or Arabic.
        if let Some(g) = self.stack.last().filter(|g| g.rtl) {
            match g.af.and_then(|f| self.fonts.get(&f)) {
                Some(177 | 181) => return 1255,
                Some(178..=180) => return 1256,
                _ => {}
            }
        }
        let font = self.stack.last().and_then(|g| g.font).or(self.deff);
        match font.and_then(|f| self.fonts.get(&f)) {
            Some(177 | 181) => 1255,
            Some(178..=180) => 1256,
            _ => self.ansicpg.unwrap_or(1252),
        }
    }

    fn flush_run(&mut self) {
        if self.run.is_empty() {
            return;
        }
        let run = std::mem::take(&mut self.run);
        if self.skipping() {
            return;
        }
        let label = format!("windows-{}", self.codepage());
        let enc =
            encoding_rs::Encoding::for_label(label.as_bytes()).unwrap_or(encoding_rs::WINDOWS_1252);
        let (text, _) = enc.decode_without_bom_handling(&run);
        let text = text.into_owned();
        self.emit(&text);
    }

    fn unicode(&mut self, n: i64) {
        if self.skipping() {
            return;
        }
        let n = if n < 0 { n + 65_536 } else { n };
        match n {
            0xD800..=0xDBFF => {
                self.resolve_high();
                self.high = Some(n as u16);
            }
            0xDC00..=0xDFFF => match self.high.take() {
                Some(h) => {
                    let c = 0x10000 + ((u32::from(h) - 0xD800) << 10) + (n as u32 - 0xDC00);
                    let c = char::from_u32(c).unwrap_or('\u{FFFD}');
                    self.text_push(&c.to_string());
                }
                None => self.text_push("\u{FFFD}"),
            },
            _ => {
                let c = u32::try_from(n)
                    .ok()
                    .and_then(char::from_u32)
                    .unwrap_or('\u{FFFD}');
                self.resolve_high();
                self.text_push(&c.to_string());
            }
        }
    }

    fn end_paragraph(&mut self) {
        self.resolve_high();
        if self.intbl {
            self.cur.push('\n');
            self.nest_nl = false;
        } else {
            self.close_table();
            let text = std::mem::take(&mut self.cur);
            self.blocks.push(DocBlock::Paragraph { text });
        }
    }

    fn end_cell(&mut self) {
        self.resolve_high();
        if self.nest_nl && self.cur.ends_with('\n') {
            self.cur.pop();
        }
        self.nest_nl = false;
        let text = std::mem::take(&mut self.cur);
        self.table.get_or_insert_with(Table::default).row.push(text);
    }

    fn end_row(&mut self) {
        self.resolve_high();
        if !self.cur.is_empty() {
            self.end_cell();
        }
        if let Some(t) = self.table.as_mut() {
            if !t.row.is_empty() {
                let row = std::mem::take(&mut t.row);
                t.rows.push(row);
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    /// Parse the optional numeric parameter and the single-space delimiter.
    fn param(&mut self) -> Option<i64> {
        let mut neg = false;
        if self.peek() == Some(b'-') {
            neg = true;
            self.pos += 1;
        }
        let mut val: Option<i64> = None;
        while let Some(d) = self.peek().filter(u8::is_ascii_digit) {
            val = Some(
                val.unwrap_or(0)
                    .saturating_mul(10)
                    .saturating_add(i64::from(d - b'0'))
                    .min(i64::from(u32::MAX)),
            );
            self.pos += 1;
        }
        if self.peek() == Some(b' ') {
            self.pos += 1;
        }
        val.map(|v| if neg { -v } else { v })
    }

    fn open_group(&mut self) -> Result<(), DocError> {
        self.flush_run();
        self.resolve_high();
        self.skip_n = 0;
        if self.stack.len() >= MAX_DEPTH {
            return Err(corrupt("RTF groups are nested too deeply"));
        }
        let g = self.stack.last().cloned().unwrap_or(Group {
            uc: 1,
            font: None,
            skip: false,
            fonttbl: false,
            af: None,
            rtl: false,
        });
        self.stack.push(g);
        Ok(())
    }

    fn close_group(&mut self) {
        self.flush_run();
        self.resolve_high();
        self.skip_n = 0;
        self.stack.pop();
    }

    fn control_symbol(&mut self, sym: u8) {
        match sym {
            b'\'' => {
                let h = self.peek().and_then(hex);
                let l = self.bytes.get(self.pos + 1).copied().and_then(hex);
                if let (Some(h), Some(l)) = (h, l) {
                    self.pos += 2;
                    if self.skip_n > 0 {
                        self.skip_n -= 1;
                    } else {
                        self.run.push(h * 16 + l);
                    }
                }
            }
            _ if self.skip_n > 0 => self.skip_n -= 1,
            b'\\' | b'{' | b'}' => self.run.push(sym),
            b'~' => {
                self.flush_run();
                self.emit("\u{A0}");
            }
            b'_' => {
                self.flush_run();
                self.emit("\u{2011}");
            }
            b'*' => {
                if let Some(g) = self.stack.last_mut() {
                    g.skip = true;
                }
            }
            b'\r' | b'\n' => {
                self.flush_run();
                if !self.skipping() {
                    self.end_paragraph();
                }
            }
            _ => {}
        }
    }

    fn control_word(&mut self, word: &str, n: Option<i64>) {
        // `\u` is never a fallback character itself.
        if word == "u" {
            self.flush_run();
            self.skip_n = 0;
            if let Some(n) = n {
                self.unicode(n);
            }
            self.skip_n = self.stack.last().map_or(1, |g| g.uc);
            return;
        }
        // `\binN` always skips its data, even when it is itself the `\uN` fallback.
        if word == "bin" {
            if self.skip_n > 0 {
                self.skip_n -= 1;
            } else {
                self.flush_run();
            }
            let len = usize::try_from(n.unwrap_or(0)).unwrap_or(0);
            self.pos = self.pos.saturating_add(len).min(self.bytes.len());
            return;
        }
        if self.skip_n > 0 {
            self.skip_n -= 1;
            return;
        }
        self.flush_run();
        if word == "pict" {
            self.warn("pict", "embedded pictures were skipped");
        } else if word == "object" {
            self.warn("object", "embedded objects were skipped");
        }
        match word {
            "ansicpg" => {
                self.ansicpg = n.and_then(|v| u32::try_from(v).ok());
            }
            "deff" => self.deff = n,
            "uc" => {
                if let Some(g) = self.stack.last_mut() {
                    g.uc = n.and_then(|v| u32::try_from(v).ok()).unwrap_or(1).min(64);
                }
            }
            "f" => {
                if let Some(g) = self.stack.last_mut() {
                    g.font = n;
                }
            }
            "af" => {
                if let Some(g) = self.stack.last_mut() {
                    g.af = n;
                }
            }
            "rtlch" | "ltrch" => {
                if let Some(g) = self.stack.last_mut() {
                    g.rtl = word == "rtlch";
                }
            }
            "fcharset" => {
                let in_tbl = self.stack.last().is_some_and(|g| g.fonttbl);
                let font = self.stack.last().and_then(|g| g.font);
                if let (true, Some(f), Some(cs)) = (in_tbl, font, n) {
                    self.fonts.insert(f, cs);
                }
            }
            "fonttbl" => {
                if let Some(g) = self.stack.last_mut() {
                    g.fonttbl = true;
                }
            }
            w if SKIPPED.contains(&w) => {
                if let Some(g) = self.stack.last_mut() {
                    g.skip = true;
                }
            }
            _ if self.skipping() || self.stack.last().is_some_and(|g| g.fonttbl) => {}
            "par" | "sect" | "page" => self.end_paragraph(),
            "line" => self.emit("\n"),
            "tab" => self.emit("\t"),
            "intbl" => self.intbl = true,
            "pard" => self.intbl = false,
            "cell" => self.end_cell(),
            "row" => self.end_row(),
            "nestcell" => self.emit("\t"),
            "nestrow" => {
                self.resolve_high();
                if self.cur.ends_with('\t') {
                    self.cur.pop();
                }
                self.cur.push('\n');
                self.nest_nl = true;
            }
            _ => {}
        }
    }

    fn run_parse(&mut self) -> Result<(), DocError> {
        while let Some(b) = self.peek() {
            self.pos += 1;
            match b {
                b'{' => self.open_group()?,
                b'}' => {
                    self.close_group();
                    if self.stack.is_empty() {
                        return Ok(());
                    }
                }
                _ if self.stack.is_empty() => {}
                b'\r' | b'\n' => {}
                b'\\' => {
                    let Some(next) = self.peek() else {
                        break;
                    };
                    if next.is_ascii_alphabetic() {
                        let start = self.pos;
                        while self.peek().is_some_and(|c| c.is_ascii_alphabetic()) {
                            self.pos += 1;
                        }
                        let word =
                            String::from_utf8_lossy(&self.bytes[start..self.pos]).into_owned();
                        let n = self.param();
                        self.control_word(&word, n);
                    } else {
                        self.pos += 1;
                        self.control_symbol(next);
                    }
                }
                _ => {
                    if self.skip_n > 0 {
                        self.skip_n -= 1;
                    } else {
                        self.run.push(b);
                    }
                }
            }
        }
        Ok(())
    }

    fn finish(mut self) -> Result<DocumentText, DocError> {
        if !self.stack.is_empty() {
            return Err(corrupt("unbalanced braces in RTF"));
        }
        self.resolve_high();
        if self.table.is_some() && self.intbl && !self.cur.is_empty() {
            self.end_cell();
        }
        self.close_table();
        if !self.cur.is_empty() {
            let text = std::mem::take(&mut self.cur);
            self.blocks.push(DocBlock::Paragraph { text });
        }
        Ok(DocumentText {
            format: DocFormat::Rtf,
            blocks: self.blocks,
            warnings: self.warnings,
        })
    }
}

pub(super) fn extract(bytes: &[u8]) -> Result<DocumentText, DocError> {
    let start = bytes
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    if !bytes[start..].starts_with(b"{\\rtf") {
        return Err(corrupt("not an RTF document"));
    }
    let mut p = Parser::new(&bytes[start..]);
    p.run_parse()?;
    if p.stack.is_empty()
        && !p.bytes[p.pos.min(p.bytes.len())..]
            .iter()
            .all(|&b| b.is_ascii_whitespace() || b == 0)
    {
        return Err(corrupt(
            "unexpected content after the end of the RTF document",
        ));
    }
    p.finish()
}

#[cfg(test)]
mod tests {
    use super::super::enforce_text_cap;
    use super::super::zipxml::test_util::{fixture_dir, FIXTURE_NAMES, RTF_ONLY_FIXTURE_NAMES};
    use super::*;

    fn blocks(src: &str) -> Vec<DocBlock> {
        extract(src.as_bytes()).unwrap().blocks
    }

    fn para(text: &str) -> DocBlock {
        DocBlock::Paragraph { text: text.into() }
    }

    fn table(rows: &[&[&str]]) -> DocBlock {
        DocBlock::Table {
            rows: rows
                .iter()
                .map(|r| r.iter().map(|c| (*c).to_string()).collect())
                .collect(),
        }
    }

    #[test]
    fn plain_paragraphs() {
        let d = extract(br"{\rtf1\ansi Hello \par World\par}").unwrap();
        assert_eq!(d.format, DocFormat::Rtf);
        assert_eq!(
            blocks(r"{\rtf1\ansi Hello \par World\par}"),
            [para("Hello "), para("World")]
        );
        assert!(d.warnings.is_empty());
    }

    #[test]
    fn unicode_escape_skips_fallback() {
        let got = blocks(r"{\rtf1\ansi\uc1\u1513?\u1500\'3f\u1493 ?\par}");
        assert_eq!(got, [para("שלו")]);
    }

    #[test]
    fn uc_zero_and_two() {
        assert_eq!(blocks(r"{\rtf1\uc0\u1513 a\par}"), [para("שa")]);
        assert_eq!(blocks(r"{\rtf1\uc2\u1513\'3f\'3fa\par}"), [para("שa")]);

        // \uc is group scoped
        assert_eq!(blocks(r"{\rtf1{\uc0 x}\u1513?a\par}"), [para("xשa")]);
    }

    #[test]
    fn ansicpg_1255_hex_bytes() {
        assert_eq!(
            blocks(r"{\rtf1\ansi\ansicpg1255\'e0\'e1\par}"),
            [para("אב")]
        );
    }

    #[test]
    fn hebrew_charset_font_without_ansicpg() {
        let src = r"{\rtf1\ansi\deff0{\fonttbl{\f0\fnil\fcharset177 Arial;}{\f1\fcharset0 Arial;}}\f0 \'e0\'e1{\f1 \'e9}\par}";
        assert_eq!(blocks(src), [para("אבé")]);
    }

    #[test]
    fn hebrew_font_charset_beats_ansicpg() {
        let src = r"{\rtf1\ansi\ansicpg1252{\fonttbl{\f0\fcharset177 Arial;}{\f1\fcharset0 Arial;}}\f0 \'f9\'ec\'e5\'ed{\f1 \'e9}\par}";
        assert_eq!(blocks(src), [para("שלוםé")]);
    }

    #[test]
    fn arabic_font_charset_is_cp1256() {
        let src = r"{\rtf1\ansi{\fonttbl{\f0\fcharset178 Arial;}}\f0 \'c7\par}";
        assert_eq!(blocks(src), [para("\u{0627}")]);
    }

    #[test]
    fn ansicpg_1252_latin() {
        assert_eq!(
            blocks(r"{\rtf1\ansi\ansicpg1252 caf\'e9\par}"),
            [para("café")]
        );
        assert_eq!(blocks(r"{\rtf1\ansi\ansicpg99999 \'e9\par}"), [para("é")]);
    }

    #[test]
    fn negative_unicode_values() {
        assert_eq!(blocks(r"{\rtf1\u-1238?\par}"), [para("\u{FB2A}")]);
    }

    #[test]
    fn surrogate_pairs() {
        assert_eq!(blocks(r"{\rtf1\u-10179?\u-8704?\par}"), [para("\u{1F600}")]);
        assert_eq!(
            blocks(r"{\rtf1\uc0\u-10179\u-8704 x\par}"),
            [para("\u{1F600}x")]
        );
        assert_eq!(blocks(r"{\rtf1\u-10179?x\par}"), [para("\u{FFFD}x")]);
        assert_eq!(blocks(r"{\rtf1\u-8704?x\par}"), [para("\u{FFFD}x")]);
    }

    #[test]
    fn line_tab_and_symbols() {
        assert_eq!(
            blocks("{\\rtf1 a\\line b\\tab c\\~d\\_e\\-f\\\\\\{\\}\r\ng\\par}"),
            [para("a\nb\tc\u{A0}d\u{2011}ef\\{}g")]
        );
    }

    #[test]
    fn page_and_sect_end_paragraphs() {
        assert_eq!(
            blocks(r"{\rtf1 a\page b\sect c}"),
            [para("a"), para("b"), para("c")]
        );
    }

    #[test]
    fn table_two_by_two() {
        let src = r"{\rtf1\trowd\cellx1000\cellx2000\pard\intbl a\cell b\cell\row\trowd\pard\intbl c\cell d\cell\row\pard after\par}";
        assert_eq!(
            blocks(src),
            [table(&[&["a", "b"], &["c", "d"]]), para("after")]
        );
    }

    #[test]
    fn table_closes_at_end_of_input_and_keeps_inner_par() {
        let src = r"{\rtf1\pard\intbl a\par b\cell\row}";
        assert_eq!(blocks(src), [table(&[&["a\nb"]])]);
    }

    #[test]
    fn nested_cell_is_flattened() {
        let src = r"{\rtf1\pard\intbl x\nestcell y\nestcell\nestrow z\nestcell w\nestcell\nestrow\cell\row}";
        assert_eq!(blocks(src), [table(&[&["x\ty\nz\tw"]])]);
    }

    #[test]
    fn skipped_destinations() {
        let src = r"{\rtf1{\*\generator Foo 1.0;}{\colortbl;\red0\green0\blue0;}{\info{\title T}}{\*\unknown stuff}a{\header h}{\footnote f}b\par}";
        let d = extract(src.as_bytes()).unwrap();
        assert_eq!(d.blocks, [para("ab")]);
        assert!(d.warnings.is_empty());
    }

    #[test]
    fn fldrslt_is_kept_and_fldinst_skipped() {
        let src = r"{\rtf1{\field{\*\fldinst HYPERLINK x}{\fldrslt link}}\par}";
        assert_eq!(blocks(src), [para("link")]);
    }

    #[test]
    fn bin_skips_raw_bytes_with_braces() {
        let src = "{\\rtf1 a\\bin5 }{}\\x b\\par}";
        assert_eq!(blocks(src), [para("a b")]);
    }

    #[test]
    fn bin_as_unicode_fallback_skips_its_data() {
        let src = r"{\rtf1\uc1\u1513\bin3 }}}x\par}";
        assert_eq!(blocks(src), [para("שx")]);
    }

    #[test]
    fn trailing_content_after_root_group() {
        for src in [r"{\rtf1 a}x", r"{\rtf1 a}}"] {
            let e = extract(src.as_bytes()).unwrap_err();
            assert_eq!(e.kind, DocErrorKind::Corrupt, "{src}");
            assert!(
                e.message.contains("after the end of the RTF document"),
                "{}",
                e.message
            );
        }
        assert_eq!(blocks("{\\rtf1 a}\r\n"), [para("a")]);
        assert_eq!(blocks("{\\rtf1 a}\0"), [para("a")]);
    }

    #[test]
    fn associated_font_charset_inside_rtlch() {
        let src = r"{\rtf1\ansi\ansicpg1252{\fonttbl{\f0\fcharset0 Arial;}{\f1\fcharset177 Arial;}{\f2\fcharset178 Arial;}}\f0 {\ltrch\fcs0 \f0 \rtlch\fcs1 \af1 \'f9\'ec\'e5\'ed}{\rtlch\fcs1 \af1 \ltrch\fcs0 \f0 caf\'e9}{\rtlch\af2 \'c7}\par}";
        assert_eq!(blocks(src), [para("שלוםcafé\u{0627}")]);
        // The state is group scoped.
        let src = r"{\rtf1\ansi\ansicpg1252{\fonttbl{\f0\fcharset0 Arial;}{\f1\fcharset177 Arial;}}\f0 {\rtlch\af1 \'e0}\'e9\par}";
        assert_eq!(blocks(src), [para("אé")]);
    }

    #[test]
    fn word_cp1255_fixture_matches_expected() {
        for name in RTF_ONLY_FIXTURE_NAMES {
            let dir = fixture_dir();
            let bytes = std::fs::read(dir.join(format!("{name}.rtf"))).unwrap();
            let expected: Vec<DocBlock> = serde_json::from_slice(
                &std::fs::read(dir.join(format!("{name}.expected.json"))).unwrap(),
            )
            .unwrap();
            let got = enforce_text_cap(extract(&bytes).unwrap()).unwrap();
            assert_eq!(got.blocks, expected, "{name}");
        }
    }

    #[test]
    fn pict_and_object_warn_once() {
        let src = r"{\rtf1 a{\pict\pngblip 89}{\pict 90}{\object\objemb x}{\object y}b\par}";
        let d = extract(src.as_bytes()).unwrap();
        assert_eq!(d.blocks, [para("ab")]);
        let kinds: Vec<_> = d.warnings.iter().map(|w| w.kind).collect();
        assert_eq!(kinds, [DocWarningKind::Skipped, DocWarningKind::Skipped]);
        assert_ne!(d.warnings[0].message, d.warnings[1].message);
    }

    #[test]
    fn leading_whitespace_is_allowed() {
        assert_eq!(blocks("\r\n  {\\rtf1 x}"), [para("x")]);
    }

    #[test]
    fn corrupt_inputs() {
        for src in [r"{\rtf1 {abc}", "{\\rtf1 abc", "plain text", "", r"\rtf1 x"] {
            let e = extract(src.as_bytes()).unwrap_err();
            assert_eq!(e.kind, DocErrorKind::Corrupt, "{src}");
        }
    }

    #[test]
    fn depth_limit() {
        let ok = format!(
            r"{{\rtf1{}x{}}}",
            "{".repeat(MAX_DEPTH - 1),
            "}".repeat(MAX_DEPTH - 1)
        );
        assert!(extract(ok.as_bytes()).is_ok());
        let deep = format!(
            r"{{\rtf1{}x{}}}",
            "{".repeat(MAX_DEPTH),
            "}".repeat(MAX_DEPTH)
        );
        assert_eq!(
            extract(deep.as_bytes()).unwrap_err().kind,
            DocErrorKind::Corrupt
        );
    }

    #[test]
    fn fixture_expectations_hold() {
        for name in FIXTURE_NAMES {
            let dir = fixture_dir();
            let bytes = std::fs::read(dir.join(format!("{name}.rtf"))).unwrap();
            let expected: Vec<DocBlock> = serde_json::from_slice(
                &std::fs::read(dir.join(format!("{name}.expected.json"))).unwrap(),
            )
            .unwrap();
            let got = enforce_text_cap(extract(&bytes).unwrap()).unwrap();
            assert_eq!(got.blocks, expected, "{name}");
        }
    }
}
