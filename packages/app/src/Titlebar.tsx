import { invoke } from "@tauri-apps/api/core";

interface Props {
  vaultSize: number | null;
  clipboardCount: number | null;
  tab: "memory" | "clipboard";
  onTabChange: (t: "memory" | "clipboard") => void;
  pinned: boolean;
  onPinnedChange: (p: boolean) => void;
}

export function Titlebar({
  vaultSize,
  clipboardCount,
  tab,
  onTabChange,
  pinned,
  onPinnedChange,
}: Props) {
  const togglePin = async () => {
    const next = !pinned;
    try {
      await invoke("set_pinned", { pinned: next });
      onPinnedChange(next);
    } catch {
      // ignore
    }
  };

  const close = async () => {
    try {
      await invoke("hide_window");
    } catch {
      // ignore
    }
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="brand" data-tauri-drag-region>
          nexus
        </span>
        <nav className="tabs" data-tauri-drag-region={false}>
          <button
            className={tab === "memory" ? "tab active" : "tab"}
            onClick={() => onTabChange("memory")}
          >
            memory
            <span className="badge">{vaultSize ?? "…"}</span>
          </button>
          <button
            className={tab === "clipboard" ? "tab active" : "tab"}
            onClick={() => onTabChange("clipboard")}
          >
            clipboard
            <span className="badge">{clipboardCount ?? "…"}</span>
          </button>
        </nav>
      </div>
      <div className="titlebar-actions">
        <button
          className={pinned ? "icon-btn pinned" : "icon-btn"}
          onClick={togglePin}
          title={pinned ? "Unpin (auto-hide on focus loss)" : "Pin (keep visible always)"}
          aria-label="pin"
        >
          {/* pin icon: rotated thumbtack */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L8 6v6l-3 3v3h14v-3l-3-3V6l-4-4z" />
            <line x1="12" y1="18" x2="12" y2="22" />
          </svg>
        </button>
        <button
          className="icon-btn"
          onClick={close}
          title="Hide"
          aria-label="close"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
