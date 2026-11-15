pub mod db;
pub mod smoke;

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Listener;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    if smoke::is_smoke_mode(std::env::var("SHIR_SMOKE").ok().as_deref()) {
        builder = builder.setup(|app| {
            let announced = AtomicBool::new(false);
            let app_handle = app.handle().clone();
            app.listen_any(smoke::UI_READY_EVENT, move |_event| {
                if announced.swap(true, Ordering::SeqCst) {
                    return;
                }
                let mut stdout = std::io::stdout();
                // Best effort: a closed stdout must not crash the app.
                let _ = writeln!(stdout, "{}", smoke::READY_MARKER);
                let _ = stdout.flush();
                let exit_handle = app_handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(smoke::SMOKE_DWELL);
                    exit_handle.exit(0);
                });
            });
            Ok(())
        });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running Shir");
}
