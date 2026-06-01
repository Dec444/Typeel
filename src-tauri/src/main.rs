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

/// Write the rendered document to a temp .html file and open it in the user's
/// default browser, where reliable "print / save as PDF" is available. (The
/// macOS WebKit webview does not implement JavaScript printing.)
#[tauri::command]
fn open_html_in_browser(html: String, name: String) -> Result<(), String> {
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let file = format!("typeel-{}.html", if safe.is_empty() { "export".into() } else { safe });

    let mut path = std::env::temp_dir();
    path.push(file);
    fs::write(&path, html).map_err(|e| e.to_string())?;

    open_path(&path.to_string_lossy())
}

#[cfg(target_os = "macos")]
fn open_path(p: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(p)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn open_path(p: &str) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", p])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn open_path(p: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(p)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
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

/// Read a local image file and return it as a base64 `data:` URL, which renders
/// in the editor regardless of webview protocol/scope settings.
#[tauri::command]
fn read_image_data_url(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mime = match std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{};base64,{}", mime, base64_encode(&bytes)))
}

/// Minimal, dependency-free base64 encoder.
fn base64_encode(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            list_dir,
            open_html_in_browser,
            read_image_data_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}