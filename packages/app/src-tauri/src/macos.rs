//! Native macOS window tweaks.
//!
//! Tauri's transparent + macOSPrivateApi setup makes the WebView canvas
//! transparent, but the NSWindow's content layer still clips to a square.
//! CSS border-radius on .app makes the *content* round, however the
//! NSWindow drop-shadow + click hit-area follow the NSWindow shape, not
//! the HTML — so corners look "broken" near the shadow edge.
//!
//! Fix: set the NSWindow's contentView CALayer cornerRadius. macOS then
//! clips drop-shadow + hit-region to the rounded shape we want.

use objc2::msg_send;
use objc2::runtime::AnyObject;

pub fn apply_window_corner_radius(window: &tauri::WebviewWindow, radius: f64) {
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
        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        if content_view.is_null() {
            return;
        }
        let _: () = msg_send![content_view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![content_view, layer];
        if layer.is_null() {
            return;
        }
        let _: () = msg_send![layer, setCornerRadius: radius];
        let _: () = msg_send![layer, setMasksToBounds: true];
    }
}
