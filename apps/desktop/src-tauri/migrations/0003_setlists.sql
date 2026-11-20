-- V3: setlists. Forward-only: never edit this file once shipped; append a new migration.
CREATE TABLE setlists (
    id         TEXT PRIMARY KEY NOT NULL,
    name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

-- One entry per song occurrence. `capo` NULL means "use the song's own capo".
CREATE TABLE setlist_items (
    id         TEXT PRIMARY KEY NOT NULL,
    setlist_id TEXT NOT NULL REFERENCES setlists (id) ON DELETE CASCADE,
    song_id    TEXT NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    position   INTEGER NOT NULL CHECK (position >= 0),
    transpose  INTEGER NOT NULL DEFAULT 0 CHECK (transpose BETWEEN -11 AND 11),
    capo       INTEGER CHECK (capo IS NULL OR capo BETWEEN 0 AND 24),
    UNIQUE (setlist_id, position)
) STRICT;

CREATE INDEX idx_setlist_items_song_id ON setlist_items (song_id);
CREATE INDEX idx_setlists_updated_at ON setlists (updated_at);
