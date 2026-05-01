import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface RecallHit {
  id: string;
  title: string;
  type: string;
  scope: string;
  summary: string;
  score: number;
}

export function App() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<RecallHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [vaultSize, setVaultSize] = useState<number | null>(null);

  useEffect(() => {
    invoke<{ size: number }>("vault_status")
      .then((s) => setVaultSize(s.size))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const handle = setTimeout(() => {
      invoke<RecallHit[]>("recall", { query, k: 10 })
        .then(setHits)
        .catch((e) => setError(String(e)));
    }, 80);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="app">
      <header>
        <h1>nexus</h1>
        <span className="vault-size">
          {vaultSize !== null ? `${vaultSize} memorys` : "loading…"}
        </span>
      </header>
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
      </ul>
    </div>
  );
}
