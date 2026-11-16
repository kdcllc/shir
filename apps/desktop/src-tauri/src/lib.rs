pub mod commands;
pub mod db;
pub mod smoke;

use commands::state::DbState;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Listener, Manager};

fn open_db_state(app: &tauri::App) -> DbState {
    match app.path().app_data_dir() {
        Ok(dir) => {
            let state = DbState::open(&dir.join("shir.db"));
            if let Err(e) = state.with_conn(|_| Ok(())) {
                eprintln!("shir: database unavailable: {e}");
            }
            state
        }
        Err(e) => {
            let err = db::DbError::unavailable(format!("cannot resolve app data dir: {e}"));
            eprintln!("shir: database unavailable: {err}");
            DbState::unavailable(err)
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    if let Err(e) = commands::sync_bindings(std::path::Path::new(commands::BINDINGS_PATH)) {
        eprintln!("shir: could not export bindings: {e}");
    }

    let smoke_mode = smoke::is_smoke_mode(std::env::var("SHIR_SMOKE").ok().as_deref());

    tauri::Builder::default()
        .invoke_handler(commands::specta_builder().invoke_handler())
        .setup(move |app| {
            app.manage(open_db_state(app));
            if smoke_mode {
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
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Shir");
}
