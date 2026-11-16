//! Full-text song search over the normalized `songs_fts` index.
use super::error::DbError;
use super::extract::extract;
use super::model::{SearchHit, SongSummary};
use super::normalize::normalize_he;
use super::repo::summary_from_row;
use rusqlite::Connection;
use unicode_normalization::char::is_combining_mark;

/// Maximum number of search results returned.
pub const SEARCH_LIMIT: usize = 100;

/// Maximum snippet length in `char`s before truncation.
const SNIPPET_MAX_CHARS: usize = 160;

/// Split text into search tokens: `normalize_he`, every non-alphanumeric character
/// becomes a separator, then split on whitespace. Shared by the MATCH expression and
/// the snippet so both agree on what a query word is.
fn tokenize(text: &str) -> Vec<String> {
    let spaced: String = normalize_he(text)
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    spaced.split_whitespace().map(str::to_owned).collect()
}

/// Turn a user query into an FTS5 MATCH expression of quoted prefix terms (implicit
/// AND), or `None` when it has no tokens. Every non-alphanumeric character becomes a
/// separator, so no FTS5 syntax can survive.
fn match_expression(query: &str) -> Option<String> {
    let terms: Vec<String> = tokenize(query)
        .iter()
        .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

/// Niqqud, cantillation and other Hebrew points (U+0591-U+05C7) plus general-category
/// combining marks.
fn is_mark(c: char) -> bool {
    ('\u{0591}'..='\u{05C7}').contains(&c) || is_combining_mark(c)
}

/// Trim a snippet line and cut it to `SNIPPET_MAX_CHARS`, never separating a base
/// letter from its marks; a cut line ends with `…`.
fn truncate_snippet(line: &str) -> String {
    let line = line.trim();
    let chars: Vec<char> = line.chars().collect();
    if chars.len() <= SNIPPET_MAX_CHARS {
        return line.to_owned();
    }
    let mut cut = SNIPPET_MAX_CHARS;
    while cut > 0 && is_mark(chars[cut]) {
        cut -= 1;
    }
    let kept: String = chars[..cut].iter().collect();
    format!("{}\u{2026}", kept.trim_end())
}

/// The first lyric line (chords stripped, original text) with a word starting with any
/// query token, or `None` when only the title or artist matched.
fn snippet_for(chordpro: &str, query_tokens: &[String]) -> Option<String> {
    if query_tokens.is_empty() {
        return None;
    }
    extract(chordpro)
        .lyrics
        .split('\n')
        .find(|line| {
            tokenize(line)
                .iter()
                .any(|w| query_tokens.iter().any(|q| w.starts_with(q.as_str())))
        })
        .map(truncate_snippet)
}

/// Search songs by normalized query, at most `SEARCH_LIMIT` results.
pub fn search_songs(conn: &Connection, query: &str) -> Result<Vec<SearchHit>, DbError> {
    let Some(expr) = match_expression(query) else {
        return Ok(Vec::new());
    };
    let query_tokens = tokenize(query);
    let mut stmt = conn.prepare(
        "SELECT s.id, s.title, s.artist, s.key, s.language, s.updated_at, s.chordpro \
         FROM songs_fts JOIN songs s ON s.rowid = songs_fts.rowid \
         WHERE songs_fts MATCH ?1 \
         ORDER BY bm25(songs_fts), s.updated_at DESC, s.id DESC \
         LIMIT ?2",
    )?;
    let limit = i64::try_from(SEARCH_LIMIT).unwrap_or(100);
    let rows = stmt.query_map(rusqlite::params![expr, limit], |row| {
        let song: SongSummary = summary_from_row(row)?;
        let chordpro: String = row.get(6)?;
        Ok(SearchHit {
            snippet: snippet_for(&chordpro, &query_tokens),
            song,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::open_in_memory;
    use crate::db::model::SaveSongInput;
    use crate::db::repo::save_song;
    use serde::Deserialize;

    fn db() -> Connection {
        open_in_memory().unwrap()
    }

    fn add(c: &mut Connection, chordpro: &str) -> String {
        save_song(
            c,
            &SaveSongInput {
                id: None,
                chordpro: chordpro.to_owned(),
            },
        )
        .unwrap()
        .id
    }

    fn found(c: &Connection, q: &str) -> usize {
        search_songs(c, q).unwrap().len()
    }

    #[derive(Deserialize)]
    struct Stored {
        title: String,
        artist: String,
        lyrics: String,
    }

    #[derive(Deserialize)]
    struct Case {
        name: String,
        stored: Stored,
        query: String,
        matches: bool,
    }

    #[derive(Deserialize)]
    struct CaseFile {
        cases: Vec<Case>,
    }

    #[test]
    fn fixture_cases_behave() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/test-fixtures/search/query.cases.json");
        let file: CaseFile = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert!(file.cases.len() >= 19);
        for case in file.cases {
            let mut c = db();
            let mut text = String::new();
            if !case.stored.title.is_empty() {
                text.push_str(&format!("{{title: {}}}\n", case.stored.title));
            }
            if !case.stored.artist.is_empty() {
                text.push_str(&format!("{{artist: {}}}\n", case.stored.artist));
            }
            text.push_str(&case.stored.lyrics);
            text.push('\n');
            add(&mut c, &text);
            let hits = search_songs(&c, &case.query).unwrap();
            assert_eq!(
                !hits.is_empty(),
                case.matches,
                "case {:?} query {:?}",
                case.name,
                case.query
            );
        }
    }

    #[test]
    fn unpointed_query_finds_niqqud_lyric() {
        let mut c = db();
        let id = add(&mut c, "{title: x}\nשָׁלוֹם עָלֵיכֶם\n");
        let hits = search_songs(&c, "שלום").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].song.id, id);
    }

    #[test]
    fn final_letter_query_finds_pointed_word() {
        let mut c = db();
        add(&mut c, "{title: x}\nמֶלֶךְ הַיָּם\n");
        assert_eq!(found(&c, "מלך"), 1);
        assert_eq!(found(&c, "מלכ"), 1);
    }

    #[test]
    fn artist_found_case_insensitively() {
        let mut c = db();
        add(
            &mut c,
            "{title: Plain Tune}\n{artist: Yonatan Testman}\nla la\n",
        );
        assert_eq!(found(&c, "TESTMAN"), 1);
        assert_eq!(found(&c, "testman"), 1);
    }

    #[test]
    fn prefix_query_finds_song() {
        let mut c = db();
        add(&mut c, "{title: x}\nwindowsill garden\n");
        assert_eq!(found(&c, "windows"), 1);
        assert_eq!(found(&c, "garden"), 1);
        assert_eq!(found(&c, "ndowsill"), 0);
    }

    #[test]
    fn multiple_tokens_use_and() {
        let mut c = db();
        add(&mut c, "{title: x}\nred lantern\n");
        add(&mut c, "{title: y}\nblue lantern\n");
        assert_eq!(found(&c, "lantern"), 2);
        assert_eq!(found(&c, "red lantern"), 1);
        assert_eq!(found(&c, "red blue"), 0);
    }

    #[test]
    fn absent_term_matches_nothing() {
        let mut c = db();
        add(&mut c, "{title: x}\nred lantern\n");
        assert_eq!(found(&c, "zebra"), 0);
        assert_eq!(found(&c, "red zebra"), 0);
    }

    #[test]
    fn fts_syntax_queries_are_ok() {
        let mut c = db();
        add(&mut c, "{title: x}\nred lantern and not blue\n");
        for q in [
            "AND",
            "OR",
            "NOT",
            "NEAR",
            "\"",
            "\"\"",
            "*",
            "(",
            ")",
            ":",
            "-",
            "^",
            "red AND",
            "NOT red",
            "red OR blue",
            "NEAR(red blue)",
            "\"red lantern\"",
            "red*",
            "title:red",
            "-red",
            "^red",
            "(red",
            "red)",
            "a\"b",
            "col:\"x\" NOT (y",
            "\"unterminated",
        ] {
            assert!(search_songs(&c, q).is_ok(), "query {q:?} must not error");
        }
        // Operators are literal words, not syntax.
        assert_eq!(found(&c, "red OR zebra"), 0);
        assert_eq!(found(&c, "lantern AND not"), 1);
    }

    #[test]
    fn english_contraction_matches() {
        let mut c = db();
        add(&mut c, "{title: x}\nwe don't stop\n");
        assert_eq!(found(&c, "don't"), 1);
        assert_eq!(found(&c, "don"), 1);
    }

    #[test]
    fn hyphenated_word_matches() {
        let mut c = db();
        add(&mut c, "{title: x}\na sing-along tune\n");
        assert_eq!(found(&c, "sing-along"), 1);
        assert_eq!(found(&c, "sing along"), 1);
    }

    #[test]
    fn hebrew_geresh_word_matches() {
        let mut c = db();
        add(&mut c, "{title: x}\nצ׳יפס חם\n");
        assert_eq!(found(&c, "צ׳יפס"), 1);
        assert_eq!(found(&c, "חם"), 1);
    }

    #[test]
    fn latin_diacritics_are_not_folded() {
        // Guards the `remove_diacritics 0` tokenizer option.
        let mut c = db();
        add(&mut c, "{title: x}\ncafé lights\n");
        assert_eq!(found(&c, "café"), 1);
        assert_eq!(found(&c, "cafe"), 0);
    }

    #[test]
    fn update_keeps_fts_in_sync() {
        let mut c = db();
        let id = add(&mut c, "{title: x}\nbluebird\n");
        // A second song shifts rowids so a REPLACE-style rewrite would be visible.
        add(&mut c, "{title: y}\nsomething else\n");
        save_song(
            &mut c,
            &SaveSongInput {
                id: Some(id.clone()),
                chordpro: "{title: x}\nredwing\n".to_owned(),
            },
        )
        .unwrap();
        assert_eq!(found(&c, "bluebird"), 0);
        let hits = search_songs(&c, "redwing").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].song.id, id);
        let n = |sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(
            n("SELECT count(*) FROM songs_fts"),
            n("SELECT count(*) FROM songs")
        );
    }

    #[test]
    fn empty_and_whitespace_queries_give_empty_vec() {
        let mut c = db();
        add(&mut c, "{title: x}\nhello\n");
        for q in ["", "   ", "\t\n", "--", "'''", "׳״"] {
            assert_eq!(search_songs(&c, q).unwrap(), vec![], "query {q:?}");
        }
    }

    #[test]
    fn results_are_capped_at_limit() {
        assert_eq!(SEARCH_LIMIT, 100);
        let mut c = db();
        for i in 0..=SEARCH_LIMIT {
            add(&mut c, &format!("{{title: song {i}}}\nshared chorus\n"));
        }
        assert_eq!(found(&c, "shared"), SEARCH_LIMIT);
        // Exactly at the limit is not truncated further.
        let mut c2 = db();
        for i in 0..SEARCH_LIMIT {
            add(&mut c2, &format!("{{title: song {i}}}\nshared chorus\n"));
        }
        assert_eq!(found(&c2, "shared"), SEARCH_LIMIT);
    }

    #[test]
    fn results_are_ordered_by_relevance_then_recency() {
        let mut c = db();
        // Strongest match saved first, so recency alone would rank it last.
        let strong = add(&mut c, "{title: s}\nlantern lantern lantern\n");
        let weak = add(
            &mut c,
            "{title: w}\nlantern in a long line of many other words that dilute it\n",
        );
        let ids: Vec<String> = search_songs(&c, "lantern")
            .unwrap()
            .into_iter()
            .map(|h| h.song.id)
            .collect();
        assert_eq!(ids, vec![strong, weak]);
    }

    #[test]
    fn equal_relevance_falls_back_to_updated_at_desc() {
        let mut c = db();
        let old = add(&mut c, "{title: o}\nmarigold\n");
        let new = add(&mut c, "{title: n}\nmarigold\n");
        for (id, ts) in [
            (&old, "2031-01-01T00:00:00.000Z"),
            (&new, "2030-01-01T00:00:00.000Z"),
        ] {
            c.execute(
                "UPDATE songs SET updated_at = ?2 WHERE id = ?1",
                [id.as_str(), ts],
            )
            .unwrap();
        }
        let ids: Vec<String> = search_songs(&c, "marigold")
            .unwrap()
            .into_iter()
            .map(|h| h.song.id)
            .collect();
        assert_eq!(ids, vec![old, new]);
    }

    #[test]
    fn match_expression_quotes_each_token() {
        assert_eq!(
            match_expression("Don't  sing-along"),
            Some("\"dont\"* \"sing\"* \"along\"*".to_owned())
        );
        assert_eq!(match_expression("  - "), None);
        assert_eq!(
            match_expression("צה״ל ka’tamar"),
            Some("\"צהל\"* \"katamar\"*".to_owned())
        );
    }

    #[derive(Deserialize)]
    struct SnippetCase {
        name: String,
        chordpro: String,
        query: String,
        snippet: Option<String>,
    }

    #[derive(Deserialize)]
    struct SnippetFile {
        cases: Vec<SnippetCase>,
    }

    #[test]
    fn snippet_fixture_cases_behave() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/test-fixtures/search/snippet.cases.json");
        let file: SnippetFile =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert!(file.cases.len() >= 13);
        for case in file.cases {
            let mut c = db();
            add(&mut c, &case.chordpro);
            let hits = search_songs(&c, &case.query).unwrap();
            assert!(!hits.is_empty(), "case {:?} must be a hit", case.name);
            assert_eq!(hits[0].snippet, case.snippet, "case {:?}", case.name);
        }
    }

    #[test]
    fn truncation_boundaries() {
        let l160 = "א".repeat(160);
        assert_eq!(truncate_snippet(&l160), l160);
        let l161 = "א".repeat(161);
        assert_eq!(
            truncate_snippet(&l161),
            format!("{}\u{2026}", "א".repeat(160))
        );
        // Mark is the first dropped char (index 160): cut backs off past its base letter.
        let marked = format!("{}\u{05B8}ב", "א".repeat(160));
        assert_eq!(
            truncate_snippet(&marked),
            format!("{}\u{2026}", "א".repeat(159))
        );
        // Mark at index 160 but marks also at 159: both are dropped with their base.
        let two = format!("{}\u{05B8}\u{05BC}ב", "א".repeat(159));
        assert_eq!(
            truncate_snippet(&two),
            format!("{}\u{2026}", "א".repeat(158))
        );
        // Mn mark outside the Hebrew range (combining acute) also backs off.
        let acute = format!("{}\u{0301}b", "e".repeat(160));
        assert_eq!(
            truncate_snippet(&acute),
            format!("{}\u{2026}", "e".repeat(159))
        );
        assert_eq!(truncate_snippet("  hi  "), "hi");
    }

    #[test]
    fn truncation_never_leaves_space_before_ellipsis() {
        // The 160-char cut ends on a space (index 159); it must be trimmed off.
        let spaced = format!("{} bcd", "a".repeat(159));
        let out = truncate_snippet(&spaced);
        assert_eq!(out, format!("{}\u{2026}", "a".repeat(159)));
        assert!(!out.trim_end_matches('\u{2026}').ends_with(' '));
        // A space followed by marks that are backed off also leaves no trailing space.
        let marked = format!("{} \u{05B8}\u{05BC}ב", "a".repeat(158));
        let out = truncate_snippet(&marked);
        assert_eq!(out, format!("{}\u{2026}", "a".repeat(158)));
        assert!(!out.contains(" \u{2026}"));
    }

    #[test]
    fn snippet_scans_lines_in_order_and_ignores_empty() {
        assert_eq!(
            snippet_for("a b\n\nc d", &["c".to_owned()]),
            Some("c d".to_owned())
        );
        assert_eq!(snippet_for("a b", &[]), None);
    }
}
