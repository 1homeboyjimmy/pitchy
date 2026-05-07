// Frontend-only plan quotas. Real usage counters will come from the backend later.
// When the backend exposes /me/usage, replace getPlaceholderUsage with the real fetch.

export type SubscriptionTier = "free" | "starter" | "pro" | "tester";

export interface PlanQuotas {
  messages: number;       // -1 = unlimited
  deepResearch: number;
  roadmaps: number;
  deepCustdev: number;
}

export interface QuotaUsage {
  messages: number;
  deepResearch: number;
  roadmaps: number;
  deepCustdev: number;
}

export const PLAN_QUOTAS: Record<SubscriptionTier, PlanQuotas> = {
  free:    { messages: 50,   deepResearch: 2,   roadmaps: 1,  deepCustdev: 1  },
  starter: { messages: 500,  deepResearch: 20,  roadmaps: 5,  deepCustdev: 5  },
  pro:     { messages: -1,   deepResearch: 100, roadmaps: 50, deepCustdev: 50 },
  tester:  { messages: -1,   deepResearch: 100, roadmaps: 50, deepCustdev: 50 },
};

export function getQuotas(tier?: string | null): PlanQuotas {
  const t = ((tier || "free").toLowerCase()) as SubscriptionTier;
  return PLAN_QUOTAS[t] ?? PLAN_QUOTAS.free;
}

export function getTierLabel(tier?: string | null): string {
  const t = (tier || "free").toLowerCase();
  if (t === "free") return "Free";
  if (t === "starter") return "Starter";
  if (t === "pro") return "Pro";
  if (t === "tester") return "Tester";
  return t;
}

// Placeholder until backend exposes real counters.
// Uses session count as a rough estimate so the UI feels alive.
export function getPlaceholderUsage(sessionsCount: number): QuotaUsage {
  return {
    messages: Math.min(sessionsCount * 4, 9999),
    deepResearch: Math.min(Math.floor(sessionsCount / 2), 9999),
    roadmaps: Math.min(Math.floor(sessionsCount / 3), 9999),
    deepCustdev: Math.min(Math.floor(sessionsCount / 4), 9999),
  };
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
