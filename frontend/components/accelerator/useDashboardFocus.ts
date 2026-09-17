"use client";

import { useEffect } from "react";

/** Bring the event, assignment or stage selected on the overview into view. */
export function useDashboardFocus(kind: string, id: number | undefined, itemCount: number) {
  useEffect(() => {
    if (!id || !itemCount) return;
    const element = document.getElementById(`dashboard-${kind}-${id}`);
    if (!element) return;
    element.classList.add("dashboard-focus");
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    return () => { element.classList.remove("dashboard-focus"); };
  }, [kind, id, itemCount]);
}
