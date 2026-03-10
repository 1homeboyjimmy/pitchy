"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, HelpCircle } from "lucide-react";

const faqs = [
    {
        question: "Что такое Pitchy.pro?",
        answer:
            "Pitchy.pro — это платформа для оценки стартапов на базе искусственного интеллекта. Мы помогаем инвесторам и фаундерам валидировать идеи, рассчитывать юнит-экономику и автоматически собирать инвестиционные отчеты.",
    },
    {
        question: "Что такое AI-скоринг стартапов?",
        answer: "AI-скоринг стартапов от Pitchy.pro — это процесс автоматической оценки бизнес-идеи, команды и рыночных перспектив с использованием больших языковых моделей (LLM) для предсказания инвестиционной привлекательности проекта по шкале от 0 до 100.",
    },
    {
        question: "Какие данные использует ваш ИИ?",
        answer:
            "Наш ИИ использует публично доступные данные: рыночные тренды, информацию о команде, данные о продукте и метрики роста. Мы не используем конфиденциальную информацию.",
    },
    {
        question: "Насколько точны результаты ИИ-анализа?",
        answer:
            "Наш ИИ предоставляет объективную оценку на основе доступных данных. Это сверхбыстрый инструмент для первичного скрининга стартапов, который не заменяет полноценный due diligence, но значительно ускоряет процесс принятия инвестиционных решений.",
    },
];

function FAQItem({
    question,
    answer,
    index,
}: {
    question: string;
    answer: string;
    index: number;
}) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.1, duration: 0.4 }}
            className="glass-card-hover overflow-hidden"
        >
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-5 sm:p-6 text-left cursor-pointer"
            >
                <span className="text-base sm:text-lg font-medium text-white pr-4">
                    {question}
                </span>
                <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex-shrink-0"
                >
                    <ChevronDown className="w-5 h-5 text-white/40" />
                </motion.div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <div className="px-5 sm:px-6 pb-5 sm:pb-6">
                            <p className="text-sm sm:text-base text-white/60 leading-relaxed">
                                {answer}
                            </p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

export function HomeFAQSection() {
    return (
        <section className="relative py-24 sm:py-32 overflow-hidden">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5 }}
                    className="text-center mb-16"
                >
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-pitchy-violet mb-6">
                        <HelpCircle className="w-4 h-4" />
                        <span className="text-sm font-medium">FAQ</span>
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                        Частые вопросы
                    </h2>
                    <p className="text-lg text-white/50">
                        Быстрые ответы для понимания того, как работает Pitchy.pro
                    </p>
                </motion.div>

                <div className="space-y-3">
                    {faqs.map((faq, index) => (
                        <FAQItem key={index} {...faq} index={index} />
                    ))}
                </div>
            </div>
        </section>
    );
}
