//! Metadata extraction from ChordPro source (docs/CHORDPRO.md § Lines).
use super::model::Language;

/// Fields derived from a ChordPro document for indexing.
#[derive(Debug, Clone, PartialEq)]
pub struct Extracted {
    pub title: String,
    pub artist: Option<String>,
    pub key: Option<String>,
    /// Capo fret, 0-24 (docs/CHORDPRO.md § Song fields); absent when invalid.
    pub capo: Option<u8>,
    pub language: Language,
    /// Lyrics text with chords removed, used for search indexing.
    pub lyrics: String,
}

/// Whitespace as JavaScript `\s` / `trim()` sees it (includes U+FEFF, excludes U+0085).
fn is_ws(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn trim(s: &str) -> &str {
    s.trim_matches(is_ws)
}

/// A parsed `{name: value}` tag; `name` is lowercased, `value` trimmed.
struct Tag {
    name: String,
    value: Option<String>,
}

/// Hand-written § Lines tag grammar, matched against a trimmed line.
fn parse_tag(trimmed: &str) -> Option<Tag> {
    let inner = trimmed.strip_prefix('{')?.strip_suffix('}')?;
    if inner.contains('}') {
        return None;
    }
    let inner = inner.trim_start_matches(is_ws);
    let mut chars = inner.char_indices();
    let (_, first) = chars.next()?;
    if !(first.is_ascii_alphabetic() || first == '_') {
        return None;
    }
    let end = chars
        .find(|(_, c)| !(c.is_ascii_alphanumeric() || *c == '_' || *c == '-'))
        .map_or(inner.len(), |(i, _)| i);
    let name = inner[..end].to_ascii_lowercase();
    let rest = trim(&inner[end..]);
    if rest.is_empty() {
        return Some(Tag { name, value: None });
    }
    let value = rest.strip_prefix(':')?;
    Some(Tag {
        name,
        value: Some(trim(value).to_string()),
    })
}

/// Canonical literal section name opened by a start tag, if any.
fn literal_start(name: &str) -> Option<&'static str> {
    let long = match name {
        "sot" => "start_of_tab",
        "sog" => "start_of_grid",
        other => {
            return match other.strip_prefix("start_of_")? {
                "tab" => Some("tab"),
                "grid" => Some("grid"),
                "abc" => Some("abc"),
                "ly" => Some("ly"),
                "textblock" => Some("textblock"),
                "svg" => Some("svg"),
                _ => None,
            }
        }
    };
    literal_start(long)
}

fn closes_literal(name: &str, section: &str) -> bool {
    match name {
        "eot" => section == "tab",
        "eog" => section == "grid",
        other => other.strip_prefix("end_of_") == Some(section),
    }
}

/// A `meta` field line: lowercased name and trimmed value.
fn meta_field(tag: &Tag) -> Option<(String, String)> {
    let value = tag.value.as_deref().unwrap_or("");
    match tag.name.as_str() {
        "t" => Some(("title".into(), value.into())),
        "title" | "artist" | "key" | "capo" => Some((tag.name.clone(), value.into())),
        "meta" => {
            let (n, v) = match value.find(is_ws) {
                Some(i) => (&value[..i], trim(&value[i..])),
                None => (value, ""),
            };
            if n.is_empty() {
                None
            } else {
                Some((n.to_lowercase(), v.into()))
            }
        }
        _ => None,
    }
}

/// Strip `[…]` chords from a lyric line; `None` when the line is `raw` (bad bracket).
fn strip_chords(line: &str) -> Option<String> {
    let mut out = String::new();
    let mut in_chord = false;
    let mut chord_len = 0usize;
    for c in line.chars() {
        if in_chord {
            match c {
                '[' => return None,
                ']' => {
                    if chord_len == 0 {
                        return None;
                    }
                    in_chord = false;
                }
                _ => chord_len += 1,
            }
        } else if c == '[' {
            in_chord = true;
            chord_len = 0;
        } else {
            out.push(c);
        }
    }
    if in_chord {
        None
    } else {
        Some(out)
    }
}

#[derive(Default)]
struct Letters {
    he: bool,
    latin: bool,
}

fn scan_letters(text: &str) -> Letters {
    let mut l = Letters::default();
    for c in text.chars() {
        match c {
            '\u{05D0}'..='\u{05EA}' => l.he = true,
            'A'..='Z' | 'a'..='z' => l.latin = true,
            '\u{00C0}'..='\u{024F}' if c != '\u{00D7}' && c != '\u{00F7}' => l.latin = true,
            _ => {}
        }
    }
    l
}

fn detect_language(lyrics: &str, title: &str) -> Language {
    let mut l = scan_letters(lyrics);
    if !l.he && !l.latin {
        l = scan_letters(title);
    }
    match (l.he, l.latin) {
        (true, false) => Language::He,
        (true, true) => Language::Mixed,
        _ => Language::En,
    }
}

/// Extract title, artist, key, capo, language and lyrics.
pub fn extract(chordpro: &str) -> Extracted {
    let mut title: Option<String> = None;
    let mut artist: Option<String> = None;
    let mut key_seen = false;
    let mut key: Option<String> = None;
    let mut capo_seen = false;
    let mut capo: Option<u8> = None;
    let mut lyric_lines: Vec<String> = Vec::new();
    let mut literal: Option<&'static str> = None;

    let mut lines: Vec<&str> = chordpro.split('\n').collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    let last = if chordpro.ends_with('\n') {
        usize::MAX
    } else {
        lines.len().wrapping_sub(1)
    };
    for (idx, raw) in lines.into_iter().enumerate() {
        let line = if idx == last {
            raw
        } else {
            raw.trim_end_matches('\r')
        };
        let trimmed = trim(line);
        if let Some(section) = literal {
            if let Some(tag) = parse_tag(trimmed) {
                if closes_literal(&tag.name, section) {
                    literal = None;
                }
            }
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('{') {
            let Some(tag) = parse_tag(trimmed) else {
                continue;
            };
            if let Some(section) = literal_start(&tag.name) {
                literal = Some(section);
                continue;
            }
            if let Some((name, value)) = meta_field(&tag) {
                match name.as_str() {
                    "title" => {
                        title.get_or_insert(value);
                    }
                    "artist" => {
                        if artist.is_none() && !value.is_empty() {
                            artist = Some(value);
                        }
                    }
                    "key" => {
                        if !key_seen {
                            key_seen = true;
                            key = Some(value).filter(|v| !v.is_empty());
                        }
                    }
                    "capo" if !capo_seen => {
                        capo_seen = true;
                        capo = parse_capo(&value);
                    }
                    _ => {}
                }
            }
            continue;
        }
        if trimmed.is_empty() && !line.contains('[') {
            continue;
        }
        if let Some(text) = strip_chords(line) {
            if !text.chars().all(is_ws) {
                lyric_lines.push(text);
            }
        }
    }

    let title = title.unwrap_or_default();
    let lyrics = lyric_lines.join("\n");
    let language = detect_language(&lyrics, &title);
    Extracted {
        title,
        artist,
        key,
        capo,
        language,
        lyrics,
    }
}

fn parse_capo(value: &str) -> Option<u8> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    value.parse::<u8>().ok().filter(|n| *n <= 24)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixtures_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/test-fixtures/fixtures")
    }

    #[test]
    fn title_alias_meta_and_empty_first_title() {
        assert_eq!(extract("{t: שלום}\n").title, "שלום");
        assert_eq!(extract("{TITLE: Hello}").title, "Hello");
        assert_eq!(extract("{meta: title שיר x}").title, "שיר x");
        assert_eq!(extract("{title:}\n{title: later}").title, "");
        assert_eq!(extract("[Am]שלום").title, "");
    }

    #[test]
    fn first_title_wins() {
        assert_eq!(extract("{title: א}\n{title: ב}").title, "א");
    }

    #[test]
    fn artist_is_first_non_empty() {
        let e = extract("{artist:}\n{artist:   }\n{artist: עומר}\n{artist: other}");
        assert_eq!(e.artist.as_deref(), Some("עומר"));
        assert_eq!(extract("{title: x}").artist, None);
        assert_eq!(
            extract("{meta: artist  Dana}").artist.as_deref(),
            Some("Dana")
        );
    }

    #[test]
    fn key_first_line_wins_and_empty_is_none() {
        assert_eq!(extract("{key: Am}\n{key: G}").key.as_deref(), Some("Am"));
        assert_eq!(extract("{key:}\n{key: G}").key, None);
    }

    #[test]
    fn capo_valid_and_invalid() {
        assert_eq!(extract("{capo: 3}").capo, Some(3));
        assert_eq!(extract("{capo: 0}").capo, Some(0));
        assert_eq!(extract("{capo: 24}").capo, Some(24));
        assert_eq!(extract("{capo: 25}").capo, None);
        assert_eq!(extract("{capo: x}").capo, None);
        assert_eq!(extract("{capo:}").capo, None);
        assert_eq!(extract("{capo: 999999999999}").capo, None);
        assert_eq!(extract("{capo: x}\n{capo: 3}").capo, None);
    }

    #[test]
    fn crlf_and_bom() {
        let e = extract("\u{FEFF}{title: שיר}\r\n{artist: דנה}\r\r\n[Am]שלום\r\nעולם\r\n");
        assert_eq!(e.title, "שיר");
        assert_eq!(e.artist.as_deref(), Some("דנה"));
        assert_eq!(e.lyrics, "שלום\nעולם");
        assert_eq!(extract("שלום\r").lyrics, "שלום\r");
        assert_eq!(extract("שלום\r\n").lyrics, "שלום");
        assert_eq!(
            extract("{ \u{FEFF}title\u{FEFF}: \u{FEFF}x\u{FEFF} }").title,
            "x"
        );
    }

    #[test]
    fn tab_section_is_excluded() {
        let e = extract("שלום\n{start_of_tab}\n[Am] עולם\ne|--0--|\n  {end_of_tab}\nשיר");
        assert_eq!(e.lyrics, "שלום\nשיר");
        let e = extract("{sog}\nא [Am] ב\n{EOG}\nlast");
        assert_eq!(e.lyrics, "last");
        let e = extract("{start_of_abc}\nx\n{end_of_tab}\ny\n{end_of_abc}\nz");
        assert_eq!(e.lyrics, "z");
    }

    #[test]
    fn unclosed_literal_swallows_rest() {
        assert_eq!(extract("a\n{sot}\nb\nc").lyrics, "a");
    }

    #[test]
    fn non_literal_sections_keep_lyrics() {
        assert_eq!(extract("{soc}\nשלום\n{eoc}").lyrics, "שלום");
    }

    #[test]
    fn remarks_and_malformed_tags_contribute_nothing() {
        let e = extract("# שלום\n{title: a} {artist: b}\n{broken\n  {x: y}  \nעולם");
        assert_eq!(e.lyrics, "עולם");
        assert_eq!(e.title, "");
        assert_eq!(e.artist, None);
        assert_eq!(extract("  # not a remark").lyrics, "  # not a remark");
    }

    #[test]
    fn metadata_inside_literal_is_ignored() {
        assert_eq!(
            extract("{start_of_tab}\n{title: X}\n{end_of_tab}").title,
            ""
        );
        let e = extract("{sot}\n{key: G}\n{capo: 2}\n{eot}\n{key: Am}");
        assert_eq!(e.key.as_deref(), Some("Am"));
        assert_eq!(e.capo, None);
    }

    #[test]
    fn hash_prefixed_tag_is_remark() {
        let e = extract("#{title: X}\n{artist: A}");
        assert_eq!(e.title, "");
        assert_eq!(e.artist.as_deref(), Some("A"));
    }

    #[test]
    fn chords_stripped_mid_word() {
        assert_eq!(extract("שָׁ[Am]לוֹם").lyrics, "שָׁלוֹם");
        assert_eq!(extract("[C]Hel[G]lo wor[Am]ld").lyrics, "Hello world");
    }

    #[test]
    fn chord_only_empty_and_raw_lines_dropped() {
        let e = extract("[Am] [G]\n\n   \n[]x\n[A\n[A[B]c\nok [Em]\n");
        assert_eq!(e.lyrics, "ok ");
    }

    #[test]
    fn stray_close_bracket_is_lyric() {
        assert_eq!(extract("א ] ב").lyrics, "א ] ב");
    }

    #[test]
    fn language_detection() {
        assert_eq!(extract("שלום עולם").language, Language::He);
        assert_eq!(extract("Hello world").language, Language::En);
        assert_eq!(extract("[Am]שלום Hello").language, Language::Mixed);
        assert_eq!(extract("123 !!!").language, Language::En);
        assert_eq!(extract("").language, Language::En);
        assert_eq!(extract("café").language, Language::En);
        assert_eq!(extract("שלום ×÷").language, Language::He);
        assert_eq!(extract("×÷").language, Language::En);
    }

    #[test]
    fn language_falls_back_to_title() {
        assert_eq!(extract("{title: שיר}\n[Am] 123").language, Language::He);
        assert_eq!(extract("{title: Song}\n").language, Language::En);
        assert_eq!(extract("{title: שיר Song}").language, Language::Mixed);
        assert_eq!(extract("{title: Song}\nשלום").language, Language::He);
    }

    #[test]
    fn never_panics_on_odd_input() {
        for s in [
            "", "{", "[", "]", "}", "{}", "{:}", "[[", "{a", "\r", "\n\n", "#", "{ }", "{x:",
            "\u{FEFF}",
        ] {
            let _ = extract(s);
        }
    }

    #[test]
    fn fixtures_extract_without_panic() {
        let mut seen = 0;
        for entry in std::fs::read_dir(fixtures_dir()).expect("fixtures dir") {
            let path = entry.expect("entry").path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !name.ends_with(".cho") || name.ends_with(".canonical.cho") {
                continue;
            }
            let text = std::fs::read_to_string(&path).expect("fixture readable");
            let e = extract(&text);
            if name == "he_niqqud.cho" {
                assert_eq!(e.title, "שיר השלום");
                assert_eq!(e.language, Language::He);
            }
            seen += 1;
        }
        assert!(seen >= 10);
    }
}
