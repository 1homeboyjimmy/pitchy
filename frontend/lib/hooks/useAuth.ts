"use client";

import { useState, useEffect } from "react";
import { getToken, authEvents } from "../auth";

export function useAuth() {
    const [token, setTokenState] = useState<string | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        // Initial fetch
        const current = getToken();
        setTokenState(current);
        setIsLoaded(true);

        // Subscribe to changes
        const handler = () => {
            setTokenState(getToken());
        };

        authEvents.addEventListener("auth-change", handler);
        return () => {
            authEvents.removeEventListener("auth-change", handler);
        };
    }, []);

    return { token, isLoaded, isAuthenticated: !!token };
}
