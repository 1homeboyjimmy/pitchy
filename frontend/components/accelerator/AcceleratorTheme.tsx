"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Suspense } from "react";
import { ParticipantRegistrationGate } from "./ParticipantRegistrationGate";
import { Moon, Sun } from "lucide-react";
import "./accelerator-theme.css";

const STORAGE_KEY = "pitchy_accelerator_theme";
const bootstrap = `(function(s){try{var t=localStorage.getItem('${STORAGE_KEY}');s.parentElement.dataset.theme=t==='dark'?'dark':'light'}catch(e){}})(document.currentScript)`;

/** A separate preference keeps accelerator themes isolated from the public site. */
export function AcceleratorTheme({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const sync = () => {
      try { if (root.current) root.current.dataset.theme = localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light"; } catch { /* Storage can be unavailable in private browsers. */ }
    };
    sync();
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) sync(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function toggle() {
    if (!root.current) return;
    const next = root.current.dataset.theme === "light" ? "dark" : "light";
    root.current.dataset.theme = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Switching still works without persistence. */ }
  }

  return <div ref={root} className="accelerator-theme" data-theme="light" suppressHydrationWarning>
    <script dangerouslySetInnerHTML={{ __html: bootstrap }} />
    <div className="accelerator-theme-toolbar">
      <button type="button" onClick={toggle} className="accelerator-theme-toggle" aria-label="Переключить тему">
        <span className="theme-dark-icon inline-flex items-center gap-2"><Sun size={17} aria-hidden="true" />Светлая тема</span>
        <span className="theme-light-icon inline-flex items-center gap-2"><Moon size={17} aria-hidden="true" />Тёмная тема</span>
      </button>
    </div>
    {children}
    <Suspense fallback={null}><ParticipantRegistrationGate acceleratorScope /></Suspense>
  </div>;
}
