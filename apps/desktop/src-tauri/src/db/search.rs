//! Full-text song search over the normalized `songs_fts` index.
use super::error::DbError;
use super::model::SongSummary;
use super::normalize::normalize_he;
use super::repo::summary_from_row;
use rusqlite::Connection;

/// Maximum number of search results returned.
pub const SEARCH_LIMIT: usize = 100;

/// Turn a user query into an FTS5 MATCH expression of quoted prefix terms (implicit
/// AND), or `None` when it has no tokens. Every non-alphanumeric character becomes a
/// separator, so no FTS5 syntax can survive.
fn match_expression(query: &str) -> Option<String> {
    let spaced: String = normalize_he(query)
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    let terms: Vec<String> = spaced
        .split_whitespace()
        .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

/// Search songs by normalized query, at most `SEARCH_LIMIT` results.
pub fn search_songs(conn: &Connection, query: &str) -> Result<Vec<SongSummary>, DbError> {
    let Some(expr) = match_expression(query) else {
        return Ok(Vec::new());
    };
    let mut stmt = conn.prepare(
        "SELECT s.id, s.title, s.artist, s.key, s.language, s.updated_at \
         FROM songs_fts JOIN songs s ON s.rowid = songs_fts.rowid \
         WHERE songs_fts MATCH ?1 \
         ORDER BY bm25(songs_fts), s.updated_at DESC, s.id DESC \
         LIMIT ?2",
    )?;
    let limit = i64::try_from(SEARCH_LIMIT).unwrap_or(100);
    let rows = stmt.query_map(rusqlite::params![expr, limit], summary_from_row)?;
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
        assert!(file.cases.len() >= 8);
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
        assert_eq!(hits[0].id, id);
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
        assert_eq!(hits[0].id, id);
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
            .map(|s| s.id)
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
            .map(|s| s.id)
            .collect();
        assert_eq!(ids, vec![old, new]);
    }

    #[test]
    fn match_expression_quotes_each_token() {
        assert_eq!(
            match_expression("Don't  sing-along"),
            Some("\"don\"* \"t\"* \"sing\"* \"along\"*".to_owned())
        );
        assert_eq!(match_expression("  - "), None);
    }
}
