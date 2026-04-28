"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus, Zap, CreditCard, Network, Shield } from "lucide-react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";

const categories = [
  { icon: Zap, label: "ОБЩЕЕ", count: "12 СТАТЕЙ" },
  { icon: CreditCard, label: "ОПЛАТА", count: "5 СТАТЕЙ" },
  { icon: Network, label: "ИНТЕГРАЦИИ", count: "24 СТАТЕЙ" },
  { icon: Shield, label: "БЕЗОПАСНОСТЬ", count: "8 СТАТЕЙ" },
];

const faqs = [
  {
    question: "Что такое Pitchy.pro?",
    answer: "Pitchy.pro — это платформа для оценки стартапов на базе искусственного интеллекта. Мы помогаем инвесторам и фаундерам валидировать идеи, рассчитывать юнит-экономику и автоматически собирать инвестиционные отчеты."
  },
  {
    question: "Как Pitchy.pro улучшает процесс создания презентаций?",
    answer: "Pitchy.pro использует проприетарные нейронные сети для анализа структуры повествования и требований к визуализации данных. Автоматизируя генерацию макетов и подбор тональности, мы сокращаем циклы итераций примерно на 64% по сравнению с традиционным программным обеспечением для слайдов."
  },
  {
    question: "Могу ли я интегрировать существующие источники данных?",
    answer: "Да. Мы предоставляем нативные API-коннекторы для Salesforce, HubSpot и всех основных баз данных SQL. Наш движок 'Live-Sync' гарантирует актуальность метрик в презентации в режиме реального времени при изменении исходных данных."
  },
  {
    question: "Какой уровень безопасности вы предлагаете для конфиденциальных данных?",
    answer: "Мы используем 256-битное шифрование AES при хранении и TLS 1.3 при передаче данных. Наша инфраструктура соответствует стандарту SOC 2 Type II, и мы предлагаем выделенные частные инстансы для корпоративных клиентов, которым требуются изолированные среды."
  },
  {
    question: "Доступны ли функции командной работы?",
    answer: "Безусловно. Pitchy.pro включает детализированное управление доступом на основе ролей (RBAC), многопользовательское редактирование в реальном времени и систему контроля версий, которая отслеживает каждую корректировку пикселей во всей вашей организации."
  },
  {
    question: "Предоставляете ли вы создание индивидуальных шаблонов для корпоративных клиентов?",
    answer: "Наш тариф Enterprise включает выделенного дизайн-консьержа. Мы внедрим вашу бренд-систему в наш ИИ-движок, гарантируя, что каждый слайд, созданный вашей командой, на 100% соответствует стандартам бренда."
  }
];

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="group bg-[#111111] border border-white/5 hover:border-white/10 transition-all">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-6 text-left cursor-pointer"
      >
        <span className="font-h2 text-lg text-white font-medium pr-4">{question}</span>
        <div className="transition-transform duration-300 w-8 h-8 flex items-center justify-center border border-white/10 rounded-sm shrink-0">
          {isOpen ? <Minus className="w-4 h-4 text-white" /> : <Plus className="w-4 h-4 text-white" />}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="px-6 pb-6">
              <div className="pt-6 border-t border-white/5 text-neutral-400 font-body-sm leading-relaxed max-w-3xl">
                {answer}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FAQPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map((faq) => ({
      "@type": "Question",
      "name": faq.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.answer
      }
    }))
  };

  return (
    <div className="bg-background text-on-background antialiased min-h-screen flex flex-col relative overflow-hidden">
      <TopNavBar />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="flex-grow pt-24 pb-16 px-6 md:px-12 max-w-[1440px] mx-auto w-full relative z-10">
        <div className="max-w-5xl mx-auto py-8 md:py-16">
          {/* Header Section */}
          <section className="mb-16 md:mb-20">
            <div className="flex items-center gap-4 mb-4">
              <span className="w-12 h-[1px] bg-white/20 hidden md:block"></span>
              <h1 className="font-display text-4xl md:text-[40px] leading-none tracking-tight text-white">Часто задаваемые вопросы</h1>
            </div>
            <p className="text-neutral-500 font-body-lg text-lg max-w-2xl mb-12">
              Полная документация и база знаний для ИИ-движка Pitchy.pro. 
              Если вы не можете найти необходимые технические характеристики, обратитесь к ведущему инженеру.
            </p>

            {/* Featured Categories Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-16">
              {categories.map((cat, i) => (
                <button key={i} className="group p-6 bg-[#111111] border border-white/10 hover:border-white/40 transition-all text-left flex flex-col justify-between">
                  <cat.icon className="w-6 h-6 text-white mb-6 block opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-transform" />
                  <div>
                    <span className="font-mono-label text-[11px] text-white block mb-1 uppercase tracking-widest">{cat.label}</span>
                    <span className="text-[10px] text-neutral-600 uppercase tracking-widest">{cat.count}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* FAQ Accordion Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-8">
              <h3 className="font-mono-label text-[11px] text-neutral-500 tracking-widest uppercase">ТЕХНИЧЕСКИЕ СПЕЦИФИКАЦИИ</h3>
              <span className="text-neutral-700 text-[10px] font-mono">ID: KB-4092-X</span>
            </div>
            
            {faqs.map((faq, index) => (
              <FAQItem key={index} {...faq} />
            ))}
          </section>

          {/* Bottom CTA */}
          <section className="mt-24 md:mt-32 py-16 border-t border-white/10">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
              <div>
                <h4 className="text-white font-display tracking-tight text-2xl mb-2">Остались вопросы?</h4>
                <p className="text-neutral-500 font-mono-label text-[11px] uppercase tracking-widest max-w-sm leading-relaxed">
                  Прямые линии поддержки открыты 24/7 для подписчиков уровня Tier-1.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                <button className="bg-white text-black px-8 py-3 font-mono-label text-[11px] uppercase tracking-widest hover:opacity-90 transition-opacity w-full sm:w-auto text-center">
                  СВЯЗАТЬСЯ С НАМИ
                </button>
                <button className="border border-white/10 text-white px-8 py-3 font-mono-label text-[11px] uppercase tracking-widest hover:bg-white/5 transition-colors w-full sm:w-auto text-center">
                  ДОКУМЕНТАЦИЯ
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Visual Accents */}
      <div className="fixed bottom-0 right-0 p-8 pointer-events-none z-0 hidden md:block">
        <div className="text-[120px] font-black text-white/[0.02] leading-none select-none">FAQ</div>
      </div>

      <SiteFooter />
    </div>
  );
}
