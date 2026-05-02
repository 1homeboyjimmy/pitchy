"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader, Lock, Activity, RefreshCcw, TrendingUp, BarChart2, ArrowUp, ArrowUpRight, MessageSquare, Search, GitBranch, Terminal } from "lucide-react";
import { ChatInterface } from "@/components/dashboard/ChatInterface";
import { AdminView } from "@/components/dashboard/AdminView";
import { TreeView } from "@/components/dashboard/TreeView";
import { SideNavBar } from "@/components/internal/SideNavBar";
import { InternalTopNavBar } from "@/components/internal/InternalTopNavBar";

import { useAuth } from "@/lib/hooks/useAuth";
import { setToken, getToken } from "@/lib/auth";
import {
  getChatSessions,
  createChatSession,
  getChatSession,
  getMe,
  deleteChatSession,
  createChatSessionFromIntent,
  ChatSessionResponse,
  ChatSessionDetailResponse,
  UserResponse
} from "@/lib/api";
import Link from "next/link";

function UnauthDashboard() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center px-4">
      <div className="flex flex-col items-center w-full max-w-[280px]">
        <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6">
          <Lock className="w-8 h-8 text-white/50" />
        </div>

        <div className="text-center w-full mb-8">
          <h1 className="text-2xl font-bold text-white mb-3 leading-tight">
            Войдите для доступа
          </h1>
          <p className="text-white/50 text-sm leading-relaxed">
            Дашборд доступен только авторизованным пользователям.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <Link href="/login" className="flex-1 bg-white text-black font-mono text-sm uppercase tracking-widest py-2.5 hover:bg-neutral-200 transition-colors rounded-sm font-bold text-center">
            Войти
          </Link>
          <Link href="/signup" className="flex-1 border border-white/20 text-white font-mono text-sm uppercase tracking-widest py-2.5 hover:bg-white/10 transition-colors rounded-sm text-center">
            Регистрация
          </Link>
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

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "chat") setActiveTab("chat");

    const urlToken = searchParams.get("token");
    if (urlToken) {
      setToken(urlToken);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("token");
      router.replace(params.toString() ? `/dashboard?${params.toString()}` : "/dashboard");
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
        const [sessionsList, user] = await Promise.all([
          getChatSessions(token).catch(() => []),
          getMe(token).catch(() => null)
        ]);
        setSessions(sessionsList);
        setUserProfile(user);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [isLoaded, token]);

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
      alert("Ошибка создания чата");
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
      alert("Не удалось загрузить чат");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader className="w-8 h-8 text-white/50 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) return <UnauthDashboard />;

  return (
    <div className="bg-[#0A0A0A] text-white min-h-screen font-sans flex overflow-hidden">
      <SideNavBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isAdmin={userProfile?.is_admin}
        isMobileOpen={isMobileSidebarOpen}
        onMobileClose={() => setIsMobileSidebarOpen(false)}
      />
      <InternalTopNavBar
        activeTab={activeTab}
        onMenuClick={() => setIsMobileSidebarOpen(true)}
      />

      <main className="flex-1 md:ml-64 pt-14 h-screen overflow-y-auto">
        <div className={`w-full mx-auto ${activeTab === 'chat' || activeTab === 'tree' ? 'px-4 sm:px-8 pt-4 sm:pt-8 h-[calc(100vh-3.5rem)]' : 'p-4 sm:p-8 max-w-7xl min-h-full'}`}>

          {activeTab === "overview" && (
            <>
              {/* Header Section */}
              <div className="flex justify-between items-end mb-12">
                <div>
                  <h2 className="text-3xl font-bold text-white mb-2 uppercase tracking-tight">Обзор проекта</h2>
                  <div className="flex gap-4 items-center">
                    <div className="flex items-center gap-2 px-2 py-1 bg-white/5 border border-white/10 rounded">
                      <Activity size={14} className="text-white" />
                      <span className="font-mono text-xs text-neutral-400">Сессии: <span className="text-white">{sessions.length}</span></span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1 bg-white/5 border border-white/10 rounded">
                      <RefreshCcw size={14} className="text-white" />
                      <span className="font-mono text-xs text-neutral-400">Синхронизация: <span className="text-white">только что</span></span>
                    </div>
                  </div>
                </div>
                <button className="bg-white text-black px-6 py-2 font-mono text-xs uppercase tracking-widest font-bold hover:bg-white/90 transition-all active:scale-[0.98] rounded-sm">
                  Экспорт данных
                </button>
              </div>

              {/* Stats Row (Bento Grid Style) */}
              <div className="grid grid-cols-12 gap-4 mb-12">
                {/* Progress Card */}
                <div className="col-span-12 md:col-span-5 bg-[#111111] border border-white/10 p-6 flex flex-col justify-between group hover:border-white/20 transition-all">
                  <div className="flex justify-between items-start mb-8">
                    <span className="font-mono text-xs text-neutral-500 uppercase tracking-widest font-bold">ПРОГРЕСС СИСТЕМЫ</span>
                    <TrendingUp className="text-neutral-500" size={18} />
                  </div>
                  <div>
                    <div className="flex justify-between items-end mb-2">
                      <span className="text-4xl font-mono text-white font-semibold">84.2%</span>
                      <span className="font-mono text-[10px] text-neutral-600 mb-1">ОПТИМИЗИРОВАНО</span>
                    </div>
                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-white w-[84.2%] transition-all duration-1000"></div>
                    </div>
                  </div>
                </div>

                {/* Market Readiness Card */}
                <div className="col-span-12 md:col-span-3 bg-[#111111] border border-white/10 p-6 flex flex-col justify-between hover:border-white/20 transition-all">
                  <div className="flex justify-between items-start">
                    <span className="font-mono text-xs text-neutral-500 uppercase tracking-widest font-bold">ГОТОВНОСТЬ РЫНКА</span>
                    <BarChart2 className="text-neutral-500" size={18} />
                  </div>
                  <div className="mt-8">
                    <span className="text-4xl font-mono text-white font-semibold">9.4<span className="text-neutral-600 text-2xl">/10</span></span>
                  </div>
                </div>

                {/* Total Branches Card */}
                <div className="col-span-12 md:col-span-4 bg-[#111111] border border-white/10 p-6 flex flex-col justify-between hover:border-white/20 transition-all">
                  <div className="flex justify-between items-start">
                    <span className="font-mono text-xs text-neutral-500 uppercase tracking-widest font-bold">ВСЕГО ВЕТОК</span>
                    <div className="flex items-center gap-1 text-emerald-500">
                      <ArrowUp size={12} />
                      <span className="font-mono text-[10px]">12%</span>
                    </div>
                  </div>
                  <div className="mt-8">
                    <span className="text-4xl font-mono text-white font-semibold">1,248</span>
                    <p className="font-mono text-[10px] text-neutral-600 mt-1 uppercase tracking-wider">по сравнению с прошлой неделей</p>
                  </div>
                </div>
              </div>

              {/* Recent Sessions Grid */}
              <div className="mt-12 pt-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  {sessions.slice(0, 7).map(session => (
                    <div
                      key={session.id}
                      onClick={() => handleSelectSession(session.id)}
                      className="bg-[#111111] border border-white/10 p-6 flex flex-col justify-between hover:border-white/20 transition-all min-h-[160px] group cursor-pointer"
                    >
                      <div className="flex justify-between items-start mb-6">
                        <div className="w-8 h-8 bg-white/5 flex items-center justify-center rounded-sm">
                          <MessageSquare className="text-neutral-400" size={18} />
                        </div>
                        <span className="font-mono text-[9px] uppercase tracking-widest px-2 py-1 border border-emerald-500/30 text-emerald-500 rounded-sm">
                          ЗАВЕРШЕНО
                        </span>
                      </div>
                      <div>
                        <h3 className="font-mono text-[13px] text-white uppercase tracking-wider mb-4 line-clamp-2" title={session.title}>
                          {session.title || "СЕССИЯ АНАЛИЗА"}
                        </h3>
                        <div className="flex justify-between items-end">
                          <span className="font-mono text-[10px] text-neutral-600">
                            {new Date(session.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                          </span>
                          <ArrowUpRight className="text-neutral-600 group-hover:text-white transition-colors" size={14} />
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Create New Card */}
                  <div
                    onClick={handleCreateEmptySession}
                    className="bg-transparent border border-dashed border-white/20 p-6 flex flex-col justify-center items-center hover:border-white/40 hover:bg-white/5 transition-all min-h-[160px] cursor-pointer rounded-sm"
                  >
                    {isCreating ? (
                      <Loader className="animate-spin text-neutral-400 mb-2" size={24} />
                    ) : (
                      <div className="w-8 h-8 bg-white/5 flex items-center justify-center rounded-sm mb-4">
                        <span className="text-white text-xl font-light">+</span>
                      </div>
                    )}
                    <span className="font-mono text-[11px] text-neutral-400 uppercase tracking-widest">Новый анализ</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === "chat" && (
            <div className="h-full w-full flex flex-col pb-8 max-w-7xl mx-auto">
              {activeSession ? (
                <ChatInterface session={activeSession} onUpdate={setActiveSession} />
              ) : (
                <div className="flex flex-col flex-1 h-full bg-[#111111] rounded border border-white/10 items-center justify-center px-4">
                  <div className="w-full max-w-md flex flex-col items-center text-center">
                    <MessageSquare className="w-12 h-12 text-white/20 mb-6" />
                    <h3 className="text-xl sm:text-2xl font-bold text-white mb-2">Анализ проекта</h3>
                    <p className="text-sm text-neutral-500 mb-8 w-full">
                      Нажмите кнопку ниже, чтобы начать новый интерактивный анализ.
                    </p>
                    <button
                      onClick={handleCreateEmptySession}
                      disabled={isCreating}
                      className="px-6 py-3 bg-white text-black font-mono text-sm uppercase tracking-widest font-bold rounded hover:bg-gray-200 disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      {isCreating ? <Loader className="w-5 h-5 animate-spin" /> : <span className="text-xl font-light leading-none mb-0.5">+</span>}
                      Начать новый анализ
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "tree" && (
            <div className="h-full w-full max-w-7xl mx-auto pb-8">
               <TreeView onSwitchToChat={(ctx) => { if(ctx) handleCreateEmptySession(); setActiveTab("chat"); }} />
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
  );
}

export default function AuthDashboard() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader className="w-8 h-8 animate-spin text-white/50" />
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
