"use client";

const AUTH_STATE_KEY = "vi_auth_state";

// Sentinel value stored in localStorage instead of the actual JWT. The
// real session token lives in an httpOnly cookie that JS can't read, so
// XSS can't steal it. The sentinel still satisfies "am I logged in?"
// boolean checks scattered across the app via getToken().
export const COOKIE_SESSION_MARKER = "cookie-session";

// Custom event target for auth changes
export const authEvents = new EventTarget();

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AUTH_STATE_KEY);
}

export function setToken(_token: string) {
  // Ignore the actual JWT — we don't store it anymore. The httpOnly
  // cookie set by the backend is authoritative. We only store a marker
  // so existing `if (token)` checks throughout the app stay green.
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTH_STATE_KEY, COOKIE_SESSION_MARKER);
  authEvents.dispatchEvent(new Event("auth-change"));
}

export async function clearToken() {
  if (typeof window === "undefined") return;

  try {
    await fetch(`/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (err) {
    console.error("Logout error:", err);
  } finally {
    window.localStorage.removeItem(AUTH_STATE_KEY);
    authEvents.dispatchEvent(new Event("auth-change"));
  }
}
