"use client";

import { motion } from "framer-motion";
import {
    MessageSquare,
    Gauge,
    LineChart,
    Shield,
    Zap,
    Target,
    TrendingUp,
} from "lucide-react";

const features = [
    {
        icon: MessageSquare,
        title: "Чат-анализ",
        description:
            "Просто общайтесь с нашим ИИ-аналитиком. Никаких сложных форм — просто введите название компании и получите мгновенные инсайты.",
        color: "violet",
    },
    {
        icon: Gauge,
        title: "Оценка 0-100",
        description:
            "Чёткая, объективная оценка по 5 ключевым параметрам: Рынок, Команда, Продукт, Трекшн и Финансы.",
        color: "cyan",
    },
    {
        icon: LineChart,
        title: "Глубокие метрики",
        description:
            "Выходите за рамки поверхностного анализа с детальной разбивкой по каждому параметру оценки.",
        color: "emerald",
    },
    {
        icon: Shield,
        title: "На основе данных",
        description:
            "Наш ИИ анализирует миллионы точек данных из публичных источников, трендов рынка и исторических паттернов.",
        color: "amber",
    },
    {
        icon: Zap,
        title: "Молниеносно",
        description:
            "Получите комплексный анализ стартапа менее чем за 30 секунд. Без ожидания, без задержек.",
        color: "violet",
    },
    {
        icon: Target,
        title: "Сравнение и отслеживание",
        description:
            "Сохраняйте анализы, сравнивайте стартапы бок о бок и отслеживайте динамику оценок.",
        color: "cyan",
    },
];

const colorMap: Record<string, { bg: string; icon: string; glow: string }> = {
    violet: {
        bg: "rgba(139, 92, 246, 0.1)",
        icon: "text-pitchy-violet",
        glow: "shadow-glow-primary/30",
    },
    cyan: {
        bg: "rgba(6, 182, 212, 0.1)",
        icon: "text-pitchy-cyan",
        glow: "shadow-glow-cyan/30",
    },
    emerald: {
        bg: "rgba(16, 185, 129, 0.1)",
        icon: "text-emerald-400",
        glow: "shadow-glow-success/30",
    },
    amber: {
        bg: "rgba(245, 158, 11, 0.1)",
        icon: "text-amber-400",
        glow: "",
    },
};

const steps = [
    {
        number: "01",
        title: "Введите стартап",
        description:
            "Чем больше деталей вы добавите (проблема, решение, команда, рынок), тем лучше ИИ поймёт вашу идею и даст полезную обратную связь.",
        icon: MessageSquare,
    },
    {
        number: "02",
        title: "ИИ-анализ",
        description:
            "Наш ИИ обрабатывает миллионы точек данных за секунды.",
        icon: Zap,
    },
    {
        number: "03",
        title: "Получите оценку",
        description:
            "Получите комплексную оценку 0-100 с детальной разбивкой.",
        icon: TrendingUp,
    },
];

export function FeaturesSection() {
    return (
        <section className="relative py-20 sm:py-32 px-4 sm:px-6 lg:px-8 overflow-hidden">
            <div className="absolute inset-0 gradient-hero opacity-50" />

            <div className="relative z-10 max-w-7xl mx-auto">
                {/* Section Header */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-100px" }}
                    transition={{ duration: 0.6 }}
                    className="text-center mb-16 sm:mb-20"
                >
                    <span className="inline-block px-4 py-1.5 rounded-full text-xs font-medium bg-pitchy-violet/10 text-pitchy-violet border border-pitchy-violet/20 mb-4">
                        Возможности
                    </span>
                    <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4">
                        Всё для{" "}
                        <span className="text-gradient-violet">оценки стартапов</span>
                    </h2>
                    <p className="text-lg text-white/50 max-w-2xl mx-auto">
                        Мощные ИИ-инструменты для современных инвесторов и фаундеров.
                    </p>
                </motion.div>

                {/* Features Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-24">
                    {features.map((feature, index) => {
                        const colors = colorMap[feature.color];
                        return (
                            <motion.div
                                key={feature.title}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true, margin: "-50px" }}
                                transition={{ duration: 0.5, delay: index * 0.1 }}
                                whileHover={{ scale: 1.02, y: -4 }}
                                className="group relative p-6 rounded-2xl glass-card-hover overflow-hidden"
                            >
                                <div
                                    className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-30 transition-opacity"
                                    style={{ background: colors.bg }}
                                />

                                <div className="relative">
                                    <div
                                        className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${colors.glow}`}
                                        style={{ background: colors.bg }}
                                    >
                                        <feature.icon className={`w-6 h-6 ${colors.icon}`} />
                                    </div>

                                    <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-pitchy-violet-light transition-colors">
                                        {feature.title}
                                    </h3>
                                    <p className="text-sm text-white/50 leading-relaxed">
                                        {feature.description}
                                    </p>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>

                {/* How It Works */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-100px" }}
                    transition={{ duration: 0.6 }}
                    className="text-center mb-12"
                >
                    <span className="inline-block px-4 py-1.5 rounded-full text-xs font-medium bg-pitchy-cyan/10 text-pitchy-cyan border border-pitchy-cyan/20 mb-4">
                        Как это работает
                    </span>
                    <h2 className="text-3xl sm:text-4xl font-bold text-white">
                        Три шага к{" "}
                        <span className="text-gradient-violet">аналитике стартапов</span>
                    </h2>
                </motion.div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {steps.map((step, index) => (
                        <motion.div
                            key={step.number}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: "-50px" }}
                            transition={{ duration: 0.5, delay: index * 0.15 }}
                            className="relative"
                        >
                            {index < steps.length - 1 && (
                                <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-px bg-gradient-to-r from-white/20 to-transparent" />
                            )}

                            <div className="text-center">
                                <div className="relative inline-flex items-center justify-center w-24 h-24 mb-6">
                                    <div className="absolute inset-0 rounded-full bg-pitchy-violet/20 blur-xl" />
                                    <div className="relative w-full h-full rounded-full glass-panel flex items-center justify-center border border-pitchy-violet/30">
                                        <span className="text-3xl font-bold text-pitchy-violet font-mono-numbers">
                                            {step.number}
                                        </span>
                                    </div>
                                    <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full bg-pitchy-violet flex items-center justify-center">
                                        <step.icon className="w-5 h-5 text-white" />
                                    </div>
                                </div>

                                <h3 className="text-xl font-semibold text-white mb-2">
                                    {step.title}
                                </h3>
                                <p className="text-sm text-white/50 max-w-xs mx-auto">
                                    {step.description}
                                </p>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}

export default FeaturesSection;
