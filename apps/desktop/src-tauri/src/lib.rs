pub mod commands;
pub mod db;
pub mod smoke;

use commands::state::DbState;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Listener, Manager};

/// Write the startup fallback line for an unavailable `state` to `out`; nothing when healthy.
fn report_unavailable(state: &DbState, out: &mut dyn Write) {
    if let Some(line) = state.unavailable_line() {
        // Best effort: a closed log must not fail startup.
        let _ = writeln!(out, "{line}");
    }
}

fn open_db_state(app: &tauri::App) -> DbState {
    let state = match app.path().app_data_dir() {
        Ok(dir) => DbState::open(&dir.join("shir.db")),
        Err(e) => {
            let err = db::DbError::unavailable(format!("cannot resolve app data dir: {e}"));
            DbState::unavailable(err)
        }
    };
    report_unavailable(&state, &mut std::io::stderr());
    state
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    if let Err(e) = commands::sync_bindings(std::path::Path::new(commands::BINDINGS_PATH)) {
        eprintln!("shir: could not export bindings: {e}");
    }

    let smoke_mode = smoke::is_smoke_mode(std::env::var("SHIR_SMOKE").ok().as_deref());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_state_writes_exactly_one_line() {
        let state = DbState::unavailable(db::DbError::unavailable("nope"));
        let mut out: Vec<u8> = Vec::new();
        report_unavailable(&state, &mut out);
        let text = String::from_utf8(out).unwrap();
        assert_eq!(text, "shir: database unavailable: nope\n");
    }

    #[test]
    fn available_state_writes_nothing() {
        let mut out: Vec<u8> = Vec::new();
        report_unavailable(&DbState::in_memory(), &mut out);
        assert!(out.is_empty(), "{out:?}");
    }
}
