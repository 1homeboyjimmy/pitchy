"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SideNavBar } from "@/components/internal/SideNavBar";
import { InternalTopNavBar } from "@/components/internal/InternalTopNavBar";
import { getToken } from "@/lib/auth";
import { getMe, type UserResponse } from "@/lib/api";
import { fetchUsage, getQuotas, type UsageResponse } from "@/lib/planLimits";
import { notifyTierGate } from "@/lib/ui";

/**
 * Shell layout for /grants/* pages so the left sidebar persists exactly like
 * on the dashboard. The dashboard's internal tabs (overview / chat / tree /
 * admin) are not real routes — they live in dashboard state — so clicking
 * them here navigates to /dashboard?tab=… instead of switching local state.
 * The "grants" nav item is href-based and stays highlighted via activeTab.
 */
export default function GrantsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [userProfile, setUserProfile] = useState<UserResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    (async () => {
      const [user, usageData] = await Promise.all([
        getMe(token).catch(() => null),
        fetchUsage(token).catch(() => null),
      ]);
      if (cancelled) return;
      setUserProfile(user);
      setUsage(usageData);
    })();
    return () => { cancelled = true; };
  }, []);

  const tier = (usage?.tier || userProfile?.subscription_tier || "free").toLowerCase();
  const quotas = getQuotas(tier);

  // Internal dashboard tabs route back to the dashboard with the tab pre-selected.
  const handleSetActiveTab = (tab: string) => {
    if (tab === "grants") return; // already here
    if (tab === "overview") router.push("/dashboard");
    else router.push(`/dashboard?tab=${tab}`);
  };

  return (
    <div className="bg-black text-white h-[100dvh] min-h-0 font-sans flex overflow-hidden">
      <button
        onClick={() => setIsMobileSidebarOpen((prev) => !prev)}
        className="md:hidden fixed top-3 left-3 z-[200] p-2 text-white/80 hover:text-white bg-black/70 backdrop-blur-md border border-white/10 rounded-lg active:scale-95 transition-colors"
        aria-label={isMobileSidebarOpen ? "Закрыть меню" : "Открыть меню"}
      >
        {isMobileSidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>

      <SideNavBar
        activeTab="grants"
        setActiveTab={handleSetActiveTab}
        isAdmin={userProfile?.is_admin}
        isMobileOpen={isMobileSidebarOpen}
        onMobileClose={() => setIsMobileSidebarOpen(false)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        canUseTree={usage?.limits.can_use_tree ?? quotas.canUseTree}
        canUseCustdev={usage?.limits.can_use_custdev ?? quotas.canUseCustdev}
        onLockedClick={(label) => notifyTierGate(label)}
      />

      <div className="flex-1 flex flex-col min-w-0 h-[100dvh] min-h-0 overflow-hidden relative">
        {!isSidebarCollapsed && (
          <div className="absolute top-0 left-0 right-0 z-[100]">
            <InternalTopNavBar activeTab="grants" />
          </div>
        )}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
