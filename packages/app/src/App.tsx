import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MemoryTab } from "./MemoryTab";
import { ClipboardTab } from "./ClipboardTab";

type Tab = "memory" | "clipboard";

export function App() {
  const [tab, setTab] = useState<Tab>("memory");
  const [vaultSize, setVaultSize] = useState<number | null>(null);
  const [clipboardCount, setClipboardCount] = useState<number | null>(null);

  useEffect(() => {
    invoke<{ size: number }>("vault_status")
      .then((s) => setVaultSize(s.size))
      .catch(() => setVaultSize(0));
  }, []);

  // Refresh clipboard count when on clipboard tab and periodically.
  useEffect(() => {
    let active = true;
    const tick = () => {
      invoke<number>("clipboard_count")
        .then((n) => active && setClipboardCount(n))
        .catch(() => {});
    };
    tick();
    const handle = setInterval(tick, 2000);
    return () => {
      active = false;
      clearInterval(handle);
    };
  }, []);

  return (
    <div className="app">
      <header>
        <h1>nexus</h1>
        <nav className="tabs">
          <button
            className={tab === "memory" ? "tab active" : "tab"}
            onClick={() => setTab("memory")}
          >
            memory
            <span className="badge">{vaultSize ?? "…"}</span>
          </button>
          <button
            className={tab === "clipboard" ? "tab active" : "tab"}
            onClick={() => setTab("clipboard")}
          >
            clipboard
            <span className="badge">{clipboardCount ?? "…"}</span>
          </button>
        </nav>
      </header>
      {tab === "memory" ? <MemoryTab /> : <ClipboardTab />}
    </div>
  );
}
