"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader, Activity, RefreshCcw, MessageSquare, Plus, Map, Users, ChevronRight, ChevronLeft, Trash2, Calendar, Banknote } from "lucide-react";
import { ChatInterface } from "@/components/dashboard/ChatInterface";
import { ProjectFolders } from "@/components/dashboard/ProjectFolders";
import { SessionFolderMenu } from "@/components/dashboard/SessionFolderMenu";
import { AdminView } from "@/components/dashboard/AdminView";
import { RoadmapView } from "@/components/dashboard/RoadmapView";
import { PlatformOnboarding } from "@/components/dashboard/PlatformOnboarding";
import { SideNavBar } from "@/components/internal/SideNavBar";
import { InternalTopNavBar } from "@/components/internal/InternalTopNavBar";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { QuotaCard } from "@/components/dashboard/QuotaCard";
import { getQuotas, getPlaceholderUsage, buildSnapshot, getTierLabel, fetchUsage, type UsageResponse } from "@/lib/planLimits";
import { motion, AnimatePresence } from "framer-motion";

import { useAuth } from "@/lib/hooks/useAuth";
import { setToken } from "@/lib/auth";
import { notifyError, confirmAction, notifyTierGate } from "@/lib/ui";
import {
  getChatSessions,
  createChatSession,
  getChatSession,
  deleteChatSession,
  getMe,
  createChatSessionFromIntent,
  ChatSessionResponse,
  ChatSessionDetailResponse,
  UserResponse
} from "@/lib/api";
import Link from "next/link";

function UnauthDashboard() {
  return (
    <div className="min-h-screen bg-black flex flex-col relative overflow-hidden antialiased">
      {/* Background Glow */}
      <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-white/5 blur-[120px] rounded-full pointer-events-none" />

      <TopNavBar />

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 relative z-10">
        <div className="flex flex-col items-center w-full max-w-[800px]">

          <div className="text-center w-full mb-12">
            <h1 className="text-6xl md:text-8xl text-white mb-8 leading-[0.9] tracking-tighter" style={{ fontFamily: "'Instrument Serif', serif" }}>
              Войдите для <br />
              <span className="text-white/30 italic transition-all duration-700 hover:text-white/50">доступа</span>.
            </h1>
            <p className="text-white/40 text-lg font-light leading-relaxed">
              Дашборд доступен только авторизованным пользователям. Войдите или зарегистрируйтесь, чтобы сохранять и отслеживать анализы.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
            <Link href="/login" className="bg-white text-black font-semibold text-sm px-10 py-4 hover:bg-neutral-200 transition-all rounded-full text-center flex items-center justify-center gap-2 uppercase tracking-tighter">
              Войти <span>›</span>
            </Link>
            <Link href="/signup" className="lovable-glass text-white font-semibold text-sm px-10 py-4 hover:bg-white/5 transition-all rounded-full text-center uppercase tracking-tighter">
              Регистрация
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, isLoaded, isAuthenticated } = useAuth();

  const [activeTab, setActiveTab] = useState("overview");
  const [sessions, setSessions] = useState<ChatSessionResponse[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSessionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserResponse | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isContextImportOpen, setIsContextImportOpen] = useState(false);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Prefer the live tier returned by /me/usage (server-side resolved,
  // accounts for expired subscriptions); fall back to /me before the
  // usage fetch resolves.
  const tier = (usage?.tier || userProfile?.subscription_tier || "free").toLowerCase();
  const quotas = getQuotas(tier);
  const usageCounts = usage?.usage || getPlaceholderUsage(sessions.length);
  const liveLimits = usage?.limits;
  const messagesSnap = buildSnapshot(
    usageCounts.messages,
    liveLimits ? liveLimits.messages : quotas.messages,
  );
  const grantsSnap = buildSnapshot(
    "grants" in usageCounts ? usageCounts.grants : 0,
    liveLimits && "grants" in liveLimits ? liveLimits.grants : quotas.grants,
  );
  const roadmapsSnap = buildSnapshot(
    usageCounts.roadmaps,
    liveLimits ? liveLimits.roadmaps : quotas.roadmaps,
  );
  const custdevSnap = buildSnapshot(
    "custdev" in usageCounts ? usageCounts.custdev : usageCounts.deepCustdev,
    liveLimits ? liveLimits.custdev : quotas.deepCustdev,
  );

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "chat" || tab === "tree" || tab === "admin" || tab === "overview") {
      setActiveTab(tab);
    }

    const urlToken = searchParams.get("token");
    const ssoFlag = searchParams.get("sso");
    if (urlToken || ssoFlag) {
      // После SSO бэкенд ставит httpOnly-cookie и редиректит с ?sso=1.
      // JWT в URL больше не приходит — выставляем только маркер сессии.
      setToken(urlToken || "");
      const params = new URLSearchParams(searchParams.toString());
      const nextParam = params.get("next");
      params.delete("token");
      params.delete("sso");
      params.delete("next");
      // If the SSO callback forwarded a `next` (post-login destination),
      // honour it — only local paths to avoid open-redirect.
      if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.startsWith("/\\")) {
        router.replace(nextParam);
      } else {
        router.replace(params.toString() ? `/dashboard?${params.toString()}` : "/dashboard");
      }
    }

    const handleIntentLoad = async () => {
      if (!isLoaded || !token) return;
      const intentId = localStorage.getItem("pitchy_intent_id");
      if (intentId) {
        localStorage.removeItem("pitchy_intent_id");
        try {
          const session = await createChatSessionFromIntent(intentId, token);
          setSessions(prev => [session, ...prev]);
          setActiveSession(session);
          setActiveTab("chat");
          router.replace("/dashboard?tab=chat");
        } catch (e) {
          console.error("Failed to load intent", e);
        }
      }
    };
    handleIntentLoad();
  }, [searchParams, isLoaded, token, router]);

  useEffect(() => {
    const init = async () => {
      if (!isLoaded) return;
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const [sessionsList, user, usageData] = await Promise.all([
          getChatSessions(token).catch(() => []),
          getMe(token).catch(() => null),
          fetchUsage(token).catch(() => null),
        ]);
        setSessions(sessionsList);
        setUserProfile(user);
        setShowOnboarding(Boolean(user && !user.onboarding_completed_at));
        setUsage(usageData);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [isLoaded, token]);

  // Refresh usage after session changes (create / delete / send message)
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchUsage(token).then((u) => {
      if (!cancelled) setUsage(u);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [token, sessions.length, activeSession?.id]);

  const handleCreateEmptySession = async () => {
    setIsCreating(true);
    try {
      if (!token) throw new Error("No token");
      const session = await createChatSession({ title: "Чат с аналитиком" }, token);
      setSessions(prev => [session, ...prev]);
      setActiveSession(session);
      setActiveTab("chat");
    } catch (e) {
      console.error(e);
      notifyError("Не удалось создать чат. Попробуйте позже.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSelectSession = async (sessionId: number) => {
    if (activeSession?.id === sessionId) {
      setActiveTab("chat");
      return;
    }
    try {
      if (!token) return;
      const session = await getChatSession(sessionId, token);
      setActiveSession(session);
      setActiveTab("chat");
    } catch (e) {
      console.error(e);
      notifyError("Не удалось загрузить чат.");
    }
  };

  const handleDeleteSession = async (
    e: React.MouseEvent,
    sessionId: number,
    sessionTitle?: string,
  ) => {
    e.stopPropagation(); // do not trigger card click
    e.preventDefault();
    if (!token) return;
    const label = sessionTitle?.trim() || `чат #${sessionId}`;
    const ok = await confirmAction({
      title: "Удалить чат?",
      message: `«${label}» будет удалён навсегда. Это действие нельзя отменить.`,
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteChatSession(sessionId, token);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSession?.id === sessionId) {
        setActiveSession(null);
        setActiveTab("overview");
      }
    } catch (err) {
      console.error(err);
      notifyError("Не удалось удалить чат. Попробуйте ещё раз.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader className="w-8 h-8 text-white/50 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) return <UnauthDashboard />;

  const mainPadTop = isSidebarCollapsed ? "pt-10 sm:pt-14" : "pt-24 sm:pt-32";
  const overviewMaxW = isSidebarCollapsed ? "" : "max-w-6xl";
  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    setUserProfile((prev) =>
      prev ? { ...prev, onboarding_completed_at: new Date().toISOString() } : prev,
    );
  };

  return (
    <div className="bg-black text-white h-screen font-sans flex overflow-hidden">
      <AnimatePresence>
        {showOnboarding && token && (
          <PlatformOnboarding token={token} onComplete={handleOnboardingComplete} />
        )}
      </AnimatePresence>

      {/* Mobile sidebar toggle — fixed at the dashboard root so it always
          sits above the sidebar's stacking context. Hidden while the
          context-import modal is open so it doesn't sit on top of it. */}
      {!isContextImportOpen && (
        <button
          onClick={() => setIsMobileSidebarOpen((prev) => !prev)}
          className="md:hidden fixed top-3 left-3 z-[200] p-2 text-white/80 hover:text-white bg-black/70 backdrop-blur-md border border-white/10 rounded-lg active:scale-95 transition-colors"
          aria-label={isMobileSidebarOpen ? "Закрыть меню" : "Открыть меню"}
        >
          {isMobileSidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
      )}

      <SideNavBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isAdmin={userProfile?.is_admin}
        isMobileOpen={isMobileSidebarOpen}
        onMobileClose={() => setIsMobileSidebarOpen(false)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        canUseTree={usage?.limits.can_use_tree ?? quotas.canUseTree}
        canUseCustdev={usage?.limits.can_use_custdev ?? quotas.canUseCustdev}
        onLockedClick={(label) => notifyTierGate(label)}
      />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
        <AnimatePresence initial={false}>
          {!isSidebarCollapsed && (
            <motion.div
              key="top-nav"
              initial={{ y: -80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -80, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="absolute top-0 left-0 right-0 z-[100]"
            >
              <InternalTopNavBar activeTab={activeTab} />
            </motion.div>
          )}
        </AnimatePresence>

        <main className="flex-1 overflow-y-auto overflow-x-hidden transition-[padding] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]">
          <div className={`w-full mx-auto transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${activeTab === 'chat' || activeTab === 'tree' ? `px-3 sm:px-8 ${mainPadTop} h-full` : `px-4 sm:px-8 lg:px-12 ${mainPadTop} ${overviewMaxW} min-h-full`}`}>

          {activeTab === "overview" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              {/* Header Section */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-5 mb-8 sm:mb-12">
                <div>
                  <h2 className="font-display text-3xl sm:text-4xl md:text-5xl text-white mb-3 sm:mb-5 leading-tight tracking-tight">
                    Обзор проекта
                  </h2>
                  <div className="flex flex-wrap gap-3 items-center">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border border-white/5 rounded-full">
                      <Activity size={14} className="text-white/40" />
                      <span className="font-mono text-[10px] text-white/40 uppercase tracking-[0.15em] font-bold">Тариф: <span className="text-white">{getTierLabel(tier)}</span></span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border border-white/5 rounded-full">
                      <RefreshCcw size={14} className="text-white/40" />
                      <span className="font-mono text-[10px] text-white/40 uppercase tracking-[0.15em] font-bold">Синхронизация: <span className="text-white">только что</span></span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quota Cards Row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-8 sm:mb-12">
                <QuotaCard
                  label="Сообщения"
                  caption="ОСТАЛОСЬ"
                  icon={MessageSquare}
                  snapshot={messagesSnap}
                />
                <QuotaCard
                  label="Грантовые заявки"
                  caption="ОСТАЛОСЬ"
                  icon={Banknote}
                  snapshot={grantsSnap}
                />
                <QuotaCard
                  label="Дорожные карты"
                  caption="ОСТАЛОСЬ"
                  icon={Map}
                  snapshot={roadmapsSnap}
                />
                <QuotaCard
                  label="Deep Custdev"
                  caption="ОСТАЛОСЬ"
                  icon={Users}
                  snapshot={custdevSnap}
                />
              </div>

              {/* Project folders — passport, scoped memory, grants */}
              {token && (
                <ProjectFolders
                  token={token}
                  onOpenSession={handleSelectSession}
                  onSessionCreated={(s) => setSessions((prev) => [s, ...prev])}
                  onAttached={(sid, pid) =>
                    setSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, project_id: pid } : s)))
                  }
                  onDeleted={(pid) =>
                    setSessions((prev) => prev.map((s) => (s.project_id === pid ? { ...s, project_id: null } : s)))
                  }
                />
              )}

              {/* Recent Sessions — horizontal row list */}
              <div>
                <h3 className="font-display text-xl sm:text-2xl text-white/40 mb-4 sm:mb-6 ml-2">Последние сессии</h3>
                <div className="flex flex-col gap-2 sm:gap-3">
                  {/* Create New — full-width dashed row */}
                  <motion.button
                    type="button"
                    whileHover={{ y: -1 }}
                    onClick={handleCreateEmptySession}
                    disabled={isCreating}
                    className="lovable-glass w-full border border-dashed border-white/10 hover:border-white/25 hover:bg-white/[0.03] transition-all duration-300 rounded-2xl px-5 sm:px-6 py-4 sm:py-5 flex items-center gap-4 group disabled:opacity-50"
                  >
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-white/[0.04] border border-white/5 flex items-center justify-center shrink-0 group-hover:bg-white group-hover:text-black transition-colors duration-300">
                      {isCreating ? (
                        <Loader className="animate-spin" size={20} />
                      ) : (
                        <Plus size={22} strokeWidth={1.8} />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-display text-base sm:text-lg text-white/90 group-hover:text-white transition-colors">
                        Новый анализ
                      </div>
                      <div className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-white/30 mt-0.5">
                        Создать чат с аналитиком
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-white/20 group-hover:text-white/60 transition-colors" strokeWidth={2} />
                  </motion.button>

                  {sessions.slice(0, 12).map(session => {
                    const created = new Date(session.created_at);
                    const dateLabel = created.toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    });
                    const timeLabel = created.toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    return (
                      <motion.div
                        key={session.id}
                        whileHover={{ x: 2 }}
                        onClick={() => handleSelectSession(session.id)}
                        className="lovable-glass-strong w-full border border-white/5 hover:border-white/15 hover:bg-white/[0.04] transition-all duration-300 rounded-2xl px-4 sm:px-5 py-4 flex items-center gap-4 cursor-pointer group bg-white/[0.02]"
                      >
                        <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0 group-hover:bg-white/10 transition-colors">
                          <MessageSquare className="text-white/50 group-hover:text-white transition-colors" size={20} strokeWidth={1.5} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4
                            className="font-display text-base sm:text-lg text-white truncate leading-tight group-hover:text-white transition-colors"
                            title={session.title}
                          >
                            {session.title || "Чат с аналитиком"}
                          </h4>
                          <div className="flex items-center gap-1.5 mt-1.5 text-[12px] text-white/40">
                            <Calendar size={12} strokeWidth={1.8} />
                            <span>{dateLabel}, {timeLabel}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {token && (
                            <SessionFolderMenu
                              token={token}
                              sessionId={session.id}
                              projectId={session.project_id}
                              onAttached={(sid, pid) =>
                                setSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, project_id: pid } : s)))
                              }
                            />
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleDeleteSession(e, session.id, session.title)}
                            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.03] border border-white/5 text-white/40 hover:bg-red-500/15 hover:border-red-500/40 hover:text-red-400 transition-all"
                            title="Удалить чат"
                            aria-label="Удалить чат"
                          >
                            <Trash2 className="w-4 h-4" strokeWidth={1.8} />
                          </button>
                          <div
                            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.03] border border-white/5 text-white/40 group-hover:bg-white group-hover:text-black group-hover:border-white transition-all"
                            aria-hidden
                          >
                            <ChevronRight className="w-4 h-4" strokeWidth={2.2} />
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}

                  {sessions.length === 0 && (
                    <div className="text-center py-12 text-white/30 font-mono text-[11px] uppercase tracking-[0.2em]">
                      Пока нет ни одной сессии
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "chat" && (
            <div className={`h-full w-full flex flex-col pb-8 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${isSidebarCollapsed ? '' : 'max-w-6xl mx-auto'}`}>
              {activeSession ? (
                <ChatInterface
                  session={activeSession}
                  onUpdate={setActiveSession}
                  isSidebarCollapsed={isSidebarCollapsed}
                  onImportModalChange={setIsContextImportOpen}
                  canUseDeepSearch={usage?.limits.can_use_deep_search ?? quotas.canUseDeepSearch}
                  canUseResearch={usage?.limits.can_use_research ?? quotas.canUseResearch}
                  canUsePresentation={usage?.limits.can_use_presentation ?? quotas.canUsePresentation}
                  canUseImportContext={usage?.limits.can_use_import_context ?? quotas.canUseImportContext}
                  messagesRemaining={usage?.remaining.messages ?? null}
                  tierLabel={getTierLabel(tier)}
                />
              ) : (
                <div className="flex flex-col flex-1 h-full lovable-glass-strong rounded-3xl sm:rounded-[2.5rem] border border-white/5 items-center justify-center px-4 sm:px-6 py-8 bg-gradient-to-br from-white/[0.02] to-transparent">
                  <div className="w-full max-w-4xl flex flex-col items-center text-center">
                    <div className="w-14 h-14 sm:w-20 sm:h-20 bg-white/5 flex items-center justify-center rounded-2xl sm:rounded-[2rem] mb-5 sm:mb-8">
                      <MessageSquare className="w-7 h-7 sm:w-10 sm:h-10 text-white/20" strokeWidth={1} />
                    </div>
                    <h3 className="font-display text-3xl sm:text-5xl text-white mb-3 sm:mb-6">Начать анализ</h3>
                    <p className="text-white/50 font-light mb-8 sm:mb-12 text-base sm:text-xl leading-relaxed max-w-4xl mx-auto px-2">
                      Pitchy готов помочь вам разобрать идею, рынок и финансовую модель.
                    </p>
                    <button
                      onClick={handleCreateEmptySession}
                      disabled={isCreating}
                      className="px-10 py-4 bg-white text-black font-mono text-[11px] uppercase tracking-[0.2em] font-bold rounded-full hover:bg-neutral-200 disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-3 shadow-xl shadow-white/5"
                    >
                      {isCreating ? <Loader className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" strokeWidth={2.5} />}
                      Создать сессию
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "tree" && (
            <div className={`h-full w-full pb-8 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${isSidebarCollapsed ? '' : 'max-w-6xl mx-auto'}`}>
               <RoadmapView />
            </div>
          )}

          {activeTab === "admin" && userProfile?.is_admin && (
            <div className="h-full">
              <AdminView />
            </div>
          )}

        </div>
      </main>
    </div>
  </div>
);
}

export default function AuthDashboard() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader className="w-8 h-8 animate-spin text-white/50" />
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
