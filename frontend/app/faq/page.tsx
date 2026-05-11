"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus, Zap, CreditCard, Network, Shield, HelpCircle } from "lucide-react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";
import { PitchyLogo } from "@/components/shared/PitchyLogo";

const categories = [
  { icon: Zap, label: "ОБЩЕЕ", count: "12 СТАТЕЙ" },
  { icon: CreditCard, label: "ОПЛАТА", count: "5 СТАТЕЙ" },
  { icon: Network, label: "ИНТЕГРАЦИИ", count: "24 СТАТЕЙ" },
  { icon: Shield, label: "БЕЗОПАСНОСТЬ", count: "8 СТАТЕЙ" },
];

const faqs = [
  {
    question: <>Что такое <PitchyLogo size="none" />?</>,
    answer: <><PitchyLogo size="none" /> — это платформа для оценки стартапов на базе искусственного интеллекта. Мы помогаем инвесторам и фаундерам валидировать идеи, рассчитывать юнит-экономику и автоматически собирать инвестиционные отчеты.</>
  },
  {
    question: <>Как <PitchyLogo size="none" /> улучшает процесс создания презентаций?</>,
    answer: <><PitchyLogo size="none" /> использует проприетарные нейронные сети для анализа структуры повествования и требований к визуализации данных. Автоматизируя генерацию макетов и подбор тональности, мы сокращаем циклы итераций примерно на 64% по сравнению с традиционным программным обеспечением для слайдов.</>
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
    answer: <>Безусловно. <PitchyLogo size="none" /> включает детализированное управление доступом на основе ролей (RBAC), многопользовательское редактирование в реальном времени и систему контроля версий, которая отслеживает каждую корректировку пикселей во всей вашей организации.</>
  },
  {
    question: "Предоставляете ли вы создание индивидуальных шаблонов для корпоративных клиентов?",
    answer: "Наш тариф Enterprise включает выделенного дизайн-консьержа. Мы внедрим вашу бренд-систему в наш ИИ-движок, гарантируя, что каждый слайд, созданный вашей командой, на 100% соответствует стандартам бренда."
  }
];

function FAQItem({ question, answer, index }: { question: React.ReactNode; answer: React.ReactNode; index: number }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`lovable-glass rounded-3xl overflow-hidden transition-all duration-500 ${isOpen ? "border-white/20" : "hover:border-white/10"}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-8 text-left cursor-pointer group"
      >
        <span className="font-display text-xl text-white group-hover:text-white/80 transition-colors pr-6 tracking-tight">{question}</span>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center border border-white/10 transition-all duration-500 ${isOpen ? "bg-white text-black rotate-180" : "bg-white/5 text-white"}`}>
          {isOpen ? <Minus size={18} /> : <Plus size={18} />}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="px-8 pb-8">
              <div className="pt-8 border-t border-white/5 text-foreground/50 font-body-sm leading-relaxed text-[16px] max-w-3xl">
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
  return (
    <div className="bg-black text-foreground antialiased min-h-screen flex flex-col relative overflow-hidden">
      {/* Decorative Orbs */}
      <div className="aurora-orb top-[-10rem] right-[-10rem] h-96 w-96 bg-white/[0.03] animate-pulse" />
      <div className="aurora-orb bottom-[10rem] left-[-10rem] h-80 w-80 bg-white/[0.02] animate-float-slow" />

      <TopNavBar />

      <main className="flex-grow pt-12 pb-24 px-6 md:px-12 max-w-[1440px] mx-auto w-full relative z-10">
        <div className="max-w-5xl mx-auto py-8">
          {/* Header Section */}
          <section className="mb-24">
            <h1 className="font-display text-6xl md:text-8xl text-white mb-8 tracking-tighter leading-none">
              Часто задаваемые <span className="text-white/30 italic">вопросы</span>.
            </h1>
            <p className="text-foreground/60 font-body-lg text-xl max-w-2xl mb-16 leading-relaxed">
              Полная документация и база знаний для ИИ-движка <PitchyLogo size="none" />. 
              Если вы не можете найти ответ, наша поддержка готова помочь.
            </p>

            {/* Featured Categories Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 mb-16">
              {categories.map((cat, i) => (
                <button key={i} className="lovable-glass p-8 rounded-3xl hover:translate-y-[-4px] transition-all duration-500 text-left group">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-10 group-hover:bg-white group-hover:text-black transition-all duration-500">
                    <cat.icon size={20} />
                  </div>
                  <div>
                    <span className="font-mono-label text-[12px] text-white block mb-2 uppercase tracking-[0.2em]">{cat.label}</span>
                    <span className="text-[10px] text-white/30 uppercase tracking-[0.3em]">{cat.count}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* FAQ Accordion Section */}
          <section className="space-y-6">
            <div className="flex items-center justify-between border-b border-white/5 pb-6 mb-12">
              <h3 className="font-mono-label text-[12px] text-white/30 tracking-[0.4em] uppercase">Технические спецификации</h3>
              <span className="text-white/20 text-[10px] font-mono tracking-widest">ID: KB-4092-X</span>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              {faqs.map((faq, index) => (
                <FAQItem key={index} index={index} {...faq} />
              ))}
            </div>
          </section>

          {/* Bottom CTA */}
          <section className="mt-16 sm:mt-32 py-12 sm:py-20 border-t border-white/5">
            <div className="lovable-glass p-6 sm:p-12 rounded-3xl sm:rounded-[40px] flex flex-col md:flex-row md:items-center justify-between gap-8 sm:gap-10">
              <div className="w-full md:max-w-md text-center md:text-left">
                <h4 className="text-white font-display tracking-tight text-3xl sm:text-4xl mb-3 sm:mb-4">Остались вопросы?</h4>
                <p className="text-foreground/40 font-body-sm text-[14px] sm:text-[15px] leading-relaxed">
                  Прямые линии поддержки открыты 24/7 для подписчиков всех уровней. Мы поможем вам настроить систему.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full md:w-auto shrink-0">
                <button className="bg-white text-black px-6 sm:px-10 py-3 sm:py-4 rounded-full font-mono-label text-[11px] uppercase tracking-[0.2em] font-black hover:scale-105 transition-all text-center whitespace-nowrap">
                  СВЯЗАТЬСЯ С НАМИ
                </button>
                <button className="bg-white/5 border border-white/10 text-white px-6 sm:px-10 py-3 sm:py-4 rounded-full font-mono-label text-[11px] uppercase tracking-[0.2em] font-black hover:bg-white/10 transition-all text-center whitespace-nowrap">
                  ДОКУМЕНТАЦИЯ
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
