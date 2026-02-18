"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  BarChart3,
  Plus,
  Search,
  TrendingUp,
  Activity,
  Star,
  Clock,
  Sparkles,
  Lock,
  ChevronRight,
} from "lucide-react";
import Layout from "@/components/Layout";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { AnalysisCard } from "@/components/dashboard/AnalysisCard";
import { GlassCard, Button } from "@/components/shared";
import { getToken } from "@/lib/auth";
import { postAuthJson, getAuthJson } from "@/lib/api";
import Link from "next/link";

interface AnalysisItem {
  id: number;
  name: string;
  description?: string; // Backend might not return description in list if not added to schema, but we use payload_text parsing for name/cat. 
  // Wait, backend AnalysisResponse does NOT have description. It has market_summary etc.
  // We should align with backend.
  category: string | null;
  investment_score: number;
  created_at: string;
  market_summary: string;
}

interface DashboardData {
  analyses: AnalysisItem[];
  totalAnalyses: number;
  userName: string;
}

const sidebarItems = [
  { icon: LayoutDashboard, label: "Обзор", id: "overview" },
  { icon: MessageSquare, label: "Чат", id: "chat" },
  { icon: BarChart3, label: "Аналитика", id: "analytics" },
];

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

      {/* Demo Teaser — Blurred */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 0.4, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mt-16 w-full max-w-5xl blur-sm pointer-events-none select-none"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { title: "Анализы", value: "24", icon: Activity, color: "violet" as const },
            { title: "Средний балл", value: "78", icon: Star, color: "cyan" as const },
            { title: "Тренд", value: "+12%", icon: TrendingUp, color: "emerald" as const },
            { title: "Сессии", value: "8", icon: Clock, color: "amber" as const },
          ].map((stat, i) => (
            <StatsCard key={i} {...stat} index={i} />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

/* ──── Authenticated Dashboard ──── */
function AuthDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [data, setData] = useState<DashboardData>({
    analyses: [],
    totalAnalyses: 0,
    userName: "",
  });
  const [loading, setLoading] = useState(true);

  // Data fetching
  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = getToken()!;
        const [meRes, analysisRes] = await Promise.all([
          postAuthJson<{ id: number; email: string; name: string }>("/me", {}, token),
          getAuthJson<AnalysisItem[]>("/analysis", token),
        ]);

        setData({
          analyses: Array.isArray(analysisRes) ? analysisRes : [],
          totalAnalyses: Array.isArray(analysisRes) ? analysisRes.length : 0,
          userName: meRes.name || meRes.email || "Пользователь",
        });
      } catch (error) {
        console.error("Dashboard fetch error:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-2 border-white/20 border-t-pitchy-violet rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-5rem)]">
      {/* Sidebar (Desktop) */}
      <motion.aside
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="hidden lg:flex flex-col w-64 border-r border-white/8 py-6 px-4"
      >
        <div className="mb-8">
          <p className="text-xs text-white/30 uppercase tracking-wider mb-2 px-3">
            Навигация
          </p>
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-1 cursor-pointer ${activeTab === item.id
                ? "bg-pitchy-violet/10 text-white border border-pitchy-violet/20"
                : "text-white/50 hover:text-white hover:bg-white/5"
                }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-auto">
          <GlassCard hover={false} className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-pitchy-violet" />
              <span className="text-xs font-medium text-white/70">Совет</span>
            </div>
            <p className="text-xs text-white/50 leading-relaxed">
              Используйте чат для уточнения деталей анализа.
            </p>
          </GlassCard>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 py-6 px-4 sm:px-6 lg:px-8 overflow-y-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8"
        >
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              {activeTab === "overview" && `Привет, ${data.userName}`}
              {activeTab === "chat" && "AI Ассистент"}
              {activeTab === "analytics" && "Аналитика"}
            </h1>
            <p className="text-white/50 text-sm mt-1">
              {activeTab === "overview" && "Ваша панель аналитики стартапов"}
              {activeTab === "chat" && "Задайте вопросы по вашим проектам"}
              {activeTab === "analytics" && "Статистика ваших анализов"}
            </p>
          </div>
          {activeTab === "overview" && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => router.push("/")}
            >
              Новый анализ
            </Button>
          )}
        </motion.div>

        {/* Tab Content */}
        {activeTab === "overview" && (
          <OverviewTab
            data={data}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />
        )}
        {activeTab === "chat" && <ChatTab />}
        {activeTab === "analytics" && <AnalyticsTab data={data} />}
      </main>

      {/* Bottom Nav (Mobile) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 glass-panel border-t border-white/8 z-30">
        <div className="flex items-center justify-around py-2">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center gap-1 p-2 rounded-lg cursor-pointer ${activeTab === item.id ? "text-pitchy-violet" : "text-white/40"
                }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ──── Sub-Components for Tabs ──── */

function OverviewTab({
  data,
  searchQuery,
  setSearchQuery,
}: {
  data: DashboardData;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}) {
  const filteredAnalyses = data.analyses.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const averageScore =
    data.analyses.length > 0
      ? Math.round(
        data.analyses.reduce((acc, curr) => acc + (curr.investment_score || 0), 0) /
        data.analyses.length
      )
      : 0;

  const stats = [
    {
      title: "Всего анализов",
      value: data.totalAnalyses.toString(),
      icon: Activity,
      color: "violet" as const,
    },
    {
      title: "Средний балл",
      value: averageScore.toString(),
      icon: Star,
      color: "cyan" as const,
    },
    {
      title: "Последняя сессия",
      value:
        data.analyses.length > 0
          ? new Date(data.analyses[0]?.created_at).toLocaleDateString("ru-RU")
          : "—",
      icon: Clock,
      color: "emerald" as const,
    },
    {
      title: "Категорий",
      value: new Set(data.analyses.map((a) => a.category).filter(Boolean)).size
        .toString(),
      icon: TrendingUp,
      color: "amber" as const,
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <StatsCard key={i} {...stat} index={i} />
        ))}
      </div>

      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-white">Ваши анализы</h2>
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по названию..."
              className="pitchy-input pl-10 py-2.5 text-sm"
            />
          </div>
        </div>

        {filteredAnalyses.length > 0 ? (
          <div className="space-y-3">
            {filteredAnalyses.map((analysis, index) => (
              <AnalysisCard
                key={analysis.id}
                analysis={{
                  id: analysis.id.toString(),
                  name: analysis.name,
                  score: analysis.investment_score,
                  category: analysis.category || "Не указана",
                  date: new Date(analysis.created_at).toLocaleDateString("ru-RU"),
                  summary: analysis.market_summary || "Нет описания",
                }}
                index={index}
              />
            ))}
          </div>
        ) : (
          <GlassCard hover={false} className="p-8 text-center">
            <BarChart3 className="w-10 h-10 text-white/20 mx-auto mb-3" />
            <p className="text-white/50 text-sm">
              {searchQuery
                ? "Ничего не найдено"
                : "Анализов пока нет. Начните с главной страницы!"}
            </p>
          </GlassCard>
        )}
      </div>
    </>
  );
}

function ChatTab() {
  // Placeholder for Chat Tab implementation
  return (
    <GlassCard hover={false} className="p-8 text-center min-h-[400px] flex flex-col items-center justify-center">
      <MessageSquare className="w-12 h-12 text-pitchy-violet mb-4" />
      <h3 className="text-xl font-bold text-white mb-2">Чат-ассистент</h3>
      <p className="text-white/50 max-w-md mx-auto">
        Функционал чата с поддержкой сохранения контекста и истории скоро будет доступен.
        Мы переносим его на новый движок.
      </p>
    </GlassCard>
  );
}

function AnalyticsTab({ data }: { data: DashboardData }) {
  return (
    <GlassCard hover={false} className="p-8 text-center min-h-[400px] flex flex-col items-center justify-center">
      <BarChart3 className="w-12 h-12 text-emerald-400 mb-4" />
      <h3 className="text-xl font-bold text-white mb-2">Расширенная аналитика</h3>
      <p className="text-white/50 max-w-md mx-auto mb-6">
        Здесь скоро появятся графики роста ваших проектов и сравнение с конкурентами.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="text-2xl font-bold text-white">{data.totalAnalyses}</div>
          <div className="text-xs text-white/40">Всего анализов</div>
        </div>
        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="text-2xl font-bold text-white">0</div>
          <div className="text-xs text-white/40">Успешных питчей</div>
        </div>
        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="text-2xl font-bold text-white">0%</div>
          <div className="text-xs text-white/40">Growth Rate</div>
        </div>
      </div>
    </GlassCard>
  );
}

/* ──── Dashboard Page ──── */
export default function DashboardPage() {
  const [isAuthed, setIsAuthed] = useState<boolean | null>(() => {
    if (typeof window === "undefined") return null;
    return !!getToken();
  });

  useEffect(() => {
    // If localStorage says not authed, try cookie-based /me to catch SSO logins
    if (isAuthed === false) {
      const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
      fetch(`${base}/me`, {
        method: "GET",
        credentials: "include",
      })
        .then((res) => {
          if (res.ok) {
            // Cookie auth works — sync localStorage
            if (typeof window !== "undefined") {
              window.localStorage.setItem("vi_auth_state", "1");
            }
            setIsAuthed(true);
          }
        })
        .catch(() => {
          /* ignore — user is genuinely not authed */
        });
    }
  }, [isAuthed]);

  if (isAuthed === null) {
    return (
      <Layout>
        <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-8 h-8 border-2 border-white/20 border-t-pitchy-violet rounded-full"
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {isAuthed ? <AuthDashboard /> : <UnauthDashboard />}
    </Layout>
  );
}
