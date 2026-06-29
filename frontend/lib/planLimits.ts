// Plan tier definitions — mirror of backend/plan_limits.py.
// Keep both files in sync by hand; the runtime fetch from /me/usage is
// authoritative, this static config is only used as a fallback before
// the network call completes.

import { getAuthJson } from "@/lib/api";

export type SubscriptionTier = "free" | "starter" | "pro" | "tester" | "premium" | "custom";

export interface PlanQuotas {
  messages: number;        // -1 = unlimited
  deepResearch: number;
  roadmaps: number;
  deepCustdev: number;
  grants: number;
  // Feature gates
  canUseDeepSearch: boolean;
  canUseResearch: boolean;
  canUsePresentation: boolean;
  canUseImportContext: boolean;
  canUseTree: boolean;
  canUseCustdev: boolean;
}

export const PLAN_QUOTAS: Record<SubscriptionTier, PlanQuotas> = {
  free: {
    messages: 3,
    deepResearch: 0,
    roadmaps: 0,
    deepCustdev: 0, grants: 0,
    canUseDeepSearch: false,
    canUseResearch: false,
    canUsePresentation: false,
    canUseImportContext: false,
    canUseTree: false,
    canUseCustdev: false,
  },
  starter: {
    messages: 100,
    deepResearch: 20,
    roadmaps: 5,
    deepCustdev: 2, grants: 0,
    canUseDeepSearch: true,
    canUseResearch: true,
    canUsePresentation: true,
    canUseImportContext: true,
    canUseTree: true,
    canUseCustdev: true,
  },
  pro: {
    messages: 500,
    deepResearch: -1,
    roadmaps: -1,
    deepCustdev: -1, grants: -1,
    canUseDeepSearch: true,
    canUseResearch: true,
    canUsePresentation: true,
    canUseImportContext: true,
    canUseTree: true,
    canUseCustdev: true,
  },
  premium: {
    messages: -1,
    deepResearch: -1,
    roadmaps: -1,
    deepCustdev: -1, grants: -1,
    canUseDeepSearch: true,
    canUseResearch: true,
    canUsePresentation: true,
    canUseImportContext: true,
    canUseTree: true,
    canUseCustdev: true,
  },
  tester: {
    messages: 25,
    deepResearch: 0,
    roadmaps: 0,
    deepCustdev: 0, grants: 0,
    canUseDeepSearch: false,
    canUseResearch: false,
    canUsePresentation: false,
    canUseImportContext: false,
    canUseTree: false,
    canUseCustdev: false,
  },
  custom: {
    messages: 50, deepResearch: -1, roadmaps: 3, deepCustdev: 2, grants: 0,
    canUseDeepSearch: true, canUseResearch: true, canUsePresentation: true,
    canUseImportContext: true, canUseTree: true, canUseCustdev: true,
  },
};

export interface QuotaUsage {
  messages: number;
  deepResearch: number;
  roadmaps: number;
  deepCustdev: number;
  grants: number;
}

export function getQuotas(tier?: string | null): PlanQuotas {
  const t = ((tier || "free").toLowerCase()) as SubscriptionTier;
  return PLAN_QUOTAS[t] ?? PLAN_QUOTAS.free;
}

export function getTierLabel(tier?: string | null): string {
  const t = (tier || "free").toLowerCase();
  if (t === "free") return "Free";
  if (t === "starter") return "Starter";
  if (t === "pro") return "Pro";
  if (t === "premium") return "Premium";
  if (t === "tester") return "Tester";
  if (t === "custom") return "Персональный";
  return t;
}

export interface QuotaSnapshot {
  used: number;
  limit: number;        // -1 = unlimited
  remaining: number;    // Infinity for unlimited; never negative
  percentUsed: number;  // 0..1; 0 for unlimited
  isUnlimited: boolean;
}

export function buildSnapshot(used: number, limit: number): QuotaSnapshot {
  if (limit < 0) {
    return { used, limit, remaining: Infinity, percentUsed: 0, isUnlimited: true };
  }
  const remaining = Math.max(0, limit - used);
  const percentUsed = limit === 0 ? 1 : Math.min(1, used / limit);
  return { used, limit, remaining, percentUsed, isUnlimited: false };
}

// -------------------------------------------------------------------
// Real usage fetch
// -------------------------------------------------------------------

export interface UsageResponse {
  tier: SubscriptionTier;
  limits: {
    messages: number;
    custdev: number;
    roadmaps: number;
    deep_research: number;
    grants: number;
    can_use_deep_search: boolean;
    can_use_research: boolean;
    can_use_presentation: boolean;
    can_use_import_context: boolean;
    can_use_tree: boolean;
    can_use_custdev: boolean;
  };
  usage: {
    messages: number;
    custdev: number;
    roadmaps: number;
    deep_research: number;
    grants: number;
  };
  remaining: {
    messages: number | null;       // null = unlimited
    custdev: number | null;
    roadmaps: number | null;
    deep_research: number | null;
    grants: number | null;
  };
  period_start: string;            // ISO timestamp, first day of current month
}

export async function fetchUsage(token: string): Promise<UsageResponse> {
  return getAuthJson<UsageResponse>("/me/usage", token);
}

// Legacy placeholder kept for fallback rendering when the network call
// hasn't completed yet. Returns zero usage so the bars start at 0.
export function getPlaceholderUsage(_sessionsCount: number): QuotaUsage {
  return { messages: 0, deepResearch: 0, roadmaps: 0, deepCustdev: 0, grants: 0 };
}

// Helper for upgrade-required error detection from API responses.
export function isUpgradeRequiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("upgrade_required") || msg.includes("quota_exceeded");
}
