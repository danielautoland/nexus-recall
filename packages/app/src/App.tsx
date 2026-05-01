import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Titlebar } from "./Titlebar";
import { MemoryTab } from "./MemoryTab";
import { ClipboardTab } from "./ClipboardTab";

type Tab = "memory" | "clipboard";

const FADE_DELAY_MS = 700;

export function App() {
  const [tab, setTab] = useState<Tab>("memory");
  const [vaultSize, setVaultSize] = useState<number | null>(null);
  const [clipboardCount, setClipboardCount] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [faded, setFaded] = useState(false);
  const fadeTimer = useRef<number | null>(null);

  useEffect(() => {
    invoke<{ size: number }>("vault_status")
      .then((s) => setVaultSize(s.size))
      .catch(() => setVaultSize(0));
    invoke<boolean>("get_pinned").then(setPinned).catch(() => {});
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

  // Caret position from the Rust-side anchor event
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ x: number }>("popover:anchor", (e) => {
      document.documentElement.style.setProperty("--caret-x", `${e.payload.x}px`);
      // Reset fade whenever a fresh open happens
      setFaded(false);
    }).then((un) => {
      unlisten = un;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Fade-on-idle: only when pinned, the popover dims to 10% after the user
  // hasn't hovered it for FADE_DELAY_MS — so it can stay parked beside other
  // windows without competing visually.
  useEffect(() => {
    if (!pinned) {
      setFaded(false);
      if (fadeTimer.current !== null) {
        window.clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
      return;
    }
    // Pinned but not yet faded: arm the timer
    if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => setFaded(true), FADE_DELAY_MS);
    return () => {
      if (fadeTimer.current !== null) {
        window.clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
    };
  }, [pinned]);

  const onMouseEnter = () => {
    setFaded(false);
    if (fadeTimer.current !== null) {
      window.clearTimeout(fadeTimer.current);
      fadeTimer.current = null;
    }
  };

  const onMouseLeave = () => {
    if (!pinned) return;
    if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => setFaded(true), FADE_DELAY_MS);
  };

  return (
    <div
      className={faded ? "popover-shell faded" : "popover-shell"}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="caret" aria-hidden="true" />
      <div className="app">
        <Titlebar
          vaultSize={vaultSize}
          clipboardCount={clipboardCount}
          tab={tab}
          onTabChange={setTab}
          pinned={pinned}
          onPinnedChange={setPinned}
        />
        <div className="content">
          {tab === "memory" ? <MemoryTab /> : <ClipboardTab />}
        </div>
      </div>
    </div>
  );
}
