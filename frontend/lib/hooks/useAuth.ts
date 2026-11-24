"use client";
import { useSyncExternalStore, useEffect } from "react";
import { getToken, authEvents, getAuthSnapshot, getAuthStatus, ensureSession, recheckSession, wasSessionValidated } from "../auth";
function subscribe(callback: () => void) {
  authEvents.addEventListener("auth-change", callback);
  const storage = () => { callback(); void ensureSession(true); };
  window.addEventListener("storage", storage);
  return () => { authEvents.removeEventListener("auth-change", callback); window.removeEventListener("storage", storage); };
}
export function useAuth() {
  const snapshot = useSyncExternalStore(subscribe, getAuthSnapshot, () => "server");
  useEffect(() => {
    void ensureSession();
    window.addEventListener("focus", recheckSession); document.addEventListener("visibilitychange", recheckSession);
    const timer = window.setInterval(recheckSession, 300000);
    return () => { clearInterval(timer); window.removeEventListener("focus", recheckSession); document.removeEventListener("visibilitychange", recheckSession); };
  }, []);
  const state = snapshot === "server" ? "checking" : getAuthStatus();
  const authenticated = state === "authenticated" || (state === "error" && wasSessionValidated());
  const ready = authenticated || state === "anonymous";
  return { token: authenticated ? getToken() : null, isLoaded: ready, isAuthenticated: authenticated, authError: state === "error", retryAuth: () => ensureSession(true) };
}
