//! Read a user-picked text file for import. Plain `std::fs`; no fs plugin.
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

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

/// File name used when the caller's default name sanitizes to nothing.
pub const DEFAULT_EXPORT_NAME: &str = "setlist.docx";

/// Category of a file failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum FileErrorKind {
    TooLarge,
    NotUtf8,
    Io,
    /// The request itself is unacceptable (for example an empty or oversized payload).
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

/// Reduce a webview-supplied name to a bare `.docx` file name: path separators, `..`,
/// control characters and `: * ? " < > |` are removed; empty becomes `setlist.docx`;
/// `.docx` is appended when missing.
pub fn sanitize_export_name(name: &str) -> String {
    let mut cleaned: String = name
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
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
    if stem.trim().is_empty() {
        return DEFAULT_EXPORT_NAME.to_string();
    }
    format!("{stem}.docx")
}

/// The path to write for a dialog-chosen `chosen`: kept when it already ends in `.docx`
/// (ASCII case-insensitive); otherwise `.docx` is appended, and when that path already exists
/// (the dialog confirmed only the name without the extension) the next free
/// `<name> (2).docx`, `(3)`, ... is used so nothing is overwritten unconfirmed.
pub fn resolve_docx_path(chosen: &Path) -> Result<PathBuf, FileError> {
    let has_ext = chosen
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(has_docx_extension);
    if has_ext {
        return Ok(chosen.to_path_buf());
    }
    let with_suffix = |suffix: &str| {
        let mut s: OsString = chosen.as_os_str().to_owned();
        s.push(suffix);
        PathBuf::from(s)
    };
    let first = with_suffix(".docx");
    if std::fs::symlink_metadata(&first).is_err() {
        return Ok(first);
    }
    for n in 2..10_000u32 {
        let candidate = with_suffix(&format!(" ({n}).docx"));
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

/// Write `bytes` to a temp file next to `path`, then rename it over `path`. No partial file
/// is ever visible at `path`; the temp file is removed on error; a symlink at `path` is
/// replaced by a regular file, never written through. Returns the final path.
pub fn write_docx_atomically(path: &Path, bytes: &[u8]) -> Result<PathBuf, FileError> {
    let dir = match path.parent() {
        Some(d) if !d.as_os_str().is_empty() => d,
        _ => Path::new("."),
    };
    let tmp = dir.join(format!(
        ".shir-export-{}-{}.tmp",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    if let Err(e) = write_temp(&tmp, bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(FileError::io(e));
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(FileError::io(e));
    }
    Ok(path.to_path_buf())
}

/// Ask for a save location in a native dialog opened here (the webview never supplies a
/// path) and write the Word document `bytes` there. `Ok(None)` when the user cancels.
#[tauri::command(async)]
#[specta::specta]
pub fn save_export_docx(
    app: tauri::AppHandle,
    default_name: String,
    filter_name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, FileError> {
    validate_export_bytes(&bytes)?;
    let picked = app
        .dialog()
        .file()
        .set_file_name(sanitize_export_name(&default_name))
        .add_filter(filter_name, &["docx"])
        .blocking_save_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let chosen = picked
        .into_path()
        .map_err(|e| FileError::new(FileErrorKind::Io, e.to_string()))?;
    let target = resolve_docx_path(&chosen)?;
    let written = write_docx_atomically(&target, &bytes)?;
    Ok(Some(written.to_string_lossy().into_owned()))
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
