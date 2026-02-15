"use client";

import { motion } from "framer-motion";
import { Shield } from "lucide-react";
import Layout from "@/components/Layout";

const sections = [
    {
        title: "1. Сбор информации",
        content:
            "Мы собираем информацию, которую вы предоставляете при создании аккаунта (email, имя), а также данные об использовании платформы (анализы, запросы). Мы не собираем конфиденциальную финансовую информацию о стартапах.",
    },
    {
        title: "2. Использование данных",
        content:
            "Ваши данные используются для: предоставления сервиса, улучшения алгоритмов анализа, отправки уведомлений (при согласии), и обеспечения безопасности аккаунта. Мы не продаём ваши данные третьим лицам.",
    },
    {
        title: "3. Хранение данных",
        content:
            "Данные хранятся на защищённых серверах с шифрованием. Мы храним данные только на территории Российской Федерации в соответствии с требованиями 152-ФЗ.",
    },
    {
        title: "4. Права пользователей",
        content:
            "Вы имеете право: запрашивать копию своих данных, требовать удаления данных, отзывать согласие на обработку, подавать жалобу в надзорный орган.",
    },
    {
        title: "5. Cookies",
        content:
            "Мы используем необходимые cookies для работы платформы и аналитические cookies для улучшения сервиса. Вы можете управлять cookies в настройках браузера.",
    },
    {
        title: "6. Контакты",
        content:
            "По вопросам конфиденциальности: privacy@pitchy.pro. Ответственный за обработку персональных данных: указан в реквизитах компании.",
    },
];

export default function PrivacyPage() {
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
                                <Shield className="w-7 h-7 text-pitchy-violet" />
                            </div>
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
                            Политика конфиденциальности
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
