//! Text-based PDF extraction: glyph positions from `pdf-extract`, rebuilt into one paragraph
//! per visual line, with horizontal gaps turned back into spaces and Hebrew runs converted from
//! visual to logical order (decided from glyph positions, never from stream order).
use super::{
    DocBlock, DocError, DocErrorKind, DocFormat, DocWarning, DocWarningKind, DocumentText,
};
use pdf_extract::{Document, MediaBox, Object, ObjectId, OutputDev, OutputError, Transform};
use std::ops::Range;
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

/// A glyph that carries visible text. A zero-width `Neutral` glyph whose text is exactly one
/// ASCII graphic character is an unmapped placeholder (the crate falls back to the encoding for
/// a missing ToUnicode entry and yields the byte, e.g. "0") and is dropped. A zero-width
/// non-ASCII neutral (maqaf, sof pasuq) is real text and is kept. The clusters such placeholders
/// used to hide (LibreOffice ligature glyphs for niqqud) are restored from the page's
/// `/ActualText` spans (see `scan_page_spans`).
fn is_visible(g: &Glyph) -> bool {
    match kind_of(&g.text) {
        Kind::Blank => false,
        Kind::Neutral => g.width > 0.0 || !is_placeholder(&g.text),
        _ => true,
    }
}

/// Exactly one ASCII graphic character.
fn is_placeholder(text: &str) -> bool {
    let mut chars = text.chars();
    matches!((chars.next(), chars.next()), (Some(c), None) if c.is_ascii_graphic())
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
/// width, `left_edge` the page's minimum glyph x and `right_edge` its maximum glyph right edge.
/// A right-to-left line is indented from the right edge, any other line from the left edge.
/// Returns the text and whether any RTL run was reordered.
fn reorder_line(line: &[&Glyph], avg: f64, left_edge: f64, right_edge: f64) -> (String, bool) {
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
    let indent = match items.last() {
        Some(last) if rtl_line => spaces_for(right_edge - last.right, avg),
        _ => spaces_for(items[0].x - left_edge, avg),
    };
    let mut out = " ".repeat(indent);
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
    // Marks are zero-width and may sit outside every base: they never set the edge.
    let right_edge = glyphs
        .iter()
        .filter(|g| kind_of(&g.text) != Kind::Mark)
        .map(|g| g.x + g.width)
        .fold(f64::NEG_INFINITY, f64::max);
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
        let (text, r) = reorder_line(&line, avg, left_edge, right_edge);
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
    /// Most glyphs accepted before the collection fails.
    max_glyphs: usize,
    /// (page number, index of the page's first glyph), in page order.
    page_starts: Vec<(u32, usize)>,
}

impl Collector {
    fn new(max_glyphs: usize) -> Self {
        Collector {
            page: 0,
            glyphs: Vec::new(),
            too_large: false,
            max_glyphs,
            page_starts: Vec::new(),
        }
    }

    /// Index range of the glyphs collected for page `page_num`.
    fn page_range(&self, page_num: u32) -> Option<Range<usize>> {
        let i = self.page_starts.iter().position(|(p, _)| *p == page_num)?;
        let start = self.page_starts[i].1;
        let end = self
            .page_starts
            .get(i + 1)
            .map_or(self.glyphs.len(), |(_, s)| *s);
        Some(start..end)
    }
}

impl OutputDev for Collector {
    fn begin_page(
        &mut self,
        page_num: u32,
        _media_box: &MediaBox,
        _art_box: Option<(f64, f64, f64, f64)>,
    ) -> Result<(), OutputError> {
        self.page = page_num;
        self.page_starts.push((page_num, self.glyphs.len()));
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
        if self.glyphs.len() >= self.max_glyphs {
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

/// The `/ActualText` spans of one page, counted in character codes shown by the page's own
/// content stream (the unit pdf-extract reports one glyph for).
#[derive(Debug, Clone, PartialEq)]
struct PageSpans {
    /// Character codes shown by the page.
    total_codes: usize,
    /// Outermost spans as (first code index, code count, replacement text), in stream order.
    spans: Vec<(usize, usize, String)>,
}

/// Marked-content nesting entry.
#[derive(Clone, Copy)]
enum Frame {
    /// `BMC`, or `BDC` without `/ActualText`.
    Plain,
    /// An `/ActualText` span that is not inside another one.
    Outer,
    /// An `/ActualText` span covered by an outer one.
    Nested,
}

/// Bytes per character code of a font, or `None` when it cannot be told: a `Type0` font is
/// counted only with an `/Identity-H` or `/Identity-V` encoding name; every other `Type0`
/// CMap is left alone.
fn code_width(doc: &Document, font: &pdf_extract::Dictionary) -> Option<usize> {
    let name_of = |key: &[u8]| -> Option<Vec<u8>> {
        let (_, obj) = doc.dereference(font.get(key).ok()?).ok()?;
        obj.as_name().ok().map(<[u8]>::to_vec)
    };
    if name_of(b"Subtype").as_deref() == Some(b"Type0") {
        let enc = name_of(b"Encoding")?;
        (enc == b"Identity-H" || enc == b"Identity-V").then_some(2)
    } else {
        Some(1)
    }
}

/// Character codes in a shown string, `None` for an odd length in a 2-byte font.
fn code_count(s: &[u8], width: usize) -> Option<usize> {
    s.len().is_multiple_of(width).then_some(s.len() / width)
}

/// Walk the page content and collect its `/ActualText` spans. `None` leaves the page alone
/// (missing content, bad operands, unknown font). Only an inline property-list dictionary is
/// read; a named property list (`/Span /MC0 BDC`, resolved through `/Properties`) is out of
/// scope and counts as "no ActualText".
fn scan_page_spans(doc: &Document, page_id: ObjectId) -> Option<PageSpans> {
    let content = doc.get_and_decode_page_content(page_id).ok()?;
    let fonts = doc.get_page_fonts(page_id).ok()?;
    let mut width: Option<usize> = None;
    let mut stack: Vec<Frame> = Vec::new();
    // The open outermost span: (first code index, decoded text or None on a decode error).
    let mut open: Option<(usize, Option<String>)> = None;
    let mut total = 0usize;
    let mut spans = Vec::new();
    for op in &content.operations {
        let shown: Option<usize> = match op.operator.as_str() {
            "Tf" => {
                let name = op.operands.first()?.as_name().ok()?;
                width = fonts.get(name).and_then(|f| code_width(doc, f));
                None
            }
            "BMC" => {
                stack.push(Frame::Plain);
                None
            }
            "BDC" => {
                let text = match op.operands.get(1) {
                    Some(Object::Dictionary(d)) => d.get(b"ActualText").ok(),
                    _ => None,
                };
                match text {
                    None => stack.push(Frame::Plain),
                    Some(_) if open.is_some() => stack.push(Frame::Nested),
                    Some(obj) => {
                        open = Some((total, pdf_extract::decode_text_string(obj).ok()));
                        stack.push(Frame::Outer);
                    }
                }
                None
            }
            "EMC" => {
                if let Some(Frame::Outer) = stack.pop() {
                    if let Some((start, Some(text))) = open.take() {
                        if total > start {
                            spans.push((start, total - start, text));
                        }
                    }
                }
                None
            }
            "Tj" | "'" => match op.operands.first()? {
                Object::String(s, _) => code_count(s, width?),
                _ => return None,
            },
            "\"" => match op.operands.get(2)? {
                Object::String(s, _) => code_count(s, width?),
                _ => return None,
            },
            "TJ" => {
                let Object::Array(items) = op.operands.first()? else {
                    return None;
                };
                let mut n = 0usize;
                for e in items {
                    if let Object::String(s, _) = e {
                        n = n.checked_add(code_count(s, width?)?)?;
                    }
                }
                Some(n)
            }
            _ => None,
        };
        if let Some(n) = shown {
            total = total.checked_add(n)?;
        }
    }
    Some(PageSpans {
        total_codes: total,
        spans,
    })
}

/// Replace each span's glyphs (a contiguous run in stream order) with one glyph carrying the
/// span's text. Only applies when the page's glyph count equals the pre-pass's code count;
/// otherwise (Form XObjects, other CMaps, decode failures) the page is left unchanged.
fn apply_actual_text(glyphs: &mut Vec<Glyph>, page_range: Range<usize>, spans: &PageSpans) {
    if page_range.end > glyphs.len() || page_range.len() != spans.total_codes {
        return;
    }
    // Back to front, so earlier indices stay valid while spans shrink.
    for (start, len, text) in spans.spans.iter().rev() {
        let lo = page_range.start + start;
        let hi = lo + len;
        if start + len > spans.total_codes || *len == 0 {
            continue;
        }
        if text.is_empty() {
            glyphs.drain(lo..hi);
            continue;
        }
        let run = &glyphs[lo..hi];
        let min_x = run.iter().map(|g| g.x).fold(f64::INFINITY, f64::min);
        let max_right = run
            .iter()
            .map(|g| g.x + g.width)
            .fold(f64::NEG_INFINITY, f64::max);
        let first = &run[0];
        let merged = Glyph {
            page: first.page,
            x: min_x,
            y: first.y,
            width: max_right - min_x,
            font_size: first.font_size,
            text: text.clone(),
        };
        glyphs.splice(lo..hi, [merged]);
    }
}

/// The crate work: load, collect glyphs, build blocks.
fn extract_blocking(bytes: &[u8]) -> Result<DocumentText, DocError> {
    extract_with_limit(bytes, MAX_GLYPHS)
}

/// `extract_blocking` with an explicit glyph cap.
fn extract_with_limit(bytes: &[u8], max_glyphs: usize) -> Result<DocumentText, DocError> {
    let mut doc = Document::load_mem(bytes).map_err(|e| load_error(&e))?;
    if doc.is_encrypted() && doc.decrypt("").is_err() {
        return Err(corrupt("encrypted PDF"));
    }
    let mut collector = Collector::new(max_glyphs);
    let result = pdf_extract::output_doc(&doc, &mut collector);
    if collector.too_large {
        return Err(DocError::new(
            DocErrorKind::TextTooLarge,
            "PDF has too many characters",
        ));
    }
    result.map_err(|e| corrupt(format!("cannot read PDF text: {e}")))?;
    // Last page first: a replacement shrinks the vector and moves later pages only.
    for (page_num, page_id) in doc.get_pages().into_iter().rev() {
        if let (Some(range), Some(spans)) = (
            collector.page_range(page_num),
            scan_page_spans(&doc, page_id),
        ) {
            apply_actual_text(&mut collector.glyphs, range, &spans);
        }
    }
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
        assemble(&[
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>".to_string(),
            "<< /Length 0 >>\nstream\n\nendstream".to_string(),
        ])
    }

    /// Serialize objects 1..=n (object 1 is the catalog) with an xref table.
    fn assemble(objs: &[String]) -> Vec<u8> {
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

    /// `blank_pdf` with a page that has the Helvetica font `/F1` and the given content stream.
    fn text_pdf(content: &str) -> Vec<u8> {
        assemble(&[
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 800] /Contents 4 0 R \
             /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica \
             /Encoding /WinAnsiEncoding >> >> >> >>"
                .to_string(),
            format!(
                "<< /Length {} >>\nstream\n{content}\nendstream",
                content.len() + 1
            ),
        ])
    }

    fn paragraphs(bytes: &[u8]) -> Vec<String> {
        extract(bytes)
            .unwrap()
            .blocks
            .iter()
            .filter_map(|b| match b {
                DocBlock::Paragraph { text } => Some(text.clone()),
                DocBlock::Table { .. } => None,
            })
            .collect()
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
    fn fixture_lines_match_the_oracle_with_marks() {
        for name in FIXTURE_NAMES {
            let want = oracle(name);
            let got = fixture_paragraphs(name);
            assert_eq!(got.len(), want.len(), "fixture {name}: line count");
            for (i, (g, w)) in got.iter().zip(&want).enumerate() {
                assert_eq!(g, w, "fixture {name} line {i}");
            }
        }
    }

    #[test]
    fn actual_text_replaces_span_glyphs() {
        // 16.672 = Helvetica "b" advance (556/1000 * 12) past x=10: no gap between the two glyphs.
        let pdf = text_pdf(
            "BT /F1 12 Tf 1 0 0 1 16.672 700 Tm /Span <</ActualText <FEFF05E905B605C1>>> BDC (a) Tj EMC \
             1 0 0 1 10 700 Tm /Span <</ActualText <FEFF05DC>>> BDC (b) Tj EMC ET",
        );
        assert_eq!(paragraphs(&pdf), vec!["שֶׁל"]);
        // Without spans the same glyphs read "ba".
        let plain =
            text_pdf("BT /F1 12 Tf 1 0 0 1 16.672 700 Tm (a) Tj 1 0 0 1 10 700 Tm (b) Tj ET");
        assert_eq!(paragraphs(&plain), vec!["ba"]);
    }

    #[test]
    fn actual_text_span_over_two_glyphs_and_nesting() {
        let two = text_pdf(
            "BT /F1 12 Tf 10 700 Td /Span <</ActualText <FEFF05D205B605BC>>> BDC (ab) Tj EMC ET",
        );
        assert_eq!(paragraphs(&two), vec!["גֶּ"]);
        let nested = text_pdf(
            "BT /F1 12 Tf 10 700 Td /Span <</ActualText <FEFF05D0>>> BDC \
             /Span <</ActualText <FEFF05D1>>> BDC (ab) Tj EMC (c) Tj EMC ET",
        );
        assert_eq!(paragraphs(&nested), vec!["א"]);
        let empty =
            text_pdf("BT /F1 12 Tf 10 700 Td /Span <</ActualText ()>> BDC (zz) Tj EMC (k) Tj ET");
        assert_eq!(paragraphs(&empty), vec!["k"]);
        // A plain BDC / BMC only nests; its glyphs stay.
        let plain =
            text_pdf("BT /F1 12 Tf 10 700 Td /P <</MCID 0>> BDC /Span BMC (ab) Tj EMC EMC ET");
        assert_eq!(paragraphs(&plain), vec!["ab"]);
    }

    #[test]
    fn actual_text_count_mismatch_leaves_glyphs() {
        let glyphs = row(0, 700.0, "abc");
        let spans = PageSpans {
            total_codes: 5,
            spans: vec![(0, 2, "x".to_string())],
        };
        let mut got = glyphs.clone();
        apply_actual_text(&mut got, 0..3, &spans);
        assert_eq!(got, glyphs);
        // The same span applies once the counts agree.
        let spans = PageSpans {
            total_codes: 3,
            spans: vec![(0, 2, "x".to_string())],
        };
        apply_actual_text(&mut got, 0..3, &spans);
        let texts: Vec<&str> = got.iter().map(|g| g.text.as_str()).collect();
        assert_eq!(texts, vec!["x", "c"]);
        assert_eq!(got[0].width, 2.0 * W);
    }

    #[test]
    fn mark_follows_containment_not_nearest_centre() {
        let glyph = |x: f64, width: f64, t: &str| {
            let mut gl = g(x, 700.0, t);
            gl.width = width;
            gl
        };
        // The patah centre (18) is inside nun [0, 20) but nearer the centre of he (22).
        let gl = vec![
            glyph(0.0, 20.0, "נ"),
            glyph(20.0, 4.0, "ה"),
            glyph(18.0, 0.0, "\u{05B7}"),
        ];
        assert_eq!(lines(&gl), vec!["הנ\u{05B7}"]);
        // Mirrored: the centre (5) is inside he [4, 24) but nearer the centre of nun (2).
        let gl = vec![
            glyph(0.0, 4.0, "נ"),
            glyph(4.0, 20.0, "ה"),
            glyph(5.0, 0.0, "\u{05B7}"),
        ];
        assert_eq!(lines(&gl), vec!["ה\u{05B7}נ"]);
    }

    #[test]
    fn glyph_cap_is_a_collector_field() {
        let mut c = Collector::new(2);
        let t = Transform::identity();
        assert!(c.output_character(&t, 0.5, 0.0, 12.0, "a").is_ok());
        assert!(c.output_character(&t, 0.5, 0.0, 12.0, "b").is_ok());
        assert!(!c.too_large);
        assert!(c.output_character(&t, 0.5, 0.0, 12.0, "c").is_err());
        assert!(c.too_large);
        assert_eq!(c.glyphs.len(), 2);
    }

    #[test]
    fn extract_with_limit_over_cap_is_text_too_large() {
        let pdf = text_pdf("BT /F1 12 Tf 10 700 Td (abc) Tj ET");
        let e = extract_with_limit(&pdf, 2).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::TextTooLarge);
        assert_eq!(e.message, "PDF has too many characters");
        let d = extract_with_limit(&pdf, 3).unwrap();
        assert_eq!(
            d.blocks,
            vec![DocBlock::Paragraph {
                text: "abc".to_string()
            }]
        );
    }

    /// `text_pdf` encrypted with RC4-128 under `user_password` (owner password "owner").
    fn encrypted_pdf(user_password: &str) -> Vec<u8> {
        use pdf_extract::{EncryptionState, EncryptionVersion, Permissions, StringFormat};
        let mut doc =
            Document::load_mem(&text_pdf("BT /F1 12 Tf 10 700 Td (secret) Tj ET")).unwrap();
        let id = Object::String(b"0123456789abcdef".to_vec(), StringFormat::Literal);
        doc.trailer.set("ID", Object::Array(vec![id.clone(), id]));
        let state = EncryptionState::try_from(EncryptionVersion::V2 {
            document: &doc,
            owner_password: "owner",
            user_password,
            key_length: 128,
            permissions: Permissions::all(),
        })
        .unwrap();
        doc.encrypt(&state).unwrap();
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    #[test]
    fn encrypted_pdf_with_a_user_password_is_corrupt() {
        let e = extract(&encrypted_pdf("hunter2")).unwrap_err();
        assert_eq!(e.kind, DocErrorKind::Corrupt);
        assert_eq!(e.message, "encrypted PDF");
    }

    #[test]
    fn encrypted_pdf_with_an_empty_user_password_extracts() {
        assert_eq!(paragraphs(&encrypted_pdf("")), vec!["secret"]);
    }

    #[test]
    fn load_error_maps_password_errors_to_encrypted_pdf() {
        for e in [
            pdf_extract::Error::InvalidPassword,
            pdf_extract::Error::AlreadyEncrypted,
        ] {
            let d = load_error(&e);
            assert_eq!(d.kind, DocErrorKind::Corrupt);
            assert_eq!(d.message, "encrypted PDF");
        }
    }

    #[test]
    fn zero_width_placeholder_is_dropped_but_other_neutrals_kept() {
        let zero = |x: f64, t: &str| {
            let mut gl = g(x, 700.0, t);
            gl.width = 0.0;
            gl
        };
        let gl = vec![g(0.0, 700.0, "a"), zero(W, "0"), g(W, 700.0, "b")];
        assert_eq!(lines(&gl), vec!["ab"]);
        let gl = vec![g(0.0, 700.0, "א"), zero(W, "\u{05BE}"), g(W, 700.0, "ב")];
        assert_eq!(lines(&gl), vec!["ב\u{05BE}א"]);
    }

    #[test]
    fn rtl_indentation_is_measured_from_the_right_edge() {
        let mut gl = row(0, 700.0, "םולש");
        gl.extend(row(2, 680.0, "בא"));
        gl.extend(row(0, 660.0, "בא"));
        assert_eq!(lines(&gl), vec!["שלום", "אב", "  אב"]);
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
