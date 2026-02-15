"use client";

import { motion } from "framer-motion";
import { FileText } from "lucide-react";
import Layout from "@/components/Layout";

const sections = [
    {
        title: "1. Общие положения",
        content:
            "Настоящие Условия регулируют использование платформы Pitchy.pro. Используя наш сервис, вы соглашаетесь с данными условиями. Если вы не согласны, пожалуйста, не используйте платформу.",
    },
    {
        title: "2. Описание сервиса",
        content:
            "Pitchy.pro предоставляет ИИ-инструменты для анализа и оценки стартапов. Результаты анализа носят информационный характер и не являются инвестиционной рекомендацией.",
    },
    {
        title: "3. Регистрация",
        content:
            "Для доступа к расширенным функциям необходима регистрация. Вы обязуетесь предоставлять достоверные данные и не передавать данные аккаунта третьим лицам.",
    },
    {
        title: "4. Ответственность",
        content:
            "Pitchy.pro не несёт ответственности за инвестиционные решения, принятые на основе результатов анализа. Платформа предоставляет информацию «как есть» без гарантий точности.",
    },
    {
        title: "5. Интеллектуальная собственность",
        content:
            "Все материалы, логотипы, алгоритмы и контент платформы являются собственностью Pitchy.pro. Копирование и распространение без разрешения запрещено.",
    },
    {
        title: "6. Изменения условий",
        content:
            "Мы оставляем за собой право изменять данные условия. Продолжение использования платформы после изменений считается согласием с обновлёнными условиями.",
    },
];

export default function TermsPage() {
    return (
        <Layout>
            <div className="min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8">
                <div className="max-w-3xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center mb-12"
                    >
                        <div className="flex justify-center mb-4">
                            <div className="w-14 h-14 rounded-2xl bg-pitchy-violet/10 border border-pitchy-violet/20 flex items-center justify-center">
                                <FileText className="w-7 h-7 text-pitchy-violet" />
                            </div>
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
                            Условия использования
                        </h1>
                        <p className="text-white/40 text-sm">
                            Последнее обновление: февраль 2026
                        </p>
                    </motion.div>

                    <div className="space-y-6">
                        {sections.map((section, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.05 }}
                                className="glass-card-hover p-6"
                            >
                                <h2 className="text-lg font-semibold text-white mb-3">
                                    {section.title}
                                </h2>
                                <p className="text-sm text-white/60 leading-relaxed">
                                    {section.content}
                                </p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
