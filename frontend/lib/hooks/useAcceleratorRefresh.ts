"use client";

import { useEffect, useRef } from "react";

export const ACCELERATOR_REFRESH = "pitchy:accelerator-refresh";

/** Refresh data in place, preserving filters, open dialogs and unsaved forms. */
export function useAcceleratorRefresh(load: () => unknown, cohortId?: number) {
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    let running = false;
    let pending = false;
    let active = true;
    const refresh = async (event: Event) => {
      if (cohortId && (event as CustomEvent<number>).detail !== cohortId) return;
      if (running) { pending = true; return; }
      running = true;
      try {
        do {
          pending = false;
          await latest.current();
        } while (pending && active);
      } catch { /* Each workspace renders its own loading error. */ }
      finally { running = false; }
    };
    window.addEventListener(ACCELERATOR_REFRESH, refresh);
    return () => { active = false; window.removeEventListener(ACCELERATOR_REFRESH, refresh); };
  }, [cohortId]);
}
