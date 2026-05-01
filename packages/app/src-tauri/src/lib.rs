mod clipboard;

use clipboard::{ClipboardItem, Store};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Serialize)]
struct VaultStatus {
    size: usize,
}

#[derive(Serialize, Deserialize, Clone)]
struct RecallHit {
    id: String,
    title: String,
    #[serde(rename = "type")]
    memory_type: String,
    scope: String,
    summary: String,
    score: f64,
}

// SPIKE: returns mock data so we can validate the Tauri stack end-to-end
// (window, tray, hotkey, IPC, frontend rendering) before wiring the real
// @nexus-recall/core bridge. Bridge lands in the next iteration.
#[tauri::command]
fn vault_status() -> VaultStatus {
    VaultStatus { size: 64 }
}

#[tauri::command]
fn recall(query: String, _k: Option<usize>) -> Vec<RecallHit> {
    if query.trim().is_empty() {
        return vec![];
    }
    let q = query.to_lowercase();
    let mock: Vec<RecallHit> = vec![
        RecallHit {
            id: "mock-scrollbar".into(),
            title: "Don't stack focus styles on inputs".into(),
            memory_type: "lesson".into(),
            scope: "all-projects".into(),
            summary: "Stacking ring + outline + custom :focus on nested inputs causes double focus rings.".into(),
            score: 280.5,
        },
        RecallHit {
            id: "mock-no-overengineering".into(),
            title: "nexus-recall: nicht über-engineeren".into(),
            memory_type: "preference".into(),
            scope: "nexus-recall".into(),
            summary: "Pragmatisch bleiben. Minimum das funktioniert, dann im Gebrauch verfeinern.".into(),
            score: 212.9,
        },
        RecallHit {
            id: "mock-best-memory-tool".into(),
            title: "Ambition: das beste Memory-Tool für KI-Agenten".into(),
            memory_type: "preference".into(),
            scope: "nexus-recall".into(),
            summary: "Ziel ist nicht 'gut genug', sondern THE beste Memory-Lösung für KI-Agenten.".into(),
            score: 96.8,
        },
    ];
    mock.into_iter()
        .filter(|h| {
            h.title.to_lowercase().contains(&q)
                || h.summary.to_lowercase().contains(&q)
                || h.scope.to_lowercase().contains(&q)
                || q.is_empty()
        })
        .collect()
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
            clipboard_history,
            clipboard_count,
            clipboard_delete,
            clipboard_clear,
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
            clipboard::spawn_watcher(store.clone());
            app.manage(store);

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
