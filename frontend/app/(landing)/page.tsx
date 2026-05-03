"use client";

import Link from "next/link";
import { ArrowUpRight, BarChart3, Users, FileText, Sparkles, MessageSquare, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { LandingNavBar } from "@/components/landing/LandingNavBar";
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
      <div className="mono-lovable text-white/70">{eyebrow}</div>
      <h2 className="mt-4 max-w-4xl text-4xl leading-none text-gradient md:text-6xl" style={{ fontFamily: "'Instrument Serif', serif" }}>{title}</h2>
      <p className="mt-5 max-w-2xl text-sm leading-7 text-white/60 md:text-base font-light">{text}</p>
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
    <div className="antialiased min-h-screen flex flex-col overflow-x-hidden bg-black text-white">
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

      <main className="relative min-h-screen overflow-hidden bg-black text-white">
        {/* Lovable Aurora Background Elements */}
        <div className="aurora-orb left-[-8rem] top-[18rem] h-64 w-64 bg-[oklch(0.35_0.12_280_/_0.2)] animate-float-slow" />
        <div className="aurora-orb right-[-6rem] top-[58rem] h-72 w-72 bg-[oklch(0.3_0.1_250_/_0.15)] animate-float-slow" />



        {/* System Overview Section */}
        <section className="relative section-line px-5 py-24 sm:px-8 lg:px-12">
          <div className="absolute inset-0 aurora-bg opacity-80" />
          <div className="relative mx-auto w-full max-w-7xl">
            <SectionHeading
              eyebrow="SYSTEM OVERVIEW"
              title="Всё, что идёт после hero, теперь выглядит как продукт, а не лендинг-болванка."
              text="Мы сохранили ощущение премиальности и сделали интерфейс глубже: стеклянные поверхности, тонкие контуры, контрастная типографика и анимации, которые поддерживают композицию, а не отвлекают."
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
                        <h3 className="mt-10 text-2xl leading-tight text-white font-medium" style={{ fontFamily: "'Instrument Serif', serif" }}>{card.title}</h3>
                        <p className="mt-4 text-sm leading-7 text-white/60 font-light">{card.body}</p>
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
              <div className="mono-lovable text-white/70">USER PATH REWIRED</div>
              <h2 className="mt-4 w-full text-4xl leading-none text-gradient md:text-6xl break-words" style={{ fontFamily: "'Instrument Serif', serif" }}>
                Вместо скучного скролла — управляемая драматургия пути пользователя.
              </h2>
              <p className="mt-6 w-full text-sm leading-7 text-white/60 md:text-base font-light break-words">
                Каждая следующая зона теперь ведёт глубже: сначала ценность, потом механика процесса,
                затем интеллект системы и в конце — ощущение контроля над исполнением.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button className="bg-white text-black px-8 py-3 rounded-full text-sm font-medium hover:opacity-90 transition-opacity shrink-0">
                  View roadmap
                </button>
                <button className="lovable-glass text-white px-8 py-3 rounded-full text-sm font-medium hover:bg-white/5 transition-colors shrink-0">
                  Explore flow
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
                    <div className="lovable-liquid-outline lovable-glass rounded-full px-5 py-3 text-center text-sm font-medium text-white shrink-0">
                      {step.label}
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
              <div className="mono-lovable text-white/70">AI LAYER</div>
              <h2 className="mt-4 text-4xl leading-none text-gradient md:text-6xl break-words" style={{ fontFamily: "'Instrument Serif', serif" }}>
                Жидкое стекло и живой интеллект вместо тяжёлых блоков.
              </h2>
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
                          <h3 className="text-xl text-white font-medium truncate">{item.title}</h3>
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
              title="Синтетическая обратная связь теперь подана как коллекция сигналов."
              text="Мы оставили технологичность, но усилили ощущение премиального исследовательского интерфейса: больше воздуха, тоньше рамки, лучше иерархия и мягкая глубина поверхностей."
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
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-white/40 animate-pulse" />
                    <div className="text-lg text-white font-medium truncate">{signal}</div>
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
