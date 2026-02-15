"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dayjs from "dayjs";
import {
  Search,
  Calendar,
  TrendingUp,
  MessageSquare,
  ArrowRight,
  LogOut,
  Loader2,
} from "lucide-react";
import { FadeContent } from "../reactbits/FadeContent";
import { AnimatedContent } from "../reactbits/AnimatedContent";
import { AnimatedButton } from "../ui-custom/AnimatedButton";
import {
  AnalysisItem,
  ChatSession,
  UserProfile,
  getAuthJson,
} from "@/lib/api";
import { getToken, clearToken } from "@/lib/auth";

export function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisItem[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"analyses" | "chats">("analyses");

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }
    const loadData = async () => {
      try {
        const [me, analysisList, chatSessions] = await Promise.all([
          getAuthJson<UserProfile>("/me", token),
          getAuthJson<AnalysisItem[]>("/analysis", token),
          getAuthJson<ChatSession[]>("/chat/sessions", token),
        ]);
        setProfile(me);
        setAnalyses(analysisList);
        setSessions(chatSessions);
      } catch {
        clearToken();
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [router]);

  const filteredAnalyses = analyses.filter(
    (a) =>
      !search.trim() ||
      (a.market_summary || "").toLowerCase().includes(search.toLowerCase()) ||
      a.strengths.some((s: string) =>
        s.toLowerCase().includes(search.toLowerCase())
      ) ||
      a.weaknesses.some((w: string) =>
        w.toLowerCase().includes(search.toLowerCase())
      )
  );

  const handleLogout = () => {
    clearToken();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center py-12">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <Loader2 className="w-8 h-8 text-violet-400" />
        </motion.div>
      </div>
    );
  }

  const scoreColor = (score: number) => {
    if (score >= 8) return "text-green-400";
    if (score >= 5) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] px-4 py-12 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-violet-950/10 via-transparent to-transparent pointer-events-none" />

      <div className="relative z-10 w-full max-w-5xl mx-auto">
        {/* Profile header */}
        <FadeContent delay={0.1}>
          <div className="flex items-center justify-between mb-10">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
                {profile?.name ? `Привет, ${profile.name}` : "Панель управления"}
              </h1>
              <p className="text-zinc-400">
                {profile?.email}
                {profile?.is_admin ? (
                  <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30">
                    Админ
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/account">
                <AnimatedButton variant="outline" size="sm">
                  Аккаунт
                </AnimatedButton>
              </Link>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleLogout}
                className="p-2 rounded-lg bg-zinc-800/50 text-zinc-400 hover:text-red-400 transition-colors"
                title="Выйти"
              >
                <LogOut className="w-5 h-5" />
              </motion.button>
            </div>
          </div>
        </FadeContent>

        {/* Stats cards */}
        <FadeContent delay={0.2}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              {
                label: "Всего анализов",
                value: analyses.length,
                icon: TrendingUp,
                color: "text-violet-400",
              },
              {
                label: "Сред. оценка",
                value:
                  analyses.length > 0
                    ? (
                      analyses.reduce(
                        (s, a) => s + a.investment_score,
                        0
                      ) / analyses.length
                    ).toFixed(1)
                    : "—",
                icon: TrendingUp,
                color: "text-green-400",
              },
              {
                label: "Чат-сессии",
                value: sessions.length,
                icon: MessageSquare,
                color: "text-blue-400",
              },
              {
                label: "В системе с",
                value: profile?.created_at
                  ? dayjs(profile.created_at).format("MMM YYYY")
                  : "—",
                icon: Calendar,
                color: "text-orange-400",
              },
            ].map((stat) => (
              <motion.div
                key={stat.label}
                whileHover={{ scale: 1.02 }}
                className="bg-zinc-900/60 backdrop-blur-sm border border-zinc-800 rounded-2xl p-5"
              >
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon className={`w-4 h-4 ${stat.color}`} />
                  <span className="text-xs text-zinc-500 uppercase tracking-wider">
                    {stat.label}
                  </span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {stat.value}
                </div>
              </motion.div>
            ))}
          </div>
        </FadeContent>

        {/* Tab switcher + search */}
        <FadeContent delay={0.3}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center bg-zinc-800/50 rounded-xl p-1">
              <button
                onClick={() => setActiveTab("analyses")}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === "analyses"
                  ? "bg-violet-600 text-white"
                  : "text-zinc-400 hover:text-white"
                  }`}
              >
                Анализы ({analyses.length})
              </button>
              <button
                onClick={() => setActiveTab("chats")}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === "chats"
                  ? "bg-violet-600 text-white"
                  : "text-zinc-400 hover:text-white"
                  }`}
              >
                Чат-сессии ({sessions.length})
              </button>
            </div>

            {activeTab === "analyses" ? (
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск анализов..."
                  className="w-full pl-10 pr-4 py-2.5 bg-zinc-900/80 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                />
              </div>
            ) : null}
          </div>
        </FadeContent>

        {/* Content */}
        <AnimatePresence mode="wait">
          {activeTab === "analyses" ? (
            <motion.div
              key="analyses"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3"
            >
              {filteredAnalyses.length === 0 ? (
                <div className="text-center py-16">
                  <TrendingUp className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                  <p className="text-zinc-500 mb-4">
                    {search.trim()
                      ? "Ничего не найдено."
                      : "Пока нет анализов. Запустите первый!"}
                  </p>
                  {!search.trim() ? (
                    <Link href="/">
                      <AnimatedButton size="sm" icon={<ArrowRight className="w-4 h-4" />}>
                        Анализировать стартап
                      </AnimatedButton>
                    </Link>
                  ) : null}
                </div>
              ) : (
                filteredAnalyses.map((analysis, index) => (
                  <AnimatedContent key={analysis.id} delay={index * 0.05}>
                    <motion.div
                      whileHover={{ scale: 1.005 }}
                      className="bg-zinc-900/60 backdrop-blur-sm border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
                            <span
                              className={`text-2xl font-bold ${scoreColor(
                                analysis.investment_score
                              )}`}
                            >
                              {analysis.investment_score}/10
                            </span>
                            <span className="text-xs text-zinc-500">
                              {dayjs(analysis.created_at).format(
                                "MMM D, YYYY HH:mm"
                              )}
                            </span>
                          </div>
                          <p className="text-sm text-zinc-400 line-clamp-2">
                            {analysis.market_summary}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {analysis.strengths.slice(0, 2).map((s: string) => (
                          <span
                            key={s}
                            className="px-2 py-0.5 text-xs rounded-full bg-green-500/10 text-green-400 border border-green-500/20"
                          >
                            {s.length > 40 ? `${s.slice(0, 40)}…` : s}
                          </span>
                        ))}
                        {analysis.weaknesses.slice(0, 1).map((w: string) => (
                          <span
                            key={w}
                            className="px-2 py-0.5 text-xs rounded-full bg-red-500/10 text-red-400 border border-red-500/20"
                          >
                            {w.length > 40 ? `${w.slice(0, 40)}…` : w}
                          </span>
                        ))}
                      </div>
                    </motion.div>
                  </AnimatedContent>
                ))
              )}
            </motion.div>
          ) : (
            <motion.div
              key="chats"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3"
            >
              {sessions.length === 0 ? (
                <div className="text-center py-16">
                  <MessageSquare className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                  <p className="text-zinc-500 mb-4">
                    Нет чат-сессий. Начните общение!
                  </p>
                  <Link href="/account">
                    <AnimatedButton size="sm" icon={<ArrowRight className="w-4 h-4" />}>
                      Открыть чат
                    </AnimatedButton>
                  </Link>
                </div>
              ) : (
                sessions.map((session, index) => (
                  <AnimatedContent key={session.id} delay={index * 0.05}>
                    <Link href="/account">
                      <motion.div
                        whileHover={{ scale: 1.005 }}
                        className="bg-zinc-900/60 backdrop-blur-sm border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                              <MessageSquare className="w-4 h-4 text-blue-400" />
                            </div>
                            <div>
                              <p className="text-white font-medium">
                                {session.title}
                              </p>
                              <p className="text-xs text-zinc-500">
                                {dayjs(session.created_at).format(
                                  "MMM D, YYYY HH:mm"
                                )}
                              </p>
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-zinc-600" />
                        </div>
                      </motion.div>
                    </Link>
                  </AnimatedContent>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
