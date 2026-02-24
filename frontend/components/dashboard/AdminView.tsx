import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, Tag, BarChart2, Plus, Trash2, Shield, Loader2, CreditCard } from "lucide-react";
import { Button, GlassCard } from "@/components/shared";
import { getToken } from "@/lib/auth";

// Temporary Types mapping what API returns
type PromoCode = {
    id: number;
    code: string;
    discount_percent: number;
    max_uses: number | null;
    current_uses: number;
    expires_at: string | null;
    created_at: string;
};

type User = {
    id: number;
    name: string;
    email: string;
    is_admin: boolean;
    is_active: boolean;
    subscription_tier: string;
};

type AnalyticsData = {
    totals: {
        users: number;
        analyses: number;
        analyses_anon: number;
        chat_sessions: number;
        chat_sessions_anon: number;
    };
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

export function AdminView() {
    const [activeTab, setActiveTab] = useState<"analytics" | "promocodes" | "users" | "subscriptions" | "rag">("users");
    const [loading, setLoading] = useState(true);
    const [promocodes, setPromocodes] = useState<PromoCode[]>([]);
    const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

    // RAG State
    const [ragUrl, setRagUrl] = useState("");
    const [isScraping, setIsScraping] = useState(false);
    const [ragResult, setRagResult] = useState<{ success: boolean, message: string } | null>(null);

    // New Promo Form
    const [newPromo, setNewPromo] = useState({ code: "", discount_percent: 10, max_uses: "" });

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
                    if (res.ok) setPromocodes(await res.json());
                } else if (activeTab === "analytics") {
                    const res = await fetch(`${API_BASE}/admin/analytics`, {
                        headers: { "Authorization": `Bearer ${token}` }
                    });
                    if (res.ok) setAnalytics(await res.json());
                } else if (activeTab === "users") {
                    const res = await fetch(`${API_BASE}/admin/users`, {
                        headers: { "Authorization": `Bearer ${token}` }
                    });
                    if (res.ok) setUsers(await res.json());
                } else if (activeTab === "subscriptions") {
                    const res = await fetch(`${API_BASE}/admin/subscriptions`, {
                        headers: { "Authorization": `Bearer ${token}` }
                    });
                    if (res.ok) setSubscriptions(await res.json());
                }
            } catch (e) {
                console.error("Admin fetch error", e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [activeTab, API_BASE]);

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
                    max_uses: newPromo.max_uses ? parseInt(newPromo.max_uses) : null
                })
            });

            if (res.ok) {
                const created = await res.json();
                setPromocodes([created, ...promocodes]);
                setNewPromo({ code: "", discount_percent: 10, max_uses: "" });
            } else {
                alert("Ошибка при создании промокода. Возможно, он уже существует.");
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleDeletePromo = async (id: number) => {
        if (!confirm("Удалить промокод?")) return;
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
            const data = await res.json();

            if (res.ok) {
                setRagResult({ success: true, message: data.message });
                setRagUrl("");
            } else {
                setRagResult({ success: false, message: data.detail || "Произошла ошибка при обработке URL." });
            }
        } catch (e) {
            setRagResult({ success: false, message: "Не удалось подключиться к серверу." });
        } finally {
            setIsScraping(false);
        }
    };

    const handleUserAction = async (userId: number, action: "block" | "unblock" | "make-admin" | "delete") => {
        let confirmMsg = "";
        if (action === "block") confirmMsg = "Заблокировать пользователя?";
        else if (action === "unblock") confirmMsg = "Разблокировать пользователя?";
        else if (action === "make-admin") confirmMsg = "Сделать пользователя администратором?";
        else if (action === "delete") confirmMsg = "Удалить пользователя навсегда?";

        if (!confirm(confirmMsg)) return;

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
                alert("Ошибка при выполнении действия");
            }
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex gap-4 border-b border-white/10 pb-4 overflow-x-auto">
                <button
                    onClick={() => setActiveTab("users")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === "users" ? "bg-pitchy-violet text-white" : "text-white/50 hover:text-white"
                        }`}
                >
                    <Users className="w-4 h-4" /> Пользователи
                </button>
                <button
                    onClick={() => setActiveTab("promocodes")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === "promocodes" ? "bg-pitchy-violet text-white" : "text-white/50 hover:text-white"
                        }`}
                >
                    <Tag className="w-4 h-4" /> Промокоды
                </button>
                <button
                    onClick={() => setActiveTab("analytics")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === "analytics" ? "bg-pitchy-violet text-white" : "text-white/50 hover:text-white"
                        }`}
                >
                    <BarChart2 className="w-4 h-4" /> Аналитика платформы
                </button>
                <button
                    onClick={() => setActiveTab("subscriptions")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === "subscriptions" ? "bg-pitchy-violet text-white" : "text-white/50 hover:text-white"
                        }`}
                >
                    <CreditCard className="w-4 h-4" /> Подписки
                </button>
                <button
                    onClick={() => setActiveTab("rag")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === "rag" ? "bg-pitchy-violet text-white" : "text-white/50 hover:text-white"
                        }`}
                >
                    <Shield className="w-4 h-4" /> База Знаний (RAG)
                </button>
            </div>

            {loading ? (
                <div className="py-12 flex justify-center">
                    <Loader2 className="w-8 h-8 text-pitchy-violet animate-spin" />
                </div>
            ) : (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    {activeTab === "promocodes" && (
                        <div className="space-y-6">
                            {/* Create new promo form */}
                            <GlassCard hover={false} className="p-6 border border-pitchy-violet/30">
                                <h3 className="text-lg font-bold text-white mb-4">Создать промокод</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                                    <input
                                        type="text"
                                        placeholder="Код (например TITLE20)"
                                        value={newPromo.code}
                                        onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value })}
                                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-pitchy-violet"
                                    />
                                    <input
                                        type="number"
                                        placeholder="% Скидки"
                                        min="1" max="100"
                                        value={newPromo.discount_percent}
                                        onChange={(e) => setNewPromo({ ...newPromo, discount_percent: parseInt(e.target.value) })}
                                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-pitchy-violet"
                                    />
                                    <input
                                        type="number"
                                        placeholder="Кол-во использований (не обяз.)"
                                        value={newPromo.max_uses}
                                        onChange={(e) => setNewPromo({ ...newPromo, max_uses: e.target.value })}
                                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-pitchy-violet"
                                    />
                                    <Button
                                        variant="primary"
                                        onClick={handleCreatePromo}
                                        disabled={!newPromo.code.trim()}
                                    >
                                        <Plus className="w-4 h-4 mr-2" /> Добавить
                                    </Button>
                                </div>
                            </GlassCard>

                            {/* Promo codes list */}
                            <div className="bg-[#0F0F13] border border-white/10 rounded-2xl overflow-hidden">
                                <table className="w-full text-left text-sm text-white">
                                    <thead className="bg-white/5 text-white/50 border-b border-white/10">
                                        <tr>
                                            <th className="px-6 py-4 font-medium">КОД</th>
                                            <th className="px-6 py-4 font-medium text-center">СКИДКА %</th>
                                            <th className="px-6 py-4 font-medium text-center">ИСПОЛЬЗОВАНО</th>
                                            <th className="px-6 py-4 font-medium text-right">ДЕЙСТВИЕ</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {promocodes.map(promo => (
                                            <tr key={promo.id} className="border-b border-white/5">
                                                <td className="px-6 py-4 font-bold text-pitchy-cyan">{promo.code}</td>
                                                <td className="px-6 py-4 text-center">{promo.discount_percent}%</td>
                                                <td className="px-6 py-4 text-center text-white/50">
                                                    {promo.current_uses} / {promo.max_uses ? promo.max_uses : '∞'}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <button onClick={() => handleDeletePromo(promo.id)} className="text-red-400 hover:text-red-300 p-2">
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                            <GlassCard hover={false} className="p-6">
                                <p className="text-white/50 text-sm mb-1">Всего пользователей</p>
                                <p className="text-3xl font-bold text-white">{analytics.totals.users}</p>
                            </GlassCard>
                            <GlassCard hover={false} className="p-6">
                                <p className="text-white/50 text-sm mb-1">Запущено анализов</p>
                                <p className="text-3xl font-bold text-white flex items-end gap-2">
                                    {analytics.totals.analyses}
                                    <span className="text-xs text-pitchy-violet mb-1">(анон: {analytics.totals.analyses_anon})</span>
                                </p>
                            </GlassCard>
                            <GlassCard hover={false} className="p-6">
                                <p className="text-white/50 text-sm mb-1">Чат-сессий</p>
                                <p className="text-3xl font-bold text-white flex items-end gap-2">
                                    {analytics.totals.chat_sessions}
                                    <span className="text-xs text-pitchy-violet mb-1">(анон: {analytics.totals.chat_sessions_anon})</span>
                                </p>
                            </GlassCard>
                        </div>
                    )}

                    {activeTab === "users" && (
                        <div className="space-y-6">
                            <div className="bg-[#0F0F13] border border-white/10 rounded-2xl overflow-hidden overflow-x-auto">
                                <table className="w-full text-left text-sm text-white min-w-[800px]">
                                    <thead className="bg-white/5 text-white/50 border-b border-white/10">
                                        <tr>
                                            <th className="px-6 py-4 font-medium">ПОЛЬЗОВАТЕЛЬ</th>
                                            <th className="px-6 py-4 font-medium">СТАТУС & РОЛЬ</th>
                                            <th className="px-6 py-4 font-medium text-center">ТАРИФ</th>
                                            <th className="px-6 py-4 font-medium text-right">ДЕЙСТВИЕ</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.map(u => (
                                            <tr key={u.id} className={`border-b border-white/5 ${!u.is_active ? 'opacity-50' : ''}`}>
                                                <td className="px-6 py-4">
                                                    <div className="font-bold">{u.name || "Без имени"}</div>
                                                    <div className="text-white/50 text-xs">{u.email}</div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col items-start gap-1">
                                                        {u.is_admin ? (
                                                            <span className="text-xs bg-pitchy-cyan/10 text-pitchy-cyan px-2 py-0.5 rounded-full border border-pitchy-cyan/20">Админ</span>
                                                        ) : (
                                                            <span className="text-xs bg-white/10 text-white/70 px-2 py-0.5 rounded-full">Юзер</span>
                                                        )}
                                                        {!u.is_active && (
                                                            <span className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full border border-red-500/20">Заблокирован</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-center text-white/70 capitalize">
                                                    {u.subscription_tier}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        {u.is_active ? (
                                                            <button onClick={() => handleUserAction(u.id, "block")} className="text-amber-400 hover:text-amber-300 text-xs px-2 py-1 rounded border border-amber-500/20 bg-amber-500/10 transition-colors">Блок</button>
                                                        ) : (
                                                            <button onClick={() => handleUserAction(u.id, "unblock")} className="text-emerald-400 hover:text-emerald-300 text-xs px-2 py-1 rounded border border-emerald-500/20 bg-emerald-500/10 transition-colors">Разблок</button>
                                                        )}
                                                        {!u.is_admin && (
                                                            <button onClick={() => handleUserAction(u.id, "make-admin")} className="text-pitchy-cyan hover:text-pitchy-cyan/80 text-xs px-2 py-1 rounded border border-pitchy-cyan/20 bg-pitchy-cyan/10 transition-colors" title="Сделать админом"><Shield className="w-3 h-3" /></button>
                                                        )}
                                                        <button onClick={() => handleUserAction(u.id, "delete")} className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded border border-red-500/20 bg-red-500/10 transition-colors" title="Удалить"><Trash2 className="w-3 h-3" /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {users.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="px-6 py-8 text-center text-white/30">Нет пользователей</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === "subscriptions" && (
                        <div className="space-y-4">
                            <GlassCard hover={false} className="p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-bold text-white">Платные пользователи</h3>
                                    <span className="text-sm text-white/40">{subscriptions.length} подписок</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-white/40 border-b border-white/10">
                                                <th className="text-left px-4 py-3">Email</th>
                                                <th className="text-left px-4 py-3">Имя</th>
                                                <th className="text-left px-4 py-3">Тариф</th>
                                                <th className="text-left px-4 py-3">Статус</th>
                                                <th className="text-left px-4 py-3">Окончание</th>
                                                <th className="text-left px-4 py-3">Платежи</th>
                                                <th className="text-left px-4 py-3">Сумма</th>
                                                <th className="text-left px-4 py-3">Промокод</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {subscriptions.map((sub) => (
                                                <tr key={sub.user_id} className="border-b border-white/5 hover:bg-white/5">
                                                    <td className="px-4 py-3 text-white/80">{sub.email}</td>
                                                    <td className="px-4 py-3 text-white/60">{sub.name}</td>
                                                    <td className="px-4 py-3">
                                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sub.subscription_tier === "premium"
                                                            ? "bg-amber-500/20 text-amber-400"
                                                            : "bg-pitchy-violet/20 text-pitchy-violet"
                                                            }`}>
                                                            {sub.subscription_tier.toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sub.is_active
                                                            ? "bg-green-500/20 text-green-400"
                                                            : "bg-red-500/20 text-red-400"
                                                            }`}>
                                                            {sub.is_active ? "Активна" : "Истекла"}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-white/60">
                                                        {sub.subscription_expires_at
                                                            ? new Date(sub.subscription_expires_at).toLocaleDateString("ru-RU")
                                                            : "—"}
                                                    </td>
                                                    <td className="px-4 py-3 text-white/60">{sub.total_payments}</td>
                                                    <td className="px-4 py-3 text-white/80">{sub.total_spent.toFixed(0)} ₽</td>
                                                    <td className="px-4 py-3">
                                                        {sub.promo_code_used ? (
                                                            <span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400">{sub.promo_code_used}</span>
                                                        ) : (
                                                            <span className="text-white/20">—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                            {subscriptions.length === 0 && (
                                                <tr>
                                                    <td colSpan={8} className="px-6 py-8 text-center text-white/30">Нет платных пользователей</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </GlassCard>
                        </div>
                    )}

                    {activeTab === "rag" && (
                        <div className="space-y-6 max-w-2xl">
                            <GlassCard hover={false} className="p-6 border border-pitchy-violet/30">
                                <h3 className="text-xl font-bold text-white mb-2">Обновление базы знаний (RAG)</h3>
                                <p className="text-white/60 mb-6 text-sm">
                                    Вставьте ссылку на любую статью, регламент или документацию. Система скачает страницу, удалит лишний мусор (HTML/рекламу), нарежет текст на куски и добавит в векторную базу данных. ИИ мгновенно научится отвечать с учётом этой новой информации.
                                </p>

                                <div className="flex gap-4">
                                    <input
                                        type="url"
                                        placeholder="https://example.com/company-policy"
                                        value={ragUrl}
                                        onChange={(e) => setRagUrl(e.target.value)}
                                        className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-pitchy-violet transition-colors"
                                        disabled={isScraping}
                                    />
                                    <Button
                                        variant="primary"
                                        onClick={handleScrapeRAG}
                                        disabled={!ragUrl.trim() || isScraping}
                                        className="px-6"
                                    >
                                        {isScraping ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Парсинг...
                                            </>
                                        ) : (
                                            <>
                                                <Plus className="w-4 h-4 mr-2" /> Обучить ИИ
                                            </>
                                        )}
                                    </Button>
                                </div>

                                {ragResult && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className={`mt-4 p-4 rounded-xl border ${ragResult.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}
                                    >
                                        <p className="font-medium text-sm">{ragResult.message}</p>
                                    </motion.div>
                                )}
                            </GlassCard>
                        </div>
                    )}
                </motion.div>
            )}
        </div>
    );
}

