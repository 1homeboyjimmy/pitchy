"use client";

import { useState, useEffect, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { Layout as LayoutIcon, MessageSquare, BarChart2, Plus, Star, Lock, ChevronRight, Loader, Shield, GitBranch, Menu } from "react-feather";
import Layout from "@/components/Layout";
// StatsCard unused
import { SessionCard } from "@/components/dashboard/SessionCard";
import { ChatInterface } from "@/components/dashboard/ChatInterface";
import { AdminView } from "@/components/dashboard/AdminView";
import { TreeView } from "@/components/dashboard/TreeView";
import { GlassCard, Button } from "@/components/shared";
import { useLayoutStore } from "@/lib/store/layout";
import { getToken } from "@/lib/auth";
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

/* ──── Unauthenticated View ──── */
function UnauthDashboard() {
  return (
    <div className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center max-w-md"
      >
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-pitchy-violet/10 border border-pitchy-violet/20 flex items-center justify-center">
            <Lock className="w-8 h-8 text-pitchy-violet" />
          </div>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-3">
          Войдите для доступа
        </h1>
        <p className="text-white/50 mb-8">
          Дашборд доступен только авторизованным пользователям. Войдите или
          зарегистрируйтесь, чтобы сохранять и отслеживать анализы.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/login">
            <Button variant="primary" icon={<ChevronRight className="w-4 h-4" />} iconPosition="right">
              Войти
            </Button>
          </Link>
          <Link href="/signup">
            <Button variant="ghost">Регистрация</Button>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}

/* ──── Authenticated Dashboard ──── */

import { useSearchParams } from "next/navigation";

// ... imports ...

import { useAuth } from "@/lib/hooks/useAuth";
import { setToken } from "@/lib/auth";

// ...

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, isLoaded, isAuthenticated } = useAuth(); // Use the hook

  const [activeTab, setActiveTab] = useState("overview");
  const [sessions, setSessions] = useState<ChatSessionResponse[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSessionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserResponse | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const { isSidebarOpen, setSidebarOpen, toggleSidebar, setIsDashboard, setIsChatOpen } = useLayoutStore();

  useEffect(() => {
    setIsDashboard(true);
    return () => setIsDashboard(false);
  }, [setIsDashboard]);

  useEffect(() => {
    if (setIsChatOpen) setIsChatOpen(activeTab === "chat");
    return () => { if (setIsChatOpen) setIsChatOpen(false); }
  }, [activeTab, setIsChatOpen]);

  // Handle URL Params for Redirects
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "chat") {
      setActiveTab("chat");
    }

    // Handle SSO Token
    const urlToken = searchParams.get("token");
    if (urlToken) {
      setToken(urlToken);
      // Remove token from URL
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
  }, [searchParams, isLoaded, token, router]); // Added token and router dependency

  useEffect(() => {
    const init = async () => {
      if (!isLoaded) return; // Wait for auth to load

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
  }, [isLoaded, token]); // Re-run when auth is loaded/changed

  // ... createSession handlers using token from hook ...

  const handleCreateEmptySession = async () => {
    setIsCreating(true);
    try {
      const token = getToken();
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
    // If already active, just switch tab
    if (activeSession?.id === sessionId) {
      setActiveTab("chat");
      return;
    }

    try {
      const token = getToken();
      if (!token) return;

      const session = await getChatSession(sessionId, token);
      setActiveSession(session);
      setActiveTab("chat");
    } catch (e) {
      console.error(e);
      alert("Не удалось загрузить чат");
    }
  };

  const handleDeleteSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Вы уверены, что хотите удалить этот анализ? Это действие нельзя отменить.")) return;

    try {
      const token = getToken();
      if (!token) return;

      await deleteChatSession(sessionId, token);

      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (activeSession?.id === sessionId) {
        setActiveSession(null);
        setActiveTab("overview");
      }
    } catch (err) {
      console.error(err);
      alert("Не удалось удалить анализ");
    }
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center">
        <Loader className="w-8 h-8 text-pitchy-violet animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) return <UnauthDashboard />;

  return (
    <div className="flex w-full flex-1 min-h-0 transition-all duration-300">
      {/* Floating Menu Button for FullScreen Mode */}
      <AnimatePresence>
        {!isSidebarOpen && (
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            onClick={() => toggleSidebar()}
            className="fixed top-6 left-[max(1.5rem,calc(50vw-35rem))] z-[60] p-2.5 rounded-xl bg-pitchy-bg/80 hover:bg-white/10 backdrop-blur-xl border border-white/20 text-white shadow-lg shadow-black/20 transition-colors cursor-pointer"
            title="Открыть меню"
          >
            <Menu className="w-5 h-5" />
          </motion.button>
        )}
      </AnimatePresence>
      {/* Sidebar (Desktop) */}
      <motion.aside
        initial={false}
        animate={{ width: isSidebarOpen ? 256 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="hidden lg:block shrink-0 overflow-hidden sticky top-[4rem] h-[calc(100vh-4rem)] border-white/10"
        style={{ borderRightWidth: isSidebarOpen ? '1px' : '0px' }}
      >
        <div className="w-64 flex flex-col py-6 px-4 h-full">
        <div className="mb-8">
          <Button
            onClick={() => {
              setActiveSession(null);
              setActiveTab("chat");
            }}
            icon={<Plus className="w-5 h-5" />}
            iconPosition="left"
            className="w-full mb-6 bg-gradient-to-r from-pitchy-violet to-purple-600 border-none hover:opacity-90 transition-opacity cursor-pointer"
          >
            Новый анализ
          </Button>

          <p className="text-xs text-white/30 uppercase tracking-wider mb-2 px-3">
            Меню
          </p>
          {[
            { id: "overview", label: "Обзор", icon: LayoutIcon },
            { id: "chat", label: "Чат", icon: MessageSquare },
            { id: "tree", label: "Древо", icon: GitBranch },
            { id: "custdev", label: "CustDev", icon: BarChart2, href: "https://custdev.pitchy.pro/" }
          ].map((item) => {
            const isExternal = 'href' in item;
            const content = (
              <>
                <item.icon className="w-4 h-4" />
                {item.label}
              </>
            );

            if (isExternal && 'href' in item) {
              return (
                <a
                  key={item.id}
                  href={item.href as string}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-1 text-left text-white/50 hover:text-white hover:bg-white/5"
                >
                  {content}
                </a>
              );
            }

            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-1 text-left ${activeTab === item.id
                  ? "bg-white/10 text-white border border-white/10"
                  : "text-white/50 hover:text-white hover:bg-white/5"
                  }`}
              >
                {content}
              </button>
            );
          })}

          {userProfile?.is_admin && (
            <>
              <div className="my-4 border-t border-white/10" />
              <p className="text-xs text-pitchy-cyan uppercase tracking-wider mb-2 px-3 flex items-center gap-2">
                <Shield className="w-3 h-3" /> Управление
              </p>
              <button
                onClick={() => setActiveTab("admin")}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${activeTab === "admin"
                  ? "bg-pitchy-cyan/20 text-pitchy-cyan border border-pitchy-cyan/30"
                  : "text-white/50 hover:text-pitchy-cyan hover:bg-white/5"
                  }`}
              >
                <Shield className="w-4 h-4" />
                Админ-панель
              </button>
            </>
          )}
        </div>

        <div className="mt-auto">
          <GlassCard hover={false} className="p-4 bg-gradient-to-br from-pitchy-violet/20 to-transparent border-pitchy-violet/20">
            <div className="flex items-center gap-2 mb-2">
              <Star className="w-4 h-4 text-pitchy-violet" />
              <span className="text-xs font-bold text-white">PRO Совет</span>
            </div>
            <p className="text-xs text-white/60 leading-relaxed">
              Чем подробнее вы опишете проект в начале, тем точнее будет анализ.
            </p>
          </GlassCard>
        </div>
        </div>
      </motion.aside>

      {/* content */}
      <main className={`flex-1 px-4 sm:px-6 lg:px-8 overflow-hidden w-full flex flex-col transition-all duration-300 ${isSidebarOpen ? 'py-6' : 'pt-6 pb-0'}`}>
        {/* Mobile Navigation (Tabs) */}
        <div className="flex lg:hidden overflow-x-auto gap-2 mb-6 pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          {[
            { id: "overview", label: "Обзор", icon: LayoutIcon },
            { id: "chat", label: "Чат", icon: MessageSquare },
            { id: "tree", label: "Древо", icon: GitBranch },
            { id: "custdev", label: "CustDev", icon: BarChart2, href: "https://custdev.pitchy.pro/" }
          ].map((item) => {
            const isExternal = 'href' in item;
            const content = (
              <>
                <item.icon className="w-4 h-4" />
                {item.label}
              </>
            );

            if (isExternal && 'href' in item) {
              return (
                <a
                  key={item.id}
                  href={item.href as string}
                  className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all text-white/50 border border-transparent hover:text-white hover:bg-white/5"
                >
                  {content}
                </a>
              );
            }

            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === item.id
                  ? "bg-white/10 text-white border border-white/10 shadow-sm"
                  : "text-white/50 border border-transparent hover:text-white hover:bg-white/5"
                  }`}
              >
                {content}
              </button>
            );
          })}
          {userProfile?.is_admin && (
            <button
              onClick={() => setActiveTab("admin")}
              className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === "admin"
                ? "bg-pitchy-cyan/20 text-pitchy-cyan border border-pitchy-cyan/30 shadow-sm"
                : "text-white/50 border border-transparent hover:text-pitchy-cyan hover:bg-white/5"
                }`}
            >
              <Shield className="w-4 h-4" />
              Админ-панель
            </button>
          )}
        </div>

        {/* Header / Title */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div 
              initial={{ height: 0, opacity: 0, marginBottom: 0 }}
              animate={{ height: "auto", opacity: 1, marginBottom: 32 }}
              exit={{ height: 0, opacity: 0, marginBottom: 0, overflow: "hidden" }}
              className="flex justify-between items-center"
            >
              <div className="flex items-center gap-4">
                <button
                  onClick={() => toggleSidebar()}
                  className="hidden lg:flex p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-colors"
                  aria-label="Toggle Sidebar"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <div>
                  <h1 className="text-2xl font-bold text-white mb-1">
                    {activeTab === "overview" && "Обзор проектов"}
                  {activeTab === "chat" && (activeSession ? activeSession.title : "Чат с аналитиком")}
                  {activeTab === "tree" && "Древо принятия решений"}
                  {activeTab === "admin" && "Админ-панель"}
                </h1>
                <p className="text-white/40 text-sm">
                  {activeTab === "overview" && "Управляйте вашими анализами и запускайте новые."}
                  {activeTab === "chat" && "Интерактивный анализ вашего стартапа."}
                  {activeTab === "tree" && "ИИ-визуализация готовности вашего стартапа."}
                  {activeTab === "admin" && "Управление пользователями, промокодами и аналитикой платформы."}
                </p>
              </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {activeTab === "overview" && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
            >
              {/* New Analysis Card Button */}
              <button
                onClick={() => {
                  setActiveSession(null);
                  setActiveTab("chat");
                }}
                className="flex flex-col items-center justify-center p-8 rounded-2xl border border-dashed border-white/20 hover:border-pitchy-violet/50 hover:bg-pitchy-violet/5 transition-all group h-[120px] md:h-auto cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <Plus className="w-6 h-6 text-white/50 group-hover:text-pitchy-violet" />
                </div>
                <span className="text-white/50 font-medium group-hover:text-white transition-colors">Новый анализ</span>
              </button>

              {sessions.map(session => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onClick={() => handleSelectSession(session.id)}
                  onDelete={(e) => handleDeleteSession(session.id, e)}
                />
              ))}

              {sessions.length === 0 && (
                <div className="col-span-full text-center py-12 text-white/30">
                  У вас пока нет анализов. Создайте первый!
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "chat" && (
            <motion.div
              key="chat"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="h-full flex-1 flex flex-col min-h-0"
            >
              {activeSession ? (
                <ChatInterface
                  session={activeSession}
                  onUpdate={(updated) => setActiveSession(updated)}
                />
              ) : (
                <div className="flex flex-col flex-1 h-full bg-[#131313] rounded-2xl border border-white/10 overflow-hidden relative items-center justify-center px-4">
                  <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />
                  <Star className="w-16 h-16 text-pitchy-violet/30 mb-6" />
                  <h3 className="text-xl sm:text-2xl font-bold text-white mb-2 text-center">Анализ проекта</h3>
                  <p className="text-sm text-white/50 mb-8 max-w-sm text-center">
                    Нажмите кнопку ниже, чтобы начать новый интерактивный анализ.
                  </p>

                  <button
                    onClick={handleCreateEmptySession}
                    disabled={isCreating}
                    className="px-6 py-3 bg-gradient-to-r from-pitchy-violet to-purple-600 font-medium text-white rounded-xl shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:shadow-[0_0_30px_rgba(168,85,247,0.6)] disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isCreating ? <Loader className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                    Начать новый анализ
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "tree" && (
            <motion.div
              key="tree"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="h-full"
            >
              <TreeView
                onSwitchToChat={(context) => {
                  if (context) {
                    handleCreateEmptySession();
                  }
                  setActiveTab("chat");
                }}
              />
            </motion.div>
          )}

          {activeTab === "admin" && userProfile?.is_admin && (
            <motion.div
              key="admin"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="h-full"
            >
              <AdminView />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function AuthDashboard() {
  return (
    <Layout>
      <Suspense fallback={
        <div className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center">
          <Loader className="w-8 h-8 animate-spin text-pitchy-violet" />
        </div>
      }>
        <DashboardContent />
      </Suspense>
    </Layout>
  );
}
