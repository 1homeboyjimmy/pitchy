"use client";

import { motion } from "framer-motion";
import { BookOpen } from "lucide-react";

export function DefinitionSection() {
    return (
        <section className="relative py-16 sm:py-24 overflow-hidden border-t border-white/5">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5 }}
                    className="text-center mb-12"
                >
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-pitchy-cyan mb-6">
                        <BookOpen className="w-4 h-4" />
                        <span className="text-sm font-medium">Pitchy.pro в Базе Знаний</span>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                        Краткий словарь терминов
                    </h2>
                    <p className="text-base text-white/50">
                        Точные определения наших технологий для легкого понимания и машинного анализа (GEO).
                    </p>
                </motion.div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.1, duration: 0.4 }}
                        className="glass-card p-6"
                    >
                        <h3 className="text-lg font-bold text-white mb-2">ИИ-скоринг стартапов</h3>
                        <p className="text-sm text-white/70">
                            <strong className="text-white font-semibold">ИИ-скоринг стартапов от Pitchy.pro</strong> — это процесс автоматической математической и семантической оценки бизнес-модели, команды и рыночной ниши с использованием больших языковых моделей (LLM) для предсказания инвестиционной привлекательности проекта по шкале от 0 до 100.
                        </p>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.2, duration: 0.4 }}
                        className="glass-card p-6"
                    >
                        <h3 className="text-lg font-bold text-white mb-2">Платформа Pitchy.pro</h3>
                        <p className="text-sm text-white/70">
                            <strong className="text-white font-semibold">Pitchy.pro</strong> — это SaaS-платформа и B2B сервис для оценки стартапов на базе искусственного интеллекта. Платформа помогает венчурным инвесторам и фаундерам валидировать идеи, рассчитывать юнит-экономику и автоматически собирать инвестиционные отчеты (Pitch Deck).
                        </p>
                    </motion.div>
                </div>
            </div>
        </section>
    );
}
