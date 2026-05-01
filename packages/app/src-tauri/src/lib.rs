mod bridge;
mod clipboard;
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

/// Optional because the bridge can fail to spawn (no NEXUS_VAULT_PATH set,
/// node not found, etc). The clipboard tab still works without it.
pub struct BridgeState(pub Option<Arc<Bridge>>);

#[tauri::command]
async fn vault_status(state: State<'_, BridgeState>) -> Result<Value, String> {
    let Some(bridge) = state.0.clone() else {
        return Ok(json!({ "size": 0, "error": "vault not configured (set NEXUS_VAULT_PATH)" }));
    };
    bridge.request("vault_status", json!({})).await
}

#[tauri::command]
async fn recall(
    state: State<'_, BridgeState>,
    query: String,
    k: Option<usize>,
    scope: Option<String>,
    r#type: Option<String>,
) -> Result<Value, String> {
    let Some(bridge) = state.0.clone() else {
        return Err("vault not configured (set NEXUS_VAULT_PATH and restart)".to_string());
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
    let Some(bridge) = state.0.clone() else {
        return Err("vault not configured".to_string());
    };
    bridge.request("load_memory", json!({ "id": id })).await
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
        .invoke_handler(tauri::generate_handler![
            vault_status,
            recall,
            load_memory,
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

            // Bridge to @nexus-recall/core (Node sidecar)
            let bridge = match std::env::var("NEXUS_VAULT_PATH") {
                Ok(vault) if !vault.is_empty() => {
                    let script = bridge::dev_script_path();
                    match Bridge::start("node", &script, &vault) {
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
                _ => {
                    eprintln!("[bridge] NEXUS_VAULT_PATH not set — memory tab disabled");
                    None
                }
            };
            app.manage(BridgeState(bridge));

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
                // Auto-hide on focus loss UNLESS pinned.
                let app = window.app_handle();
                let pinned = app
                    .try_state::<PinState>()
                    .map(|s| s.0.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if !pinned && window.label() == "main" {
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
