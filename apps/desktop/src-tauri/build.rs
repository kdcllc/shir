fn main() {
    // Windows MSVC test executables (`cargo test`) crashed with 0xc0000139
    // STATUS_ENTRYPOINT_NOT_FOUND: tauri-build's resource compile (embed_resource) links the
    // app manifest only into bins (`rustc-link-arg-bins`), so test exes lacked the
    // Common-Controls v6 dependency. Skip the default manifest and pass the same dependency as
    // a link arg that applies to every artifact (bins, tests). Check the build TARGET via the
    // CARGO_CFG_* env vars, not `cfg!`, which would test the host.
    let is_windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|v| v == "windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|v| v == "msvc");

    let mut attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "save_song",
            "get_song",
            "list_songs",
            "delete_song",
            "search_songs",
            "read_text_file",
            "save_export_docx",
            "list_setlists",
            "get_setlist",
            "create_setlist",
            "rename_setlist",
            "delete_setlist",
            "duplicate_setlist",
            "add_setlist_items",
            "remove_setlist_item",
            "reorder_setlist_items",
            "update_setlist_item",
            "log_webview_error",
        ]));

    if is_windows_msvc {
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
