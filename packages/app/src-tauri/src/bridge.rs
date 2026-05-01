//! Bridge to the @nexus-recall/core library running as a Node sidecar.
//!
//! Spawn the daemon's `bridge.js` once on app startup, then send line-JSON
//! requests over stdin and match responses by id on the stdout reader
//! thread. Responses fan out to per-call tokio oneshot channels, so each
//! Tauri command can `.await` its own answer.
//!
//! Why not call @nexus-recall/core directly: the core is Node-only
//! (chokidar, gray-matter, minisearch). Reimplementing it in Rust would
//! fork the codebase. A persistent subprocess is the smallest bridge
//! that keeps a single source of truth.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tokio::sync::oneshot;

#[derive(Serialize)]
struct Request<'a> {
    id: u64,
    method: &'a str,
    params: Value,
}

#[derive(Deserialize)]
struct Response {
    id: u64,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<ResponseError>,
}

#[derive(Deserialize)]
struct ResponseError {
    message: String,
}

pub struct Bridge {
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    next_id: AtomicU64,
    // Held to keep the child alive; not directly used but dropping it would kill the process.
    _child: Mutex<Child>,
}

impl Bridge {
    pub fn start(node: &str, script: &PathBuf, vault_path: &str) -> Result<Arc<Self>, String> {
        let mut child = Command::new(node)
            .arg(script)
            .env("NEXUS_VAULT_PATH", vault_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("spawn bridge ({}): {}", script.display(), e))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "no stdin on bridge child".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "no stdout on bridge child".to_string())?;

        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Reader thread: parse one JSON object per line, dispatch to waiters.
        let pending_reader = pending.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };
                let resp: Response = match serde_json::from_str(&line) {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("[bridge] bad reply: {} ({})", line, e);
                        continue;
                    }
                };
                let payload = if let Some(err) = resp.error {
                    Err(err.message)
                } else {
                    Ok(resp.result.unwrap_or(Value::Null))
                };
                if let Some(tx) = pending_reader.lock().unwrap().remove(&resp.id) {
                    let _ = tx.send(payload);
                }
            }
            eprintln!("[bridge] stdout reader exited");
            // Fail all in-flight requests so they don't hang.
            let mut p = pending_reader.lock().unwrap();
            for (_id, tx) in p.drain() {
                let _ = tx.send(Err("bridge process exited".to_string()));
            }
        });

        Ok(Arc::new(Self {
            stdin: Mutex::new(stdin),
            pending,
            next_id: AtomicU64::new(1),
            _child: Mutex::new(child),
        }))
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = Request { id, method, params };
        let line = serde_json::to_string(&req).map_err(|e| format!("encode: {}", e))?;

        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);

        {
            let mut stdin = self
                .stdin
                .lock()
                .map_err(|_| "stdin poisoned".to_string())?;
            writeln!(stdin, "{}", line).map_err(|e| format!("write: {}", e))?;
            stdin.flush().map_err(|e| format!("flush: {}", e))?;
        }

        rx.await
            .map_err(|_| "bridge response channel dropped".to_string())?
    }
}

/// Resolve the bridge.js path. In dev (cargo build), CARGO_MANIFEST_DIR
/// points at packages/app/src-tauri, so the script lives at
/// ../../daemon/dist/bridge.js relative to it.
pub fn dev_script_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .join("../../daemon/dist/bridge.js")
        .canonicalize()
        .unwrap_or_else(|_| {
            PathBuf::from(manifest_dir).join("../../daemon/dist/bridge.js")
        })
}
