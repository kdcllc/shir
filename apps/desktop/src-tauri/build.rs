fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "save_song",
            "get_song",
            "list_songs",
            "delete_song",
            "search_songs",
        ]),
    ))
    .expect("failed to run tauri-build");
}
