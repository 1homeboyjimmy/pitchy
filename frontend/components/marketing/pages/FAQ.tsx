"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, MessageCircle } from "lucide-react";
import { FadeContent } from "../reactbits/FadeContent";
import { AnimatedContent } from "../reactbits/AnimatedContent";
import { AnimatedButton } from "../ui-custom/AnimatedButton";

const faqs = [
  {
    question: "Как работает ИИ-анализ?",
    answer:
      "Наша система использует YandexGPT в сочетании с RAG (Retrieval-Augmented Generation). Когда вы отправляете описание стартапа, мы находим релевантный контекст в нашей базе знаний и просим ИИ оценить инвестиционный потенциал, предоставить оценку, сильные и слабые стороны, а также рекомендации.",
  },
  {
    question: "Какие данные Pitchy использует для контекста?",
    answer:
      "Анализ обогащается контекстом из кураторской базы знаний о российском венчурном рынке, включая информацию о регулировании, ожиданиях инвесторов, динамике рынка и конкуренции. Система использует поиск на основе TF-IDF для нахождения наиболее релевантного контекста.",
  },
  {
    question: "Могу ли я анализировать любой стартап?",
    answer:
      "Да, Pitchy работает со стартапами из любых отраслей и стадий. ИИ адаптирует анализ на основе предоставленных данных — имя, категория, стадия, сайт и описание помогают создать более точную оценку.",
  },
  {
    question: "Сколько времени занимает анализ?",
    answer:
      "Большинство анализов занимают 10–30 секунд. Время зависит от скорости ответа YandexGPT и сложности описания стартапа.",
  },
  {
    question: "Мои данные в безопасности?",
    answer:
      "Ваша сессия защищена JWT-токенами в HttpOnly cookies. Данные анализа и чат-сессий хранятся в вашем аккаунте и доступны только после входа.",
  },
  {
    question: "Можно ли экспортировать результаты?",
    answer:
      "Да, вы можете экспортировать историю анализов в CSV через панель управления. Экспорт включает оценки, сильные и слабые стороны и рекомендации.",
  },
  {
    question: "Нужен ли аккаунт, чтобы попробовать?",
    answer:
      "Вы можете запустить быстрый анализ на главной странице без аккаунта. Однако создание аккаунта позволяет сохранять анализы, использовать ИИ-чат и просматривать историю.",
  },
  {
    question: "Pitchy бесплатен?",
    answer:
      "Да, платформа сейчас бесплатна. Вы можете создать аккаунт, запускать анализы и использовать чат-ассистента без оплаты.",
  },
];

function FAQItem({
  question,
  answer,
  isOpen,
  onToggle,
  index,
}: {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`border border-zinc-800 rounded-xl overflow-hidden transition-colors duration-200 ${isOpen ? "bg-zinc-900/50 border-violet-500/30" : "bg-zinc-900/20 hover:bg-zinc-900/40"
        }`}
    >
      <button onClick={onToggle} className="w-full flex items-center justify-between p-5 text-left">
        <span className="text-white font-medium pr-4">{question}</span>
        <motion.div
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ duration: 0.2 }}
          className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-200 ${isOpen ? "bg-violet-500 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
        >
          <Plus className="w-5 h-5" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isOpen ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="px-5 pb-5">
              <div className="pt-2 border-t border-zinc-800">
                <p className="text-zinc-400 leading-relaxed pt-4">{answer}</p>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

export function FAQPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const handleToggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <FadeContent>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/20 mb-6">
              <MessageCircle className="w-4 h-4 text-violet-400" />
              <span className="text-sm text-violet-300">Центр поддержки</span>
            </div>
          </FadeContent>

          <FadeContent delay={0.1}>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Часто задаваемые вопросы
            </h1>
          </FadeContent>

          <FadeContent delay={0.2}>
            <p className="text-lg text-zinc-400 max-w-xl mx-auto">
              Все, что нужно знать о Pitchy и как он помогает принимать инвестиционные решения.
            </p>
          </FadeContent>
        </div>

        <AnimatedContent animation="slideUp" delay={0.3}>
          <div className="space-y-3">
            {faqs.map((faq, index) => (
              <FAQItem
                key={index}
                question={faq.question}
                answer={faq.answer}
                isOpen={openIndex === index}
                onToggle={() => handleToggle(index)}
                index={index}
              />
            ))}
          </div>
        </AnimatedContent>

        <FadeContent delay={0.6}>
          <div className="mt-12 text-center p-8 bg-zinc-900/50 backdrop-blur-sm border border-zinc-800 rounded-2xl">
            <h3 className="text-xl font-medium text-white mb-2">Остались вопросы?</h3>
            <p className="text-zinc-400 mb-6">
              Не нашли ответ? Наша команда готова помочь.
            </p>
            <AnimatedButton variant="outline" icon={<MessageCircle className="w-4 h-4" />}>
              Написать в поддержку
            </AnimatedButton>
          </div>
        </FadeContent>
      </div>
    </div>
  );
}
