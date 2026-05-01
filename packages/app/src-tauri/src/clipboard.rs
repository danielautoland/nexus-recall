//! Clipboard observer + SQLite-backed history.
//!
//! Polls the system clipboard at a fixed interval. When the text
//! content changes, hashes it and either inserts a new row or bumps
//! `copy_count` + `last_copied_at` on the existing one.
//!
//! Storage: ~/.nexus-recall/clipboard.db (out-of-vault on purpose,
//! same dir convention as the daemon's telemetry logs).
//!
//! Privacy / scope-cut for this iteration:
//! - Text only (image clipboard ignored).
//! - No source-app detection yet (NSWorkspace integration deferred).
//! - No exclusion list yet — Daniel adds Banking/Password apps later.

use arboard::Clipboard;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

const POLL_INTERVAL_MS: u64 = 700;
const MAX_CONTENT_LEN: usize = 100_000; // hard cap to keep DB sane

#[derive(Serialize, Clone)]
pub struct ClipboardItem {
    pub id: i64,
    pub content: String,
    pub content_type: String,
    pub source_app: Option<String>,
    pub first_copied_at: i64,
    pub last_copied_at: i64,
    pub copy_count: i64,
    pub promoted_to_memory_id: Option<String>,
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
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        init_schema(&conn).map_err(|e| e.to_string())?;
        Ok(Store {
            conn: Mutex::new(conn),
        })
    }

    pub fn upsert(&self, content: &str) -> Result<(), String> {
        if content.is_empty() || content.len() > MAX_CONTENT_LEN {
            return Ok(());
        }
        let hash = sha256_hex(content);
        let now = now_unix();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Try update first; if no row matched, insert.
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
        Ok(())
    }

    pub fn list(&self, limit: usize) -> Result<Vec<ClipboardItem>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, content, content_type, source_app,
                        first_copied_at, last_copied_at, copy_count, promoted_to_memory_id
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
        conn.execute("DELETE FROM clipboard_items WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear(&self) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let n = conn
            .execute("DELETE FROM clipboard_items", [])
            .map_err(|e| e.to_string())?;
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
}

pub fn spawn_watcher(store: std::sync::Arc<Store>) {
    thread::spawn(move || {
        let mut clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[clipboard] could not init: {}", e);
                return;
            }
        };
        let mut last: Option<String> = None;
        loop {
            thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
            match clipboard.get_text() {
                Ok(text) => {
                    if last.as_deref() != Some(text.as_str()) {
                        if let Err(e) = store.upsert(&text) {
                            eprintln!("[clipboard] upsert failed: {}", e);
                        }
                        last = Some(text);
                    }
                }
                Err(arboard::Error::ContentNotAvailable) => {
                    // image-only or empty — ignore
                }
                Err(e) => {
                    // transient errors on macOS happen; log and keep polling
                    eprintln!("[clipboard] read failed: {}", e);
                }
            }
        }
    });
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
    )
}

fn db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
    Ok(home.join(".nexus-recall").join("clipboard.db"))
}

fn sha256_hex(s: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
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
    })
}
