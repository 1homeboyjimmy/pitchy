"use client";

import type { ResidentWorkspaceData } from "@/components/accelerator/ResidentWorkspace";
import type { AcceleratorAccess } from "./acceleratorAccess";
import { authEvents, getToken } from "./auth";

export type AcceleratorWorkspaceAccess = AcceleratorAccess & {
  name: string; status: string; description?: string | null;
};

// A one-time handoff across the immediate redirect, never a persistent permissions cache.
let handoff: {
  token: string; createdAt: number; workspace: ResidentWorkspaceData; access: AcceleratorWorkspaceAccess[];
} | null = null;

authEvents.addEventListener("auth-change", () => { handoff = null; });
if (typeof window !== "undefined") window.addEventListener("storage", () => { handoff = null; });

export function handoffAcceleratorEntry(token: string, workspace: ResidentWorkspaceData, access: AcceleratorWorkspaceAccess[]) {
  handoff = { token, workspace, access, createdAt: Date.now() };
}

export function takeAcceleratorEntry(token: string) {
  const value = handoff;
  handoff = null;
  if (!value || value.token !== token || getToken() !== token || Date.now() - value.createdAt > 30_000) return null;
  return value;
}
