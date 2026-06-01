// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use std::sync::atomic::{AtomicU32, Ordering};

// Monotonic counter so every spawned window gets a unique label.
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

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

/// Minimal, dependency-free base64 decoder (standard alphabet).
fn base64_decode(s: &str) -> Vec<u8> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut acc = 0u32;
    let mut nbits = 0u32;
    for &c in s.as_bytes() {
        let v = match val(c) {
            Some(v) => v,
            None => continue, // skip '=', whitespace, etc.
        };
        acc = (acc << 6) | v;
        nbits += 6;
        if nbits >= 8 {
            nbits -= 8;
            out.push(((acc >> nbits) & 0xFF) as u8);
        }
    }
    out
}

/// Save a pasted/embedded image (base64 bytes) into a folder next to the
/// document and return the filename written. Used to persist images the way a
/// desktop editor does, instead of leaving them inline in the Markdown.
#[tauri::command]
fn save_image(dir: String, data: String, ext: String) -> Result<String, String> {
    let bytes = base64_decode(&data);
    if bytes.is_empty() {
        return Err("empty image data".into());
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let safe_ext: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let safe_ext = if safe_ext.is_empty() { "png".into() } else { safe_ext };
    let fname = format!("image-{}.{}", stamp, safe_ext);

    let mut p = std::path::PathBuf::from(&dir);
    p.push(&fname);
    fs::write(&p, bytes).map_err(|e| e.to_string())?;
    Ok(fname)
}

/// Open another independent Typeel editor window.
#[tauri::command]
fn new_window(app: tauri::AppHandle) -> Result<(), String> {
    let n = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("win-{n}");
    // Light cascade so a new window doesn't land exactly on top of the last one.
    let offset = 28.0 * ((n % 8) as f64);
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("Typeel")
        .inner_size(1100.0, 740.0)
        .min_inner_size(640.0, 480.0)
        .position(120.0 + offset, 120.0 + offset)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Find the window the user is currently working in (for routing menu actions).
#[cfg(target_os = "macos")]
fn focused_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    use tauri::Manager;
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            list_dir,
            open_html_in_browser,
            read_image_data_url,
            save_image,
            new_window
        ])
        .setup(|app| {
            // A native menu only makes sense on macOS, where it lives in the
            // top-of-screen menu bar. On Windows/Linux it would render as an
            // in-window strip that clashes with Typeel's own toolbar, so we
            // leave those platforms with the default (no app menu).
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};
                use tauri::Emitter;

                let app_menu = SubmenuBuilder::new(app, "Typeel")
                    .about(Some(AboutMetadata::default()))
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                let file_menu = SubmenuBuilder::new(app, "File")
                    .text("new_tab", "New Tab")
                    .text("new_window", "New Window")
                    .separator()
                    .text("open", "Open\u{2026}")
                    .text("save", "Save")
                    .separator()
                    .text("close_tab", "Close Tab")
                    .build()?;

                // Re-supplying the standard Edit items keeps copy/paste/undo
                // working once we replace the default menu.
                let edit_menu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                let window_menu = SubmenuBuilder::new(app, "Window").minimize().build()?;

                let menu = MenuBuilder::new(app)
                    .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
                    .build()?;
                app.set_menu(menu)?;

                app.on_menu_event(|app_handle, event| {
                    let id = event.id().0.as_str();
                    if id == "new_window" {
                        let _ = new_window(app_handle.clone());
                    } else if matches!(id, "new_tab" | "open" | "save" | "close_tab") {
                        // The custom items drive frontend actions in the focused window.
                        if let Some(win) = focused_window(app_handle) {
                            let _ = win.emit("menu", id);
                        }
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}