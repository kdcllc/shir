//! Tauri commands over the setlist repository.
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

use super::state::DbState;
use crate::db::setlists as repo;
use crate::db::{DbError, Setlist, SetlistSummary};
use tauri::State;

pub fn list_setlists_impl(state: &DbState) -> Result<Vec<SetlistSummary>, DbError> {
    state.with_conn(|c| repo::list_setlists(c))
}

pub fn get_setlist_impl(state: &DbState, id: &str) -> Result<Setlist, DbError> {
    state.with_conn(|c| repo::get_setlist(c, id))
}

pub fn create_setlist_impl(state: &DbState, name: &str) -> Result<Setlist, DbError> {
    state.with_conn(|c| repo::create_setlist(c, name))
}

pub fn rename_setlist_impl(state: &DbState, id: &str, name: &str) -> Result<Setlist, DbError> {
    state.with_conn(|c| repo::rename_setlist(c, id, name))
}

pub fn delete_setlist_impl(state: &DbState, id: &str) -> Result<(), DbError> {
    state.with_conn(|c| repo::delete_setlist(c, id))
}

pub fn duplicate_setlist_impl(state: &DbState, id: &str, name: &str) -> Result<Setlist, DbError> {
    state.with_conn(|c| repo::duplicate_setlist(c, id, name))
}

pub fn add_setlist_items_impl(
    state: &DbState,
    setlist_id: &str,
    song_ids: &[String],
) -> Result<Setlist, DbError> {
    state.with_conn(|c| repo::add_setlist_items(c, setlist_id, song_ids))
}

pub fn remove_setlist_item_impl(
    state: &DbState,
    setlist_id: &str,
    item_id: &str,
) -> Result<Setlist, DbError> {
    state.with_conn(|c| repo::remove_setlist_item(c, setlist_id, item_id))
}

pub fn reorder_setlist_items_impl(
    state: &DbState,
    setlist_id: &str,
    item_ids: &[String],
) -> Result<Setlist, DbError> {
    state.with_conn(|c| repo::reorder_setlist_items(c, setlist_id, item_ids))
}

pub fn update_setlist_item_impl(
    state: &DbState,
    setlist_id: &str,
    item_id: &str,
    transpose: i8,
    capo: Option<u8>,
) -> Result<Setlist, DbError> {
    state.with_conn(|c| repo::update_setlist_item(c, setlist_id, item_id, transpose, capo))
}

#[tauri::command(async)]
#[specta::specta]
pub fn list_setlists(state: State<'_, DbState>) -> Result<Vec<SetlistSummary>, DbError> {
    list_setlists_impl(&state)
}

#[tauri::command(async)]
#[specta::specta]
pub fn get_setlist(state: State<'_, DbState>, id: String) -> Result<Setlist, DbError> {
    get_setlist_impl(&state, &id)
}

#[tauri::command(async)]
#[specta::specta]
pub fn create_setlist(state: State<'_, DbState>, name: String) -> Result<Setlist, DbError> {
    create_setlist_impl(&state, &name)
}

#[tauri::command(async)]
#[specta::specta]
pub fn rename_setlist(
    state: State<'_, DbState>,
    id: String,
    name: String,
) -> Result<Setlist, DbError> {
    rename_setlist_impl(&state, &id, &name)
}

#[tauri::command(async)]
#[specta::specta]
pub fn delete_setlist(state: State<'_, DbState>, id: String) -> Result<(), DbError> {
    delete_setlist_impl(&state, &id)
}

#[tauri::command(async)]
#[specta::specta]
pub fn duplicate_setlist(
    state: State<'_, DbState>,
    id: String,
    name: String,
) -> Result<Setlist, DbError> {
    duplicate_setlist_impl(&state, &id, &name)
}

#[tauri::command(async)]
#[specta::specta]
pub fn add_setlist_items(
    state: State<'_, DbState>,
    setlist_id: String,
    song_ids: Vec<String>,
) -> Result<Setlist, DbError> {
    add_setlist_items_impl(&state, &setlist_id, &song_ids)
}

#[tauri::command(async)]
#[specta::specta]
pub fn remove_setlist_item(
    state: State<'_, DbState>,
    setlist_id: String,
    item_id: String,
) -> Result<Setlist, DbError> {
    remove_setlist_item_impl(&state, &setlist_id, &item_id)
}

#[tauri::command(async)]
#[specta::specta]
pub fn reorder_setlist_items(
    state: State<'_, DbState>,
    setlist_id: String,
    item_ids: Vec<String>,
) -> Result<Setlist, DbError> {
    reorder_setlist_items_impl(&state, &setlist_id, &item_ids)
}

#[tauri::command(async)]
#[specta::specta]
pub fn update_setlist_item(
    state: State<'_, DbState>,
    setlist_id: String,
    item_id: String,
    transpose: i8,
    capo: Option<u8>,
) -> Result<Setlist, DbError> {
    update_setlist_item_impl(&state, &setlist_id, &item_id, transpose, capo)
}
