"use client";

import { useState, useEffect, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  BarChart3,
  Plus,
  Sparkles,
  Lock,
  ChevronRight,
  Loader2,
  Shield
} from "lucide-react";
import Layout from "@/components/Layout";
// StatsCard unused
import { SessionCard } from "@/components/dashboard/SessionCard";
import { ChatInterface } from "@/components/dashboard/ChatInterface";
import { AdminView } from "@/components/dashboard/AdminView";
import { GlassCard, Button } from "@/components/shared";
import { getToken } from "@/lib/auth";
import {
  getChatSessions,
  getChatSession,
  createChatSessionAuto,
  createChatSessionFromIntent,
  ChatSessionResponse,
  ChatSessionDetailResponse,
  getMe,
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
  const [newChatDesc, setNewChatDesc] = useState("");
  const [isCreating, setIsCreating] = useState(false);

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

  const handleCreateAutoSession = async (message: string) => {
    if (!message.trim()) return;
    setIsCreating(true);
    try {
      const token = getToken();
      if (!token) throw new Error("No token");

      const session = await createChatSessionAuto(message, token);

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

  if (loading) {
    return (

      <Layout>
        <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-pitchy-violet animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated) return <Layout><UnauthDashboard /></Layout>;

  return (
    <Layout>
      <div className="flex min-h-[calc(100vh-5rem)]">
        {/* Sidebar (Desktop) */}
        <motion.aside
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="hidden lg:flex flex-col w-64 border-r border-white/10 py-6 px-4 shrink-0"
        >
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
              { id: "overview", label: "Обзор", icon: LayoutDashboard },
              { id: "chat", label: "Чат", icon: MessageSquare },
              { id: "analytics", label: "Аналитика", icon: BarChart3 }
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-1 text-left ${activeTab === item.id
                  ? "bg-white/10 text-white border border-white/10"
                  : "text-white/50 hover:text-white hover:bg-white/5"
                  }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}

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
                <Sparkles className="w-4 h-4 text-pitchy-violet" />
                <span className="text-xs font-bold text-white">PRO Совет</span>
              </div>
              <p className="text-xs text-white/60 leading-relaxed">
                Чем подробнее вы опишете проект в начале, тем точнее будет анализ.
              </p>
            </GlassCard>
          </div>
        </motion.aside>

        {/* content */}
        <main className="flex-1 py-6 px-4 sm:px-6 lg:px-8 overflow-hidden w-full">
          {/* Mobile Navigation (Tabs) */}
          <div className="flex lg:hidden overflow-x-auto gap-2 mb-6 pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
            {[
              { id: "overview", label: "Обзор", icon: LayoutDashboard },
              { id: "chat", label: "Чат", icon: MessageSquare },
              { id: "analytics", label: "Аналитика", icon: BarChart3 }
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === item.id
                  ? "bg-white/10 text-white border border-white/10 shadow-sm"
                  : "text-white/50 border border-transparent hover:text-white hover:bg-white/5"
                  }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}
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
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">
                {activeTab === "overview" && "Обзор проектов"}
                {activeTab === "chat" && (activeSession ? activeSession.title : "Чат с аналитиком")}
                {activeTab === "analytics" && "Статистика"}
                {activeTab === "admin" && "Админ-панель"}
              </h1>
              <p className="text-white/40 text-sm">
                {activeTab === "overview" && "Управляйте вашими анализами и запускайте новые."}
                {activeTab === "chat" && "Интерактивный анализ вашего стартапа."}
                {activeTab === "admin" && "Управление пользователями, промокодами и аналитикой платформы."}
              </p>
            </div>
            {/* Mobile Menu Toggle could go here if needed */}
            <div className="lg:hidden">
              {/* Simplified mobile nav just for context, mostly Layout handles it */}
            </div>
          </div>

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
                className="h-full"
              >
                {activeSession ? (
                  <ChatInterface
                    session={activeSession}
                    onUpdate={(updated) => setActiveSession(updated)}
                  />
                ) : (
                  <div className="flex flex-col h-[calc(100vh-12rem)] bg-white/5 rounded-2xl border border-white/10 overflow-hidden relative items-center justify-center px-4">
                    <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />
                    <Sparkles className="w-16 h-16 text-pitchy-violet/30 mb-6" />
                    <h3 className="text-xl sm:text-2xl font-bold text-white mb-2 text-center">О чем ваш проект?</h3>
                    <p className="text-sm text-white/50 mb-8 max-w-sm text-center">
                      Напишите нам, и мы мгновенно создадим аналитический чат.
                    </p>

                    <div className="w-full max-w-2xl bg-white/5 border border-white/10 rounded-2xl p-4 flex gap-2">
                      <textarea
                        value={newChatDesc}
                        onChange={(e) => setNewChatDesc(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleCreateAutoSession(newChatDesc);
                            setNewChatDesc("");
                          }
                        }}
                        placeholder="Опишите стартап..."
                        className="w-full bg-transparent text-white placeholder-white/30 min-h-[50px] max-h-[150px] outline-none resize-none px-2 py-2 text-sm sm:text-base scrollbar-none"
                        disabled={isCreating}
                        rows={1}
                      />
                      <button
                        onClick={() => {
                          handleCreateAutoSession(newChatDesc);
                          setNewChatDesc("");
                        }}
                        disabled={!newChatDesc.trim() || isCreating}
                        className="self-end p-3 rounded-xl bg-pitchy-violet text-white disabled:opacity-50 hover:bg-pitchy-violet/80 transition-colors"
                      >
                        {isCreating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "analytics" && (
              <div key="analytics" className="text-center py-20 text-white/30">
                <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>Раздел персональной аналитики в разработке.</p>
              </div>
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

    </Layout>
  );
}

export default function AuthDashboard() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-pitchy-bg"><Loader2 className="w-8 h-8 animate-spin text-pitchy-violet" /></div>}>
      <DashboardContent />
    </Suspense>
  );
}
