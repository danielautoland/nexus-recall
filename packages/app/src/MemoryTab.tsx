import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface RecallHit {
  id: string;
  title: string;
  type: string;
  scope: string;
  summary: string;
  score: number;
}

interface VaultStatus {
  size?: number;
  configured?: boolean;
}

export function MemoryTab() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<RecallHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await invoke<VaultStatus>("vault_status");
      setConfigured(!!s.configured);
    } catch {
      setConfigured(false);
    }
    try {
      const cfg = await invoke<{ vault_path: string | null; env_vault_path: string | null }>(
        "app_config_get",
      );
      setVaultPath(cfg.env_vault_path ?? cfg.vault_path);
    } catch {
      setVaultPath(null);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    let unlistenFn: (() => void) | null = null;
    listen("vault:reconfigured", () => refreshStatus()).then((un) => {
      unlistenFn = un;
    });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (!configured) {
      setHits([]);
      return;
    }
    if (!query.trim()) {
      setHits([]);
      setError(null);
      return;
    }
    const handle = setTimeout(() => {
      invoke<RecallHit[]>("recall", { query, k: 10 })
        .then((r) => {
          setHits(r);
          setError(null);
        })
        .catch((e) => setError(String(e)));
    }, 80);
    return () => clearTimeout(handle);
  }, [query, configured]);

  const chooseFolder = async () => {
    setBusy(true);
    try {
      // Single backend command: opens picker AND applies the result, so the
      // dialog-open flag stays set across the focus-loss caused by the picker.
      const result = await invoke<{ vault_path: string; configured: boolean } | null>(
        "pick_vault_folder",
      );
      if (!result) return; // user cancelled
      setVaultPath(result.vault_path);
      setConfigured(result.configured);
      if (!result.configured) {
        setError("vault selected but bridge failed to start — check logs");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (configured === null) {
    return <div className="empty">loading…</div>;
  }

  if (!configured) {
    return (
      <div className="setup">
        <div className="setup-card">
          <h2>Choose your vault</h2>
          <p>
            Nexus indexes a folder of <code>.md</code> memorys with YAML
            frontmatter — typically a subfolder of your Obsidian vault.
          </p>
          {vaultPath && (
            <p className="muted">
              Last set: <code>{vaultPath}</code>
            </p>
          )}
          <button className="primary" onClick={chooseFolder} disabled={busy}>
            {busy ? "Connecting…" : "Choose folder…"}
          </button>
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="search your memory…"
      />
      {error && <div className="error">{error}</div>}
      <ul className="hits">
        {hits.map((h) => (
          <li key={h.id}>
            <div className="hit-title">{h.title}</div>
            <div className="hit-meta">
              <span className={`type type-${h.type}`}>{h.type}</span>
              <span className="scope">{h.scope}</span>
              <span className="score">{h.score.toFixed(1)}</span>
            </div>
            <div className="hit-summary">{h.summary}</div>
          </li>
        ))}
        {!hits.length && query.trim() && !error && (
          <li className="empty">no hits</li>
        )}
      </ul>
    </>
  );
}
