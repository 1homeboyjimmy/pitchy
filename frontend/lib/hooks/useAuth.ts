"use client";

import { useSyncExternalStore, useState, useEffect } from "react";
import { getToken, authEvents } from "../auth";

function subscribe(callback: () => void) {
    const handler = () => callback();
    authEvents.addEventListener("auth-change", handler);
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
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsMounted(true);
    }, []);

    // isLoaded is true only after hydration is complete (useEffect runs)
    // token is reactive via useSyncExternalStore
    return {
        token: isMounted ? token : null,
        isLoaded: isMounted,
        isAuthenticated: isMounted && !!token
    };
}
