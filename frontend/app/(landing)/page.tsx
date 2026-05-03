"use client";

import Link from "next/link";
import { ArrowUpRight, BarChart3, Users, FileText, Sparkles, MessageSquare, Plus, Radar, Layers3 } from "lucide-react";
import { motion } from "framer-motion";

import { LandingFooter } from "@/components/landing/LandingFooter";
import { HeroSection } from "@/components/sections/HeroSection";

const capabilityCards = [
  {
    icon: BarChart3,
    title: "Моментальная unit-экономика",
    body: "Считайте окупаемость, CAC, LTV и сценарии роста в одном живом слое данных.",
  },
  {
    icon: Users,
    title: "Глубокий CustDev",
    body: "Синтетические интервью и сегментация сигналов без сухих дашбордов и лишнего шума.",
  },
  {
    icon: FileText,
    title: "Гранты и заявки",
    body: "Собирайте подачу, трекинг и отчётность в единую управляемую систему.",
  },
  {
    icon: MessageSquare,
    title: "Ассистент 24/7",
    body: "AI-слой помогает с RAG, юридическими вопросами и структурированием проектных решений.",
  },
];

const timeline = [
  { label: "Идея", note: "Сбор сигналов, гипотез и рыночного контекста" },
  { label: "Скоринг", note: "Оценка потенциала, рисков и unit-экономики" },
  { label: "Интервью", note: "Синтетическая обратная связь от релевантных персон" },
  { label: "Roadmap", note: "Приоритезация и структурированный трек исполнения" },
];

const signals = ["Инвестор", "Маркетолог", "Разработчик", "HR", "Юрист", "Аналитик"];

function SectionHeading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
      <div className="text-[#a855f7] text-[11px] font-bold tracking-[0.3em] uppercase mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{eyebrow}</div>
      <h2 className="mt-4 max-w-4xl text-3xl md:text-5xl lg:text-6xl font-bold text-foreground tracking-tight leading-none uppercase font-display">
        {title}<span className="text-[#a855f7]">.</span>
      </h2>
      <p className="mt-6 max-w-2xl text-sm leading-7 text-foreground/60 md:text-lg font-light">{text}</p>
    </div>
  );
}



const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Pitchy.pro",
  "url": "https://pitchy.pro",
  "logo": "https://pitchy.pro/og-image.png",
  "contactPoint": {
    "@type": "ContactPoint",
    "email": "auth@pitchy.pro",
    "contactType": "customer support"
  }
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "url": "https://pitchy.pro",
  "potentialAction": {
    "@type": "SearchAction",
    "target": "https://pitchy.pro/?q={search_term_string}",
    "query-input": "required name=search_term_string"
  }
};

export default function LandingPage() {
  return (
    <div className="antialiased min-h-screen flex flex-col overflow-x-hidden bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />

      <HeroSection />

      {/* Cinematic Fade Top (Legacy Transition) */}
      <div className="w-full h-32 bg-gradient-to-b from-transparent to-black pointer-events-none -mt-32 relative z-10" />

      <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
        {/* Lovable Aurora Background Elements */}




        {/* System Overview Section */}
        <section className="relative section-line px-5 py-24 sm:px-8 lg:px-12">
          <div className="absolute inset-0 aurora-bg opacity-80" />
          <div className="relative mx-auto w-full max-w-7xl">
            <SectionHeading
              eyebrow="SYSTEM OVERVIEW"
              title="Единая операционная система для стартапа"
              text="Мы собрали все инструменты в одном интерфейсе: от первичного анализа идеи до полной подготовки к инвестициям. Никаких лишних переключений между вкладками."
            />

            <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {capabilityCards.map((card, index) => {
                const Icon = card.icon;
                return (
                  <motion.article
                    key={card.title}
                    initial={{ opacity: 0, y: 28 }}
                    whileInView={{ opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut", delay: 0.08 * index } }}
                    whileHover={{ y: -5 }}
                    viewport={{ once: true, margin: "-80px" }}
                    className="lovable-glass lovable-liquid-outline group rounded-[1.75rem] p-6 transition-all duration-500 hover:shadow-[0_20px_40px_-15px_oklch(0.5_0.15_260_/_0.2)]"
                  >
                    <div className="flex items-center justify-between relative z-10 w-full">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5">
                        <Icon size={20} strokeWidth={1.5} className="text-white" />
                      </div>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-white/40 transition-transform duration-300 group-hover:-translate-y-1 group-hover:translate-x-1" />
                    </div>
                    <div className="relative z-10 w-full break-words">
                        <h3 className="mt-10 text-xl leading-tight text-foreground font-bold uppercase tracking-tight font-display">{card.title}</h3>
                        <p className="mt-4 text-sm leading-7 text-foreground/60 font-light">{card.body}</p>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          </div>
        </section>

        {/* User Path Section */}
        <section className="relative section-line px-5 py-24 sm:px-8 lg:px-12">
          <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-2 lg:items-center">
            <motion.div
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              viewport={{ once: true, margin: "-120px" }}
              className="w-full flex-1"
            >
              <div className="text-[#a855f7] text-[11px] font-bold tracking-[0.3em] uppercase mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>USER PATH REWIRED</div>
              <h2 className="mt-4 w-full text-4xl leading-none text-foreground md:text-6xl font-bold uppercase tracking-tight font-display">
                Путь продукта: от гипотезы до результата<span className="text-[#a855f7]">.</span>
              </h2>
              <p className="mt-6 w-full text-sm leading-7 text-foreground/60 md:text-lg font-light break-words">
                Интерфейс адаптируется под текущий этап развития: сбор сигналов, проверка рынка, проведение CustDev и формирование дорожной карты.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button className="bg-white text-black px-8 py-3 rounded-full text-sm font-medium hover:opacity-90 transition-opacity shrink-0">
                  Начать анализ
                </button>
                <button className="lovable-glass text-white px-8 py-3 rounded-full text-sm font-medium hover:bg-white/5 transition-colors shrink-0">
                  Посмотреть демо
                </button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.14 }}
              viewport={{ once: true, margin: "-120px" }}
              className="lovable-glass-strong lovable-liquid-outline relative rounded-[2rem] p-6 md:p-8"
            >
              <div className="absolute inset-x-10 top-1/2 h-px -translate-y-1/2 bg-white/10" />
              <div className="space-y-5 relative z-10 w-full">
                {timeline.map((step, index) => (
                  <div
                    key={step.label}
                    className="grid gap-3 md:grid-cols-[160px_1fr] md:items-center w-full"
                  >
                    <div className="liquid-glass rounded-full px-5 py-3 text-center text-sm font-bold text-[#a855f7] shrink-0" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {step.label.toUpperCase()}
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-sm text-white/60 break-words flex items-center">
                      <span className="mr-3 inline-block h-2 w-2 shrink-0 rounded-full bg-white/40 align-middle animate-pulse-glow-lovable" />
                      <span className="flex-1">{step.note}</span>
                      <span className="mono-lovable ml-3 shrink-0 text-white/30">0{index + 1}</span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* AI Layer Section */}
        <section className="relative section-line px-5 py-24 sm:px-8 lg:px-12">
          <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-2 lg:items-start">
            <motion.div
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              viewport={{ once: true, margin: "-120px" }}
              className="lovable-glass-strong lovable-liquid-outline rounded-[2rem] p-6 md:p-8"
            >
              <div className="flex items-center gap-3 relative z-10 w-full">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
                  <Sparkles className="h-5 w-5 shrink-0" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white truncate">Умный ассистент</div>
                  <div className="text-sm text-white/40 truncate">online / context aware</div>
                </div>
              </div>

              <div className="mt-8 space-y-4 relative z-10 w-full flex flex-col">
                <div className="ml-auto w-fit max-w-[85%] rounded-[1.5rem] bg-white/[0.92] px-4 py-3 text-left text-sm leading-relaxed text-black shadow-2xl break-words">
                  Сделай расчёт unit-экономики для B2B SaaS и покажи, где стоит усиливать каналы
                  роста.
                </div>
                <div className="lovable-glass lovable-liquid-outline w-fit max-w-[85%] rounded-[1.5rem] p-5 text-sm leading-relaxed text-white/60 break-words">
                  <div className="mb-3 text-white font-medium">Результат анализа</div>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2"><span className="h-1 w-1 shrink-0 rounded-full bg-white/40" /> Payback period: ~3.3 месяца</li>
                    <li className="flex items-center gap-2"><span className="h-1 w-1 shrink-0 rounded-full bg-white/40" /> LTV / CAC: 3.6 — в безопасной зоне роста</li>
                    <li className="flex items-center gap-2"><span className="h-1 w-1 shrink-0 rounded-full bg-white/40" /> 12-месячный LTV: ~18 000 ₽</li>
                  </ul>
                  <p className="mt-4 text-white border-t border-white/10 pt-3">
                    Экономика сходится. Масштабирование можно ускорять.
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
              viewport={{ once: true, margin: "-120px" }}
              className="w-full flex-1"
            >
              <div className="text-[#a855f7] text-[11px] font-bold tracking-[0.3em] uppercase mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>AI LAYER</div>
              <h2 className="mt-4 text-4xl leading-none text-foreground md:text-6xl font-bold uppercase tracking-tight font-display">
                Интеллект в каждом действии<span className="text-[#a855f7]">.</span>
              </h2>
              <p className="mt-6 text-sm leading-7 text-foreground/60 md:text-lg font-light break-words">
                Слой живого ИИ не просто отвечает на вопросы, а анализирует контекст проекта, подбирает релевантные гранты и помогает структурировать юридические аспекты.
              </p>
              <div className="mt-8 grid gap-4">
                {[
                  {
                    icon: Radar,
                    title: "Анализ ЦА",
                    text: "Выявляйте боли, сигналы спроса и скрытые мотивы аудитории.",
                  },
                  {
                    icon: Layers3,
                    title: "RAG-контекст",
                    text: "Подтягивайте документы, исследования и внутреннюю базу знаний в один ответ.",
                  },
                  {
                    icon: FileText,
                    title: "Юридический слой",
                    text: "Базовые проверки, структура документов и быстрые сценарии согласования.",
                  },
                ].map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="lovable-glass lovable-liquid-outline rounded-[1.5rem] p-5 relative z-10 w-full">
                      <div className="flex items-start gap-4 relative z-10 w-full">
                        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
                          <Icon className="h-4 w-4 shrink-0" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg text-white font-bold uppercase tracking-tight truncate">{item.title}</h3>
                          <p className="mt-2 text-sm leading-7 text-white/60 font-light break-words">{item.text}</p>
                          <div className="mono-lovable mt-3 text-white/30">module 0{index + 1}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        </section>

        {/* Signal Map Section */}
        <section className="relative section-line px-5 py-24 sm:px-8 lg:px-12">
          <div className="mx-auto w-full max-w-7xl">
            <SectionHeading
              eyebrow="SIGNAL MAP"
              title="Карта рыночных сигналов"
              text="Визуализация спроса, болей аудитории и конкурентной среды в реальном времени."
            />

            <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {signals.map((signal, index) => (
                <motion.div
                  key={signal}
                  initial={{ opacity: 0, y: 28 }}
                  whileInView={{ opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut", delay: 0.06 * index } }}
                  viewport={{ once: true, margin: "-80px" }}
                  className="lovable-glass lovable-liquid-outline rounded-[1.5rem] p-5"
                >
                  <div className="flex items-center gap-3 relative z-10 w-full">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#a855f7] animate-pulse shadow-[0_0_10px_#a855f7]" />
                    <div className="text-lg text-foreground font-bold uppercase tracking-tight truncate font-display">{signal}</div>
                  </div>
                  <div className="mt-5 border-t border-white/10 pt-4 text-sm italic leading-7 text-white/60 font-light relative z-10 break-words w-full">
                    “Сигнал уже виден, но теперь интерфейс не спорит с контентом — он усиливает его.”
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />

    </div>
  );
}
