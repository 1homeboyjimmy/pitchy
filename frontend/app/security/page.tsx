"use client";

import { motion } from "framer-motion";
import { Shield, Lock, Server, Eye, Key, RefreshCw } from "lucide-react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";
import { PitchyLogo } from "@/components/shared/PitchyLogo";

const securityFeatures = [
    {
        icon: Lock,
        title: "Шифрование данных",
        description: "Все данные зашифрованы при передаче (TLS 1.3) и хранении (AES-256). Токены доступа хешируются с использованием современных алгоритмов.",
    },
    {
        icon: Server,
        title: "Защищённая инфраструктура",
        description: "Серверы размещены в сертифицированных дата-центрах с физической защитой, резервным питанием и круглосуточным мониторингом.",
    },
    {
        icon: Eye,
        title: "Мониторинг безопасности",
        description: "Автоматическое обнаружение аномалий, мониторинг подозрительной активности и оповещение в реальном времени.",
    },
    {
        icon: Key,
        title: "Контроль доступа",
        description: "Ролевая модель доступа, двухфакторная аутентификация (2FA) и автоматическое истечение сессий.",
    },
    {
        icon: RefreshCw,
        title: "Резервное копирование",
        description: "Автоматическое ежедневное резервное копирование с хранением в географически распределённых дата-центрах.",
    },
    {
        icon: Shield,
        title: "Соответствие стандартам",
        description: "Платформа соответствует требованиям 152-ФЗ о персональных данных и следует лучшим практикам безопасности.",
    },
];

export default function SecurityPage() {
    return (
        <div className="bg-black text-foreground antialiased min-h-screen flex flex-col relative overflow-hidden">
            {/* Decorative Orbs */}
            <div className="aurora-orb top-[-10rem] right-[-5rem] h-96 w-96 bg-white/[0.03] animate-pulse" />
            <div className="aurora-orb bottom-[20rem] left-[-10rem] h-80 w-80 bg-white/[0.02] animate-float-slow" />

            <TopNavBar />

            <main className="flex-grow pt-32 pb-24 px-6 md:px-12 max-w-[1440px] mx-auto w-full relative z-10">
                {/* Header */}
                <header className="mb-16 md:mb-24 mt-8 md:mt-16 text-center">
                    <div className="inline-block bg-white/5 border border-white/[0.08] rounded px-4 py-1.5 mb-8">
                        <span className="font-mono text-[11px] text-white/50 tracking-[0.2em] uppercase">Security Protocols</span>
                    </div>
                    <h1 className="font-display text-6xl md:text-8xl text-white mb-8 tracking-tighter leading-none">
                        Безопасность<span className="text-white/20">.</span>
                    </h1>
                    <p className="font-body-lg text-xl text-foreground/60 max-w-2xl mx-auto leading-relaxed">
                        Защита ваших данных и идей — наш главный приоритет. Мы используем банковские стандарты безопасности на всех уровнях системы.
                    </p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
                    {securityFeatures.map((feature, i) => (
                        <motion.div
                            key={feature.title}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.1 }}
                            className="lovable-glass rounded-3xl p-8 hover:translate-y-[-4px] transition-all duration-500 group"
                        >
                            <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-500">
                                <feature.icon className="w-6 h-6 text-white/60" />
                            </div>
                            <h3 className="font-mono text-lg text-white mb-4 tracking-tight uppercase font-bold">
                                {feature.title}
                            </h3>
                            <p className="font-body-sm text-foreground/50 leading-relaxed">
                                {feature.description}
                            </p>
                        </motion.div>
                    ))}
                </div>

                {/* Bottom Card */}
                <div className="mt-20 max-w-4xl mx-auto">
                    <div className="lovable-glass-strong rounded-[40px] p-12 text-center relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] to-transparent pointer-events-none" />
                        <h2 className="font-display text-3xl text-white mb-6">Возникли вопросы по безопасности?</h2>
                        <p className="text-foreground/60 mb-10 max-w-xl mx-auto">
                            Наши специалисты готовы предоставить подробную информацию о методах защиты и хранения данных в <PitchyLogo size="none" />.
                        </p>
                        <a 
                            href="/contact" 
                            className="inline-flex bg-white text-black font-mono text-[11px] font-black uppercase tracking-[0.2em] px-10 py-4 rounded-full hover:scale-105 transition-transform"
                        >
                            Связаться с нами
                        </a>
                    </div>
                </div>
            </main>

            <SiteFooter />
        </div>
    );
}
