import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ClipboardItem {
  id: number;
  content: string;
  content_type: string;
  source_app: string | null;
  first_copied_at: number;
  last_copied_at: number;
  copy_count: number;
  promoted_to_memory_id: string | null;
}

export function ClipboardTab() {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    invoke<ClipboardItem[]>("clipboard_history", { limit: 200 })
      .then((rows) => {
        setItems(rows);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
    // The watcher polls at ~700ms — refresh UI ~1.5s so we don't miss copies.
    const handle = setInterval(load, 1500);
    return () => clearInterval(handle);
  }, [load]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return items;
    const q = filter.toLowerCase();
    return items.filter((i) => i.content.toLowerCase().includes(q));
  }, [items, filter]);

  const copyBack = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // fallback: select+copy via hidden textarea is not needed in Tauri
    }
  };

  const remove = async (id: number) => {
    try {
      await invoke("clipboard_delete", { id });
      load();
    } catch (e) {
      setError(String(e));
    }
  };

  const clearAll = async () => {
    if (!confirm("Delete all clipboard history?")) return;
    try {
      await invoke<number>("clipboard_clear");
      load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <>
      <div className="clipboard-toolbar">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter clipboard history…"
        />
        <button className="ghost" onClick={clearAll} disabled={!items.length}>
          clear all
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      <ul className="hits">
        {filtered.map((it) => (
          <li key={it.id} className="clip-item">
            <div className="clip-content">{truncate(it.content, 280)}</div>
            <div className="clip-meta">
              <span className="time">{formatRelative(it.last_copied_at)}</span>
              {it.copy_count > 1 && (
                <span className="count">×{it.copy_count}</span>
              )}
              <span className="bytes">{it.content.length}b</span>
              <button className="link" onClick={() => copyBack(it.content)}>
                copy
              </button>
              <button className="link danger" onClick={() => remove(it.id)}>
                delete
              </button>
            </div>
          </li>
        ))}
        {!filtered.length && (
          <li className="empty">
            {items.length
              ? "no items match filter"
              : "no clipboard history yet — copy something"}
          </li>
        )}
      </ul>
    </>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

function formatRelative(unixSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSec;
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
