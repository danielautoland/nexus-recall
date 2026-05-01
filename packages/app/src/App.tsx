import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Titlebar } from "./Titlebar";
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

  useEffect(() => {
    let active = true;
    const tick = () => {
      invoke<number>("clipboard_count")
        .then((n) => active && setClipboardCount(n))
        .catch(() => {});
    };
    tick();
    let unlistenFn: (() => void) | null = null;
    listen("clipboard:changed", () => tick()).then((un) => {
      unlistenFn = un;
    });
    const handle = setInterval(tick, 10_000);
    return () => {
      active = false;
      clearInterval(handle);
      if (unlistenFn) unlistenFn();
    };
  }, []);

  return (
    <div className="app">
      <Titlebar
        vaultSize={vaultSize}
        clipboardCount={clipboardCount}
        tab={tab}
        onTabChange={setTab}
      />
      <div className="content">
        {tab === "memory" ? <MemoryTab /> : <ClipboardTab />}
      </div>
    </div>
  );
}
