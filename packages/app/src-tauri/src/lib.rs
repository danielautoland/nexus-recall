mod bridge;
mod clipboard;

use bridge::Bridge;
use clipboard::{ClipboardItem, Store};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide instead of quit — menubar app stays alive in tray.
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
