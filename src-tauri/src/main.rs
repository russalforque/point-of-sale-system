#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod database;
mod files;
mod printer;

use tauri::{Manager, State};
use std::sync::Mutex;

type Result<T> = std::result::Result<T, String>;
type Store<'a> = State<'a, Mutex<database::Store>>;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            // Outside Tauri's identifier directory: the uninstaller's optional
            // "delete app data" checkbox must never erase business records.
            let directory = app.path().local_data_dir()?.join("Sellix POS").join("BusinessData");
            std::fs::create_dir_all(&directory)?;
            app.manage(Mutex::new(database::Store::new(directory)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![database::database, printer::printers,
            printer::print_raw, files::export_file, files::backup])
        .run(tauri::generate_context!())
        .expect("Unable to start Sellix POS");
}
