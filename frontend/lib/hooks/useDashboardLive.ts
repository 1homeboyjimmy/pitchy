"use client";

import { useEffect, useState } from "react";
import { ACCELERATOR_REFRESH } from "./useAcceleratorRefresh";
import { ApiError, getAuthJson } from "@/lib/api";

/** A notice requests a fresh authorized snapshot; no participant data travels in SSE. */
export function useDashboardLive(cohortId: number | null, token: string | null, membershipId?: number) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!cohortId || !token) return;
    const authToken = token;
    let active = true;
    let permitted = true;
    let enabled = false;
    let source: EventSource | null = null;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let lastSeen = Date.now();
    let failures = 0;
    const controller = new AbortController();
    const root = membershipId ? `/api/accelerators/memberships/${membershipId}` : `/api/accelerators/cohorts/${cohortId}`;
    const visible = () => document.visibilityState === "visible";
    const scheduleRefresh = () => {
      if (!active || !visible() || refresh) return;
      // Coalesce a batch of attendance writes into one refresh.
      refresh = setTimeout(() => { refresh = undefined; if (active && visible()) { setRevision(value => value + 1); window.dispatchEvent(new CustomEvent(ACCELERATOR_REFRESH, { detail: cohortId })); } }, 350);
    };
    const stop = () => {
      source?.close(); source = null;
      clearTimeout(retry); retry = undefined;
      clearInterval(poll); poll = undefined;
      clearTimeout(refresh); refresh = undefined;
    };
    const fallback = () => {
      if (!active || !permitted || !visible()) return;
      source?.close(); source = null;
      if (!poll) { scheduleRefresh(); poll = setInterval(scheduleRefresh, 30_000); }
      clearTimeout(retry);
      retry = setTimeout(() => { retry = undefined; void configure(); }, Math.min(30_000, 1500 * 2 ** Math.min(failures++, 5)));
    };
    const connect = () => {
      if (!active || !permitted || !enabled || !visible() || source) return;
      if (typeof EventSource === "undefined") { fallback(); return; }
      const stream = new EventSource(`${root}/dashboard-stream`, { withCredentials: true });
      source = stream; lastSeen = Date.now();
      const healthy = () => {
        if (source !== stream) return;
        lastSeen = Date.now(); failures = 0;
        clearInterval(poll); poll = undefined;
      };
      stream.addEventListener("ready", () => { healthy(); scheduleRefresh(); });
      stream.addEventListener("changed", () => { healthy(); scheduleRefresh(); });
      stream.addEventListener("ping", healthy);
      stream.addEventListener("fallback", () => { if (source === stream) fallback(); });
      stream.addEventListener("forbidden", () => { permitted = false; stop(); });
      stream.onerror = () => { if (source === stream) fallback(); };
    };
    async function configure() {
      if (!active || !permitted || !visible()) return;
      try {
        const config = await getAuthJson<{ enabled: boolean }>(`${root}/dashboard-live`, authToken, controller.signal);
        if (!active) return;
        enabled = config.enabled === true;
        if (enabled) connect(); else stop();
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) { permitted = false; stop(); }
        else if (active) fallback();
      }
    }
    const visibility = () => {
      if (!visible()) stop();
      else if (permitted) { scheduleRefresh(); void configure(); }
    };
    const watchdog = setInterval(() => {
      if (source && visible() && Date.now() - lastSeen > 35_000) fallback();
    }, 10_000);
    document.addEventListener("visibilitychange", visibility);
    void configure();
    return () => { active = false; controller.abort(); stop(); clearInterval(watchdog); document.removeEventListener("visibilitychange", visibility); };
  }, [cohortId, membershipId, token]);
  return revision;
}
