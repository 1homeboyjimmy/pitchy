"use client";

import { useSyncExternalStore } from "react";
import { getToken, authEvents } from "../auth";

function subscribe(callback: () => void) {
    const handler = () => callback();
    authEvents.addEventListener("auth-change", handler);
    // Also listen to storage events for cross-tab sync
    window.addEventListener("storage", handler);
    return () => {
        authEvents.removeEventListener("auth-change", handler);
        window.removeEventListener("storage", handler);
    };
}

function getSnapshot() {
    return getToken();
}

function getServerSnapshot() {
    return null;
}

export function useAuth() {
    const token = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    // With useSyncExternalStore, we are "loaded" once the client snapshot is used.
    // getServerSnapshot returns null, client returns token (or null).
    // React handles the hydration mismatch by patching up.
    // Effectively isLoaded is true on client. 
    // But to match previous API where isLoaded meant "checked localStorage",
    // we can assume if we are on client (which useSyncExternalStore ensures for the second pass) we are loaded.
    // A simple way is to use a mounted state or just rely on token being possibly null.
    // The previous API had `isLoaded`. Let's emulate it or simplify.
    // If we return `isLoaded: true` always on client, it might be enough.

    return {
        token,
        isLoaded: true, // simplified, as useSyncExternalStore handles the 'loading' state of hydration
        isAuthenticated: !!token
    };
}
