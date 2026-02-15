"use client";

import { motion } from "framer-motion";
import { Shield, Lock, Server, Eye, Key, RefreshCw } from "lucide-react";
import Layout from "@/components/Layout";

const securityFeatures = [
    {
        icon: Lock,
        title: "Шифрование данных",
        description: "Все данные зашифрованы при передаче (TLS 1.3) и хранении (AES-256). Токены доступа хешируются с использованием bcrypt.",
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
        description: "Ролевая модель доступа, двухфакторная аутентификация (2FA), автоматическое истечение сессий.",
    },
    {
        icon: RefreshCw,
        title: "Резервное копирование",
        description: "Автоматическое ежедневное резервное копирование с хранением в географически распределённых дата-центрах.",
    },
    {
        icon: Shield,
        title: "Соответствие стандартам",
        description: "Платформа соответствует требованиям 152-ФЗ о персональных данных и следует лучшим практикам OWASP.",
    },
];

export default function SecurityPage() {
    return (
        <Layout>
            <div className="min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8">
                <div className="max-w-5xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center mb-12"
                    >
                        <div className="flex justify-center mb-4">
                            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                                <Shield className="w-7 h-7 text-emerald-400" />
                            </div>
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
                            Безопасность
                        </h1>
                        <p className="text-white/50 text-lg">
                            Защита ваших данных — наш приоритет
                        </p>
                    </motion.div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {securityFeatures.map((feature, i) => (
                            <motion.div
                                key={feature.title}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1 }}
                                whileHover={{ scale: 1.02, y: -4 }}
                                className="glass-card-hover p-6 group"
                            >
                                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-4 group-hover:shadow-glow-success/30 transition-shadow">
                                    <feature.icon className="w-6 h-6 text-emerald-400" />
                                </div>
                                <h3 className="text-lg font-semibold text-white mb-2">
                                    {feature.title}
                                </h3>
                                <p className="text-sm text-white/50 leading-relaxed">
                                    {feature.description}
                                </p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
