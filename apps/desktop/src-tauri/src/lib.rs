pub mod smoke;

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::webview::PageLoadEvent;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    if smoke::is_smoke_mode(std::env::var("SHIR_SMOKE").ok().as_deref()) {
        let announced = AtomicBool::new(false);
        builder = builder.on_page_load(move |webview, payload| {
            if payload.event() != PageLoadEvent::Finished || webview.label() != "main" {
                return;
            }
            if announced.swap(true, Ordering::SeqCst) {
                return;
            }
            let mut stdout = std::io::stdout();
            // Best effort: a closed stdout must not crash the app.
            let _ = writeln!(stdout, "{}", smoke::READY_MARKER);
            let _ = stdout.flush();
            let app_handle = webview.app_handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(smoke::SMOKE_DWELL);
                app_handle.exit(0);
            });
        });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running Shir");
}
