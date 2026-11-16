//! Read a user-picked text file for import. Plain `std::fs`; no fs plugin.
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

use serde::{Deserialize, Serialize};
use specta::Type;
use std::io::Read;
use std::path::Path;
use thiserror::Error;

/// Largest text file accepted, in bytes.
pub const MAX_TEXT_FILE_BYTES: u64 = 1_048_576;

/// Category of a file-read failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum FileErrorKind {
    TooLarge,
    NotUtf8,
    Io,
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
        ] {
            assert_eq!(serde_json::to_value(k).unwrap(), json!(n));
        }
    }
}
