"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Sparkles, Zap, Crown } from "lucide-react";
import Link from "next/link";
import Layout from "@/components/Layout";

const plans = [
    {
        name: "Бесплатный",
        price: { monthly: "0", yearly: "0" },
        description: "Для знакомства с платформой",
        icon: Sparkles,
        features: [
            "Неограниченные базовые анализы",
            "Оценка 0-100",
            "5 ключевых метрик",
            "Сохранение до 5 анализов",
        ],
        cta: "Начать бесплатно",
        popular: false,
        color: "white",
    },
    {
        name: "Про",
        price: { monthly: "1 990", yearly: "19 990" },
        description: "Для активных инвесторов",
        icon: Zap,
        features: [
            "Все функции бесплатного плана",
            "Неограниченное сохранение",
            "Сравнение стартапов",
            "Экспорт отчётов",
            "Отслеживание динамики",
            "Приоритетная поддержка",
        ],
        cta: "Начать 7-дневный триал",
        popular: true,
        color: "violet",
    },
    {
        name: "Бизнес",
        price: { monthly: "4 990", yearly: "49 990" },
        description: "Для команд и фондов",
        icon: Crown,
        features: [
            "Все функции Про плана",
            "До 10 пользователей",
            "Командная аналитика",
            "API доступ",
            "Кастомные модели оценки",
            "Выделенный менеджер",
            "SLA 99.9%",
        ],
        cta: "Связаться с нами",
        popular: false,
        color: "cyan",
    },
];

export default function PricingPage() {
    const [isYearly, setIsYearly] = useState(false);

    return (
        <Layout>
            <div className="min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8">
                <div className="max-w-6xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center mb-12"
                    >
                        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
                            Тарифы
                        </h1>
                        <p className="text-white/50 text-lg mb-8">
                            Выберите план, который подходит именно вам
                        </p>

                        {/* Toggle */}
                        <div className="flex items-center justify-center gap-3">
                            <span
                                className={`text-sm font-medium ${!isYearly ? "text-white" : "text-white/40"}`}
                            >
                                Месяц
                            </span>
                            <button
                                onClick={() => setIsYearly(!isYearly)}
                                className={`relative w-14 h-7 rounded-full transition-colors cursor-pointer ${isYearly ? "bg-pitchy-violet" : "bg-white/20"
                                    }`}
                            >
                                <motion.div
                                    animate={{ x: isYearly ? 28 : 4 }}
                                    transition={{ duration: 0.2 }}
                                    className="absolute top-1 w-5 h-5 rounded-full bg-white"
                                />
                            </button>
                            <span
                                className={`text-sm font-medium ${isYearly ? "text-white" : "text-white/40"}`}
                            >
                                Год{" "}
                                <span className="text-xs text-emerald-400 ml-1">-17%</span>
                            </span>
                        </div>
                    </motion.div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {plans.map((plan, i) => (
                            <motion.div
                                key={plan.name}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.1 }}
                                whileHover={{ scale: 1.02, y: -4 }}
                                className={`relative glass-card-hover p-6 sm:p-8 ${plan.popular
                                        ? "border-pitchy-violet/30 shadow-glow-primary/20"
                                        : ""
                                    }`}
                            >
                                {plan.popular && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-pitchy-violet text-white text-xs font-medium">
                                        Популярный
                                    </div>
                                )}

                                <div className="mb-6">
                                    <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-4">
                                        <plan.icon
                                            className={`w-6 h-6 ${plan.color === "violet"
                                                    ? "text-pitchy-violet"
                                                    : plan.color === "cyan"
                                                        ? "text-pitchy-cyan"
                                                        : "text-white/60"
                                                }`}
                                        />
                                    </div>
                                    <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                                    <p className="text-sm text-white/40 mt-1">
                                        {plan.description}
                                    </p>
                                </div>

                                <div className="mb-6">
                                    <span className="text-4xl font-bold text-white font-mono-numbers">
                                        ₽{isYearly ? plan.price.yearly : plan.price.monthly}
                                    </span>
                                    <span className="text-white/40 ml-1">
                                        /{isYearly ? "год" : "мес"}
                                    </span>
                                </div>

                                <ul className="space-y-3 mb-8">
                                    {plan.features.map((feature) => (
                                        <li
                                            key={feature}
                                            className="flex items-start gap-2 text-sm text-white/70"
                                        >
                                            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <Link
                                    href={plan.popular ? "/signup" : "/contact"}
                                    className={`block w-full text-center py-3 rounded-xl font-medium transition-all ${plan.popular
                                            ? "btn-primary"
                                            : "bg-white/5 text-white border border-white/10 hover:bg-white/10"
                                        }`}
                                >
                                    {plan.cta}
                                </Link>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
