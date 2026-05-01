//! Clipboard observer + SQLite-backed history.
//!
//! Polls the system clipboard. Supports text AND images (e.g.
//! macOS Cmd+Shift+Ctrl+4 screenshots that go straight to the
//! clipboard). On change, persists into SQLite; for images, the
//! full PNG goes to disk and a small base64 thumbnail goes into
//! the DB row for instant list rendering.
//!
//! Storage:
//! - DB:        ~/.nexus-recall/clipboard.db
//! - Full PNGs: ~/.nexus-recall/clipboard-images/<sha256>.png

use arboard::{Clipboard, ImageData};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use image::{DynamicImage, ImageFormat, RgbaImage};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const POLL_INTERVAL_MS: u64 = 250;
const MAX_TEXT_LEN: usize = 100_000;
const THUMB_MAX_DIM: u32 = 240;
const SCHEMA_VERSION: i32 = 1;

#[derive(Serialize, Clone)]
pub struct ClipboardItem {
    pub id: i64,
    pub content: String,
    pub content_type: String, // "text" | "image"
    pub source_app: Option<String>,
    pub first_copied_at: i64,
    pub last_copied_at: i64,
    pub copy_count: i64,
    pub promoted_to_memory_id: Option<String>,
    pub image_path: Option<String>,
    pub image_width: Option<i64>,
    pub image_height: Option<i64>,
    pub image_thumb_b64: Option<String>, // data:image/png;base64,...
}

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open() -> Result<Self, String> {
        let path = db_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::create_dir_all(images_dir()?).map_err(|e| e.to_string())?;
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        init_schema(&conn).map_err(|e| e.to_string())?;
        Ok(Store {
            conn: Mutex::new(conn),
        })
    }

    pub fn upsert_text(&self, content: &str) -> Result<bool, String> {
        if content.is_empty() || content.len() > MAX_TEXT_LEN {
            return Ok(false);
        }
        let hash = sha256_hex(content.as_bytes());
        let now = now_unix();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let updated = conn
            .execute(
                "UPDATE clipboard_items
                   SET copy_count = copy_count + 1,
                       last_copied_at = ?1
                 WHERE hash_sha256 = ?2",
                params![now, hash],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            conn.execute(
                "INSERT INTO clipboard_items
                   (hash_sha256, content, content_type, first_copied_at, last_copied_at)
                 VALUES (?1, ?2, 'text', ?3, ?3)",
                params![hash, content, now],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(true)
    }

    /// Persist an image clipboard entry. Writes full PNG to disk,
    /// stores thumbnail-base64 + size + path in the DB row.
    pub fn upsert_image(&self, img: &ImageData<'_>) -> Result<bool, String> {
        if img.width == 0 || img.height == 0 || img.bytes.is_empty() {
            return Ok(false);
        }
        let raw_hash = sha256_hex(&img.bytes);
        let now = now_unix();

        // Build full PNG once; we need it for both disk + (potentially) the
        // thumbnail source.
        let rgba = RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.to_vec())
            .ok_or_else(|| "rgba buffer size mismatch".to_string())?;
        let dyn_img = DynamicImage::ImageRgba8(rgba);

        let images_root = images_dir()?;
        let png_path = images_root.join(format!("{}.png", raw_hash));
        if !png_path.exists() {
            dyn_img
                .save_with_format(&png_path, ImageFormat::Png)
                .map_err(|e| format!("png save: {}", e))?;
        }

        // Thumbnail
        let thumb = dyn_img.thumbnail(THUMB_MAX_DIM, THUMB_MAX_DIM);
        let mut thumb_buf: Vec<u8> = Vec::with_capacity(8 * 1024);
        thumb
            .write_to(&mut Cursor::new(&mut thumb_buf), ImageFormat::Png)
            .map_err(|e| format!("thumb encode: {}", e))?;
        let thumb_b64 = format!("data:image/png;base64,{}", B64.encode(&thumb_buf));

        let png_path_str = png_path.to_string_lossy().into_owned();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let updated = conn
            .execute(
                "UPDATE clipboard_items
                   SET copy_count = copy_count + 1,
                       last_copied_at = ?1
                 WHERE hash_sha256 = ?2",
                params![now, raw_hash],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            conn.execute(
                "INSERT INTO clipboard_items
                   (hash_sha256, content, content_type, first_copied_at, last_copied_at,
                    image_path, image_width, image_height, image_thumb_b64)
                 VALUES (?1, '', 'image', ?2, ?2, ?3, ?4, ?5, ?6)",
                params![
                    raw_hash,
                    now,
                    png_path_str,
                    img.width as i64,
                    img.height as i64,
                    thumb_b64
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(true)
    }

    pub fn list(&self, limit: usize) -> Result<Vec<ClipboardItem>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, content, content_type, source_app,
                        first_copied_at, last_copied_at, copy_count, promoted_to_memory_id,
                        image_path, image_width, image_height, image_thumb_b64
                   FROM clipboard_items
                  ORDER BY last_copied_at DESC
                  LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit as i64], row_to_item)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn delete(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Best-effort: remove the on-disk PNG too if this row was the last
        // pointer to it. Cheap heuristic: just delete the file silently;
        // if another row shares it, the file gets re-created on next copy.
        let path: Option<String> = conn
            .query_row(
                "SELECT image_path FROM clipboard_items WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM clipboard_items WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if let Some(p) = path {
            let _ = std::fs::remove_file(p);
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let n = conn
            .execute("DELETE FROM clipboard_items", [])
            .map_err(|e| e.to_string())?;
        // Wipe the images dir as well — nothing references it anymore.
        if let Ok(dir) = images_dir() {
            let _ = std::fs::remove_dir_all(&dir);
            let _ = std::fs::create_dir_all(&dir);
        }
        Ok(n)
    }

    pub fn count(&self) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM clipboard_items", [], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(0);
        Ok(n)
    }

    pub fn image_path_for(&self, id: i64) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let path: Option<String> = conn
            .query_row(
                "SELECT image_path FROM clipboard_items
                  WHERE id = ?1 AND content_type = 'image'",
                params![id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        Ok(path)
    }
}

/// Read the on-disk PNG for the given clipboard item back into the system
/// clipboard. The watcher will see the new contents on its next poll and
/// bump copy_count via the hash-dedup path.
pub fn paste_image_back(store: &Store, id: i64) -> Result<(), String> {
    let path = store
        .image_path_for(id)?
        .ok_or_else(|| "item is not an image".to_string())?;
    let img =
        image::open(&path).map_err(|e| format!("read png {}: {}", path, e))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let bytes = rgba.into_raw();
    let mut clipboard = Clipboard::new().map_err(|e| format!("clipboard init: {}", e))?;
    clipboard
        .set_image(ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(bytes),
        })
        .map_err(|e| format!("set_image: {}", e))?;
    Ok(())
}

pub fn spawn_watcher(store: std::sync::Arc<Store>, app: AppHandle) {
    thread::spawn(move || {
        let mut clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[clipboard] could not init: {}", e);
                return;
            }
        };
        // Seed last-state with whatever's already on the clipboard so we
        // don't record the first read on app start as a "new copy".
        let mut last_text: Option<String> = clipboard.get_text().ok();
        let mut last_image_hash: Option<String> =
            clipboard.get_image().ok().map(|img| sha256_hex(&img.bytes));

        loop {
            thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));

            // Try text first; if not text, try image. Some apps put both —
            // text wins (it's cheaper to render and usually richer).
            match clipboard.get_text() {
                Ok(text) => {
                    if last_text.as_deref() != Some(text.as_str()) {
                        match store.upsert_text(&text) {
                            Ok(true) => emit(&app),
                            Ok(false) => {}
                            Err(e) => eprintln!("[clipboard] text upsert: {}", e),
                        }
                        last_text = Some(text);
                        last_image_hash = None; // invalidate
                    }
                    continue;
                }
                Err(arboard::Error::ContentNotAvailable) => {} // fall through to image
                Err(e) => {
                    eprintln!("[clipboard] read text failed: {}", e);
                    continue;
                }
            }

            match clipboard.get_image() {
                Ok(img) => {
                    let h = sha256_hex(&img.bytes);
                    if last_image_hash.as_deref() != Some(h.as_str()) {
                        match store.upsert_image(&img) {
                            Ok(true) => emit(&app),
                            Ok(false) => {}
                            Err(e) => eprintln!("[clipboard] image upsert: {}", e),
                        }
                        last_image_hash = Some(h);
                        last_text = None;
                    }
                }
                Err(arboard::Error::ContentNotAvailable) => {
                    // truly empty — ignore
                }
                Err(e) => {
                    eprintln!("[clipboard] read image failed: {}", e);
                }
            }
        }
    });
}

fn emit(app: &AppHandle) {
    if let Err(e) = app.emit("clipboard:changed", ()) {
        eprintln!("[clipboard] emit failed: {}", e);
    }
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS clipboard_items (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             hash_sha256 TEXT NOT NULL UNIQUE,
             content TEXT NOT NULL,
             content_type TEXT NOT NULL DEFAULT 'text',
             source_app TEXT,
             first_copied_at INTEGER NOT NULL,
             last_copied_at INTEGER NOT NULL,
             copy_count INTEGER NOT NULL DEFAULT 1,
             promoted_to_memory_id TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_last_copied_at
             ON clipboard_items(last_copied_at DESC);",
    )?;

    let version: i32 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if version < 1 {
        // V0 → V1: add image columns. ALTER is idempotent enough here
        // because user_version gates the migration.
        conn.execute_batch(
            "ALTER TABLE clipboard_items ADD COLUMN image_path TEXT;
             ALTER TABLE clipboard_items ADD COLUMN image_width INTEGER;
             ALTER TABLE clipboard_items ADD COLUMN image_height INTEGER;
             ALTER TABLE clipboard_items ADD COLUMN image_thumb_b64 TEXT;",
        )?;
    }
    conn.execute(
        &format!("PRAGMA user_version = {}", SCHEMA_VERSION),
        [],
    )?;
    Ok(())
}

fn db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
    Ok(home.join(".nexus-recall").join("clipboard.db"))
}

fn images_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
    Ok(home.join(".nexus-recall").join("clipboard-images"))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let bytes = hasher.finalize();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<ClipboardItem> {
    Ok(ClipboardItem {
        id: row.get(0)?,
        content: row.get(1)?,
        content_type: row.get(2)?,
        source_app: row.get(3)?,
        first_copied_at: row.get(4)?,
        last_copied_at: row.get(5)?,
        copy_count: row.get(6)?,
        promoted_to_memory_id: row.get(7)?,
        image_path: row.get(8)?,
        image_width: row.get(9)?,
        image_height: row.get(10)?,
        image_thumb_b64: row.get(11)?,
    })
}
