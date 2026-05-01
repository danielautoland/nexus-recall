mod bridge;
mod clipboard;
mod config;
#[cfg(target_os = "macos")]
mod macos;

use bridge::Bridge;
use clipboard::{ClipboardItem, Store};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, Manager, PhysicalPosition, State, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// When pinned, the popover stays visible on focus loss and is alwaysOnTop.
pub struct PinState(pub AtomicBool);

/// Set to true while a native dialog (folder picker, etc.) is open.
/// Auto-hide-on-focus-loss is suppressed while this is true, otherwise
/// opening the picker steals focus → main window hides → picker orphans.
pub struct DialogState(pub AtomicBool);

/// Holds the live bridge under a Mutex so we can swap it out when the
/// user picks (or changes) the vault folder at runtime.
pub struct BridgeState(pub std::sync::Mutex<Option<Arc<Bridge>>>);

impl BridgeState {
    fn current(&self) -> Option<Arc<Bridge>> {
        self.0.lock().ok().and_then(|g| g.clone())
    }
    fn set(&self, new: Option<Arc<Bridge>>) {
        if let Ok(mut g) = self.0.lock() {
            *g = new;
        }
    }
}

fn try_spawn_bridge(vault: &str) -> Option<Arc<Bridge>> {
    let script = bridge::dev_script_path();
    match Bridge::start("node", &script, vault) {
        Ok(b) => {
            eprintln!("[bridge] spawned, vault={}", vault);
            Some(b)
        }
        Err(e) => {
            eprintln!("[bridge] FAILED to spawn: {}", e);
            None
        }
    }
}

#[tauri::command]
async fn vault_status(state: State<'_, BridgeState>) -> Result<Value, String> {
    let Some(bridge) = state.current() else {
        return Ok(json!({ "size": 0, "configured": false }));
    };
    let mut v = bridge.request("vault_status", json!({})).await?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert("configured".into(), Value::Bool(true));
    }
    Ok(v)
}

#[tauri::command]
async fn recall(
    state: State<'_, BridgeState>,
    query: String,
    k: Option<usize>,
    scope: Option<String>,
    r#type: Option<String>,
) -> Result<Value, String> {
    let Some(bridge) = state.current() else {
        return Err("vault not configured".to_string());
    };
    bridge
        .request(
            "recall",
            json!({ "query": query, "k": k, "scope": scope, "type": r#type }),
        )
        .await
}

#[tauri::command]
async fn load_memory(
    state: State<'_, BridgeState>,
    id: String,
) -> Result<Value, String> {
    let Some(bridge) = state.current() else {
        return Err("vault not configured".to_string());
    };
    bridge.request("load_memory", json!({ "id": id })).await
}

#[tauri::command]
fn app_config_get() -> Value {
    let cfg = config::load();
    json!({
        "vault_path": cfg.vault_path,
        "env_vault_path": std::env::var("NEXUS_VAULT_PATH").ok(),
    })
}

fn apply_vault_path(
    app: &AppHandle,
    state: &State<'_, BridgeState>,
    path: &str,
) -> Result<Value, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path is empty".to_string());
    }
    if !std::path::Path::new(trimmed).is_dir() {
        return Err(format!("not a directory: {}", trimmed));
    }
    // The vault now scans recursively + filters by memory `type:` frontmatter,
    // so the user can pick the Obsidian vault root directly. We still call
    // auto_resolve so existing setups that put memorys/ as a separate folder
    // keep working without requiring a re-pick.
    let resolved = config::auto_resolve(trimmed);
    let mut cfg = config::load();
    cfg.vault_path = Some(resolved.clone());
    config::save(&cfg)?;

    let new_bridge = try_spawn_bridge(&resolved);
    state.set(new_bridge.clone());
    let configured = new_bridge.is_some();
    let _ = app.emit(
        "vault:reconfigured",
        json!({ "vault_path": resolved.clone(), "configured": configured }),
    );
    Ok(json!({ "vault_path": resolved, "configured": configured }))
}

#[tauri::command]
fn app_config_set_vault(
    app: AppHandle,
    state: State<'_, BridgeState>,
    path: String,
) -> Result<Value, String> {
    apply_vault_path(&app, &state, &path)
}

#[tauri::command]
async fn pick_vault_folder(
    app: AppHandle,
    state: State<'_, BridgeState>,
    dialog_state: State<'_, DialogState>,
) -> Result<Option<Value>, String> {
    use tauri_plugin_dialog::DialogExt;

    dialog_state.0.store(true, Ordering::SeqCst);
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose your vault folder")
        .pick_folder(move |path| {
            let _ = tx.send(path);
        });
    let picked = rx.await.map_err(|_| "dialog cancelled".to_string());
    dialog_state.0.store(false, Ordering::SeqCst);

    let Some(file_path) = picked? else {
        return Ok(None); // user cancelled
    };
    let path_str = file_path.to_string();
    let result = apply_vault_path(&app, &state, &path_str)?;
    Ok(Some(result))
}

#[tauri::command]
fn clipboard_history(
    store: State<'_, Arc<Store>>,
    limit: Option<usize>,
) -> Result<Vec<ClipboardItem>, String> {
    store.list(limit.unwrap_or(100))
}

#[tauri::command]
fn clipboard_count(store: State<'_, Arc<Store>>) -> Result<i64, String> {
    store.count()
}

#[tauri::command]
fn clipboard_delete(store: State<'_, Arc<Store>>, id: i64) -> Result<(), String> {
    store.delete(id)
}

#[tauri::command]
fn clipboard_clear(store: State<'_, Arc<Store>>) -> Result<usize, String> {
    store.clear()
}

#[tauri::command]
fn clipboard_paste_image(store: State<'_, Arc<Store>>, id: i64) -> Result<(), String> {
    clipboard::paste_image_back(&store, id)
}

#[tauri::command]
fn set_pinned(
    app: AppHandle,
    pin: State<'_, PinState>,
    pinned: bool,
) -> Result<(), String> {
    pin.0.store(pinned, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("main") {
        win.set_always_on_top(pinned).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_pinned(pin: State<'_, PinState>) -> bool {
    pin.0.load(Ordering::SeqCst)
}

#[tauri::command]
fn hide_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show the window anchored to a screen position (typically the tray-icon
/// click position). The window opens just below the click, horizontally
/// centered on it, but clamped to stay on-screen. Emits `popover:anchor`
/// with the caret's x-position inside the window so the frontend can draw
/// the arrow pointing back at the tray icon.
fn show_window_anchored(app: &AppHandle, anchor: PhysicalPosition<f64>) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let scale = win.scale_factor().unwrap_or(1.0);
    let logical_anchor = LogicalPosition {
        x: anchor.x / scale,
        y: anchor.y / scale,
    };
    let mut window_x_logical = logical_anchor.x; // fallback if size fails
    let mut window_w_logical = 460.0;
    if let Ok(size) = win.outer_size() {
        window_w_logical = size.width as f64 / scale;
        let mut x = logical_anchor.x - window_w_logical / 2.0;
        // Tray sits at the top of the screen on macOS. Drop the popover
        // ~6 px below the menubar edge for visual breathing room.
        let y = logical_anchor.y + 6.0;
        // Clamp to monitor.
        if let Ok(Some(monitor)) = win.current_monitor() {
            let m_size = monitor.size();
            let m_w = m_size.width as f64 / scale;
            if x + window_w_logical > m_w - 4.0 {
                x = m_w - window_w_logical - 4.0;
            }
            if x < 4.0 {
                x = 4.0;
            }
        }
        window_x_logical = x;
        let _ = win.set_position(LogicalPosition { x, y });
    }
    let _ = win.show();
    let _ = win.set_focus();

    // Caret-x inside the window = where on the popover the arrow should sit.
    // Clamp away from the rounded corners so the arrow doesn't hang in space.
    let raw_caret_x = logical_anchor.x - window_x_logical;
    let caret_x = raw_caret_x.clamp(20.0, window_w_logical - 20.0);
    let _ = win.emit("popover:anchor", serde_json::json!({ "x": caret_x }));
}

/// Hotkey toggle: no anchor — open at last position or center if first show.
fn toggle_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        match win.is_visible() {
            Ok(true) => {
                let _ = win.hide();
            }
            _ => {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            vault_status,
            recall,
            load_memory,
            app_config_get,
            app_config_set_vault,
            pick_vault_folder,
            clipboard_history,
            clipboard_count,
            clipboard_delete,
            clipboard_clear,
            clipboard_paste_image,
            set_pinned,
            get_pinned,
            hide_window,
        ]);

    #[cfg(desktop)]
    {
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let target = Shortcut::new(
                            Some(Modifiers::SUPER | Modifiers::SHIFT),
                            Code::Space,
                        );
                        if shortcut == &target {
                            toggle_main_window(app);
                        }
                    }
                })
                .build(),
        );
    }

    builder
        .setup(|app| {
            // Clipboard store + background watcher
            let store = Arc::new(Store::open().map_err(|e| {
                eprintln!("[clipboard] store open failed: {}", e);
                std::io::Error::new(std::io::ErrorKind::Other, e)
            })?);
            clipboard::spawn_watcher(store.clone(), app.handle().clone());
            app.manage(store);

            // Bridge to @nexus-recall/core (Node sidecar) — env wins, then config.json
            let bridge = config::resolve_vault_path()
                .as_deref()
                .and_then(try_spawn_bridge);
            app.manage(BridgeState(std::sync::Mutex::new(bridge)));

            // Tray
            let show_item = MenuItem::with_id(app, "show", "Show Nexus", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                                return;
                            }
                        }
                        show_window_anchored(app, position);
                    }
                })
                .build(app)?;

            // Pin state — managed across commands and the focus handler
            app.manage(PinState(AtomicBool::new(false)));
            // Dialog state — true while a native picker is open, suppresses
            // auto-hide on focus loss so the picker doesn't orphan.
            app.manage(DialogState(AtomicBool::new(false)));

            // Native popover-window setup: cornerRadius drives the OS shadow
            // around the rounded shape, masksToBounds stays OFF so the caret
            // element above .app isn't clipped.
            #[cfg(target_os = "macos")]
            if let Some(win) = app.get_webview_window("main") {
                macos::configure_popover_window(&win, 12.0);
            }

            // Global shortcut: Cmd+Shift+Space
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::ShortcutState;
                let _ = ShortcutState::Pressed; // touch import
                let shortcut = Shortcut::new(
                    Some(Modifiers::SUPER | Modifiers::SHIFT),
                    Code::Space,
                );
                app.global_shortcut().register(shortcut)?;
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // Hide instead of quit — menubar app stays alive in tray.
                let _ = window.hide();
                api.prevent_close();
            }
            WindowEvent::Focused(false) => {
                // Auto-hide on focus loss UNLESS pinned or a dialog is open.
                let app = window.app_handle();
                let pinned = app
                    .try_state::<PinState>()
                    .map(|s| s.0.load(Ordering::SeqCst))
                    .unwrap_or(false);
                let dialog_open = app
                    .try_state::<DialogState>()
                    .map(|s| s.0.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if !pinned && !dialog_open && window.label() == "main" {
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
