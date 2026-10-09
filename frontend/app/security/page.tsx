"use client";

import { motion } from "framer-motion";
import { Shield, Lock, Server, Eye, Key, RefreshCw } from "lucide-react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";

const securityFeatures = [
    {
        icon: Lock,
        title: "Защита учётных данных",
        description: "Сайт доступен по HTTPS. Пароли пользователей не хранятся в открытом виде: приложение сохраняет их криптографические хеши.",
    },
    {
        icon: Server,
        title: "Защищённая инфраструктура",
        description: "Приложение и его вспомогательные компоненты работают в контейнерной инфраструктуре. Доступ к административным функциям требует авторизации.",
    },
    {
        icon: Eye,
        title: "Технический мониторинг",
        description: "Для контроля состояния сервисов и просмотра технических журналов используются Grafana и Loki.",
    },
    {
        icon: Key,
        title: "Контроль доступа",
        description: "Функции и административные операции доступны в соответствии с ролью аккаунта. Сессионные токены имеют ограниченный срок действия.",
    },
    {
        icon: RefreshCw,
        title: "Резервное копирование",
        description: "Перед развертыванием новой версии предусмотрено создание резервной копии базы данных. Частота и срок хранения зависят от эксплуатационной конфигурации.",
    },
    {
        icon: Shield,
        title: "Персональные данные",
        description: "Сведения об обработке персональных данных и способах связи с оператором опубликованы в Политике конфиденциальности.",
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
                    <h1 className="font-display text-4xl sm:text-6xl md:text-8xl text-white mb-8 tracking-tighter leading-none">
                        Безопасность<span className="text-white/20">.</span>
                    </h1>
                    <p className="font-body-lg text-xl text-foreground/60 max-w-2xl mx-auto leading-relaxed">
                        Здесь описаны меры защиты, используемые в приложении и его инфраструктуре.
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
                            <h3 className="font-display text-lg text-white mb-4 tracking-tight uppercase font-bold">
                                {feature.title}
                            </h3>
                            <p className="font-body-sm text-foreground/50 leading-relaxed">
                                {feature.description}
                            </p>
                        </motion.div>
                    ))}
                </div>

            </main>

            <SiteFooter />
        </div>
    );
}
