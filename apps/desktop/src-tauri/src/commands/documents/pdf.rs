//! Text-based PDF extraction: glyph positions from `pdf-extract`, rebuilt into one paragraph
//! per visual line, with horizontal gaps turned back into spaces and Hebrew runs converted from
//! visual to logical order (decided from glyph positions, never from stream order).
use super::{
    DocBlock, DocError, DocErrorKind, DocFormat, DocWarning, DocWarningKind, DocumentText,
};
use pdf_extract::{Document, MediaBox, OutputDev, OutputError, Transform};
use std::sync::mpsc;
use std::time::Duration;

/// How long the caller waits for the extraction worker.
const PDF_TIMEOUT: Duration = Duration::from_secs(30);
/// Stack of the extraction worker (deep recursion on malformed files).
const WORKER_STACK_BYTES: usize = 256 * 1_048_576;
/// Most glyphs collected from one document.
const MAX_GLYPHS: usize = 2_000_000;
/// Most spaces rebuilt from one gap.
const MAX_SPACES: usize = 200;

/// One positioned glyph in device space.
#[derive(Debug, Clone, PartialEq)]
struct Glyph {
    page: u32,
    x: f64,
    y: f64,
    /// Device-space advance width.
    width: f64,
    /// Device-space font size.
    font_size: f64,
    text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Hebrew,
    Latin,
    /// Digits and punctuation.
    Neutral,
    /// Non-spacing Hebrew point or cantillation mark.
    Mark,
    /// Whitespace or control only: dropped, spaces are rebuilt from gaps.
    Blank,
}

fn is_hebrew_letter(c: char) -> bool {
    matches!(c, '\u{05D0}'..='\u{05EA}' | '\u{FB1D}'..='\u{FB4F}') && c != '\u{FB1E}'
}

fn is_hebrew_mark(c: char) -> bool {
    matches!(c, '\u{0591}'..='\u{05BD}' | '\u{05BF}' | '\u{05C1}'..='\u{05C2}')
        || matches!(c, '\u{05C4}'..='\u{05C5}' | '\u{05C7}' | '\u{FB1E}')
}

/// A glyph that carries visible text. A zero-width glyph that is neither a mark nor a letter
/// is an unmapped placeholder (the crate decodes a missing ToUnicode entry as its byte, e.g.
/// "0") and is dropped.
fn is_visible(g: &Glyph) -> bool {
    match kind_of(&g.text) {
        Kind::Blank => false,
        Kind::Neutral => g.width > 0.0,
        _ => true,
    }
}

fn kind_of(text: &str) -> Kind {
    if text.chars().all(|c| c.is_whitespace() || c.is_control()) {
        Kind::Blank
    } else if text.chars().all(is_hebrew_mark) {
        Kind::Mark
    } else if text.chars().any(is_hebrew_letter) {
        Kind::Hebrew
    } else if text.chars().any(char::is_alphabetic) {
        Kind::Latin
    } else {
        Kind::Neutral
    }
}

/// Spaces for a horizontal `gap` given the page's typical character width.
fn spaces_for(gap: f64, avg: f64) -> usize {
    if avg <= 0.0 || gap.is_nan() || gap <= 0.25 * avg {
        return 0;
    }
    let n = (gap / avg).round();
    // Float to count: bounded by MAX_SPACES first, so the cast cannot overflow.
    (n.max(1.0).min(MAX_SPACES as f64)) as usize
}

fn median_width(glyphs: &[&Glyph]) -> f64 {
    let mut widths: Vec<f64> = glyphs
        .iter()
        .filter(|g| matches!(kind_of(&g.text), Kind::Hebrew | Kind::Latin | Kind::Neutral))
        .map(|g| g.width)
        .filter(|w| *w > 0.0)
        .collect();
    if widths.is_empty() {
        return glyphs.first().map_or(1.0, |g| (g.font_size * 0.5).max(0.1));
    }
    widths.sort_by(f64::total_cmp);
    widths[widths.len() / 2]
}

/// A base glyph (with its attached marks) in a visual line.
struct Item {
    x: f64,
    right: f64,
    text: String,
    rtl: bool,
    raw: Kind,
}

/// A base glyph, its kind, and its marks as (x, stream index, text).
type BaseWithMarks<'a> = (&'a Glyph, Kind, Vec<(f64, usize, &'a str)>);

/// Attach each mark to the base whose extent contains the mark's centre (nearest otherwise).
/// `line` is sorted by x. Returns items in visual order.
fn attach_marks(line: &[&Glyph]) -> Vec<Item> {
    let mut bases: Vec<BaseWithMarks> = Vec::new();
    let mut marks: Vec<(usize, &Glyph)> = Vec::new();
    for (i, g) in line.iter().enumerate() {
        match kind_of(&g.text) {
            Kind::Blank => {}
            Kind::Mark => marks.push((i, g)),
            k => bases.push((g, k, Vec::new())),
        }
    }
    if bases.is_empty() {
        // Marks alone: show them as they are.
        for (_, g) in &marks {
            bases.push((g, Kind::Neutral, Vec::new()));
        }
        marks.clear();
    }
    for (idx, m) in marks {
        let centre = m.x + m.width / 2.0;
        let mut best: Option<(usize, f64)> = None;
        for (bi, (b, _, _)) in bases.iter().enumerate() {
            // Half-open extent [x, x + width): a mark on a shared edge belongs to the base
            // that starts there. The epsilon absorbs float noise from the crate's transforms.
            let eps = 0.01 * b.width.max(0.0);
            let dist = if centre < b.x - eps {
                b.x - centre
            } else if centre >= b.x + b.width - eps {
                centre - (b.x + b.width) + eps + f64::MIN_POSITIVE
            } else {
                0.0
            };
            let better = match best {
                None => true,
                Some((_, d)) => dist < d,
            };
            if better {
                best = Some((bi, dist));
            }
        }
        if let Some((bi, _)) = best {
            bases[bi].2.push((m.x, idx, m.text.as_str()));
        }
    }
    bases
        .into_iter()
        .map(|(b, k, mut ms)| {
            ms.sort_by(|a, c| a.0.total_cmp(&c.0).then(a.1.cmp(&c.1)));
            let mut text = b.text.clone();
            for (_, _, t) in ms {
                text.push_str(t);
            }
            Item {
                x: b.x,
                right: b.x + b.width,
                text,
                rtl: k == Kind::Hebrew,
                raw: k,
            }
        })
        .collect()
}

/// Is the line right-to-left (decided from the visual positions of its strong glyphs)?
fn line_is_rtl(items: &[Item]) -> bool {
    let strong: Vec<&Item> = items
        .iter()
        .filter(|i| matches!(i.raw, Kind::Hebrew | Kind::Latin))
        .collect();
    let (Some(left), Some(right)) = (strong.first(), strong.last()) else {
        return false;
    };
    match (left.raw, right.raw) {
        (Kind::Hebrew, Kind::Hebrew) => true,
        (Kind::Latin, Kind::Latin) => false,
        _ => {
            let he = strong.iter().filter(|i| i.raw == Kind::Hebrew).count();
            he > strong.len() - he
        }
    }
}

/// Convert one visual line (glyphs sorted by x) to logical text. `avg` is the typical character
/// width and `left_edge` the page's minimum glyph x. Returns the text and whether any RTL run
/// was reordered.
fn reorder_line(line: &[&Glyph], avg: f64, left_edge: f64) -> (String, bool) {
    let mut items = attach_marks(line);
    items.sort_by(|a, b| a.x.total_cmp(&b.x));
    if items.is_empty() {
        return (String::new(), false);
    }
    // Punctuation between two Hebrew letters stays inside the RTL run.
    for i in 1..items.len().saturating_sub(1) {
        if items[i].raw == Kind::Neutral
            && !items[i].text.chars().any(|c| c.is_numeric())
            && items[i - 1].raw == Kind::Hebrew
            && items[i + 1].raw == Kind::Hebrew
        {
            items[i].rtl = true;
        }
    }
    let rtl_line = line_is_rtl(&items);
    let gaps: Vec<usize> = items
        .windows(2)
        .map(|w| spaces_for(w[1].x - w[0].right, avg))
        .collect();
    // Runs: (first index, last index inclusive, rtl).
    let mut runs: Vec<(usize, usize, bool)> = Vec::new();
    for (i, it) in items.iter().enumerate() {
        match runs.last_mut() {
            Some(r) if r.2 == it.rtl => r.1 = i,
            _ => runs.push((i, i, it.rtl)),
        }
    }
    let reordered = runs.iter().any(|r| r.2);
    let mut out = " ".repeat(spaces_for(items[0].x - left_edge, avg));
    let emit_run = |out: &mut String, r: &(usize, usize, bool)| {
        if r.2 {
            for i in (r.0..=r.1).rev() {
                out.push_str(&items[i].text);
                if i > r.0 {
                    out.push_str(&" ".repeat(gaps[i - 1]));
                }
            }
        } else {
            for i in r.0..=r.1 {
                out.push_str(&items[i].text);
                if i < r.1 {
                    out.push_str(&" ".repeat(gaps[i]));
                }
            }
        }
    };
    if rtl_line {
        for (n, r) in runs.iter().rev().enumerate() {
            if n > 0 {
                // The gap sits between this run (visually left) and the one emitted before it.
                out.push_str(&" ".repeat(gaps[r.1]));
            }
            emit_run(&mut out, r);
        }
    } else {
        for (n, r) in runs.iter().enumerate() {
            if n > 0 {
                out.push_str(&" ".repeat(gaps[r.0 - 1]));
            }
            emit_run(&mut out, r);
        }
    }
    (out, reordered)
}

/// Lines of one page, top to bottom, in logical order, plus whether any run was reordered.
fn build_page_lines(page: &[&Glyph]) -> (Vec<String>, bool) {
    let mut glyphs: Vec<&Glyph> = page.iter().copied().filter(|g| is_visible(g)).collect();
    if glyphs.is_empty() {
        return (Vec::new(), false);
    }
    let avg = median_width(&glyphs);
    let left_edge = glyphs.iter().map(|g| g.x).fold(f64::INFINITY, f64::min);
    // Total order, so the stream order of the input never matters.
    glyphs.sort_by(|a, b| {
        b.y.total_cmp(&a.y)
            .then(a.x.total_cmp(&b.x))
            .then_with(|| a.text.cmp(&b.text))
    });
    let mut lines: Vec<Vec<&Glyph>> = Vec::new();
    let mut anchor_y = 0.0;
    for g in glyphs {
        match lines.last_mut() {
            Some(line)
                if (g.y - anchor_y).abs()
                    <= 0.3
                        * line
                            .first()
                            .map_or(g.font_size, |f| f.font_size.max(g.font_size)) =>
            {
                line.push(g);
            }
            _ => {
                anchor_y = g.y;
                lines.push(vec![g]);
            }
        }
    }
    let mut reordered = false;
    let mut out = Vec::with_capacity(lines.len());
    for mut line in lines {
        line.sort_by(|a, b| a.x.total_cmp(&b.x).then_with(|| a.text.cmp(&b.text)));
        let (text, r) = reorder_line(&line, avg, left_edge);
        reordered |= r;
        out.push(text);
    }
    (out, reordered)
}

/// Paragraph texts of the whole document in page order, plus whether any run was reordered.
fn build_lines(glyphs: &[Glyph]) -> (Vec<String>, bool) {
    let mut pages: Vec<u32> = glyphs.iter().map(|g| g.page).collect();
    pages.sort_unstable();
    pages.dedup();
    let mut lines = Vec::new();
    let mut reordered = false;
    for p in pages {
        let page: Vec<&Glyph> = glyphs.iter().filter(|g| g.page == p).collect();
        let (l, r) = build_page_lines(&page);
        lines.extend(l);
        reordered |= r;
    }
    (lines, reordered)
}

/// Collects glyphs from `pdf_extract::output_doc`.
struct Collector {
    page: u32,
    glyphs: Vec<Glyph>,
    too_large: bool,
}

impl OutputDev for Collector {
    fn begin_page(
        &mut self,
        page_num: u32,
        _media_box: &MediaBox,
        _art_box: Option<(f64, f64, f64, f64)>,
    ) -> Result<(), OutputError> {
        self.page = page_num;
        Ok(())
    }
    fn end_page(&mut self) -> Result<(), OutputError> {
        Ok(())
    }
    fn output_character(
        &mut self,
        trm: &Transform,
        width: f64,
        _spacing: f64,
        font_size: f64,
        char: &str,
    ) -> Result<(), OutputError> {
        if self.glyphs.len() >= MAX_GLYPHS {
            self.too_large = true;
            return Err(OutputError::IoError(std::io::Error::other(
                "too many glyphs",
            )));
        }
        self.glyphs.push(Glyph {
            page: self.page,
            x: trm.m31,
            y: trm.m32,
            width: width * font_size * trm.m11,
            font_size: font_size * trm.m22.abs(),
            text: char.to_string(),
        });
        Ok(())
    }
    fn begin_word(&mut self) -> Result<(), OutputError> {
        Ok(())
    }
    fn end_word(&mut self) -> Result<(), OutputError> {
        Ok(())
    }
    fn end_line(&mut self) -> Result<(), OutputError> {
        Ok(())
    }
}

fn corrupt(message: impl Into<String>) -> DocError {
    DocError::new(DocErrorKind::Corrupt, message)
}

fn load_error(e: &pdf_extract::Error) -> DocError {
    match e {
        pdf_extract::Error::Decryption(_)
        | pdf_extract::Error::InvalidPassword
        | pdf_extract::Error::AlreadyEncrypted => corrupt("encrypted PDF"),
        other => corrupt(format!("cannot read PDF: {other}")),
    }
}

/// The crate work: load, collect glyphs, build blocks.
fn extract_blocking(bytes: &[u8]) -> Result<DocumentText, DocError> {
    let mut doc = Document::load_mem(bytes).map_err(|e| load_error(&e))?;
    if doc.is_encrypted() && doc.decrypt("").is_err() {
        return Err(corrupt("encrypted PDF"));
    }
    let mut collector = Collector {
        page: 0,
        glyphs: Vec::new(),
        too_large: false,
    };
    let result = pdf_extract::output_doc(&doc, &mut collector);
    if collector.too_large {
        return Err(DocError::new(
            DocErrorKind::TextTooLarge,
            "PDF has too many characters",
        ));
    }
    result.map_err(|e| corrupt(format!("cannot read PDF text: {e}")))?;
    let (lines, reordered) = build_lines(&collector.glyphs);
    let blocks: Vec<DocBlock> = lines
        .into_iter()
        .filter(|t| !t.trim().is_empty())
        .map(|text| DocBlock::Paragraph { text })
        .collect();
    let mut warnings = Vec::new();
    if blocks.is_empty() {
        warnings.push(DocWarning {
            kind: DocWarningKind::PdfNoText,
            message: "this PDF has no extractable text (it may be a scan); \
                      attach the file to an AI assistant instead"
                .to_string(),
        });
    } else if reordered {
        warnings.push(DocWarning {
            kind: DocWarningKind::PdfReordered,
            message: "Hebrew text was converted from visual to logical order".to_string(),
        });
    }
    Ok(DocumentText {
        format: DocFormat::Pdf,
        blocks,
        warnings,
    })
}

/// Run `job` on a big-stack worker thread and wait at most `timeout`.
fn run_with_timeout<F>(timeout: Duration, job: F) -> Result<DocumentText, DocError>
where
    F: FnOnce() -> Result<DocumentText, DocError> + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("pdf-extract".to_string())
        .stack_size(WORKER_STACK_BYTES)
        .spawn(move || {
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job))
                .unwrap_or_else(|_| Err(corrupt("PDF extraction failed")));
            // The receiver may be gone after a timeout.
            let _ = tx.send(r);
        })
        .map_err(|e| DocError::new(DocErrorKind::Io, e.to_string()))?;
    match rx.recv_timeout(timeout) {
        Ok(r) => r,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(corrupt("PDF extraction timed out")),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(corrupt("PDF extraction failed")),
    }
}

pub(super) fn extract(bytes: &[u8]) -> Result<DocumentText, DocError> {
    let owned = bytes.to_vec();
    run_with_timeout(PDF_TIMEOUT, move || extract_blocking(&owned))
}

#[cfg(test)]
mod tests {
    use super::super::zipxml::test_util::{fixture_dir, FIXTURE_NAMES};
    use super::*;

    const W: f64 = 7.2;

    fn g(x: f64, y: f64, text: &str) -> Glyph {
        Glyph {
            page: 1,
            x,
            y,
            width: W,
            font_size: 12.0,
            text: text.to_string(),
        }
    }

    /// Glyphs of `s` laid out left to right in cells starting at cell `start`.
    fn row(start: usize, y: f64, s: &str) -> Vec<Glyph> {
        s.chars()
            .enumerate()
            .map(|(i, c)| g((start + i) as f64 * W, y, &c.to_string()))
            .collect()
    }

    fn lines(glyphs: &[Glyph]) -> Vec<String> {
        build_lines(glyphs).0
    }

    fn collapse(s: &str) -> String {
        s.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn groups_by_baseline_tolerance() {
        let mut gl = row(0, 700.0, "ab");
        gl.extend(row(2, 700.0 - 3.5, "cd")); // 3.5 <= 0.3 * 12 = 3.6: same line
        gl.extend(row(0, 680.0, "ef")); // far below
        assert_eq!(lines(&gl), vec!["abcd", "ef"]);
        let mut gl = row(0, 700.0, "ab");
        gl.extend(row(0, 700.0 - 3.7, "cd")); // over tolerance: separate line
        assert_eq!(lines(&gl), vec!["ab", "cd"]);
    }

    #[test]
    fn lines_are_ordered_top_to_bottom_across_pages() {
        let mut gl = row(0, 100.0, "low");
        gl.extend(row(0, 700.0, "top"));
        let mut p2 = row(0, 500.0, "next");
        for x in &mut p2 {
            x.page = 2;
        }
        gl.extend(p2);
        assert_eq!(lines(&gl), vec!["top", "low", "next"]);
    }

    #[test]
    fn gaps_become_spaces() {
        // cells: a . . b  -> two spaces; then c right after b -> none
        let mut gl = vec![g(0.0, 700.0, "a"), g(3.0 * W, 700.0, "b")];
        gl.push(g(4.0 * W, 700.0, "c"));
        assert_eq!(lines(&gl), vec!["a  bc"]);
        // a small gap (0.3 cell) is one space, a tiny one (0.2 cell) none
        let gl = vec![g(0.0, 700.0, "a"), g(W + 0.3 * W, 700.0, "b")];
        assert_eq!(lines(&gl), vec!["a b"]);
        let gl = vec![g(0.0, 700.0, "a"), g(W + 0.2 * W, 700.0, "b")];
        assert_eq!(lines(&gl), vec!["ab"]);
        // a huge gap is capped
        let gl = vec![g(0.0, 700.0, "a"), g(5000.0 * W, 700.0, "b")];
        assert_eq!(lines(&gl)[0].len(), 202);
    }

    #[test]
    fn indentation_is_relative_to_the_page_minimum() {
        let mut gl = row(0, 700.0, "Am");
        gl.extend(row(3, 680.0, "G"));
        assert_eq!(lines(&gl), vec!["Am", "   G"]);
    }

    /// Visual Hebrew word "שלום" (logical order shin lamed vav mem) at cells 0..4.
    fn visual_shalom() -> Vec<Glyph> {
        row(0, 700.0, "םולש")
    }

    #[test]
    fn hebrew_visual_line_becomes_logical() {
        assert_eq!(lines(&visual_shalom()), vec!["שלום"]);
        let (_, reordered) = build_lines(&visual_shalom());
        assert!(reordered);
    }

    /// Visual "הַנ": nun at cell 0, he at cell 1 with a patah under it.
    fn niqqud_glyphs(marks_first: bool) -> Vec<Glyph> {
        let nun = g(0.0, 700.0, "נ");
        let he = g(W, 700.0, "ה");
        let mut patah = g(W, 700.0, "\u{05B7}");
        patah.width = 0.0;
        patah.x = W + 2.0;
        if marks_first {
            vec![patah, he, nun]
        } else {
            vec![nun, he, patah]
        }
    }

    #[test]
    fn niqqud_attaches_to_the_containing_base_in_either_stream_order() {
        assert_eq!(lines(&niqqud_glyphs(true)), vec!["הַנ"]);
        assert_eq!(lines(&niqqud_glyphs(false)), vec!["הַנ"]);
    }

    #[test]
    fn mark_outside_every_base_goes_to_the_nearest() {
        let mut gl = row(0, 700.0, "בא"); // visual: bet cell 0, alef cell 1 -> logical "אב"
        let mut mark = g(10.0 * W, 700.0, "\u{05B7}");
        mark.width = 0.0;
        gl.push(mark);
        assert_eq!(lines(&gl), vec!["א\u{05B7}ב"]);
    }

    #[test]
    fn latin_word_inside_hebrew_stays_unreversed() {
        // logical: שלום Am עולם ; visual (RTL): םלוע [Am] םולש  (left to right)
        let mut gl = row(0, 700.0, "םלוע");
        gl.extend(row(5, 700.0, "Am"));
        gl.extend(row(8, 700.0, "םולש"));
        assert_eq!(lines(&gl), vec!["שלום Am עולם"]);
    }

    #[test]
    fn shuffled_stream_order_gives_the_same_text() {
        let mut gl = row(0, 700.0, "םלוע");
        gl.extend(row(5, 700.0, "Am"));
        gl.extend(row(8, 700.0, "םולש"));
        gl.extend(row(0, 680.0, "Am D"));
        let expect = lines(&gl);
        let mut shuffled = gl.clone();
        shuffled.reverse();
        let n = shuffled.len();
        shuffled.swap(1, n - 2);
        shuffled.swap(3, n / 2);
        assert_eq!(lines(&shuffled), expect);
    }

    #[test]
    fn chord_line_is_unchanged() {
        let mut gl = row(2, 700.0, "Am D/F# G");
        let (l, r) = build_lines(&gl);
        assert_eq!(l, vec!["Am D/F# G"]);
        assert!(!r);
        gl.clear();
    }

    #[test]
    fn hebrew_line_with_one_latin_word_is_rtl() {
        // logical "הנחל Am זורם": visual left to right: םרוז Am לחנה
        let mut gl = row(0, 700.0, "םרוז");
        gl.extend(row(5, 700.0, "Am"));
        gl.extend(row(8, 700.0, "לחנה"));
        assert_eq!(lines(&gl), vec!["הנחל Am זורם"]);
    }

    #[test]
    fn english_line_with_a_hebrew_word_stays_ltr() {
        // ends in a Hebrew word: both ends differ, Latin wins by count
        let mut gl = row(0, 700.0, "see the word ");
        gl.extend(row(13, 700.0, "םולש"));
        assert_eq!(lines(&gl), vec!["see the word שלום"]);
        // Hebrew word in the middle
        let mut gl = row(0, 700.0, "say ");
        gl.extend(row(4, 700.0, "םולש"));
        gl.extend(row(9, 700.0, "now"));
        assert_eq!(lines(&gl), vec!["say שלום now"]);
    }

    #[test]
    fn hebrew_line_ending_in_a_latin_word_is_rtl() {
        // logical: "שלום עולם Am" -> Latin at the visual left
        let mut gl = row(0, 700.0, "Am");
        gl.extend(row(3, 700.0, "םלוע"));
        gl.extend(row(8, 700.0, "םולש"));
        assert_eq!(lines(&gl), vec!["שלום עולם Am"]);
    }

    #[test]
    fn digits_only_line_is_ltr_and_not_reordered() {
        let gl = row(0, 700.0, "123 45");
        let (l, r) = build_lines(&gl);
        assert_eq!(l, vec!["123 45"]);
        assert!(!r);
    }

    #[test]
    fn not_a_pdf_is_corrupt() {
        let e = extract(b"this is not a pdf at all").unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Corrupt);
    }

    /// A one-page PDF with an empty content stream (no text objects).
    fn blank_pdf() -> Vec<u8> {
        let objs = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>".to_string(),
            "<< /Length 0 >>\nstream\n\nendstream".to_string(),
        ];
        let mut out = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (i, o) in objs.iter().enumerate() {
            offsets.push(out.len());
            out.extend(format!("{} 0 obj\n{o}\nendobj\n", i + 1).bytes());
        }
        let xref = out.len();
        out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).bytes());
        for off in offsets {
            out.extend(format!("{off:010} 00000 n \n").bytes());
        }
        out.extend(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                objs.len() + 1
            )
            .bytes(),
        );
        out
    }

    #[test]
    fn pdf_without_text_has_no_blocks_and_a_warning() {
        let d = extract(&blank_pdf()).unwrap();
        assert!(d.blocks.is_empty());
        assert_eq!(d.warnings.len(), 1);
        assert_eq!(d.warnings[0].kind, DocWarningKind::PdfNoText);
        assert!(
            d.warnings[0].message.contains("AI"),
            "{}",
            d.warnings[0].message
        );
    }

    #[test]
    fn timeout_is_corrupt() {
        let e = run_with_timeout(Duration::from_millis(10), || {
            std::thread::sleep(Duration::from_millis(500));
            Err(corrupt("late"))
        })
        .unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Corrupt);
        assert_eq!(e.message, "PDF extraction timed out");
    }

    #[test]
    fn worker_panic_is_corrupt() {
        #[allow(clippy::panic)]
        let e = run_with_timeout(Duration::from_secs(5), || panic!("boom")).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Corrupt);
    }

    fn fixture_paragraphs(name: &str) -> Vec<String> {
        let bytes = std::fs::read(fixture_dir().join(format!("{name}.pdf"))).unwrap();
        extract(&bytes)
            .unwrap()
            .blocks
            .iter()
            .filter_map(|b| match b {
                DocBlock::Paragraph { text } => Some(collapse(text)),
                DocBlock::Table { .. } => None,
            })
            .filter(|t| !t.is_empty())
            .collect()
    }

    /// Fixture lines (name, 0-based line index) that cannot match the oracle with marks kept.
    /// Cause: LibreOffice 7.3 draws "shin + segol + shin dot" as one glyph whose ToUnicode
    /// entry is ambiguous, and a zero-width mark glyph has no ToUnicode entry, so the segol of
    /// "השמש" cannot be placed on the mem from the PDF's own text mapping (pdftotext garbles
    /// the same line). Line 5 (0-based) of he_chords_above.pdf.lines.json is that line.
    const KNOWN_LOSSY_PDF_LINES: &[(&str, usize)] = &[("he_chords_above", 5)];

    fn strip_marks(s: &str) -> String {
        s.chars().filter(|c| !is_hebrew_mark(*c)).collect()
    }

    fn oracle(name: &str) -> Vec<String> {
        let raw =
            std::fs::read_to_string(fixture_dir().join(format!("{name}.pdf.lines.json"))).unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    #[test]
    fn fixture_lines_match_the_oracle_without_marks() {
        for name in FIXTURE_NAMES {
            let want: Vec<String> = oracle(name).iter().map(|l| strip_marks(l)).collect();
            let got: Vec<String> = fixture_paragraphs(name)
                .iter()
                .map(|l| strip_marks(l))
                .collect();
            assert_eq!(got, want, "fixture {name}");
        }
    }

    #[test]
    fn fixture_lines_match_the_oracle_with_marks_except_known_lossy() {
        assert_eq!(KNOWN_LOSSY_PDF_LINES.len(), 1);
        for name in FIXTURE_NAMES {
            let want = oracle(name);
            let got = fixture_paragraphs(name);
            assert_eq!(got.len(), want.len(), "fixture {name}: line count");
            for (i, (g, w)) in got.iter().zip(&want).enumerate() {
                let lossy = KNOWN_LOSSY_PDF_LINES.contains(&(name, i));
                if lossy {
                    assert_ne!(g, w, "fixture {name} line {i} now matches: drop the entry");
                } else {
                    assert_eq!(g, w, "fixture {name} line {i}");
                }
            }
        }
        for (name, i) in KNOWN_LOSSY_PDF_LINES {
            assert!(FIXTURE_NAMES.contains(name) && *i < oracle(name).len());
        }
    }

    #[test]
    fn fixture_spacing_survives_in_he_chords_above() {
        let bytes = std::fs::read(fixture_dir().join("he_chords_above.pdf")).unwrap();
        let d = extract(&bytes).unwrap();
        let texts: Vec<&str> = d
            .blocks
            .iter()
            .filter_map(|b| match b {
                DocBlock::Paragraph { text } => Some(text.as_str()),
                DocBlock::Table { .. } => None,
            })
            .collect();
        let line = texts
            .iter()
            .find(|t| t.contains("Am") && t.contains("G"))
            .unwrap();
        eprintln!("first chord line: {line:?}");
        assert!(
            line.starts_with(' ') || line.contains("  "),
            "spacing lost: {line:?}"
        );
        assert!(d
            .warnings
            .iter()
            .any(|w| w.kind == DocWarningKind::PdfReordered));
    }
}
