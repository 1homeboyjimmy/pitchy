import { useEffect, useCallback, useRef } from "react";
import { getToken, clearToken } from "../auth";
import { useRouter } from "next/navigation";

// Default to 3 hours (in milliseconds)
const DEFAULT_TIMEOUT_MS = 3 * 60 * 60 * 1000;

export function useIdleTimeout(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const router = useRouter();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Define the actual logout logic
  const handleLogout = useCallback(async () => {
    // Check if token exists before trying to clear it
    if (getToken()) {
      await clearToken();
      router.push("/login?reason=idle");
    }
  }, [router]);

  // Restart the timer
  const resetTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    // Only set a timer if the user is authenticated
    if (getToken()) {
      timerRef.current = setTimeout(handleLogout, timeoutMs);
    }
  }, [handleLogout, timeoutMs]);

  useEffect(() => {
    // List of events that indicate user activity
    const events = [
      "mousemove",
      "keydown",
      "wheel",
      "DOMMouseScroll",
      "mouseWheel",
      "mousedown",
      "touchstart",
      "touchmove",
      "scroll",
    ];

    // Activity handler that resets the timer
    const handleUserActivity = () => {
      resetTimer();
    };

    // Attach listeners
    events.forEach((event) => {
      window.addEventListener(event, handleUserActivity, { passive: true });
    });

    // Initial setup
    resetTimer();

    // Cleanup
    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleUserActivity);
      });
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [resetTimer]);
}
