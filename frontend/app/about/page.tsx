"use client";

import { motion } from "framer-motion";
import {
    Users,
    Target,
    Zap,
    Shield,
    BarChart3,
    ChevronRight,
} from "lucide-react";
import Link from "next/link";
import Layout from "@/components/Layout";

const advantages = [
    {
        icon: Zap,
        title: "Молниеносный анализ",
        description: "Комплексная оценка стартапа менее чем за 30 секунд.",
        color: "violet",
    },
    {
        icon: Target,
        title: "Точная оценка",
        description: "ИИ-модели, обученные на тысячах инвестиционных кейсов.",
        color: "cyan",
    },
    {
        icon: Shield,
        title: "Защита данных",
        description: "Все данные зашифрованы и хранятся в защищённых дата-центрах.",
        color: "emerald",
    },
    {
        icon: BarChart3,
        title: "Детализация",
        description: "Разбивка по 5 метрикам с конкретными рекомендациями.",
        color: "amber",
    },
];

const stats = [
    { value: "100+", label: "Проанализированных стартапов" },
    { value: "5+", label: "Активных инвесторов" },
    { value: "30s", label: "Среднее время анализа" },
    { value: "92%", label: "Точность прогнозов" },
];

const colorMap: Record<string, { bg: string; icon: string }> = {
    violet: { bg: "rgba(139,92,246,0.1)", icon: "text-pitchy-violet" },
    cyan: { bg: "rgba(6,182,212,0.1)", icon: "text-pitchy-cyan" },
    emerald: { bg: "rgba(16,185,129,0.1)", icon: "text-emerald-400" },
    amber: { bg: "rgba(245,158,11,0.1)", icon: "text-amber-400" },
};

export default function AboutPage() {
    return (
        <Layout>
            <div className="min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8">
                <div className="max-w-5xl mx-auto">
                    {/* Hero */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center mb-16"
                    >
                        <div className="flex justify-center mb-4">
                            <div className="w-14 h-14 rounded-2xl bg-pitchy-violet/10 border border-pitchy-violet/20 flex items-center justify-center">
                                <Users className="w-7 h-7 text-pitchy-violet" />
                            </div>
                        </div>
                        <h1 className="text-3xl sm:text-5xl font-bold text-white mb-4">
                            О <span className="text-gradient">Pitchy.pro</span>
                        </h1>
                        <p className="text-lg text-white/50 max-w-2xl mx-auto">
                            Мы создаём ИИ-инструменты, которые помогают фаундерам и инвесторам
                            принимать более точные решения в мире стартапов.
                        </p>
                    </motion.div>

                    {/* Advantages */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-20">
                        {advantages.map((item, i) => {
                            const c = colorMap[item.color];
                            return (
                                <motion.div
                                    key={item.title}
                                    initial={{ opacity: 0, y: 20 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: i * 0.1 }}
                                    whileHover={{ scale: 1.02 }}
                                    className="glass-card-hover p-6"
                                >
                                    <div
                                        className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                                        style={{ background: c.bg }}
                                    >
                                        <item.icon className={`w-6 h-6 ${c.icon}`} />
                                    </div>
                                    <h3 className="text-lg font-semibold text-white mb-2">
                                        {item.title}
                                    </h3>
                                    <p className="text-sm text-white/50">{item.description}</p>
                                </motion.div>
                            );
                        })}
                    </div>

                    {/* Stats */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        className="glass-panel rounded-3xl p-8 sm:p-12 mb-20"
                    >
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                            {stats.map((stat, i) => (
                                <motion.div
                                    key={stat.label}
                                    initial={{ opacity: 0, y: 20 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: i * 0.1 }}
                                    className="text-center"
                                >
                                    <span className="text-3xl sm:text-4xl font-bold text-gradient-violet font-mono-numbers">
                                        {stat.value}
                                    </span>
                                    <p className="text-sm text-white/40 mt-2">{stat.label}</p>
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>

                    {/* CTA */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-center"
                    >
                        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                            Начните прямо сейчас
                        </h2>
                        <p className="text-white/50 mb-8">
                            Бесплатный анализ без регистрации
                        </p>
                        <Link
                            href="/"
                            className="btn-primary px-8 py-3 rounded-xl inline-flex items-center gap-2"
                        >
                            Попробовать
                            <ChevronRight className="w-4 h-4" />
                        </Link>
                    </motion.div>
                </div>
            </div>
        </Layout>
    );
}
