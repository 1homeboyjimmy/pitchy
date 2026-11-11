"use client";

import { getAuthJson } from "./api";
import { authEvents } from "./auth";
import type { ResidentWorkspaceData } from "@/components/accelerator/ResidentWorkspace";

// Share concurrent reads by the registration gate and accelerator entry page.
// Settled responses are never cached, so profile saves always read fresh data.
const pending = new Map<string, Promise<ResidentWorkspaceData>>();
authEvents.addEventListener("auth-change", () => pending.clear());
if (typeof window !== "undefined") window.addEventListener("storage", () => pending.clear());
export function getAcceleratorMemberships(token: string): Promise<ResidentWorkspaceData> {
  const current = pending.get(token);
  if (current) return current;
  const request = getAuthJson<ResidentWorkspaceData>("/api/accelerators/me/memberships", token)
    .finally(() => { if (pending.get(token) === request) pending.delete(token); });
  pending.set(token, request);
  return request;
}
