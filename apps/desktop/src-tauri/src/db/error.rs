//! Storage error type: serializes as `{"kind":"<Kind>","message":"<text>"}`.
use serde::{Deserialize, Serialize};
use specta::Type;
use thiserror::Error;

/// Category of a storage failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum ErrorKind {
    NotFound,
    Invalid,
    Storage,
    Migration,
    Unavailable,
}

/// A storage error with a machine-readable kind and a human message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, Error)]
#[error("{kind:?}: {message}")]
pub struct DbError {
    pub kind: ErrorKind,
    pub message: String,
}

impl DbError {
    fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::NotFound, message)
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Invalid, message)
    }

    pub fn storage(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Storage, message)
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Unavailable, message)
    }
}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        Self::new(ErrorKind::Storage, e.to_string())
    }
}

impl From<rusqlite_migration::Error> for DbError {
    fn from(e: rusqlite_migration::Error) -> Self {
        Self::new(ErrorKind::Migration, e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_as_kind_and_message() {
        let e = DbError::not_found("song 1");
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            json!({"kind": "NotFound", "message": "song 1"})
        );
        assert_eq!(
            serde_json::to_string(&DbError::unavailable("x")).unwrap(),
            r#"{"kind":"Unavailable","message":"x"}"#
        );
    }

    #[test]
    fn kinds_serialize_as_variant_names() {
        for (k, name) in [
            (ErrorKind::NotFound, "NotFound"),
            (ErrorKind::Invalid, "Invalid"),
            (ErrorKind::Storage, "Storage"),
            (ErrorKind::Migration, "Migration"),
            (ErrorKind::Unavailable, "Unavailable"),
        ] {
            assert_eq!(serde_json::to_value(k).unwrap(), json!(name));
        }
    }

    #[test]
    fn constructors_set_kind() {
        assert_eq!(DbError::invalid("m").kind, ErrorKind::Invalid);
        assert_eq!(DbError::storage("m").kind, ErrorKind::Storage);
        assert_eq!(DbError::unavailable("m").kind, ErrorKind::Unavailable);
        assert_eq!(DbError::not_found("m").kind, ErrorKind::NotFound);
    }

    #[test]
    fn display_is_kind_colon_message() {
        assert_eq!(DbError::invalid("bad id").to_string(), "Invalid: bad id");
        let boxed: Box<dyn std::error::Error> = Box::new(DbError::storage("disk"));
        assert_eq!(boxed.to_string(), "Storage: disk");
    }

    #[test]
    fn from_rusqlite_error_is_storage() {
        let e: DbError = rusqlite::Error::QueryReturnedNoRows.into();
        assert_eq!(e.kind, ErrorKind::Storage);
        assert!(!e.message.is_empty());
    }

    #[test]
    fn from_migration_error_is_migration() {
        let e: DbError = rusqlite_migration::Error::MigrationDefinition(
            rusqlite_migration::MigrationDefinitionError::NoMigrationsDefined,
        )
        .into();
        assert_eq!(e.kind, ErrorKind::Migration);
        assert!(!e.message.is_empty());
    }
}
