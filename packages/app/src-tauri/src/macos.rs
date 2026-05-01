//! Native macOS window tweaks.
//!
//! Goal: get a clean rounded popover silhouette including the OS
//! drop-shadow, while still allowing the caret to render *outside*
//! the .app rounded box (so it can point up at the tray icon).
//!
//! Key trick: set `cornerRadius` on the contentView's CALayer but
//! leave `masksToBounds = false`. macOS uses the layer's shape to
//! generate the window shadow, but children (the caret element)
//! are not clipped and remain visible above the rounded box.
//!
//! Also: explicitly set the NSWindow opaque/background flags. Tauri
//! does most of this when `transparent: true`, but doing it again
//! defensively avoids a class of "looks square on first paint" bugs.

use objc2::msg_send;
use objc2::runtime::AnyObject;

pub fn configure_popover_window(window: &tauri::WebviewWindow, radius: f64) {
    let raw = match window.ns_window() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[macos] ns_window unavailable: {}", e);
            return;
        }
    };
    unsafe {
        let ns_window = raw as *mut AnyObject;
        if ns_window.is_null() {
            return;
        }

        // Make sure the window draws as transparent and casts a real shadow
        // around the visible (i.e. CSS-painted) silhouette.
        let _: () = msg_send![ns_window, setOpaque: false];
        let _: () = msg_send![ns_window, setHasShadow: true];

        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        if content_view.is_null() {
            return;
        }
        let _: () = msg_send![content_view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![content_view, layer];
        if layer.is_null() {
            return;
        }
        // cornerRadius alone => the OS shadow follows the rounded shape.
        // We deliberately leave masksToBounds = false so the caret element
        // (which sits outside the .app rounded box) isn't clipped.
        let _: () = msg_send![layer, setCornerRadius: radius];
    }
}
