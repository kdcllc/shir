//! Setlist repository over a file database: round-trips, ordering, dense positions,
//! cascades, atomic rejections and song-row immutability.
use rusqlite::types::Value;
use rusqlite::Connection;
use shir_lib::db::migrations::open;
use shir_lib::db::repo::{delete_song, get_song, save_song};
use shir_lib::db::setlists::{
    add_setlist_items, create_setlist, delete_setlist, duplicate_setlist, get_setlist,
    list_setlists, remove_setlist_item, rename_setlist, reorder_setlist_items, update_setlist_item,
};
use shir_lib::db::{ErrorKind, SaveSongInput, Setlist};
use tempfile::TempDir;

const OLD: &str = "2000-01-01T00:00:00.000Z";
const NIL_ID: &str = "00000000-0000-7000-8000-000000000000";

fn open_db() -> (TempDir, std::path::PathBuf, Connection) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("lib").join("shir.db");
    let conn = open(&path).expect("open");
    (dir, path, conn)
}

fn song(conn: &mut Connection, title: &str, extra: &str) -> String {
    save_song(
        conn,
        &SaveSongInput {
            id: None,
            chordpro: format!("{{title: {title}}}\n{extra}[C]la [G]la\n"),
        },
    )
    .expect("save song")
    .id
}

fn three_songs(conn: &mut Connection) -> [String; 3] {
    [
        song(conn, "Alpha", "{artist: Ann}\n{key: G}\n{capo: 2}\n"),
        song(conn, "Beta", ""),
        song(conn, "שיר גמא", ""),
    ]
}

fn ids(s: &Setlist) -> Vec<String> {
    s.items.iter().map(|i| i.id.clone()).collect()
}

fn songs_of(s: &Setlist) -> Vec<String> {
    s.items.iter().map(|i| i.song_id.clone()).collect()
}

fn assert_dense(s: &Setlist) {
    let positions: Vec<u32> = s.items.iter().map(|i| i.position).collect();
    let expected: Vec<u32> = (0..s.items.len() as u32).collect();
    assert_eq!(positions, expected, "positions must be dense 0..n-1");
}

/// Every column of every `songs` row, in rowid order.
fn songs_snapshot(conn: &Connection) -> Vec<Vec<Value>> {
    let mut stmt = conn
        .prepare(
            "SELECT rowid, id, chordpro, title, artist, key, capo, language, created_at, \
             updated_at FROM songs ORDER BY rowid",
        )
        .expect("prepare");
    let rows = stmt
        .query_map([], |r| (0..10).map(|i| r.get::<_, Value>(i)).collect())
        .expect("query");
    rows.collect::<Result<Vec<_>, _>>().expect("rows")
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).expect("count")
}

fn age(conn: &Connection, setlist_id: &str) {
    conn.execute(
        "UPDATE setlists SET updated_at = ?2 WHERE id = ?1",
        [setlist_id, OLD],
    )
    .expect("age");
}

fn updated_at(conn: &Connection, setlist_id: &str) -> String {
    get_setlist(conn, setlist_id).expect("get").updated_at
}

#[test]
fn create_get_round_trip_with_joined_song_fields() {
    let (_d, _p, mut c) = open_db();
    let [a, b, _] = three_songs(&mut c);
    let list = create_setlist(&mut c, "  Sunday set  ").expect("create");
    assert_eq!(list.name, "Sunday set", "name is trimmed");
    assert!(list.items.is_empty());
    assert_eq!(list.created_at, list.updated_at);
    assert_eq!(list.id.len(), 36);

    let added = add_setlist_items(&mut c, &list.id, &[a.clone(), b.clone()]).expect("add");
    let got = get_setlist(&c, &list.id).expect("get");
    assert_eq!(got, added);
    assert_eq!(got.items.len(), 2);
    let first = &got.items[0];
    assert_eq!(first.song_id, a);
    assert_eq!(first.position, 0);
    assert_eq!(first.transpose, 0);
    assert_eq!(first.capo, None);
    assert_eq!(first.title, "Alpha");
    assert_eq!(first.artist.as_deref(), Some("Ann"));
    assert_eq!(first.key.as_deref(), Some("G"));
    assert_eq!(first.song_capo, Some(2));
    assert_eq!(got.items[1].title, "Beta");
    assert_eq!(got.items[1].artist, None);
}

#[test]
fn name_validation_counts_chars_and_trims() {
    let (_d, _p, mut c) = open_db();
    // 200 Hebrew chars = 400 bytes: valid. 201 chars is not.
    let ok = "ש".repeat(200);
    assert_eq!(create_setlist(&mut c, &ok).expect("200 chars").name, ok);
    let too_long = "ש".repeat(201);
    assert_eq!(
        create_setlist(&mut c, &too_long).expect_err("201").kind,
        ErrorKind::Invalid
    );
    // Padding does not count toward the limit.
    let padded = format!("  {ok}  ");
    assert_eq!(create_setlist(&mut c, &padded).expect("padded").name, ok);
    for bad in ["", "   ", "\t\n"] {
        assert_eq!(
            create_setlist(&mut c, bad).expect_err("empty").kind,
            ErrorKind::Invalid,
            "{bad:?}"
        );
    }
    let list = create_setlist(&mut c, "x").expect("create");
    assert_eq!(
        rename_setlist(&mut c, &list.id, " ")
            .expect_err("blank")
            .kind,
        ErrorKind::Invalid
    );
    assert_eq!(
        rename_setlist(&mut c, &list.id, &too_long)
            .expect_err("long")
            .kind,
        ErrorKind::Invalid
    );
    assert_eq!(
        duplicate_setlist(&mut c, &list.id, "")
            .expect_err("dup blank")
            .kind,
        ErrorKind::Invalid
    );
    assert_eq!(get_setlist(&c, &list.id).expect("get").name, "x");
    assert_eq!(list_setlists(&c).expect("list").len(), 3);
}

#[test]
fn rename_changes_name_and_touches_updated_at() {
    let (_d, _p, mut c) = open_db();
    let list = create_setlist(&mut c, "Old").expect("create");
    age(&c, &list.id);
    let renamed = rename_setlist(&mut c, &list.id, " שבת ").expect("rename");
    assert_eq!(renamed.name, "שבת");
    assert!(renamed.updated_at.as_str() > OLD);
    assert_eq!(renamed.created_at, list.created_at);
    let err = rename_setlist(&mut c, NIL_ID, "x").expect_err("unknown");
    assert_eq!(err.kind, ErrorKind::NotFound);
    assert!(err.message.contains("setlist"), "{}", err.message);
}

#[test]
fn list_orders_by_updated_at_then_id_descending() {
    let (_d, _p, mut c) = open_db();
    let songs = three_songs(&mut c);
    // ids rise with creation order: x < y < z.
    let x = create_setlist(&mut c, "x").expect("x");
    let y = create_setlist(&mut c, "y").expect("y");
    let z = create_setlist(&mut c, "z").expect("z");
    assert!(
        x.id < y.id && y.id < z.id,
        "UUIDv7 ids rise with insert order"
    );
    add_setlist_items(&mut c, &y.id, &[songs[0].clone(), songs[1].clone()]).expect("add");
    c.execute(
        "UPDATE setlists SET updated_at = '2030-01-01T00:00:00.000Z' WHERE id = ?1",
        [&x.id],
    )
    .expect("x newest");
    for id in [&y.id, &z.id] {
        c.execute(
            "UPDATE setlists SET updated_at = '2029-01-01T00:00:00.000Z' WHERE id = ?1",
            [id],
        )
        .expect("tie");
    }
    let listed = list_setlists(&c).expect("list");
    let names: Vec<&str> = listed.iter().map(|s| s.name.as_str()).collect();
    // x is newest despite the smallest id; y and z tie on updated_at, so id DESC puts z first.
    assert_eq!(names, ["x", "z", "y"]);
    let counts: Vec<u32> = listed.iter().map(|s| s.item_count).collect();
    assert_eq!(counts, [0, 0, 2]);
    assert_eq!(listed[0].updated_at, "2030-01-01T00:00:00.000Z");
}

#[test]
fn list_tiebreak_is_id_descending_even_when_rowid_order_disagrees() {
    let (_d, _p, c) = open_db();
    // The row inserted first (lower rowid) has the larger id, so only `id DESC` yields
    // [big, small]; scanning the updated_at index backwards would yield rowid order.
    let big = "ffffffff-ffff-7fff-8fff-ffffffffffff";
    let small = "00000000-0000-7000-8000-000000000001";
    for (id, name) in [(big, "big"), (small, "small")] {
        c.execute(
            "INSERT INTO setlists (id, name, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?3)",
            [id, name, "2026-01-01T00:00:00.000Z"],
        )
        .expect("insert");
    }
    let names: Vec<String> = list_setlists(&c)
        .expect("list")
        .into_iter()
        .map(|s| s.name)
        .collect();
    assert_eq!(names, ["big", "small"]);
}

#[test]
fn add_appends_in_order_allows_duplicates_and_is_atomic() {
    let (_d, _p, mut c) = open_db();
    let [a, b, h] = three_songs(&mut c);
    let list = create_setlist(&mut c, "Set").expect("create");

    let s = add_setlist_items(&mut c, &list.id, &[b.clone(), a.clone(), b.clone()]).expect("add");
    assert_eq!(songs_of(&s), [b.clone(), a.clone(), b.clone()]);
    assert_dense(&s);
    let s = add_setlist_items(&mut c, &list.id, std::slice::from_ref(&h)).expect("add more");
    assert_eq!(songs_of(&s), [b.clone(), a.clone(), b.clone(), h.clone()]);
    assert_dense(&s);
    let mut unique = ids(&s);
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), 4, "each entry has its own id");

    // Empty slice, malformed id, unknown song, unknown setlist.
    assert_eq!(
        add_setlist_items(&mut c, &list.id, &[])
            .expect_err("empty")
            .kind,
        ErrorKind::Invalid
    );
    assert_eq!(
        add_setlist_items(&mut c, &list.id, &["nope".to_owned()])
            .expect_err("bad")
            .kind,
        ErrorKind::Invalid
    );
    assert_eq!(
        add_setlist_items(&mut c, "nope", std::slice::from_ref(&a))
            .expect_err("bad list")
            .kind,
        ErrorKind::Invalid
    );
    let before = get_setlist(&c, &list.id).expect("before");
    let err = add_setlist_items(&mut c, &list.id, &[a.clone(), NIL_ID.to_owned()])
        .expect_err("unknown song");
    assert_eq!(err.kind, ErrorKind::NotFound);
    assert!(err.message.contains("song"), "{}", err.message);
    assert_eq!(get_setlist(&c, &list.id).expect("after"), before, "atomic");
    let err = add_setlist_items(&mut c, NIL_ID, &[a]).expect_err("unknown setlist");
    assert_eq!(err.kind, ErrorKind::NotFound);
    assert!(err.message.contains("setlist"), "{}", err.message);
}

#[test]
fn remove_renumbers_dense_and_rejects_foreign_items() {
    let (_d, _p, mut c) = open_db();
    let [a, b, h] = three_songs(&mut c);
    let list = create_setlist(&mut c, "Set").expect("create");
    let other = create_setlist(&mut c, "Other").expect("other");
    let s = add_setlist_items(
        &mut c,
        &list.id,
        &[a.clone(), b.clone(), h.clone(), a.clone()],
    )
    .expect("add");
    let other_s =
        add_setlist_items(&mut c, &other.id, std::slice::from_ref(&a)).expect("add other");

    age(&c, &list.id);
    let after = remove_setlist_item(&mut c, &list.id, &s.items[1].id).expect("remove");
    assert_eq!(songs_of(&after), [a.clone(), h.clone(), a.clone()]);
    assert_dense(&after);
    assert!(after.updated_at.as_str() > OLD, "remove touches updated_at");
    // Remove the first too.
    let after = remove_setlist_item(&mut c, &list.id, &s.items[0].id).expect("remove first");
    assert_eq!(songs_of(&after), [h.clone(), a.clone()]);
    assert_dense(&after);

    // An item of another setlist is NotFound and changes nothing.
    let before = get_setlist(&c, &list.id).expect("before");
    let err = remove_setlist_item(&mut c, &list.id, &other_s.items[0].id).expect_err("foreign");
    assert_eq!(err.kind, ErrorKind::NotFound);
    assert!(err.message.contains("item"), "{}", err.message);
    assert_eq!(get_setlist(&c, &list.id).expect("same"), before);
    assert_eq!(get_setlist(&c, &other.id).expect("other"), other_s);
    // Unknown item / unknown setlist / malformed id.
    assert_eq!(
        remove_setlist_item(&mut c, &list.id, NIL_ID)
            .expect_err("unknown")
            .kind,
        ErrorKind::NotFound
    );
    let err = remove_setlist_item(&mut c, NIL_ID, &s.items[2].id).expect_err("no list");
    assert_eq!(err.kind, ErrorKind::NotFound);
    assert!(err.message.contains("setlist"), "{}", err.message);
    assert_eq!(
        remove_setlist_item(&mut c, &list.id, "x")
            .expect_err("bad")
            .kind,
        ErrorKind::Invalid
    );
}

#[test]
fn reorder_applies_permutation_and_rejects_everything_else_unchanged() {
    let (_d, _p, mut c) = open_db();
    let [a, b, h] = three_songs(&mut c);
    let list = create_setlist(&mut c, "Set").expect("create");
    let other = create_setlist(&mut c, "Other").expect("other");
    let s = add_setlist_items(&mut c, &list.id, &[a.clone(), b.clone(), h.clone()]).expect("add");
    let other_s =
        add_setlist_items(&mut c, &other.id, std::slice::from_ref(&a)).expect("add other");
    let [i0, i1, i2] = [
        s.items[0].id.clone(),
        s.items[1].id.clone(),
        s.items[2].id.clone(),
    ];

    age(&c, &list.id);
    let r = reorder_setlist_items(&mut c, &list.id, &[i2.clone(), i0.clone(), i1.clone()])
        .expect("reorder");
    assert_eq!(ids(&r), [i2.clone(), i0.clone(), i1.clone()]);
    assert_dense(&r);
    assert!(r.updated_at.as_str() > OLD, "reorder touches updated_at");
    assert_eq!(get_setlist(&c, &list.id).expect("get"), r);
    // Reverse again, and the identity order.
    let r = reorder_setlist_items(&mut c, &list.id, &[i1.clone(), i0.clone(), i2.clone()])
        .expect("reverse");
    assert_eq!(ids(&r), [i1.clone(), i0.clone(), i2.clone()]);
    let r = reorder_setlist_items(&mut c, &list.id, &ids(&r)).expect("identity");
    assert_eq!(ids(&r), [i1.clone(), i0.clone(), i2.clone()]);
    assert_dense(&r);

    let foreign = other_s.items[0].id.clone();
    let rejected: Vec<Vec<String>> = vec![
        vec![],
        vec![i0.clone(), i1.clone()],
        vec![i0.clone(), i1.clone(), i2.clone(), i2.clone()],
        vec![i0.clone(), i0.clone(), i1.clone()],
        vec![i0.clone(), i1.clone(), NIL_ID.to_owned()],
        vec![i0.clone(), i1.clone(), foreign],
    ];
    let before = get_setlist(&c, &list.id).expect("before");
    for bad in rejected {
        let err = reorder_setlist_items(&mut c, &list.id, &bad).expect_err("rejected");
        assert_eq!(err.kind, ErrorKind::Invalid, "{bad:?}");
        assert_eq!(get_setlist(&c, &list.id).expect("same"), before, "{bad:?}");
    }
    assert_eq!(
        reorder_setlist_items(&mut c, &list.id, &["x".to_owned()])
            .expect_err("bad id")
            .kind,
        ErrorKind::Invalid
    );
    let err = reorder_setlist_items(&mut c, NIL_ID, &[]).expect_err("unknown");
    assert_eq!(err.kind, ErrorKind::NotFound);
    assert_eq!(get_setlist(&c, &other.id).expect("other"), other_s);
}

#[test]
fn update_item_sets_transpose_and_capo_with_bounds() {
    let (_d, _p, mut c) = open_db();
    let [a, b, _] = three_songs(&mut c);
    let list = create_setlist(&mut c, "Set").expect("create");
    let other = create_setlist(&mut c, "Other").expect("other");
    let s = add_setlist_items(&mut c, &list.id, &[a.clone(), b.clone()]).expect("add");
    let other_s = add_setlist_items(&mut c, &other.id, &[a]).expect("add other");
    let item = s.items[0].id.clone();

    age(&c, &list.id);
    let u = update_setlist_item(&mut c, &list.id, &item, -3, Some(4)).expect("update");
    assert_eq!((u.items[0].transpose, u.items[0].capo), (-3, Some(4)));
    assert_eq!(
        (u.items[1].transpose, u.items[1].capo),
        (0, None),
        "neighbour untouched"
    );
    assert!(u.updated_at.as_str() > OLD, "update touches updated_at");
    let u = update_setlist_item(&mut c, &list.id, &item, 11, Some(24)).expect("upper bounds");
    assert_eq!((u.items[0].transpose, u.items[0].capo), (11, Some(24)));
    let u = update_setlist_item(&mut c, &list.id, &item, -11, Some(0)).expect("lower bounds");
    assert_eq!((u.items[0].transpose, u.items[0].capo), (-11, Some(0)));
    let u = update_setlist_item(&mut c, &list.id, &item, 0, None).expect("clear capo");
    assert_eq!((u.items[0].transpose, u.items[0].capo), (0, None));

    let before = get_setlist(&c, &list.id).expect("before");
    for (t, capo, label) in [
        (12, None, "transpose 12"),
        (-12, None, "transpose -12"),
        (0, Some(25), "capo 25"),
    ] {
        let err = update_setlist_item(&mut c, &list.id, &item, t, capo).expect_err(label);
        assert_eq!(err.kind, ErrorKind::Invalid, "{label}");
    }
    assert_eq!(get_setlist(&c, &list.id).expect("same"), before);
    let err = update_setlist_item(&mut c, &list.id, &other_s.items[0].id, 1, None)
        .expect_err("foreign item");
    assert_eq!(err.kind, ErrorKind::NotFound);
    assert_eq!(get_setlist(&c, &other.id).expect("other"), other_s);
    assert_eq!(
        update_setlist_item(&mut c, &list.id, NIL_ID, 1, None)
            .expect_err("unknown")
            .kind,
        ErrorKind::NotFound
    );
    assert_eq!(
        update_setlist_item(&mut c, NIL_ID, &item, 1, None)
            .expect_err("no list")
            .kind,
        ErrorKind::NotFound
    );
    assert_eq!(
        update_setlist_item(&mut c, &list.id, "x", 1, None)
            .expect_err("bad")
            .kind,
        ErrorKind::Invalid
    );
}

#[test]
fn update_validation_runs_before_any_lookup() {
    let (_d, _p, mut c) = open_db();
    // Out-of-range values on unknown ids: Invalid (validated first), not NotFound.
    let err = update_setlist_item(&mut c, NIL_ID, NIL_ID, 12, None).expect_err("transpose");
    assert_eq!(err.kind, ErrorKind::Invalid);
    let err = update_setlist_item(&mut c, NIL_ID, NIL_ID, 0, Some(25)).expect_err("capo");
    assert_eq!(err.kind, ErrorKind::Invalid);
}

#[test]
fn duplicate_copies_entries_and_is_independent() {
    let (_d, _p, mut c) = open_db();
    let [a, b, _] = three_songs(&mut c);
    let list = create_setlist(&mut c, "Original").expect("create");
    let s = add_setlist_items(&mut c, &list.id, &[b.clone(), a.clone(), b.clone()]).expect("add");
    update_setlist_item(&mut c, &list.id, &s.items[1].id, 5, Some(3)).expect("adjust");
    let original = get_setlist(&c, &list.id).expect("original");

    let copy = duplicate_setlist(&mut c, &list.id, " Copy ").expect("duplicate");
    assert_eq!(copy.name, "Copy");
    assert_ne!(copy.id, original.id);
    assert_eq!(copy.items.len(), 3);
    for (o, n) in original.items.iter().zip(&copy.items) {
        assert_ne!(o.id, n.id, "new item ids");
        assert_eq!(
            (&o.song_id, o.position, o.transpose, o.capo),
            (&n.song_id, n.position, n.transpose, n.capo)
        );
    }
    assert_eq!(get_setlist(&c, &list.id).expect("untouched"), original);

    // Editing the copy leaves the original alone.
    remove_setlist_item(&mut c, &copy.id, &copy.items[0].id).expect("edit copy");
    update_setlist_item(&mut c, &copy.id, &copy.items[1].id, -1, None).expect("edit copy");
    rename_setlist(&mut c, &copy.id, "Renamed").expect("rename copy");
    assert_eq!(get_setlist(&c, &list.id).expect("still original"), original);
    // And vice versa.
    add_setlist_items(&mut c, &list.id, &[a]).expect("edit original");
    assert_eq!(get_setlist(&c, &copy.id).expect("copy").items.len(), 2);

    assert_eq!(
        duplicate_setlist(&mut c, NIL_ID, "x")
            .expect_err("unknown")
            .kind,
        ErrorKind::NotFound
    );
    assert_eq!(
        duplicate_setlist(&mut c, "x", "x")
            .expect_err("bad id")
            .kind,
        ErrorKind::Invalid
    );
    assert_eq!(
        list_setlists(&c).expect("list").len(),
        2,
        "failed duplicates add nothing"
    );
}

#[test]
fn delete_setlist_cascades_items_and_keeps_songs() {
    let (_d, _p, mut c) = open_db();
    let [a, b, _] = three_songs(&mut c);
    let doomed = create_setlist(&mut c, "Doomed").expect("create");
    let kept = create_setlist(&mut c, "Kept").expect("create");
    add_setlist_items(&mut c, &doomed.id, &[a.clone(), b.clone()]).expect("add");
    let kept_s = add_setlist_items(&mut c, &kept.id, &[a, b]).expect("add");
    assert_eq!(count(&c, "SELECT count(*) FROM setlist_items"), 4);

    delete_setlist(&mut c, &doomed.id).expect("delete");
    assert_eq!(
        count(&c, "SELECT count(*) FROM setlist_items"),
        2,
        "items cascade"
    );
    assert_eq!(count(&c, "SELECT count(*) FROM songs"), 3, "songs stay");
    assert_eq!(
        get_setlist(&c, &doomed.id).expect_err("gone").kind,
        ErrorKind::NotFound
    );
    assert_eq!(get_setlist(&c, &kept.id).expect("kept"), kept_s);
    assert_eq!(
        delete_setlist(&mut c, &doomed.id).expect_err("again").kind,
        ErrorKind::NotFound
    );
    assert_eq!(
        delete_setlist(&mut c, "x").expect_err("bad").kind,
        ErrorKind::Invalid
    );
}

#[test]
fn song_delete_removes_entries_and_keeps_positions_dense_in_every_setlist() {
    let (_d, _p, mut c) = open_db();
    let [a, b, h] = three_songs(&mut c);
    let one = create_setlist(&mut c, "One").expect("one");
    let two = create_setlist(&mut c, "Two").expect("two");
    let bystander = create_setlist(&mut c, "Bystander").expect("bystander");
    add_setlist_items(
        &mut c,
        &one.id,
        &[a.clone(), b.clone(), h.clone(), b.clone()],
    )
    .expect("add");
    add_setlist_items(&mut c, &two.id, &[b.clone(), a.clone()]).expect("add");
    add_setlist_items(&mut c, &bystander.id, &[a.clone(), h.clone()]).expect("add");
    for id in [&one.id, &two.id, &bystander.id] {
        age(&c, id);
    }

    delete_song(&mut c, &b).expect("delete song");

    let one_after = get_setlist(&c, &one.id).expect("one");
    assert_eq!(songs_of(&one_after), [a.clone(), h.clone()]);
    assert_dense(&one_after);
    let two_after = get_setlist(&c, &two.id).expect("two");
    assert_eq!(songs_of(&two_after), std::slice::from_ref(&a));
    assert_dense(&two_after);
    assert!(
        one_after.updated_at.as_str() > OLD,
        "affected setlist is touched"
    );
    assert!(
        two_after.updated_at.as_str() > OLD,
        "affected setlist is touched"
    );
    assert_eq!(
        updated_at(&c, &bystander.id),
        OLD,
        "unaffected setlist is not"
    );
    assert_eq!(
        get_song(&c, &b).expect_err("gone").kind,
        ErrorKind::NotFound
    );
    assert_eq!(
        count(
            &c,
            "SELECT count(*) FROM setlist_items WHERE song_id NOT IN (SELECT id FROM songs)"
        ),
        0
    );
    // The renumbered setlists stay editable (UNIQUE position is not left in a bad state).
    let more = add_setlist_items(&mut c, &one.id, &[a]).expect("append after renumber");
    assert_dense(&more);
    assert_eq!(more.items.len(), 3);
}

#[test]
fn deleting_the_first_entry_song_shifts_the_rest_down() {
    let (_d, _p, mut c) = open_db();
    let [a, b, h] = three_songs(&mut c);
    let list = create_setlist(&mut c, "Set").expect("create");
    add_setlist_items(&mut c, &list.id, &[a.clone(), b.clone(), h.clone()]).expect("add");
    delete_song(&mut c, &a).expect("delete");
    let s = get_setlist(&c, &list.id).expect("get");
    assert_eq!(songs_of(&s), [b, h]);
    assert_dense(&s);
    // Deleting the last remaining songs leaves an empty, valid setlist.
    for id in songs_of(&s) {
        delete_song(&mut c, &id).expect("delete");
    }
    assert!(get_setlist(&c, &list.id).expect("empty").items.is_empty());
}

#[test]
fn setlist_state_survives_reopen() {
    let (_d, path, mut c) = open_db();
    let [a, b, h] = three_songs(&mut c);
    let list = create_setlist(&mut c, "שבת בבוקר").expect("create");
    let s = add_setlist_items(&mut c, &list.id, &[a, b, h]).expect("add");
    update_setlist_item(&mut c, &list.id, &s.items[1].id, 2, Some(1)).expect("adjust");
    let order = vec![
        s.items[2].id.clone(),
        s.items[0].id.clone(),
        s.items[1].id.clone(),
    ];
    reorder_setlist_items(&mut c, &list.id, &order).expect("reorder");
    let expected = get_setlist(&c, &list.id).expect("get");
    let listed = list_setlists(&c).expect("list");
    drop(c);

    let c = open(&path).expect("reopen");
    let uv: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("user_version");
    assert_eq!(uv, 3);
    assert_eq!(get_setlist(&c, &list.id).expect("reopened"), expected);
    assert_eq!(list_setlists(&c).expect("list"), listed);
    assert_eq!(ids(&expected), order);
}

#[test]
fn setlist_mutations_leave_every_songs_row_byte_identical() {
    let (_d, _p, mut c) = open_db();
    let [a, b, h] = three_songs(&mut c);
    let before = songs_snapshot(&c);
    assert_eq!(before.len(), 3);

    let list = create_setlist(&mut c, "Set").expect("create");
    assert_eq!(songs_snapshot(&c), before, "create_setlist");
    let s = add_setlist_items(&mut c, &list.id, &[a, b, h]).expect("add");
    assert_eq!(songs_snapshot(&c), before, "add_setlist_items");
    update_setlist_item(&mut c, &list.id, &s.items[0].id, 3, Some(2)).expect("update");
    assert_eq!(songs_snapshot(&c), before, "update_setlist_item");
    let order = vec![
        s.items[1].id.clone(),
        s.items[2].id.clone(),
        s.items[0].id.clone(),
    ];
    reorder_setlist_items(&mut c, &list.id, &order).expect("reorder");
    assert_eq!(songs_snapshot(&c), before, "reorder_setlist_items");
    rename_setlist(&mut c, &list.id, "Renamed").expect("rename");
    assert_eq!(songs_snapshot(&c), before, "rename_setlist");
    let copy = duplicate_setlist(&mut c, &list.id, "Copy").expect("duplicate");
    assert_eq!(songs_snapshot(&c), before, "duplicate_setlist");
    remove_setlist_item(&mut c, &list.id, &s.items[0].id).expect("remove");
    assert_eq!(songs_snapshot(&c), before, "remove_setlist_item");
    delete_setlist(&mut c, &copy.id).expect("delete");
    assert_eq!(songs_snapshot(&c), before, "delete_setlist");
}

#[test]
fn saving_an_edited_song_keeps_its_setlist_entries() {
    let (_d, _p, mut c) = open_db();
    let [a, b, _] = three_songs(&mut c);
    let list = create_setlist(&mut c, "Set").expect("create");
    let s = add_setlist_items(&mut c, &list.id, &[b.clone(), a.clone(), b.clone()]).expect("add");
    update_setlist_item(&mut c, &list.id, &s.items[0].id, 4, Some(5)).expect("adjust");
    let before = get_setlist(&c, &list.id).expect("before");

    save_song(
        &mut c,
        &SaveSongInput {
            id: Some(b.clone()),
            chordpro: "{title: Beta Renamed}\n{key: D}\n[D]new [A]words\n".to_owned(),
        },
    )
    .expect("edit song");

    let after = get_setlist(&c, &list.id).expect("after");
    assert_eq!(after.items.len(), 3, "entries kept");
    assert_eq!(count(&c, "SELECT count(*) FROM songs"), 3);
    for (old, new) in before.items.iter().zip(&after.items) {
        assert_eq!(
            (&old.id, &old.song_id, old.position, old.transpose, old.capo),
            (&new.id, &new.song_id, new.position, new.transpose, new.capo)
        );
    }
    assert_eq!(
        after.items[0].title, "Beta Renamed",
        "joined fields follow the song"
    );
    assert_eq!(after.items[0].key.as_deref(), Some("D"));
    assert_eq!(after.items[1].title, "Alpha");
}

#[test]
fn every_mutation_touches_the_setlist_updated_at() {
    let (_d, _p, mut c) = open_db();
    let [a, b, _] = three_songs(&mut c);
    let list = create_setlist(&mut c, "Set").expect("create");
    age(&c, &list.id);
    let s = add_setlist_items(&mut c, &list.id, &[a, b]).expect("add");
    assert!(s.updated_at.as_str() > OLD, "add");
    age(&c, &list.id);
    let u = update_setlist_item(&mut c, &list.id, &s.items[0].id, 1, None).expect("update");
    assert!(u.updated_at.as_str() > OLD, "update");
    age(&c, &list.id);
    let r = reorder_setlist_items(
        &mut c,
        &list.id,
        &[s.items[1].id.clone(), s.items[0].id.clone()],
    )
    .expect("reorder");
    assert!(r.updated_at.as_str() > OLD, "reorder");
    age(&c, &list.id);
    let r = remove_setlist_item(&mut c, &list.id, &s.items[0].id).expect("remove");
    assert!(r.updated_at.as_str() > OLD, "remove");
    // A rejected mutation does not touch updated_at.
    age(&c, &list.id);
    reorder_setlist_items(&mut c, &list.id, &[]).expect_err("rejected");
    assert_eq!(updated_at(&c, &list.id), OLD, "rejected reorder");
}

#[test]
fn malformed_setlist_ids_are_invalid_at_every_entry_point() {
    let (_d, _p, mut c) = open_db();
    // A well-formed item id, so only the malformed setlist id can explain `Invalid`.
    let kind = |e: shir_lib::db::DbError| e.kind;
    assert_eq!(
        kind(get_setlist(&c, "x").expect_err("get")),
        ErrorKind::Invalid
    );
    assert_eq!(
        kind(rename_setlist(&mut c, "x", "name").expect_err("rename")),
        ErrorKind::Invalid
    );
    assert_eq!(
        kind(remove_setlist_item(&mut c, "x", NIL_ID).expect_err("remove")),
        ErrorKind::Invalid
    );
    assert_eq!(
        kind(reorder_setlist_items(&mut c, "x", &[]).expect_err("reorder")),
        ErrorKind::Invalid
    );
    assert_eq!(
        kind(update_setlist_item(&mut c, "x", NIL_ID, 0, None).expect_err("update")),
        ErrorKind::Invalid
    );
}
