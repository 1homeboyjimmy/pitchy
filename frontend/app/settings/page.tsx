"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Settings, User, Bell, Shield, Palette, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { GlassCard } from "@/components/shared";
import { getToken } from "@/lib/auth";
import { postAuthJson } from "@/lib/api";

const tabs = [
    { id: "profile", label: "Профиль", icon: User },
    { id: "notifications", label: "Уведомления", icon: Bell },
    { id: "security", label: "Безопасность", icon: Shield },
    { id: "appearance", label: "Вид", icon: Palette },
];

export default function SettingsPage() {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState("profile");
    const [saved, setSaved] = useState(false);
    const [profile, setProfile] = useState({ name: "", email: "" });

    useEffect(() => {
        const token = getToken();
        if (!token) {
            router.push("/login");
            return;
        }
        postAuthJson<{ name: string; email: string }>("/me", {}, token)
            .then((data) => setProfile({ name: data.name || "", email: data.email || "" }))
            .catch(console.error);
    }, [router]);

    const handleSave = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <Layout>
            <div className="min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8">
                <div className="max-w-4xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-8"
                    >
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-pitchy-violet/10 flex items-center justify-center">
                                <Settings className="w-5 h-5 text-pitchy-violet" />
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-white">
                                Настройки
                            </h1>
                        </div>
                        <p className="text-white/50 text-sm">
                            Управляйте профилем и предпочтениями
                        </p>
                    </motion.div>

                    <div className="flex flex-col lg:flex-row gap-6">
                        {/* Sidebar */}
                        <div className="lg:w-56 flex-shrink-0">
                            <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
                                {tabs.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all cursor-pointer ${activeTab === tab.id
                                                ? "bg-pitchy-violet/10 text-white border border-pitchy-violet/20"
                                                : "text-white/50 hover:text-white hover:bg-white/5"
                                            }`}
                                    >
                                        <tab.icon className="w-4 h-4" />
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1">
                            <GlassCard hover={false} className="p-6 sm:p-8">
                                {activeTab === "profile" && (
                                    <div className="space-y-5">
                                        <h2 className="text-lg font-semibold text-white mb-4">
                                            Профиль
                                        </h2>
                                        <div>
                                            <label className="block text-sm font-medium text-white/70 mb-2">
                                                Имя
                                            </label>
                                            <input
                                                type="text"
                                                value={profile.name}
                                                onChange={(e) =>
                                                    setProfile({ ...profile, name: e.target.value })
                                                }
                                                className="pitchy-input"
                                                placeholder="Ваше имя"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-white/70 mb-2">
                                                Email
                                            </label>
                                            <input
                                                type="email"
                                                value={profile.email}
                                                onChange={(e) =>
                                                    setProfile({ ...profile, email: e.target.value })
                                                }
                                                className="pitchy-input"
                                                placeholder="Ваш email"
                                                disabled
                                            />
                                            <p className="text-xs text-white/30 mt-1">
                                                Email нельзя изменить
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {activeTab === "notifications" && (
                                    <div>
                                        <h2 className="text-lg font-semibold text-white mb-4">
                                            Уведомления
                                        </h2>
                                        <div className="space-y-4">
                                            {[
                                                "Email-уведомления о новых функциях",
                                                "Уведомления об обновлениях анализов",
                                                "Еженедельный дайджест",
                                            ].map((label, i) => (
                                                <label
                                                    key={i}
                                                    className="flex items-center justify-between p-3 rounded-xl bg-white/5 cursor-pointer"
                                                >
                                                    <span className="text-sm text-white/70">
                                                        {label}
                                                    </span>
                                                    <div className="w-10 h-6 bg-white/10 rounded-full relative">
                                                        <div className="absolute left-1 top-1 w-4 h-4 bg-white/30 rounded-full" />
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {activeTab === "security" && (
                                    <div>
                                        <h2 className="text-lg font-semibold text-white mb-4">
                                            Безопасность
                                        </h2>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-sm font-medium text-white/70 mb-2">
                                                    Текущий пароль
                                                </label>
                                                <input
                                                    type="password"
                                                    className="pitchy-input"
                                                    placeholder="••••••••"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-white/70 mb-2">
                                                    Новый пароль
                                                </label>
                                                <input
                                                    type="password"
                                                    className="pitchy-input"
                                                    placeholder="Минимум 8 символов"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === "appearance" && (
                                    <div>
                                        <h2 className="text-lg font-semibold text-white mb-4">
                                            Внешний вид
                                        </h2>
                                        <p className="text-sm text-white/50">
                                            Тёмная тема активна по умолчанию.
                                        </p>
                                    </div>
                                )}

                                <div className="mt-8 pt-6 border-t border-white/8 flex justify-end">
                                    <motion.button
                                        onClick={handleSave}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        className="btn-primary px-6 py-2.5 rounded-xl flex items-center gap-2 cursor-pointer"
                                    >
                                        <Save className="w-4 h-4" />
                                        {saved ? "Сохранено!" : "Сохранить"}
                                    </motion.button>
                                </div>
                            </GlassCard>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
