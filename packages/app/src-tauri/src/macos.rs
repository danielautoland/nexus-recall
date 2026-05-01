//! Native macOS window tweaks.
//!
//! transparent: true + macOSPrivateApi: true gives us a transparent
//! WebView, but the underlying NSWindow needs three flags set
//! defensively to actually show through:
//!   - setOpaque(false)              — window can have transparent areas
//!   - setBackgroundColor(clearColor) — no opaque default fill behind the
//!                                      WebView (this is what was leaking
//!                                      black under the rounded corners)
//!   - setHasShadow(true)            — let macOS draw the ambient shadow
//!                                      around the visible silhouette
//!                                      (the opaque CSS .app pixels)
//! No cornerRadius / no contentView mask — the visible shape is whatever
//! the CSS .app rounded box paints.

use objc2::class;
use objc2::msg_send;
use objc2::runtime::AnyObject;

pub fn configure_popover_window(window: &tauri::WebviewWindow) {
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
        let _: () = msg_send![ns_window, setOpaque: false];
        // NSColor clearColor → fully transparent background fill
        let ns_color_class = class!(NSColor);
        let clear: *mut AnyObject = msg_send![ns_color_class, clearColor];
        if !clear.is_null() {
            let _: () = msg_send![ns_window, setBackgroundColor: clear];
        }
        // Let macOS render the ambient shadow around the opaque silhouette
        // (the CSS .app pixels); no cornerRadius, no contentView mask.
        let _: () = msg_send![ns_window, setHasShadow: true];
    }
}
