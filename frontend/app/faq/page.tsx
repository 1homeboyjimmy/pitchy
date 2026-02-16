"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, HelpCircle } from "lucide-react";
import Layout from "@/components/Layout";

const faqs = [
  {
    question: "Что такое Pitchy.pro?",
    answer:
      "Pitchy.pro — платформа на основе ИИ для оценки стартапов. Мы анализируем стартапы по 5 ключевым параметрам (рынок, команда, продукт, трекшн, финансы) и предоставляем комплексную оценку от 0 до 100.",
  },
  {
    question: "Как работает система оценки?",
    answer:
      "Наш ИИ анализирует стартап по 5 ключевым категориям, каждая из которых вносит вклад в общую оценку от 0 до 100. Более 80 — высокий инвестиционный потенциал, 60-80 — хороший, 40-60 — средний, менее 40 — высокий риск.",
  },
  {
    question: "Это бесплатно?",
    answer:
      "Да, базовый анализ полностью бесплатный. Вы можете анализировать неограниченное количество стартапов. Премиум-функции, такие как детальные отчёты и сравнение, доступны в платных тарифах.",
  },
  {
    question: "Какие данные использует ИИ?",
    answer:
      "Наш ИИ использует публично доступные данные: рыночные тренды, информацию о команде, данные о продукте и метрики роста. Мы не используем конфиденциальную информацию.",
  },
  {
    question: "Могу ли я сохранять анализы?",
    answer:
      "Да! Зарегистрированные пользователи могут сохранять неограниченное количество анализов, сравнивать стартапы и отслеживать динамику оценок во времени.",
  },
  {
    question: "Насколько точны результаты?",
    answer:
      "Наш ИИ предоставляет объективную оценку на основе доступных данных. Это инструмент для первичного скрининга, который не заменяет полноценный due diligence, но значительно ускоряет процесс принятия решений.",
  },
  {
    question: "Как связаться с командой?",
    answer:
      "Вы можете написать нам на auth@pitchy.pro или использовать форму обратной связи на странице контактов. Мы обычно отвечаем в течение 24 часов.",
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

export default function FAQPage() {
  return (
    <Layout>
      <div className="min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 rounded-2xl bg-pitchy-violet/10 border border-pitchy-violet/20 flex items-center justify-center">
                <HelpCircle className="w-7 h-7 text-pitchy-violet" />
              </div>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
              Часто задаваемые вопросы
            </h1>
            <p className="text-white/50 text-lg">
              Ответы на самые популярные вопросы о Pitchy.pro
            </p>
          </motion.div>

          <div className="space-y-3">
            {faqs.map((faq, index) => (
              <FAQItem key={index} {...faq} index={index} />
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
