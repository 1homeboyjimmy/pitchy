"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader, Activity, RefreshCcw, TrendingUp, BarChart2, ArrowUp, ArrowUpRight, MessageSquare, Plus } from "lucide-react";
import { ChatInterface } from "@/components/dashboard/ChatInterface";
import { AdminView } from "@/components/dashboard/AdminView";
import { TreeView } from "@/components/dashboard/TreeView";
import { SideNavBar } from "@/components/internal/SideNavBar";
import { InternalTopNavBar } from "@/components/internal/InternalTopNavBar";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { motion } from "framer-motion";

import { useAuth } from "@/lib/hooks/useAuth";
import { setToken } from "@/lib/auth";
import {
  getChatSessions,
  createChatSession,
  getChatSession,
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
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader className="w-8 h-8 text-white/50 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) return <UnauthDashboard />;

  return (
    <div className="bg-black text-white h-screen font-sans flex overflow-hidden">
      <SideNavBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isAdmin={userProfile?.is_admin}
        isMobileOpen={isMobileSidebarOpen}
        onMobileClose={() => setIsMobileSidebarOpen(false)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />
      
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
        <InternalTopNavBar
          activeTab={activeTab}
          onMenuClick={() => setIsMobileSidebarOpen(true)}
          isSidebarCollapsed={isSidebarCollapsed}
        />

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className={`w-full mx-auto ${activeTab === 'chat' || activeTab === 'tree' ? 'px-4 sm:px-8 pt-4 sm:pt-8 h-full' : 'p-6 sm:p-12 max-w-7xl min-h-full'}`}>

          {activeTab === "overview" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              {/* Header Section */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 mb-16">
                <div>
                  <h2 className="text-5xl md:text-6xl text-white mb-6 leading-tight tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>
                    Обзор проекта
                  </h2>
                  <div className="flex flex-wrap gap-3 items-center">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border border-white/5 rounded-full">
                      <Activity size={14} className="text-white/40" />
                      <span className="font-mono text-[10px] text-white/40 uppercase tracking-[0.15em] font-bold">Сессии: <span className="text-white">{sessions.length}</span></span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border border-white/5 rounded-full">
                      <RefreshCcw size={14} className="text-white/40" />
                      <span className="font-mono text-[10px] text-white/40 uppercase tracking-[0.15em] font-bold">Синхронизация: <span className="text-white">только что</span></span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats Row (Bento Grid Style) */}
              <div className="grid grid-cols-12 gap-5 mb-16">
                {/* Progress Card */}
                <div className="col-span-12 md:col-span-5 lovable-glass-strong border border-white/5 p-8 flex flex-col justify-between group hover:border-white/20 transition-all duration-500 rounded-[2rem] bg-gradient-to-br from-white/[0.04] to-transparent overflow-hidden relative">
                  <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                    <TrendingUp size={120} strokeWidth={1} />
                  </div>
                  <div className="flex justify-between items-start mb-12 relative z-10">
                    <span className="text-[14px] text-white/50 tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>Прогресс системы</span>
                    <TrendingUp className="text-white/20 group-hover:text-white/40 transition-colors" size={20} />
                  </div>
                  <div className="relative z-10">
                    <div className="flex justify-between items-end mb-4">
                      <span className="text-6xl text-white tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>84.2%</span>
                      <span className="font-mono text-[9px] text-emerald-400/60 font-bold tracking-widest uppercase mb-1.5">ОПТИМИЗИРОВАНО</span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: "84.2%" }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        className="h-full bg-white shadow-[0_0_15px_rgba(255,255,255,0.5)]"
                      />
                    </div>
                  </div>
                </div>

                {/* Market Readiness Card */}
                <div className="col-span-12 md:col-span-3 lovable-glass-strong border border-white/5 p-8 flex flex-col justify-between hover:border-white/20 transition-all duration-500 rounded-[2rem] bg-gradient-to-br from-white/[0.04] to-transparent">
                  <div className="flex justify-between items-start mb-12">
                    <span className="text-[14px] text-white/50 tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>Рынок</span>
                    <BarChart2 className="text-white/20 group-hover:text-white/40 transition-colors" size={20} />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-6xl text-white tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>9.4</span>
                      <span className="text-xl text-white/20" style={{ fontFamily: "'Instrument Serif', serif" }}>/10</span>
                    </div>
                    <p className="font-mono text-[9px] text-white/20 font-bold tracking-widest uppercase mt-3">ГОТОВНОСТЬ</p>
                  </div>
                </div>

                {/* Total Branches Card */}
                <div className="col-span-12 md:col-span-4 lovable-glass-strong border border-white/5 p-8 flex flex-col justify-between hover:border-white/20 transition-all duration-500 rounded-[2rem] bg-gradient-to-br from-white/[0.04] to-transparent">
                  <div className="flex justify-between items-start mb-12">
                    <span className="text-[14px] text-white/50 tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>Ветки</span>
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                      <ArrowUp size={10} className="text-emerald-400" />
                      <span className="font-mono text-[10px] text-emerald-400 font-bold">12%</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-6xl text-white tracking-tight mb-2" style={{ fontFamily: "'Instrument Serif', serif" }}>1,248</div>
                    <p className="font-mono text-[9px] text-white/20 font-bold tracking-widest uppercase">ПО СРАВНЕНИЮ С ПРОШЛОЙ НЕДЕЛЕЙ</p>
                  </div>
                </div>
              </div>

              {/* Recent Sessions Grid */}
              <div>
                <h3 className="text-3xl text-white/40 mb-8 ml-2" style={{ fontFamily: "'Instrument Serif', serif" }}>Последние сессии</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                  {sessions.slice(0, 7).map(session => (
                    <motion.div
                      key={session.id}
                      whileHover={{ y: -4 }}
                      onClick={() => handleSelectSession(session.id)}
                      className="lovable-glass-strong border border-white/5 p-8 flex flex-col justify-between hover:border-white/20 transition-all duration-500 min-h-[200px] group cursor-pointer rounded-[2rem] bg-white/[0.02]"
                    >
                      <div className="flex justify-between items-start mb-8">
                        <div className="w-14 h-10 bg-white/5 flex items-center justify-center rounded-2xl group-hover:bg-white/10 transition-colors">
                          <MessageSquare className="text-white/40 group-hover:text-white transition-colors" size={20} strokeWidth={1.5} />
                        </div>
                        <span className="font-mono text-[9px] uppercase tracking-[0.2em] px-3 py-1 border border-emerald-500/20 text-emerald-400 rounded-full font-bold">
                          ЗАВЕРШЕНО
                        </span>
                      </div>
                      <div>
                        <h4 className="font-display text-lg text-white mb-4 line-clamp-2 leading-snug group-hover:text-white transition-colors" title={session.title}>
                          {session.title || "СЕССИЯ АНАЛИЗА"}
                        </h4>
                        <div className="flex justify-between items-end border-t border-white/5 pt-4">
                          <span className="font-mono text-[10px] text-white/20 uppercase tracking-widest font-bold">
                            {new Date(session.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                          </span>
                          <div className="w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.03] group-hover:bg-white group-hover:text-black transition-all duration-300">
                            <ArrowUpRight size={14} />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  {/* Create New Card */}
                  <motion.div
                    whileHover={{ scale: 0.98 }}
                    onClick={handleCreateEmptySession}
                    className="lovable-glass border border-dashed border-white/10 p-8 flex flex-col justify-center items-center hover:border-white/20 hover:bg-white/[0.03] transition-all duration-500 min-h-[200px] cursor-pointer rounded-[2rem] group"
                  >
                    {isCreating ? (
                      <Loader className="animate-spin text-white/20 mb-2" size={32} />
                    ) : (
                      <div className="w-12 h-12 bg-white/5 flex items-center justify-center rounded-2xl mb-5 group-hover:scale-110 transition-transform">
                        <Plus className="text-white/40 group-hover:text-white" size={28} strokeWidth={1.5} />
                      </div>
                    )}
                    <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/20 font-bold group-hover:text-white transition-colors" style={{ fontFamily: "'Instrument Serif', serif", fontSize: "14px" }}>Новый анализ</span>
                  </motion.div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "chat" && (
            <div className="h-full w-full flex flex-col pb-8 max-w-7xl mx-auto">
              {activeSession ? (
                <ChatInterface 
                  session={activeSession} 
                  onUpdate={setActiveSession} 
                  isSidebarCollapsed={isSidebarCollapsed}
                />
              ) : (
                <div className="flex flex-col flex-1 h-full lovable-glass-strong rounded-[2.5rem] border border-white/5 items-center justify-center px-4 bg-gradient-to-br from-white/[0.02] to-transparent">
                  <div className="w-full max-w-4xl flex flex-col items-center text-center">
                    <div className="w-20 h-20 bg-white/5 flex items-center justify-center rounded-[2rem] mb-8">
                      <MessageSquare className="w-10 h-10 text-white/20" strokeWidth={1} />
                    </div>
                    <h3 className="text-5xl font-display text-white mb-6" style={{ fontFamily: "'Instrument Serif', serif" }}>Начать анализ</h3>
                    <p className="text-white/50 font-light mb-12 text-xl leading-relaxed max-w-2xl mx-auto">
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
