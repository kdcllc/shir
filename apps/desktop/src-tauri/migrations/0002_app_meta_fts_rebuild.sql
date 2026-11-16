-- V2 schema. Forward-only: never edit this file once shipped; append a new migration.
-- The search index (songs_fts) is rebuilt by the Rust hook that runs with this migration.
CREATE TABLE app_meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
) STRICT;
