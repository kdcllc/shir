//! Hebrew search normalization (hebrew-rtl-chords rule 7).
use unicode_normalization::UnicodeNormalization;

/// Geresh, gershayim and the apostrophe/quote variants treated as intra-word marks.
fn is_mark(c: char) -> bool {
    matches!(
        c,
        '\u{05F3}' | '\u{05F4}' | '"' | '\'' | '\u{2019}' | '\u{02BC}'
    )
}

/// Normalize text for search with the exact rule-7 pipeline, in this order:
///
/// 1. maqaf (U+05BE) becomes a space, so hyphenated words stay two tokens;
/// 2. NFD;
/// 3. strip every code point in U+0591-U+05C7 (cantillation and niqqud);
/// 4. NFC;
/// 5. delete intra-word marks: each of U+05F3, U+05F4, `"`, `'`, U+2019 and U+02BC is
///    deleted when the code points immediately before and after it (in the step-4
///    output) are both alphabetic and neither is itself one of those marks; every other
///    occurrence (string edge, next to a space, digit or punctuation, or in a run of
///    marks) is kept;
/// 6. fold the final letters (ך ם ן ף ץ to כ מ נ פ צ);
/// 7. `str::to_lowercase`.
///
/// Stored text and search queries must both go through this same function.
pub fn normalize_he(input: &str) -> String {
    let spaced: String = input
        .chars()
        .map(|c| if c == '\u{05BE}' { ' ' } else { c })
        .collect();
    let stripped: String = spaced
        .nfd()
        .filter(|c| !('\u{0591}'..='\u{05C7}').contains(c))
        .collect();
    let composed: Vec<char> = stripped.nfc().collect();
    let is_word_char = |c: char| c.is_alphabetic() && !is_mark(c);
    let unmarked: String = composed
        .iter()
        .enumerate()
        .filter(|&(i, &c)| {
            let inside = i > 0
                && is_mark(c)
                && is_word_char(composed[i - 1])
                && composed.get(i + 1).copied().is_some_and(is_word_char);
            !inside
        })
        .map(|(_, &c)| c)
        .collect();
    let folded: String = unmarked
        .chars()
        .map(|c| match c {
            'ך' => 'כ',
            'ם' => 'מ',
            'ן' => 'נ',
            'ף' => 'פ',
            'ץ' => 'צ',
            other => other,
        })
        .collect();
    folded.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Case {
        name: String,
        input: String,
        expected: String,
    }

    #[derive(Deserialize)]
    struct CaseFile {
        license: String,
        cases: Vec<Case>,
    }

    fn load() -> CaseFile {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../packages/test-fixtures/search/normalize_he.cases.json"
        );
        let text = std::fs::read_to_string(path).expect("case file readable");
        serde_json::from_str(&text).expect("case file parses")
    }

    #[test]
    fn every_case_matches_expected() {
        let file = load();
        assert!(file.license.contains("CC0-1.0"));
        assert!(file.cases.len() >= 30);
        for case in &file.cases {
            assert_eq!(
                normalize_he(&case.input),
                case.expected,
                "case {}",
                case.name
            );
        }
    }

    #[test]
    fn every_case_is_idempotent() {
        for case in &load().cases {
            let once = normalize_he(&case.input);
            assert_eq!(normalize_he(&once), once, "case {}", case.name);
            assert_eq!(
                normalize_he(&case.expected),
                case.expected,
                "case {}",
                case.name
            );
        }
    }

    #[test]
    fn niqqud_and_final_letters_match_plain_queries() {
        assert_eq!(normalize_he("שלום"), normalize_he("שָׁלוֹם"));
        assert_eq!(normalize_he("מלך"), normalize_he("מֶלֶךְ"));
    }

    #[test]
    fn maqaf_splits_tokens() {
        assert_eq!(normalize_he("בן\u{05BE}אדם"), "בנ אדמ");
    }

    #[test]
    fn latin_only_lowercased_and_composed() {
        assert_eq!(normalize_he("Track 01, Fm7!"), "track 01, fm7!");
        assert_eq!(normalize_he("cafe\u{0301}"), "caf\u{e9}");
        assert_eq!(normalize_he(""), "");
    }
}
