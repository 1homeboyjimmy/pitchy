import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import dayjs from "dayjs";
import { Users, Tag, BarChart2, Plus, Trash2, Shield, Loader, CreditCard } from "react-feather";
import { Button, GlassCard } from "@/components/shared";
import { getToken } from "@/lib/auth";
import { AreaChart } from "@mantine/charts";
import { notifyError, confirmAction } from "@/lib/ui";

// Temporary Types mapping what API returns
type PromoCode = {
    id: number;
    code: string;
    discount_percent: number;
    max_uses: number | null;
    current_uses: number;
    expires_at: string | null;
    target_tier?: string | null;
    fixed_price?: number | null;
    created_at: string;
};

type User = {
    id: number;
    name: string;
    email: string;
    is_admin: boolean;
    is_active: boolean;
    subscription_tier: string;
    created_at: string;
    privacy_consent_at?: string | null;
    cookies_consent_at?: string | null;
};

type AnalyticsData = {
    totals: {
        users: number;
        analyses: number;
        analyses_anon: number;
        chat_sessions: number;
        chat_sessions_anon: number;
        subscriptions: number;
    };
    series: Record<string, string | number>[];
};

type Subscription = {
    user_id: number;
    email: string;
    name: string;
    subscription_tier: string;
    subscription_expires_at: string | null;
    is_active: boolean;
    last_payment_date: string | null;
    last_payment_amount: number | null;
    last_payment_status: string | null;
    promo_code_used: string | null;
    total_payments: number;
    total_spent: number;
};

type RagLog = {
    id: number;
    source_url: string;
    source_type: string;
    status: string;
    chunks_added: number;
    error_message: string | null;
    created_at: string;
};

export function AdminView() {
    const [activeTab, setActiveTab] = useState<"analytics" | "promocodes" | "users" | "subscriptions" | "rag">("users");
    const [loading, setLoading] = useState(true);
    const [promocodes, setPromocodes] = useState<PromoCode[]>([]);
    const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [analyticsTimeFilter, setAnalyticsTimeFilter] = useState<"24h" | "3d" | "1w" | "1m" | "6m" | "1y">("1w");

    // RAG State
    const [ragLogs, setRagLogs] = useState<RagLog[]>([]);
    const [ragLogsTotal, setRagLogsTotal] = useState<number>(0);
    const [ragUrl, setRagUrl] = useState("");
    const [ragFile, setRagFile] = useState<File | null>(null);
    const [isScraping, setIsScraping] = useState(false);
    const [ragResult, setRagResult] = useState<{ success: boolean, message: string } | null>(null);

    // RAG Crawl State
    const [crawlUrl, setCrawlUrl] = useState("");
    const [crawlIsSitemap, setCrawlIsSitemap] = useState(false);
    const [crawlMaxPages, setCrawlMaxPages] = useState(50);

    // RAG Visualization State
    const [vizStatus, setVizStatus] = useState<"idling" | "processing">("idling");

    // New Promo Form
    const [newPromo, setNewPromo] = useState({ code: "", discount_percent: 10, max_uses: "", target_tier: "", fixed_price: "" });

    // Use relative paths so Next.js rewrites proxy to backend
    const API_BASE = "";

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const token = getToken();
                if (!token) return;

                if (activeTab === "promocodes") {
                    const res = await fetch(`${API_BASE}/admin/promocodes`, {
                        headers: { "Authorization": `Bearer ${token}` }
                    });
                    if (res.status === 401) {
                        window.localStorage.removeItem("vi_auth_state");
                        window.location.href = "/login?expired=1";
                        return;
                    }
                    if (res.ok) setPromocodes(await res.json());
                } else if (activeTab === "analytics") {
                    const endStr = dayjs().format("YYYY-MM-DD");
                    const startStr = dayjs().subtract(30, "day").format("YYYY-MM-DD");
                    
                    const res = await fetch(`${API_BASE}/admin/analytics?start=${startStr}&end=${endStr}`, {
                        headers: { "Authorization": `Bearer ${token}` }
                    });
                    if (res.status === 401) {
                        window.localStorage.removeItem("vi_auth_state");
                        window.location.href = "/login?expired=1";
                        return;
                    }
                    if (res.ok) setAnalytics(await res.json());
                } else if (activeTab === "users") {
                    const res = await fetch(`${API_BASE}/admin/users`, {
                        headers: { "Authorization": `Bearer ${token}` }
                    });
                    if (res.status === 401) {
                        window.localStorage.removeItem("vi_auth_state");
                        window.location.href = "/login?expired=1";
                        return;
                    }
                    if (res.ok) setUsers(await res.json());
                } else if (activeTab === "subscriptions") {
                    const res = await fetch(`${API_BASE}/admin/subscriptions`, {
                        headers: { "Authorization": `Bearer ${token}` }
                    });
                    if (res.status === 401) {
                        window.localStorage.removeItem("vi_auth_state");
                        window.location.href = "/login?expired=1";
                        return;
                    }
                    if (res.ok) setSubscriptions(await res.json());
                } else if (activeTab === "rag") {
                    fetchVizStatus();
                    const res = await fetch(`${API_BASE}/admin/rag/logs`, {
                        headers: { "Authorization": `Bearer ${token}` }
                    });
                    if (res.status === 401) {
                        window.localStorage.removeItem("vi_auth_state");
                        window.location.href = "/login?expired=1";
                        return;
                    }
                    if (res.ok) {
                        const data = await res.json();
                        setRagLogs(data.items || []);
                        setRagLogsTotal(data.total || 0);
                    }
                }
            } catch (e) {
                console.error("Admin fetch error", e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [activeTab, API_BASE, analyticsTimeFilter]);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (activeTab === "rag" && vizStatus === "processing") {
            interval = setInterval(fetchVizStatus, 5000);
        }
        return () => clearInterval(interval);
    }, [activeTab, vizStatus]);

    const fetchVizStatus = async () => {
        try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/admin/rag/viz/status`, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setVizStatus(data.status);
            }
        } catch (e) {
            console.error("Fetch viz status error", e);
        }
    };

    const handleRebuildViz = async () => {
        try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/admin/rag/viz/rebuild`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) {
                setVizStatus("processing");
            }
        } catch (e) {
            console.error("Rebuild viz error", e);
        }
    };

    const handleCreatePromo = async () => {
        try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/admin/promocodes`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    code: newPromo.code.toUpperCase(),
                    discount_percent: newPromo.discount_percent,
                    max_uses: newPromo.max_uses ? parseInt(newPromo.max_uses) : null,
                    target_tier: newPromo.target_tier.trim() || null,
                    fixed_price: newPromo.fixed_price ? parseFloat(newPromo.fixed_price) : null
                })
            });

            if (res.ok) {
                const created = await res.json();
                setPromocodes([created, ...promocodes]);
                setNewPromo({ code: "", discount_percent: 10, max_uses: "", target_tier: "", fixed_price: "" });
            } else {
                notifyError("Не удалось создать промокод. Возможно, такой код уже существует.");
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleDeletePromo = async (id: number) => {
        const ok = await confirmAction({
            title: "Удалить промокод?",
            message: "Промокод будет удалён. Это действие нельзя отменить.",
            confirmLabel: "Удалить",
            danger: true,
        });
        if (!ok) return;
        try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/admin/promocodes/${id}`, {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) {
                setPromocodes(promocodes.filter(p => p.id !== id));
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleScrapeRAG = async () => {
        if (!ragUrl) return;
        setIsScraping(true);
        setRagResult(null);
        try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/admin/rag/add-url`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ url: ragUrl })
            });
            if (res.status === 401) {
                window.localStorage.removeItem("vi_auth_state");
                window.location.href = "/login?expired=1";
                return;
            }
            const data = await res.json();

            if (res.ok) {
                setRagResult({ success: true, message: data.message });
                setRagUrl("");
            } else {
                setRagResult({ success: false, message: data.detail || "Произошла ошибка при обработке URL." });
            }
        } catch {
            setRagResult({ success: false, message: "Не удалось подключиться к серверу." });
        } finally {
            setIsScraping(false);
        }
    };

    const handleCrawlRAG = async () => {
        if (!crawlUrl) return;
        setIsScraping(true);
        setRagResult(null);
        try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/admin/rag/crawl`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    url: crawlUrl,
                    is_sitemap: crawlIsSitemap,
                    max_pages: crawlMaxPages
                })
            });
            if (res.status === 401) {
                window.localStorage.removeItem("vi_auth_state");
                window.location.href = "/login?expired=1";
                return;
            }
            const data = await res.json();

            if (res.ok) {
                setRagResult({ success: true, message: data.message });
                setCrawlUrl("");
            } else {
                setRagResult({ success: false, message: data.detail || "Произошла ошибка при запуске сканирования." });
            }
        } catch {
            setRagResult({ success: false, message: "Не удалось подключиться к серверу." });
        } finally {
            setIsScraping(false);
        }
    };

    const handleUploadPDF = async () => {
        if (!ragFile) return;
        setIsScraping(true);
        setRagResult(null);
        try {
            const token = getToken();
            const formData = new FormData();
            formData.append("file", ragFile);

            const res = await fetch(`${API_BASE}/admin/rag/add-pdf`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`
                    // Do NOT set Content-Type header manually when using FormData
                },
                body: formData
            });
            if (res.status === 401) {
                window.localStorage.removeItem("vi_auth_state");
                window.location.href = "/login?expired=1";
                return;
            }
            const data = await res.json();

            if (res.ok) {
                setRagResult({ success: true, message: data.message });
                setRagFile(null);
            } else {
                setRagResult({ success: false, message: data.detail || "Произошла ошибка при обработке PDF." });
            }
        } catch {
            setRagResult({ success: false, message: "Не удалось подключиться к серверу." });
        } finally {
            setIsScraping(false);
        }
    };

    const handleUserAction = async (userId: number, action: "block" | "unblock" | "make-admin" | "delete") => {
        let title = "Подтверждение";
        let message = "";
        let confirmLabel = "Подтвердить";
        let danger = false;
        if (action === "block") { title = "Заблокировать пользователя?"; message = "Пользователь не сможет войти в аккаунт."; confirmLabel = "Заблокировать"; danger = true; }
        else if (action === "unblock") { title = "Разблокировать пользователя?"; message = "Доступ к аккаунту будет восстановлен."; confirmLabel = "Разблокировать"; }
        else if (action === "make-admin") { title = "Назначить администратором?"; message = "Пользователь получит полные права администратора."; confirmLabel = "Назначить"; }
        else if (action === "delete") { title = "Удалить пользователя навсегда?"; message = "Все данные пользователя будут удалены. Это действие нельзя отменить."; confirmLabel = "Удалить"; danger = true; }

        const ok = await confirmAction({ title, message, confirmLabel, danger });
        if (!ok) return;

        try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/admin/users/${userId}${action === "delete" ? "" : `/${action}`}`, {
                method: action === "delete" ? "DELETE" : "POST",
                headers: { "Authorization": `Bearer ${token}` }
            });

            if (res.ok) {
                if (action === "delete") {
                    setUsers(users.filter(u => u.id !== userId));
                } else {
                    // Update user locally
                    setUsers(users.map(u => {
                        if (u.id === userId) {
                            if (action === "block") return { ...u, is_active: false };
                            if (action === "unblock") return { ...u, is_active: true };
                            if (action === "make-admin") return { ...u, is_admin: true };
                        }
                        return u;
                    }));
                }
            } else {
                notifyError("Не удалось выполнить действие.");
            }
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex gap-2 border-b border-white/10 pb-4 overflow-x-auto thin-scrollbar">
                <button
                    onClick={() => setActiveTab("users")}
                    className={`flex items-center gap-2 px-4 py-2 font-mono-label text-[10px] uppercase font-bold tracking-widest transition-all whitespace-nowrap ${activeTab === "users" ? "bg-white text-black" : "border border-white/10 text-white/50 hover:text-white bg-[#111111]"
                        }`}
                >
                    <Users className="w-3.5 h-3.5" /> Пользователи
                </button>
                <button
                    onClick={() => setActiveTab("promocodes")}
                    className={`flex items-center gap-2 px-4 py-2 font-mono-label text-[10px] uppercase font-bold tracking-widest transition-all whitespace-nowrap ${activeTab === "promocodes" ? "bg-white text-black" : "border border-white/10 text-white/50 hover:text-white bg-[#111111]"
                        }`}
                >
                    <Tag className="w-3.5 h-3.5" /> Промокоды
                </button>
                <button
                    onClick={() => setActiveTab("analytics")}
                    className={`flex items-center gap-2 px-4 py-2 font-mono-label text-[10px] uppercase font-bold tracking-widest transition-all whitespace-nowrap ${activeTab === "analytics" ? "bg-white text-black" : "border border-white/10 text-white/50 hover:text-white bg-[#111111]"
                        }`}
                >
                    <BarChart2 className="w-3.5 h-3.5" /> Аналитика
                </button>
                <button
                    onClick={() => setActiveTab("subscriptions")}
                    className={`flex items-center gap-2 px-4 py-2 font-mono-label text-[10px] uppercase font-bold tracking-widest transition-all whitespace-nowrap ${activeTab === "subscriptions" ? "bg-white text-black" : "border border-white/10 text-white/50 hover:text-white bg-[#111111]"
                        }`}
                >
                    <CreditCard className="w-3.5 h-3.5" /> Подписки
                </button>
                <button
                    onClick={() => setActiveTab("rag")}
                    className={`flex items-center gap-2 px-4 py-2 font-mono-label text-[10px] uppercase font-bold tracking-widest transition-all whitespace-nowrap ${activeTab === "rag" ? "bg-white text-black" : "border border-white/10 text-white/50 hover:text-white bg-[#111111]"
                        }`}
                >
                    <Shield className="w-3.5 h-3.5" /> RAG База
                </button>
            </div>

            {loading ? (
                <div className="py-12 flex justify-center">
                    <Loader className="w-8 h-8 text-white animate-spin" />
                </div>
            ) : (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    {activeTab === "promocodes" && (
                        <div className="space-y-6">
                            {/* Create new promo form */}
                            <div className="p-6 bg-[#111111] border border-white/10">
                                <h3 className="text-xl font-display font-bold text-white mb-6 uppercase tracking-tight">Создать промокод</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
                                    <input
                                        type="text"
                                        placeholder="Код (например TITLE20)"
                                        value={newPromo.code}
                                        onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value })}
                                        className="bg-black border border-white/10 px-4 py-2 text-white outline-none focus:border-white/30 font-code text-[13px]"
                                    />
                                    <input
                                        type="number"
                                        placeholder="% Скидки"
                                        min="0" max="100"
                                        value={newPromo.discount_percent}
                                        onChange={(e) => setNewPromo({ ...newPromo, discount_percent: parseInt(e.target.value) || 0 })}
                                        className="bg-black border border-white/10 px-4 py-2 text-white outline-none focus:border-white/30 font-code text-[13px]"
                                    />
                                    <input
                                        type="number"
                                        placeholder="Кол-во использований (не обяз.)"
                                        value={newPromo.max_uses}
                                        onChange={(e) => setNewPromo({ ...newPromo, max_uses: e.target.value })}
                                        className="bg-black border border-white/10 px-4 py-2 text-white outline-none focus:border-white/30 w-full font-code text-[13px]"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Тариф (напр. tester)"
                                        value={newPromo.target_tier}
                                        onChange={(e) => setNewPromo({ ...newPromo, target_tier: e.target.value })}
                                        className="bg-black border border-white/10 px-4 py-2 text-white outline-none focus:border-white/30 font-code text-[13px]"
                                    />
                                    <input
                                        type="number"
                                        placeholder="Фикс. цена в ₽ (напр. 1)"
                                        value={newPromo.fixed_price}
                                        onChange={(e) => setNewPromo({ ...newPromo, fixed_price: e.target.value })}
                                        className="bg-black border border-white/10 px-4 py-2 text-white outline-none focus:border-white/30 font-code text-[13px]"
                                    />
                                    <button
                                        onClick={handleCreatePromo}
                                        disabled={!newPromo.code.trim()}
                                        className="flex items-center justify-center gap-2 px-4 py-2 bg-white text-black font-mono-label text-[10px] uppercase font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                                    >
                                        <Plus className="w-3.5 h-3.5" /> Добавить
                                    </button>
                                </div>
                            </div>

                            {/* Promo codes list */}
                            <div className="bg-[#111111] border border-white/10">
                                <table className="w-full text-left text-sm text-white font-code">
                                    <thead className="bg-[#0A0A0A] text-white/50 border-b border-white/10 font-mono-label uppercase text-[10px] tracking-widest">
                                        <tr>
                                            <th className="px-6 py-4 font-bold">КОД</th>
                                            <th className="px-6 py-4 font-bold text-center">СКИДКА %</th>
                                            <th className="px-6 py-4 font-bold text-center">ТАРИФ/ЦЕНА</th>
                                            <th className="px-6 py-4 font-bold text-center">ИСПОЛЬЗОВАНО</th>
                                            <th className="px-6 py-4 font-bold text-right">ДЕЙСТВИЕ</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {promocodes.map(promo => (
                                            <tr key={promo.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4 font-bold tracking-wider">{promo.code}</td>
                                                <td className="px-6 py-4 text-center">{promo.discount_percent}%</td>
                                                <td className="px-6 py-4 text-center text-white/70">
                                                    {promo.target_tier ? (
                                                        <span className="bg-white/10 text-white px-2 py-0.5 border border-white/20 text-xs font-mono-label uppercase">{promo.target_tier}</span>
                                                    ) : "—"}
                                                    {promo.fixed_price && <span className="ml-2 text-xs">{promo.fixed_price} ₽</span>}
                                                </td>
                                                <td className="px-6 py-4 text-center text-white/50">
                                                    {promo.current_uses} / {promo.max_uses ? promo.max_uses : '∞'}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <button onClick={() => handleDeletePromo(promo.id)} className="text-red-400 hover:text-red-300 p-2 transition-colors">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {promocodes.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="px-6 py-8 text-center text-white/30">Нет активных промокодов</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === "analytics" && analytics && (
                        <div className="space-y-6 mt-6">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xl font-display font-bold text-white uppercase tracking-tight">Аналитика платформы</h3>
                                <div className="flex bg-[#111111] border border-white/10 p-1">
                                    {[
                                        { label: "24 часа", value: "24h" },
                                        { label: "3 дня", value: "3d" },
                                        { label: "Неделя", value: "1w" },
                                        { label: "Месяц", value: "1m" },
                                        { label: "Полгода", value: "6m" },
                                        { label: "Год", value: "1y" },
                                    ].map((opt) => (
                                        <button
                                            key={opt.value}
                                            onClick={() => setAnalyticsTimeFilter(opt.value as "24h" | "3d" | "1w" | "1m" | "6m" | "1y")}
                                            className={`px-3 py-1.5 font-mono-label text-[10px] uppercase font-bold tracking-widest transition-colors ${analyticsTimeFilter === opt.value
                                                ? "bg-white text-black"
                                                : "text-white/50 hover:text-white bg-transparent"
                                                }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="bg-[#111111] border border-white/10 p-6">
                                    <p className="text-white/50 font-mono-label text-[10px] uppercase tracking-widest mb-2">Всего пользователей</p>
                                    <p className="text-3xl font-mono text-white font-bold">{analytics.totals.users}</p>
                                </div>
                                <div className="bg-[#111111] border border-white/10 p-6">
                                    <p className="text-white/50 font-mono-label text-[10px] uppercase tracking-widest mb-2">Чат-сессий</p>
                                    <p className="text-3xl font-mono text-white font-bold flex items-end gap-2">
                                        {analytics.totals.chat_sessions}
                                        <span className="text-xs text-white/40 mb-1 font-code">(анон: {analytics.totals.chat_sessions_anon})</span>
                                    </p>
                                </div>
                                <div className="bg-[#111111] border border-white/10 p-6">
                                    <p className="text-white/50 font-mono-label text-[10px] uppercase tracking-widest mb-2">Количество подписок</p>
                                    <p className="text-3xl font-mono text-white font-bold flex items-end gap-2">
                                        {analytics.totals.subscriptions}
                                    </p>
                                </div>
                                <div className="bg-[#111111] border border-white/10 p-6">
                                    <p className="text-white/50 font-mono-label text-[10px] uppercase tracking-widest mb-2">Конверсия (%)</p>
                                    <p className="text-3xl font-mono text-white font-bold flex items-end gap-2">
                                        {analytics.totals.users > 0 ? ((analytics.totals.subscriptions / analytics.totals.users) * 100).toFixed(2) : "0.00"}%
                                    </p>
                                </div>
                            </div>

                            <div className="bg-[#111111] border border-white/10 p-6">
                                <h4 className="text-white font-mono-label text-[12px] uppercase tracking-widest mb-6">Динамика регистраций (Всего пользователей)</h4>
                                <AreaChart
                                    h={280}
                                    data={analytics.series.map(s => ({
                                        ...s,
                                        conversion: s.users && Number(s.users) > 0 ? Number(((Number(s.subscriptions) / Number(s.users)) * 100).toFixed(2)) : 0
                                    }))}
                                    dataKey="date"
                                    curveType="linear"
                                    series={[{ name: "users", color: "gray.5", label: "Пользователи" }]}
                                    withGradient
                                    gridAxis="xy"
                                    textColor="rgba(255, 255, 255, 0.5)"
                                    withDots={false}
                                    yAxisProps={{ ticks: [0, 20, 40, 60, 80], domain: [0, 80] }}
                                    xAxisProps={{ interval: "preserveStartEnd" }}
                                />
                            </div>

                            <div className="bg-[#111111] border border-white/10 p-6">
                                <h4 className="text-white font-mono-label text-[12px] uppercase tracking-widest mb-6">Активность (Чат-сессии)</h4>
                                <AreaChart
                                    h={280}
                                    data={analytics.series.map(s => ({
                                        ...s,
                                        conversion: s.users && Number(s.users) > 0 ? Number(((Number(s.subscriptions) / Number(s.users)) * 100).toFixed(2)) : 0
                                    }))}
                                    dataKey="date"
                                    curveType="linear"
                                    series={[{ name: "chat_sessions", color: "gray.5", label: "Сессии" }]}
                                    withGradient
                                    gridAxis="xy"
                                    textColor="rgba(255, 255, 255, 0.5)"
                                    withDots={false}
                                    yAxisProps={{ ticks: [0, 50, 100, 150, 200], domain: [0, 200] }}
                                    xAxisProps={{ interval: "preserveStartEnd" }}
                                />
                            </div>

                            <div className="bg-[#111111] border border-white/10 p-6">
                                <h4 className="text-white font-mono-label text-[12px] uppercase tracking-widest mb-6">Рост платных подписок</h4>
                                <AreaChart
                                    h={280}
                                    data={analytics.series.map(s => ({
                                        ...s,
                                        conversion: s.users && Number(s.users) > 0 ? Number(((Number(s.subscriptions) / Number(s.users)) * 100).toFixed(2)) : 0
                                    }))}
                                    dataKey="date"
                                    curveType="linear"
                                    series={[{ name: "subscriptions", color: "gray.3", label: "Подписки" }]}
                                    withGradient
                                    gridAxis="xy"
                                    textColor="rgba(255, 255, 255, 0.5)"
                                    withDots={false}
                                    yAxisProps={{ ticks: [0, 10, 20, 30, 40], domain: [0, 40] }}
                                    xAxisProps={{ interval: "preserveStartEnd" }}
                                />
                            </div>

                            <div className="bg-[#111111] border border-white/10 p-6">
                                <h4 className="text-white font-mono-label text-[12px] uppercase tracking-widest mb-6">Изменение конверсии (%)</h4>
                                <AreaChart
                                    h={280}
                                    data={analytics.series.map(s => ({
                                        ...s,
                                        conversion: s.users && Number(s.users) > 0 ? Number(((Number(s.subscriptions) / Number(s.users)) * 100).toFixed(2)) : 0
                                    }))}
                                    dataKey="date"
                                    curveType="linear"
                                    series={[{ name: "conversion", color: "gray.7", label: "Конверсия (%)" }]}
                                    withGradient
                                    gridAxis="xy"
                                    textColor="rgba(255, 255, 255, 0.5)"
                                    withDots={false}
                                    xAxisProps={{ interval: "preserveStartEnd" }}
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === "users" && (
                        <div className="space-y-6">
                            <div className="bg-[#111111] border border-white/10 overflow-hidden overflow-x-auto">
                                <table className="w-full text-left text-sm text-white min-w-[800px] font-code">
                                    <thead className="bg-[#0A0A0A] text-white/50 border-b border-white/10 font-mono-label uppercase text-[10px] tracking-widest">
                                        <tr>
                                            <th className="px-6 py-4 font-bold">ПОЛЬЗОВАТЕЛЬ</th>
                                            <th className="px-6 py-4 font-bold">СТАТУС & РОЛЬ</th>
                                            <th className="px-6 py-4 font-bold">ДАТА РЕГИСТРАЦИИ</th>
                                            <th className="px-6 py-4 font-bold text-center">ТАРИФ</th>
                                            <th className="px-6 py-4 font-bold text-center">СОГЛАСИЯ</th>
                                            <th className="px-6 py-4 font-bold text-right">ДЕЙСТВИЕ</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.map(u => (
                                            <tr key={u.id} className={`border-b border-white/5 hover:bg-white/5 transition-colors ${!u.is_active ? 'opacity-50' : ''}`}>
                                                <td className="px-6 py-4">
                                                    <div className="font-bold tracking-tight">{u.name || "Без имени"}</div>
                                                    <div className="text-white/50 text-[11px] font-mono mt-1">{u.email}</div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col items-start gap-1">
                                                        {u.is_admin ? (
                                                            <span className="text-[10px] font-mono-label uppercase tracking-widest bg-white/10 text-white px-2 py-0.5 border border-white/20">Админ</span>
                                                        ) : (
                                                            <span className="text-[10px] font-mono-label uppercase tracking-widest bg-[#0A0A0A] border border-white/10 text-white/50 px-2 py-0.5">Юзер</span>
                                                        )}
                                                        {!u.is_active && (
                                                            <span className="text-[10px] font-mono-label uppercase tracking-widest bg-red-500/10 text-red-400 px-2 py-0.5 border border-red-500/20 mt-1">Заблокирован</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-white/70 text-[13px]">
                                                    {u.created_at ? new Date(u.created_at).toLocaleDateString("ru-RU", { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : "—"}
                                                </td>
                                                <td className="px-6 py-4 text-center text-white/70 font-mono-label uppercase text-[11px]">
                                                    {u.subscription_tier}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <div className="flex justify-center gap-1.5" title={`Политика: ${u.privacy_consent_at ? new Date(u.privacy_consent_at).toLocaleString('ru-RU') : '—'}\nCookies: ${u.cookies_consent_at ? new Date(u.cookies_consent_at).toLocaleString('ru-RU') : '—'}`}>
                                                        <span className={`text-[10px] font-mono-label uppercase tracking-widest px-1.5 py-0.5 border ${u.privacy_consent_at ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/5 text-white/30 border-white/10'}`}>П</span>
                                                        <span className={`text-[10px] font-mono-label uppercase tracking-widest px-1.5 py-0.5 border ${u.cookies_consent_at ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/5 text-white/30 border-white/10'}`}>C</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        {u.is_active ? (
                                                            <button onClick={() => handleUserAction(u.id, "block")} className="text-amber-400 hover:text-amber-300 font-mono-label uppercase text-[10px] tracking-widest px-2 py-1 border border-amber-500/20 bg-amber-500/10 transition-colors">Блок</button>
                                                        ) : (
                                                            <button onClick={() => handleUserAction(u.id, "unblock")} className="text-emerald-400 hover:text-emerald-300 font-mono-label uppercase text-[10px] tracking-widest px-2 py-1 border border-emerald-500/20 bg-emerald-500/10 transition-colors">Разблок</button>
                                                        )}
                                                        {!u.is_admin && (
                                                            <button onClick={() => handleUserAction(u.id, "make-admin")} className="text-white hover:text-black hover:bg-white font-mono-label uppercase text-[10px] tracking-widest px-2 py-1 border border-white/20 bg-white/5 transition-colors" title="Сделать админом">Админ</button>
                                                        )}
                                                        <button onClick={() => handleUserAction(u.id, "delete")} className="text-red-400 hover:text-red-300 font-mono-label uppercase text-[10px] tracking-widest px-2 py-1 border border-red-500/20 bg-red-500/10 transition-colors" title="Удалить"><Trash2 className="w-3 h-3" /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {users.length === 0 && (
                                            <tr>
                                                <td colSpan={6} className="px-6 py-8 text-center text-white/30 font-code">Нет пользователей</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === "subscriptions" && (
                        <div className="space-y-4">
                            <div className="bg-[#111111] border border-white/10 p-6">
                                <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
                                    <h3 className="text-xl font-display font-bold text-white uppercase tracking-tight">Платные пользователи</h3>
                                    <span className="font-mono-label text-[10px] uppercase tracking-widest text-white/40">{subscriptions.length} подписок</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm font-code">
                                        <thead>
                                            <tr className="text-white/50 border-b border-white/10 font-mono-label uppercase text-[10px] tracking-widest">
                                                <th className="text-left px-4 py-3 font-bold">Email</th>
                                                <th className="text-left px-4 py-3 font-bold">Имя</th>
                                                <th className="text-left px-4 py-3 font-bold">Тариф</th>
                                                <th className="text-left px-4 py-3 font-bold">Статус</th>
                                                <th className="text-left px-4 py-3 font-bold">Окончание</th>
                                                <th className="text-left px-4 py-3 font-bold">Платежи</th>
                                                <th className="text-left px-4 py-3 font-bold">Сумма</th>
                                                <th className="text-left px-4 py-3 font-bold">Промокод</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {subscriptions.map((sub) => (
                                                <tr key={sub.user_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                    <td className="px-4 py-4 text-white/80 text-[13px]">{sub.email}</td>
                                                    <td className="px-4 py-4 text-white/60 text-[13px]">{sub.name}</td>
                                                    <td className="px-4 py-4">
                                                        <span className={`px-2 py-0.5 border text-[10px] font-mono-label uppercase tracking-widest ${sub.subscription_tier === "premium"
                                                            ? "bg-white text-black border-white"
                                                            : "bg-[#0A0A0A] text-white/70 border-white/20"
                                                            }`}>
                                                            {sub.subscription_tier}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-4">
                                                        <span className={`px-2 py-0.5 border text-[10px] font-mono-label uppercase tracking-widest ${sub.is_active
                                                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                            : "bg-red-500/10 text-red-400 border-red-500/20"
                                                            }`}>
                                                            {sub.is_active ? "Активна" : "Истекла"}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-4 text-white/60 text-[13px]">
                                                        {sub.subscription_expires_at
                                                            ? new Date(sub.subscription_expires_at).toLocaleDateString("ru-RU")
                                                            : "—"}
                                                    </td>
                                                    <td className="px-4 py-4 text-white/60 text-[13px]">{sub.total_payments}</td>
                                                    <td className="px-4 py-4 text-white/80 font-bold tracking-wider">{sub.total_spent.toFixed(0)} ₽</td>
                                                    <td className="px-4 py-4">
                                                        {sub.promo_code_used ? (
                                                            <span className="px-2 py-0.5 border border-white/20 text-[10px] font-mono-label uppercase tracking-widest bg-white/5 text-white">{sub.promo_code_used}</span>
                                                        ) : (
                                                            <span className="text-white/20 text-[10px]">—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                            {subscriptions.length === 0 && (
                                                <tr>
                                                    <td colSpan={8} className="px-6 py-8 text-center text-white/30 font-code">Нет платных пользователей</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === "rag" && (
                        <div className="space-y-6 max-w-2xl">
                            <div className="bg-[#111111] border border-white/10 p-6">
                                <h3 className="text-xl font-display font-bold text-white mb-2 uppercase tracking-tight">Обновление базы знаний (RAG)</h3>
                                <p className="text-white/60 mb-6 font-code text-[13px] leading-relaxed">
                                    Вставьте ссылку на любую статью, регламент или документацию. Система скачает страницу, удалит лишний мусор (HTML/рекламу), нарежет текст на куски и добавит в векторную базу данных. ИИ мгновенно научится отвечать с учётом этой новой информации.
                                </p>

                                <div className="flex gap-4">
                                    <input
                                        type="url"
                                        placeholder="https://example.com/company-policy"
                                        value={ragUrl}
                                        onChange={(e) => setRagUrl(e.target.value)}
                                        className="flex-1 bg-black border border-white/10 px-4 py-3 text-white outline-none focus:border-white/30 transition-colors font-code text-[13px]"
                                        disabled={isScraping}
                                    />
                                    <button
                                        onClick={handleScrapeRAG}
                                        disabled={!ragUrl.trim() || isScraping}
                                        className="flex items-center justify-center gap-2 px-6 py-2 bg-white text-black font-mono-label text-[10px] uppercase font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                                    >
                                        {isScraping ? (
                                            <Loader className="w-4 h-4 animate-spin" />
                                        ) : (
                                            "Отправить URL"
                                        )}
                                    </button>
                                </div>

                                <div className="my-6 border-b border-white/10"></div>

                                <h4 className="text-white font-mono-label text-[12px] uppercase tracking-widest mb-3">Или загрузите PDF-файл:</h4>
                                <div className="flex gap-4 items-center">
                                    <input
                                        type="file"
                                        accept="application/pdf"
                                        onChange={(e) => {
                                            if (e.target.files && e.target.files.length > 0) {
                                                setRagFile(e.target.files[0]);
                                            } else {
                                                setRagFile(null);
                                            }
                                        }}
                                        className="flex-1 bg-black border border-white/10 px-4 py-2 text-white/70 file:border border-white/20 file:bg-white/10 file:text-white file:font-mono-label file:text-[10px] file:uppercase file:px-4 file:py-1 file:mr-4 hover:file:bg-white/20 transition-colors cursor-pointer font-code text-[13px]"
                                        disabled={isScraping}
                                    />
                                    <button
                                        onClick={handleUploadPDF}
                                        disabled={!ragFile || isScraping}
                                        className="flex items-center justify-center gap-2 px-6 py-2 bg-white text-black font-mono-label text-[10px] uppercase font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                                    >
                                        {isScraping ? (
                                            <Loader className="w-4 h-4 animate-spin" />
                                        ) : (
                                            "Загрузить PDF"
                                        )}
                                    </button>
                                </div>

                                <div className="my-6 border-b border-white/10"></div>

                                <h4 className="text-white font-mono-label text-[12px] uppercase tracking-widest mb-1">Глубокое сканирование (Crawler)</h4>
                                <p className="text-white/50 mb-4 font-code text-[11px]">
                                    Автоматически найдёт и скачает все страницы сайта (или карту сайта sitemap.xml), добавив их в RAG. Работает в фоновом режиме.
                                </p>

                                <div className="space-y-4">
                                    <input
                                        type="url"
                                        placeholder="https://productradar.ru"
                                        value={crawlUrl}
                                        onChange={(e) => setCrawlUrl(e.target.value)}
                                        className="w-full bg-black border border-white/10 px-4 py-3 text-white outline-none focus:border-white/30 transition-colors font-code text-[13px]"
                                        disabled={isScraping}
                                    />
                                    <div className="flex gap-4 items-center">
                                        <label className="flex items-center gap-2 text-white/70 font-code text-[13px] cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={crawlIsSitemap}
                                                onChange={(e) => setCrawlIsSitemap(e.target.checked)}
                                                className="rounded-none bg-black border-white/20 text-white focus:ring-white"
                                            />
                                            Это Sitemap.xml
                                        </label>

                                        <div className="flex items-center gap-2">
                                            <span className="text-white/70 font-code text-[13px]">Макс. страниц:</span>
                                            <input
                                                type="number"
                                                min="1" max="500"
                                                value={crawlMaxPages}
                                                onChange={(e) => setCrawlMaxPages(parseInt(e.target.value) || 50)}
                                                className="bg-black border border-white/10 px-3 py-1 text-white w-20 outline-none font-code text-[13px]"
                                            />
                                        </div>

                                        <div className="flex-1"></div>
                                        <button
                                            onClick={handleCrawlRAG}
                                            disabled={!crawlUrl.trim() || isScraping}
                                            className="flex items-center justify-center gap-2 px-6 py-2 border border-white/20 bg-transparent text-white font-mono-label text-[10px] uppercase font-bold hover:bg-white/10 transition-colors disabled:opacity-50"
                                        >
                                            {isScraping ? (
                                                <Loader className="w-4 h-4 animate-spin" />
                                            ) : (
                                                "Запустить паука"
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {ragResult && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className={`mt-4 p-4 border font-code text-[13px] ${ragResult.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}
                                    >
                                        <p className="font-bold">{ragResult.message}</p>
                                    </motion.div>
                                )}

                                <div className="mt-8 border-t border-white/10 pt-6">
                                    <h4 className="text-white font-mono-label text-[12px] uppercase tracking-widest mb-2">Визуализация базы (Semantic Map)</h4>
                                    <p className="text-white/50 mb-4 font-code text-[11px]">
                                        Постройте 3D-карту всех знаний системы. Это помогает увидеть, как ИИ группирует информацию по темам. 
                                        Сборка карты может занять 1-2 минуты.
                                    </p>
                                    <div className="flex items-center gap-4">
                                        <div className="flex-1 flex items-center gap-3 bg-black border border-white/10 px-4 py-2">
                                            <div className={`w-2 h-2 rounded-none ${vizStatus === 'processing' ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></div>
                                            <span className="font-code text-[13px] text-white/70">
                                                Статус: {vizStatus === 'processing' ? 'Сборка карты...' : 'Карта готова'}
                                            </span>
                                        </div>
                                        <button
                                            onClick={handleRebuildViz}
                                            disabled={vizStatus === 'processing'}
                                            className="flex items-center justify-center gap-2 px-6 py-2 border border-white/20 bg-transparent text-white font-mono-label text-[10px] uppercase font-bold hover:bg-white/10 transition-colors disabled:opacity-50"
                                        >
                                            {vizStatus === 'processing' ? <Loader className="w-4 h-4 animate-spin" /> : "Обновить карту"}
                                        </button>
                                        <a 
                                            href="/admin/rag/viz" 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="px-6 py-2 border border-white/20 bg-white/10 hover:bg-white/20 text-white font-mono-label text-[10px] uppercase tracking-widest transition-colors flex items-center gap-2 font-bold"
                                        >
                                            Открыть карту
                                        </a>
                                    </div>
                                </div>

                                <div className="mt-8 border-t border-white/10 pt-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-white font-mono-label text-[12px] uppercase tracking-widest">История загрузок</h4>
                                        <span className="font-mono-label text-[10px] uppercase tracking-widest text-white/40">{ragLogsTotal} записей</span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm font-code">
                                            <thead>
                                                <tr className="text-white/50 border-b border-white/10 font-mono-label uppercase text-[10px] tracking-widest">
                                                    <th className="text-left py-3 pr-4 w-32 font-bold">Дата</th>
                                                    <th className="text-left py-3 px-4 font-bold">Источник</th>
                                                    <th className="text-left py-3 px-4 w-20 font-bold">Тип</th>
                                                    <th className="text-left py-3 px-4 w-28 font-bold">Статус</th>
                                                    <th className="text-right py-3 pl-4 w-24 font-bold">Чанки</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ragLogs.map((log) => (
                                                    <tr key={log.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                                                        <td className="py-4 pr-4 text-white/50 text-[11px] font-mono whitespace-nowrap">
                                                            {new Date(log.created_at).toLocaleString("ru-RU", {
                                                                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                                                            })}
                                                        </td>
                                                        <td className="py-4 px-4 text-white/80 text-[13px] max-w-[200px] truncate" title={log.source_url}>
                                                            {log.source_url}
                                                        </td>
                                                        <td className="py-4 px-4 text-white/60">
                                                            <span className="bg-[#0A0A0A] border border-white/10 px-2 py-0.5 text-[10px] font-mono-label uppercase tracking-widest text-white/70">{log.source_type}</span>
                                                        </td>
                                                        <td className="py-4 px-4">
                                                            <span className={`px-2 py-0.5 border text-[10px] font-mono-label uppercase tracking-widest ${log.status === "SUCCESS"
                                                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                                                : "bg-red-500/10 border-red-500/20 text-red-400"
                                                                }`}>
                                                                {log.status}
                                                            </span>
                                                            {log.error_message && (
                                                                <p className="text-[11px] font-mono text-red-400 mt-2 truncate max-w-[120px]" title={log.error_message}>{log.error_message}</p>
                                                            )}
                                                        </td>
                                                        <td className="py-4 pl-4 text-right text-white/80 font-mono font-bold">
                                                            +{log.chunks_added}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {ragLogs.length === 0 && (
                                                    <tr>
                                                        <td colSpan={5} className="py-8 text-center text-white/30 font-code">История загрузок пуста</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </motion.div>
            )}
        </div>
    );
}

