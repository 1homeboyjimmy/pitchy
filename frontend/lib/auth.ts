"use client";

const AUTH_STATE_KEY = "vi_auth_state";
const COOKIE_SESSION_MARKER = "cookie-session";

// Custom event target for auth changes
export const authEvents = new EventTarget();

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AUTH_STATE_KEY) === "1"
    ? COOKIE_SESSION_MARKER
    : null;
}

export function setToken(token: string) {
  if (typeof window === "undefined") return;
  if (!token) return;
  window.localStorage.setItem(AUTH_STATE_KEY, "1");
  authEvents.dispatchEvent(new Event("auth-change"));
}

export async function clearToken() {
  if (typeof window === "undefined") return;

  try {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
    await fetch(`${base}/auth/logout`, {
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
