//! Setlist persistence: ordered song entries with per-entry transpose and capo.
//!
//! Setlist operations never write to `songs`; deleting a song removes its entries through
//! the foreign-key cascade (see `repo::delete_song`, which renumbers the survivors).
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

use super::error::DbError;
use super::model::{Setlist, SetlistItem, SetlistSummary};
use super::repo::{language_from, now_timestamp, validate_id};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashSet;
use uuid::Uuid;

/// Maximum setlist name length, in characters.
const MAX_NAME_CHARS: usize = 200;

fn new_id() -> String {
    Uuid::now_v7().hyphenated().to_string()
}

/// Trim `name`; `Invalid` when empty or longer than 200 characters (not bytes).
fn validate_name(name: &str) -> Result<String, DbError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(DbError::invalid("setlist name is empty"));
    }
    if trimmed.chars().count() > MAX_NAME_CHARS {
        return Err(DbError::invalid(format!(
            "setlist name exceeds {MAX_NAME_CHARS} characters"
        )));
    }
    Ok(trimmed.to_owned())
}

fn validate_adjustments(transpose: i8, capo: Option<u8>) -> Result<(), DbError> {
    if !(-11..=11).contains(&transpose) {
        return Err(DbError::invalid("transpose must be between -11 and 11"));
    }
    if capo.is_some_and(|c| c > 24) {
        return Err(DbError::invalid("capo must be between 0 and 24"));
    }
    Ok(())
}

fn setlist_exists(conn: &Connection, id: &str) -> Result<bool, DbError> {
    Ok(conn
        .query_row("SELECT 1 FROM setlists WHERE id = ?1", [id], |_| Ok(()))
        .optional()?
        .is_some())
}

fn require_setlist(conn: &Connection, id: &str) -> Result<(), DbError> {
    if setlist_exists(conn, id)? {
        Ok(())
    } else {
        Err(DbError::not_found(format!("setlist {id}")))
    }
}

/// Set a setlist's `updated_at`.
pub(crate) fn touch(conn: &Connection, setlist_id: &str, now: &str) -> Result<(), DbError> {
    conn.execute(
        "UPDATE setlists SET updated_at = ?2 WHERE id = ?1",
        params![setlist_id, now],
    )?;
    Ok(())
}

/// Ids of the setlists that hold at least one entry for `song_id`.
pub(crate) fn setlists_containing_song(
    conn: &Connection,
    song_id: &str,
) -> Result<Vec<String>, DbError> {
    let mut stmt =
        conn.prepare("SELECT DISTINCT setlist_id FROM setlist_items WHERE song_id = ?1")?;
    let rows = stmt.query_map([song_id], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Item ids of a setlist in position order.
fn item_ids(conn: &Connection, setlist_id: &str) -> Result<Vec<String>, DbError> {
    let mut stmt =
        conn.prepare("SELECT id FROM setlist_items WHERE setlist_id = ?1 ORDER BY position")?;
    let rows = stmt.query_map([setlist_id], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Rewrite positions so `ordered_ids` (all the setlist's items) get 0..n-1 in that order.
/// Every item is first shifted above the current maximum so `UNIQUE(setlist_id, position)`
/// holds at every step and no negative temporary is needed.
fn write_order(conn: &Connection, setlist_id: &str, ordered_ids: &[String]) -> Result<(), DbError> {
    let offset: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM setlist_items WHERE setlist_id = ?1",
        [setlist_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "UPDATE setlist_items SET position = position + ?2 WHERE setlist_id = ?1",
        params![setlist_id, offset],
    )?;
    let mut stmt =
        conn.prepare("UPDATE setlist_items SET position = ?3 WHERE id = ?2 AND setlist_id = ?1")?;
    for (i, id) in ordered_ids.iter().enumerate() {
        stmt.execute(params![setlist_id, id, i as i64])?;
    }
    Ok(())
}

/// Renumber a setlist's items dense 0..n-1, keeping their current order.
pub(crate) fn renumber_items(conn: &Connection, setlist_id: &str) -> Result<(), DbError> {
    let ids = item_ids(conn, setlist_id)?;
    write_order(conn, setlist_id, &ids)
}

fn item_from_row(row: &Row<'_>) -> rusqlite::Result<SetlistItem> {
    let lang: String = row.get(9)?;
    Ok(SetlistItem {
        id: row.get(0)?,
        song_id: row.get(1)?,
        position: row.get(2)?,
        transpose: row.get(3)?,
        capo: row.get(4)?,
        title: row.get(5)?,
        artist: row.get(6)?,
        key: row.get(7)?,
        song_capo: row.get(8)?,
        language: language_from(&lang).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, Box::new(e))
        })?,
    })
}

fn fetch_setlist(conn: &Connection, id: &str) -> Result<Setlist, DbError> {
    let (name, created_at, updated_at): (String, String, String) = conn
        .query_row(
            "SELECT name, created_at, updated_at FROM setlists WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| DbError::not_found(format!("setlist {id}")))?;
    let mut stmt = conn.prepare(
        "SELECT i.id, i.song_id, i.position, i.transpose, i.capo, \
         s.title, s.artist, s.key, s.capo, s.language \
         FROM setlist_items i JOIN songs s ON s.id = i.song_id \
         WHERE i.setlist_id = ?1 ORDER BY i.position",
    )?;
    let rows = stmt.query_map([id], item_from_row)?;
    let items = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(Setlist {
        id: id.to_owned(),
        name,
        created_at,
        updated_at,
        items,
    })
}

/// All setlists, most recently updated first.
pub fn list_setlists(conn: &Connection) -> Result<Vec<SetlistSummary>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT l.id, l.name, \
         (SELECT count(*) FROM setlist_items i WHERE i.setlist_id = l.id), l.updated_at \
         FROM setlists l ORDER BY l.updated_at DESC, l.id DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(SetlistSummary {
            id: r.get(0)?,
            name: r.get(1)?,
            item_count: r.get(2)?,
            updated_at: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// One setlist with its entries; `NotFound` when absent.
pub fn get_setlist(conn: &Connection, id: &str) -> Result<Setlist, DbError> {
    validate_id(id)?;
    fetch_setlist(conn, id)
}

/// Create an empty setlist.
pub fn create_setlist(conn: &mut Connection, name: &str) -> Result<Setlist, DbError> {
    let name = validate_name(name)?;
    let id = new_id();
    let now = now_timestamp();
    conn.execute(
        "INSERT INTO setlists (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![id, name, now],
    )?;
    fetch_setlist(conn, &id)
}

/// Rename a setlist.
pub fn rename_setlist(conn: &mut Connection, id: &str, name: &str) -> Result<Setlist, DbError> {
    validate_id(id)?;
    let name = validate_name(name)?;
    let changed = conn.execute(
        "UPDATE setlists SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name, now_timestamp()],
    )?;
    if changed == 0 {
        return Err(DbError::not_found(format!("setlist {id}")));
    }
    fetch_setlist(conn, id)
}

/// Delete a setlist; its entries cascade. The songs are untouched.
pub fn delete_setlist(conn: &mut Connection, id: &str) -> Result<(), DbError> {
    validate_id(id)?;
    let changed = conn.execute("DELETE FROM setlists WHERE id = ?1", [id])?;
    if changed == 0 {
        return Err(DbError::not_found(format!("setlist {id}")));
    }
    Ok(())
}

/// Copy a setlist under a new name: new ids, same songs, transpose, capo and order.
pub fn duplicate_setlist(conn: &mut Connection, id: &str, name: &str) -> Result<Setlist, DbError> {
    validate_id(id)?;
    let name = validate_name(name)?;
    let tx = conn.transaction()?;
    let source = fetch_setlist(&tx, id)?;
    let new_setlist_id = new_id();
    let now = now_timestamp();
    tx.execute(
        "INSERT INTO setlists (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![new_setlist_id, name, now],
    )?;
    for item in &source.items {
        tx.execute(
            "INSERT INTO setlist_items (id, setlist_id, song_id, position, transpose, capo) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                new_id(),
                new_setlist_id,
                item.song_id,
                item.position,
                item.transpose,
                item.capo
            ],
        )?;
    }
    let copy = fetch_setlist(&tx, &new_setlist_id)?;
    tx.commit()?;
    Ok(copy)
}

/// Append one entry per id in `song_ids` (in order; duplicates allowed).
pub fn add_setlist_items(
    conn: &mut Connection,
    setlist_id: &str,
    song_ids: &[String],
) -> Result<Setlist, DbError> {
    validate_id(setlist_id)?;
    if song_ids.is_empty() {
        return Err(DbError::invalid("no songs to add"));
    }
    for song_id in song_ids {
        validate_id(song_id)?;
    }
    let tx = conn.transaction()?;
    require_setlist(&tx, setlist_id)?;
    for song_id in song_ids {
        let known = tx
            .query_row("SELECT 1 FROM songs WHERE id = ?1", [song_id], |_| Ok(()))
            .optional()?
            .is_some();
        if !known {
            return Err(DbError::not_found(format!("song {song_id}")));
        }
    }
    let start: i64 = tx.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM setlist_items WHERE setlist_id = ?1",
        [setlist_id],
        |r| r.get(0),
    )?;
    for (offset, song_id) in song_ids.iter().enumerate() {
        tx.execute(
            "INSERT INTO setlist_items (id, setlist_id, song_id, position) \
             VALUES (?1, ?2, ?3, ?4)",
            params![new_id(), setlist_id, song_id, start + offset as i64],
        )?;
    }
    touch(&tx, setlist_id, &now_timestamp())?;
    let out = fetch_setlist(&tx, setlist_id)?;
    tx.commit()?;
    Ok(out)
}

fn require_item(conn: &Connection, setlist_id: &str, item_id: &str) -> Result<(), DbError> {
    let found = conn
        .query_row(
            "SELECT 1 FROM setlist_items WHERE id = ?1 AND setlist_id = ?2",
            params![item_id, setlist_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if found {
        Ok(())
    } else {
        Err(DbError::not_found(format!("setlist item {item_id}")))
    }
}

/// Remove one entry; remaining positions are renumbered dense.
pub fn remove_setlist_item(
    conn: &mut Connection,
    setlist_id: &str,
    item_id: &str,
) -> Result<Setlist, DbError> {
    validate_id(setlist_id)?;
    validate_id(item_id)?;
    let tx = conn.transaction()?;
    require_setlist(&tx, setlist_id)?;
    require_item(&tx, setlist_id, item_id)?;
    tx.execute("DELETE FROM setlist_items WHERE id = ?1", [item_id])?;
    renumber_items(&tx, setlist_id)?;
    touch(&tx, setlist_id, &now_timestamp())?;
    let out = fetch_setlist(&tx, setlist_id)?;
    tx.commit()?;
    Ok(out)
}

/// Reorder entries; `item_ids` must be an exact permutation of the current item ids.
pub fn reorder_setlist_items(
    conn: &mut Connection,
    setlist_id: &str,
    item_ids_in_order: &[String],
) -> Result<Setlist, DbError> {
    validate_id(setlist_id)?;
    for id in item_ids_in_order {
        validate_id(id)?;
    }
    let tx = conn.transaction()?;
    require_setlist(&tx, setlist_id)?;
    let current = item_ids(&tx, setlist_id)?;
    let current_set: HashSet<&str> = current.iter().map(String::as_str).collect();
    let given_set: HashSet<&str> = item_ids_in_order.iter().map(String::as_str).collect();
    if item_ids_in_order.len() != current.len() || given_set != current_set {
        return Err(DbError::invalid(
            "item ids must be an exact permutation of the setlist's items",
        ));
    }
    write_order(&tx, setlist_id, item_ids_in_order)?;
    touch(&tx, setlist_id, &now_timestamp())?;
    let out = fetch_setlist(&tx, setlist_id)?;
    tx.commit()?;
    Ok(out)
}

/// Set one entry's transpose and capo (`None` = use the song's own capo).
pub fn update_setlist_item(
    conn: &mut Connection,
    setlist_id: &str,
    item_id: &str,
    transpose: i8,
    capo: Option<u8>,
) -> Result<Setlist, DbError> {
    validate_id(setlist_id)?;
    validate_id(item_id)?;
    validate_adjustments(transpose, capo)?;
    let tx = conn.transaction()?;
    require_setlist(&tx, setlist_id)?;
    require_item(&tx, setlist_id, item_id)?;
    tx.execute(
        "UPDATE setlist_items SET transpose = ?2, capo = ?3 WHERE id = ?1",
        params![item_id, transpose, capo],
    )?;
    touch(&tx, setlist_id, &now_timestamp())?;
    let out = fetch_setlist(&tx, setlist_id)?;
    tx.commit()?;
    Ok(out)
}
