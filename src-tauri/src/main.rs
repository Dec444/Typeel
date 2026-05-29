// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
}

/// Read a UTF-8 text file from an absolute path chosen via the native dialog.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write a UTF-8 text file to an absolute path.
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// List one level of a directory: sub-folders and Markdown files only.
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut entries: Vec<Entry> = Vec::new();

    for item in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let item = match item {
            Ok(i) => i,
            Err(_) => continue,
        };
        let p = item.path();
        let name = item.file_name().to_string_lossy().to_string();

        if name.starts_with('.') {
            continue; // skip dotfiles / dotfolders
        }

        let is_dir = p.is_dir();

        // Show every visible file and folder so the whole project is
        // browsable, not only Markdown files.
        entries.push(Entry {
            name,
            path: p.to_string_lossy().to_string(),
            is_dir,
        });
    }

    // folders first, then alphabetical (case-insensitive)
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file, write_file, list_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
