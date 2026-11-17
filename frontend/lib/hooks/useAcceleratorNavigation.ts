"use client";

import { useCallback, useState, useSyncExternalStore, useLayoutEffect, useRef, type SetStateAction } from "react";

import { usePathname } from "next/navigation";

const KEY = "pitchyAcceleratorNavigation";
const CHANGE = "pitchy-accelerator-navigation";
type Entry = { path: string; depth: number; values: Record<string, unknown> };
let batch: Entry | null = null;
let replacing = false;

export function replaceAcceleratorNavigation(action: () => void) {
  replacing = true;
  try { action(); } finally { replacing = false; }
}

function entry(): Entry {
  const saved = window.history.state?.[KEY] as Entry | undefined;
  return saved?.path === window.location.pathname ? saved : { path: window.location.pathname, depth: 0, values: {} };
}
function subscribe(notify: () => void) {
  window.addEventListener('popstate', notify);
  window.addEventListener(CHANGE, notify);
  return () => { window.removeEventListener('popstate', notify); window.removeEventListener(CHANGE, notify); };
}

/** Navigation state only: restoring an entry never repeats an API mutation. */
export function useAcceleratorNavigationState<T>(key: string, initial: T | (() => T)) {
  const [fallback] = useState(initial);
  const snapshot = useCallback(() => {
    const current = entry();
    return (key in current.values ? current.values[key] : fallback) as T;
  }, [key, fallback]);
  const value = useSyncExternalStore(subscribe, snapshot, () => fallback);
  const setValue = useCallback((update: SetStateAction<T>, options?: { replace?: boolean }) => {
    const previous = snapshot();
    const next = typeof update === 'function' ? (update as (value: T) => T)(previous) : update;
    if (Object.is(previous, next) || JSON.stringify(previous) === JSON.stringify(next)) return;
    const current = entry();
    // Store the initial value in the entry being left as well.
    const baseline = { ...current, values: { ...current.values, [key]: previous } };
    const grouped = batch && batch.path === current.path;
    if (!grouped) window.history.replaceState({ ...window.history.state, [KEY]: baseline }, '', window.location.href);
    const target = { ...current, depth: grouped || replacing || options?.replace ? current.depth : current.depth + 1, values: { ...current.values, [key]: next } };
    window.history[grouped || replacing || options?.replace ? 'replaceState' : 'pushState']({ ...window.history.state, [KEY]: target }, '', window.location.href);
    batch = target;
    queueMicrotask(() => { if (batch === target) batch = null; });
    window.dispatchEvent(new Event(CHANGE));
  }, [key, snapshot]);
  return [value, setValue] as const;
}

export function acceleratorBack(fallback: () => void) {
  if (entry().depth > 0) window.history.back();
  else fallback();
}

/** Keep the same internal back chain across Next.js route transitions. */
export function useAcceleratorNavigationBoundary() {
  const pathname = usePathname();
  const previous = useRef<Entry | null>(null);
  useLayoutEffect(() => {
    const saved = window.history.state?.[KEY] as Entry | undefined;
    if (saved?.path !== pathname) {
      const next: Entry = { path: pathname, depth: previous.current && previous.current.path !== pathname ? previous.current.depth + 1 : 0, values: {} };
      window.history.replaceState({ ...window.history.state, [KEY]: next }, '', window.location.href);
      window.dispatchEvent(new Event(CHANGE));
    }
    previous.current = entry();
    const remember = () => { previous.current = entry(); };
    window.addEventListener(CHANGE, remember);
    window.addEventListener('popstate', remember);
    return () => { window.removeEventListener(CHANGE, remember); window.removeEventListener('popstate', remember); };
  }, [pathname]);
}
