"use client";

const AUTH_STATE_KEY = "vi_auth_state";
const COOKIE_SESSION_MARKER = "cookie-session";

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
}

export function clearToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_STATE_KEY);
  // Best-effort logout: backend will clear the HttpOnly auth cookie.
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  void fetch(`${base}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}
