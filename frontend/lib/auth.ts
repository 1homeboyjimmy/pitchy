"use client";

const AUTH_STATE_KEY = "vi_auth_state";
const EPOCH_KEY = "vi_auth_epoch";
export const COOKIE_SESSION_MARKER = "cookie-session";
export const authEvents = new EventTarget();
let status: "checking" | "authenticated" | "anonymous" | "error" = "checking";
let memoryEpoch = "initial";
let memoryToken: string | null = null;
let verification: Promise<boolean> | null = null;
let lastCheck = 0;
let validated = false;
export function wasSessionValidated() { return validated; }
function read(key: string): string | null { try { return window.localStorage.getItem(key); } catch { return key === EPOCH_KEY ? memoryEpoch : memoryToken; } }
function write(key: string, value: string | null) { try { if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value); } catch { /* Cookie remains authoritative when storage is disabled. */ } }
function emit() { authEvents.dispatchEvent(new Event("auth-change")); }
export function getAuthEpoch() { return typeof window === "undefined" ? "server" : read(EPOCH_KEY) || memoryEpoch; }
export function getToken(): string | null { return typeof window === "undefined" ? null : (read(AUTH_STATE_KEY) ? COOKIE_SESSION_MARKER : memoryToken); }
export function getAuthSnapshot() { return `${status}:${getAuthEpoch()}:${getToken() || ""}`; }
export function getAuthStatus() { return status; }
function newEpoch() { memoryEpoch = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; write(EPOCH_KEY, memoryEpoch); }
export function setToken(_token: string) {
  if (typeof window === "undefined") return;
  newEpoch(); memoryToken = COOKIE_SESSION_MARKER; write(AUTH_STATE_KEY, memoryToken);
  validated = true; status = "authenticated"; lastCheck = Date.now(); emit();
}
export function ensureSession(force = false): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (verification) return verification;
  if (!force && status !== "checking" && status !== "error") return Promise.resolve(status === "authenticated");
  const epoch = getAuthEpoch();
  verification = (async () => {
    try {
      const response = await fetch("/auth/session", { credentials: "include", cache: "no-store", headers: { "x-pitchy-api": "1" }, signal: AbortSignal.timeout(15000) });
      if (getAuthEpoch() !== epoch) return !!getToken();
      if (response.status === 401 || response.status === 403) {
        memoryToken = null; write(AUTH_STATE_KEY, null); validated = false; status = "anonymous"; emit(); return false;
      }
      if (!response.ok) throw new Error("session_unavailable");
      memoryToken = COOKIE_SESSION_MARKER; write(AUTH_STATE_KEY, memoryToken); validated = true; status = "authenticated"; lastCheck = Date.now(); emit(); return true;
    } catch {
      if (getAuthEpoch() === epoch) { status = "error"; emit(); }
      return false;
    } finally { verification = null; }
  })();
  return verification;
}
export async function recoverSession(epoch: string): Promise<boolean> {
  if (getAuthEpoch() !== epoch) return !!getToken();
  const valid = await ensureSession(true);
  if (!valid && status === "anonymous" && getAuthEpoch() === epoch && !window.location.pathname.startsWith("/login")) window.location.assign("/login?expired=1");
  return valid;
}
export function recheckSession() { if (document.visibilityState === "visible" && Date.now() - lastCheck > 60000) void ensureSession(true); }
export async function clearToken() {
  if (typeof window === "undefined") return;
  newEpoch(); const epoch = getAuthEpoch(); memoryToken = null; write(AUTH_STATE_KEY, null); validated = false; status = "anonymous"; emit();
  try { await fetch("/auth/logout", { method: "POST", credentials: "include" }); }
  catch { if (getAuthEpoch() === epoch) { status = "error"; emit(); } }
}
