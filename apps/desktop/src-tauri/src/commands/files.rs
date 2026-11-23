//! Read a user-picked text file for import. Plain `std::fs`; no fs plugin.
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

use base64::Engine;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri_plugin_dialog::DialogExt;
use thiserror::Error;

/// Largest text file accepted, in bytes.
pub const MAX_TEXT_FILE_BYTES: u64 = 1_048_576;

/// Largest exported Word document accepted, in bytes (20 MiB).
pub const MAX_EXPORT_BYTES: usize = 20 * 1_048_576;

/// Longest accepted base64 text for an export payload: the encoded length of
/// `MAX_EXPORT_BYTES` bytes (27_962_028).
pub const MAX_EXPORT_BASE64_LEN: usize = MAX_EXPORT_BYTES.div_ceil(3) * 4;

/// Most characters kept from an export file name stem.
pub const MAX_EXPORT_STEM_CHARS: usize = 100;

/// Temp file names tried before giving up.
pub const TEMP_ATTEMPTS: usize = 100;

/// File name used when the caller's default name sanitizes to nothing.
pub const DEFAULT_EXPORT_NAME: &str = "setlist.docx";

/// Category of a file failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum FileErrorKind {
    TooLarge,
    NotUtf8,
    Io,
    // The request itself is unacceptable (for example an empty or oversized payload).
    Invalid,
}

/// A file-read error: serializes as `{"kind":"<Kind>","message":"<text>"}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, Error)]
#[error("{kind:?}: {message}")]
pub struct FileError {
    pub kind: FileErrorKind,
    pub message: String,
}

impl FileError {
    fn new(kind: FileErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn io(e: std::io::Error) -> Self {
        Self::new(FileErrorKind::Io, e.to_string())
    }

    fn too_large() -> Self {
        Self::new(
            FileErrorKind::TooLarge,
            format!("file is larger than {MAX_TEXT_FILE_BYTES} bytes"),
        )
    }
}

/// Read `path` as UTF-8 text: regular files up to `MAX_TEXT_FILE_BYTES`, one leading BOM
/// removed, line endings untouched.
pub fn read_text_file_impl(path: &Path) -> Result<String, FileError> {
    let meta = std::fs::metadata(path).map_err(FileError::io)?;
    if !meta.is_file() {
        return Err(FileError::new(
            FileErrorKind::Io,
            "not a regular file".to_string(),
        ));
    }
    if meta.len() > MAX_TEXT_FILE_BYTES {
        return Err(FileError::too_large());
    }
    let file = std::fs::File::open(path).map_err(FileError::io)?;
    let mut bytes = Vec::new();
    file.take(MAX_TEXT_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(FileError::io)?;
    if bytes.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(FileError::too_large());
    }
    let text = String::from_utf8(bytes)
        .map_err(|e| FileError::new(FileErrorKind::NotUtf8, e.to_string()))?;
    Ok(match text.strip_prefix('\u{feff}') {
        Some(rest) => rest.to_string(),
        None => text,
    })
}

/// Read a text file picked by the user.
#[tauri::command]
#[specta::specta]
pub fn read_text_file(path: String) -> Result<String, FileError> {
    read_text_file_impl(Path::new(&path))
}

fn has_docx_extension(name: &str) -> bool {
    name.len() > 5 && name.is_char_boundary(name.len() - 5) && {
        name[name.len() - 5..].eq_ignore_ascii_case(".docx")
    }
}

/// Reject an empty or larger-than-`MAX_EXPORT_BYTES` payload with `Invalid`.
pub fn validate_export_bytes(bytes: &[u8]) -> Result<(), FileError> {
    if bytes.is_empty() {
        return Err(FileError::new(FileErrorKind::Invalid, "document is empty"));
    }
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err(FileError::new(
            FileErrorKind::Invalid,
            format!("document is larger than {MAX_EXPORT_BYTES} bytes"),
        ));
    }
    Ok(())
}

/// Decode the base64 (RFC 4648 section 4, padded) text of an export payload and validate the
/// decoded size. The encoded length is capped before decoding.
pub fn decode_export_payload(bytes_base64: &str) -> Result<Vec<u8>, FileError> {
    if bytes_base64.len() > MAX_EXPORT_BASE64_LEN {
        return Err(FileError::new(
            FileErrorKind::Invalid,
            format!("encoded document is longer than {MAX_EXPORT_BASE64_LEN} characters"),
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64)
        .map_err(|_| FileError::new(FileErrorKind::Invalid, "document is not valid base64"))?;
    validate_export_bytes(&bytes)?;
    Ok(bytes)
}

/// Bidirectional and zero-width format characters dropped from export names (LRM and RLM stay).
fn is_stripped_format_char(c: char) -> bool {
    matches!(
        c,
        '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{200B}' | '\u{FEFF}'
    )
}

/// Windows device names that cannot be file names, with or without an extension.
fn is_reserved_device_name(part: &str) -> bool {
    let up = part.to_ascii_uppercase();
    matches!(up.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|p| {
            up.strip_prefix(p)
                .is_some_and(|d| matches!(d.as_bytes(), [b'1'..=b'9']))
        })
}

/// Cut `stem` to at most `MAX_EXPORT_STEM_CHARS` chars without separating a base character from
/// the combining marks that follow it.
fn cap_stem(stem: &str) -> &str {
    let mut ends = stem
        .char_indices()
        .map(|(i, _)| i)
        .skip(MAX_EXPORT_STEM_CHARS);
    let Some(mut cut) = ends.next() else {
        return stem;
    };
    // `cut` is the byte offset of the first dropped char; back up to a cluster boundary.
    while cut > 0 {
        match stem[cut..].chars().next() {
            Some(c) if unicode_normalization::char::is_combining_mark(c) => {
                cut = stem[..cut].char_indices().next_back().map_or(0, |(i, _)| i);
            }
            _ => break,
        }
    }
    &stem[..cut]
}

/// Reduce a webview-supplied name to a bare `.docx` file name: path separators, `..`,
/// control and bidi/zero-width format characters and `: * ? " < > |` are removed; the stem is
/// capped at `MAX_EXPORT_STEM_CHARS` chars (never splitting a combining-mark cluster); a
/// Windows device name gets a `_` prefix; empty becomes `setlist.docx`; `.docx` is appended
/// when missing.
pub fn sanitize_export_name(name: &str) -> String {
    let mut cleaned: String = name
        .chars()
        .filter(|c| {
            !c.is_control()
                && !is_stripped_format_char(*c)
                && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        .collect();
    while cleaned.contains("..") {
        cleaned = cleaned.replace("..", "");
    }
    let cleaned = cleaned.trim_matches(|c: char| c.is_whitespace() || c == '.');
    let stem = if has_docx_extension(cleaned) {
        &cleaned[..cleaned.len() - 5]
    } else {
        cleaned
    };
    let stem = cap_stem(stem).trim_matches(|c: char| c.is_whitespace() || c == '.');
    if stem.is_empty() {
        return DEFAULT_EXPORT_NAME.to_string();
    }
    let first = stem.split('.').next().unwrap_or(stem);
    if is_reserved_device_name(first) {
        return format!("_{stem}.docx");
    }
    format!("{stem}.docx")
}

fn with_suffix(chosen: &Path, suffix: &str) -> PathBuf {
    let mut s: OsString = chosen.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

fn chosen_has_docx_extension(chosen: &Path) -> bool {
    chosen
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(has_docx_extension)
}

/// The path to write for a dialog-chosen `chosen`: kept when it already ends in `.docx`
/// (ASCII case-insensitive); otherwise `.docx` is appended, and when that path already exists
/// (the dialog confirmed only the name without the extension) the next free
/// `<name> (2).docx`, `(3)`, ... is used so nothing is overwritten unconfirmed.
pub fn resolve_docx_path(chosen: &Path) -> Result<PathBuf, FileError> {
    if chosen_has_docx_extension(chosen) {
        return Ok(chosen.to_path_buf());
    }
    let first = with_suffix(chosen, ".docx");
    if std::fs::symlink_metadata(&first).is_err() {
        return Ok(first);
    }
    for n in 2..10_000u32 {
        let candidate = with_suffix(chosen, &format!(" ({n}).docx"));
        if std::fs::symlink_metadata(&candidate).is_err() {
            return Ok(candidate);
        }
    }
    Err(FileError::new(
        FileErrorKind::Io,
        "no free file name available",
    ))
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn write_temp(tmp: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tmp)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn parent_dir(path: &Path) -> &Path {
    match path.parent() {
        Some(d) if !d.as_os_str().is_empty() => d,
        _ => Path::new("."),
    }
}

fn default_temp_name(dir: &Path) -> PathBuf {
    dir.join(format!(
        ".shir-export-{}-{}.tmp",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ))
}

/// Create a new temp file holding `bytes`, taking names from `next_temp`. A name that already
/// exists is skipped (never removed, it is not ours); any other error removes the temp file.
fn write_new_temp<N: FnMut() -> PathBuf>(
    bytes: &[u8],
    mut next_temp: N,
) -> Result<PathBuf, FileError> {
    for _ in 0..TEMP_ATTEMPTS {
        let tmp = next_temp();
        match write_temp(&tmp, bytes) {
            Ok(()) => return Ok(tmp),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(FileError::io(e));
            }
        }
    }
    Err(FileError::new(
        FileErrorKind::Io,
        "no free temporary file name",
    ))
}

/// Write `bytes` to a temp file next to `path`, then rename it over `path`. No partial file
/// is ever visible at `path`; the temp file is removed on error; a symlink at `path` is
/// replaced by a regular file, never written through. Returns the final path.
pub fn write_docx_atomically(path: &Path, bytes: &[u8]) -> Result<PathBuf, FileError> {
    let dir = parent_dir(path);
    write_docx_atomically_with(path, bytes, || default_temp_name(dir))
}

/// `write_docx_atomically` with an injectable temp-name generator: up to `TEMP_ATTEMPTS`
/// names are tried, skipping (and never deleting) names that already exist.
pub fn write_docx_atomically_with<N: FnMut() -> PathBuf>(
    path: &Path,
    bytes: &[u8],
    next_temp: N,
) -> Result<PathBuf, FileError> {
    let tmp = write_new_temp(bytes, next_temp)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(FileError::io(e));
    }
    Ok(path.to_path_buf())
}

/// Publish `bytes` for a dialog-chosen path, never replacing a file the dialog did not
/// confirm. See `publish_docx_with`.
pub fn publish_docx(chosen: &Path, bytes: &[u8]) -> Result<PathBuf, FileError> {
    publish_docx_with(chosen, bytes, |a, b| std::fs::hard_link(a, b))
}

/// Publish `bytes` for `chosen`. A name already ending in `.docx` was confirmed by the dialog
/// and is replaced atomically. Otherwise one temp file is written and hard-linked (`link`) to
/// `<chosen>.docx`, `<chosen> (2).docx`, ... so a file that appears after any free-name check is
/// never replaced. When links fail for another reason (for example FAT/exFAT), it falls back to
/// `resolve_docx_path` plus `rename`, which leaves a small window for such a file to appear.
/// The temp file never survives.
pub fn publish_docx_with<L: FnMut(&Path, &Path) -> std::io::Result<()>>(
    chosen: &Path,
    bytes: &[u8],
    mut link: L,
) -> Result<PathBuf, FileError> {
    if chosen_has_docx_extension(chosen) {
        return write_docx_atomically(chosen, bytes);
    }
    let dir = parent_dir(chosen);
    let tmp = write_new_temp(bytes, || default_temp_name(dir))?;
    let candidates = std::iter::once(with_suffix(chosen, ".docx"))
        .chain((2..10_000u32).map(|n| with_suffix(chosen, &format!(" ({n}).docx"))));
    for candidate in candidates {
        match link(&tmp, &candidate) {
            Ok(()) => {
                let _ = std::fs::remove_file(&tmp);
                return Ok(candidate);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                let renamed = resolve_docx_path(chosen).and_then(|target| {
                    std::fs::rename(&tmp, &target)
                        .map(|()| target)
                        .map_err(FileError::io)
                });
                if renamed.is_err() {
                    let _ = std::fs::remove_file(&tmp);
                }
                return renamed;
            }
        }
    }
    let _ = std::fs::remove_file(&tmp);
    Err(FileError::new(
        FileErrorKind::Io,
        "no free file name available",
    ))
}

/// Decode the payload, ask `pick` for a save location (given the sanitized default name and
/// the filter label) and publish the document there. `Ok(None)` when `pick` returns `None`.
/// An invalid payload returns before `pick` is called.
pub fn save_export_with<P>(
    default_name: &str,
    filter_name: &str,
    bytes_base64: &str,
    pick: P,
) -> Result<Option<String>, FileError>
where
    P: FnOnce(String, String) -> Result<Option<PathBuf>, FileError>,
{
    let bytes = decode_export_payload(bytes_base64)?;
    let Some(chosen) = pick(sanitize_export_name(default_name), filter_name.to_string())? else {
        return Ok(None);
    };
    let written = publish_docx(&chosen, &bytes)?;
    Ok(Some(written.to_string_lossy().into_owned()))
}

/// Ask for a save location in a native dialog opened here (the webview never supplies a
/// path) and write the Word document `bytes` there. `Ok(None)` when the user cancels.
#[tauri::command(async)]
#[specta::specta]
pub fn save_export_docx(
    app: tauri::AppHandle,
    default_name: String,
    filter_name: String,
    bytes_base64: String,
) -> Result<Option<String>, FileError> {
    save_export_with(
        &default_name,
        &filter_name,
        &bytes_base64,
        |name, filter| {
            let picked = app
                .dialog()
                .file()
                .set_file_name(name)
                .add_filter(filter, &["docx"])
                .blocking_save_file();
            let Some(picked) = picked else {
                return Ok(None);
            };
            picked
                .into_path()
                .map(Some)
                .map_err(|e| FileError::new(FileErrorKind::Io, e.to_string()))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn write(bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("song.txt");
        std::fs::write(&p, bytes).unwrap();
        (dir, p)
    }

    #[test]
    fn hebrew_niqqud_round_trips() {
        let s = "{title: שִׁיר}\n[C]שָׁלוֹם עוֹלָם\n";
        let (_d, p) = write(s.as_bytes());
        assert_eq!(read_text_file_impl(&p).unwrap(), s);
    }

    #[test]
    fn bom_is_stripped_exactly_once() {
        let (_d, p) = write("\u{feff}abc".as_bytes());
        assert_eq!(read_text_file_impl(&p).unwrap(), "abc");
        let (_d2, p2) = write("\u{feff}\u{feff}abc".as_bytes());
        assert_eq!(read_text_file_impl(&p2).unwrap(), "\u{feff}abc");
    }

    #[test]
    fn crlf_is_preserved() {
        let (_d, p) = write(b"a\r\nb\r\n");
        assert_eq!(read_text_file_impl(&p).unwrap(), "a\r\nb\r\n");
    }

    #[test]
    fn size_boundaries() {
        let max = MAX_TEXT_FILE_BYTES as usize;
        let (_d, p) = write(&vec![b'a'; max]);
        assert_eq!(read_text_file_impl(&p).unwrap().len(), max);
        let (_d2, p2) = write(&vec![b'a'; max + 1]);
        assert_eq!(
            read_text_file_impl(&p2).unwrap_err().kind,
            FileErrorKind::TooLarge
        );
    }

    #[test]
    fn invalid_utf8_is_not_utf8() {
        let (_d, p) = write(&[0xff, 0xfe, 0x00]);
        assert_eq!(
            read_text_file_impl(&p).unwrap_err().kind,
            FileErrorKind::NotUtf8
        );
    }

    #[test]
    fn missing_path_and_directory_are_io() {
        let dir = tempfile::tempdir().unwrap();
        let e = read_text_file_impl(&dir.path().join("nope.txt")).unwrap_err();
        assert_eq!(e.kind, FileErrorKind::Io);
        assert!(!e.message.is_empty());
        let e = read_text_file_impl(dir.path()).unwrap_err();
        assert_eq!(e.kind, FileErrorKind::Io);
    }

    #[test]
    fn command_delegates() {
        let (_d, p) = write(b"x");
        assert_eq!(
            read_text_file(p.to_string_lossy().into_owned()).unwrap(),
            "x"
        );
    }

    #[test]
    fn serialization_shape() {
        let e = FileError::new(FileErrorKind::TooLarge, "big");
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            json!({"kind": "TooLarge", "message": "big"})
        );
        for (k, n) in [
            (FileErrorKind::TooLarge, "TooLarge"),
            (FileErrorKind::NotUtf8, "NotUtf8"),
            (FileErrorKind::Io, "Io"),
            (FileErrorKind::Invalid, "Invalid"),
        ] {
            assert_eq!(serde_json::to_value(k).unwrap(), json!(n));
        }
    }
}
