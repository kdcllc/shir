-- V1 schema. Forward-only: never edit this file once shipped; append a new migration.
CREATE TABLE songs (
    id         TEXT PRIMARY KEY NOT NULL,
    chordpro   TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    artist     TEXT,
    key        TEXT,
    capo       INTEGER CHECK (capo IS NULL OR capo BETWEEN 0 AND 24),
    language   TEXT NOT NULL CHECK (language IN ('he','en','mixed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_songs_updated_at ON songs (updated_at);

-- Search index. Holds normalize_he'd text only (the *_norm columns are the sole place
-- niqqud-stripped text is stored). rowid == songs.rowid of the indexed song.
-- Written by Rust (no triggers), because normalization happens in Rust.
CREATE VIRTUAL TABLE songs_fts USING fts5(
    title_norm,
    artist_norm,
    lyrics_norm,
    tokenize = 'unicode61 remove_diacritics 0'
);
