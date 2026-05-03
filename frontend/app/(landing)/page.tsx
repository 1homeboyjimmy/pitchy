"use client";

import Link from "next/link";
import { 
  ArrowUpRight, BarChart3, Users, FileText, Sparkles, 
  MessageSquare, Radar, Zap, 
  Target, Briefcase, Code, ShieldCheck, UserCheck, Search 
} from "lucide-react";
import { motion } from "framer-motion";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { HeroSection } from "@/components/sections/HeroSection";
import { TopNavBar } from "@/components/shared/TopNavBar";

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Pitchy.pro",
  "url": "https://pitchy.pro",
  "logo": "https://pitchy.pro/logo.png",
  "description": "ИИ-экосистема для стартапов: от анализа идеи до полной подготовки к инвестициям.",
  "sameAs": [
    "https://t.me/pitchy_pro"
  ]
};

const SectionHeading = ({ eyebrow, title, text, centered = false }: { eyebrow: string; title: string; text: string; centered?: boolean }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.8, ease: "easeOut" }}
    viewport={{ once: true, margin: "-100px" }}
    className={`max-w-4xl ${centered ? "mx-auto text-center" : ""}`}
  >
    <div className="font-mono text-white/50 mb-4 tracking-[0.2em] text-xs uppercase">{eyebrow}</div>
    <h2 className="text-4xl leading-[1.1] text-white md:text-6xl mb-6" style={{ fontFamily: "'Instrument Serif', serif" }}>
      {title}
    </h2>
    <p className="text-sm leading-7 text-white/40 md:text-lg font-light max-w-2xl mx-auto">
      {text}
    </p>
  </motion.div>
);

export default function LandingPage() {
  return (
    <div className="antialiased min-h-screen flex flex-col overflow-x-hidden bg-black text-white selection:bg-white/10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />

      <TopNavBar />
      <HeroSection />

      {/* Cinematic Fade Transition */}
      <div className="w-full h-64 bg-gradient-to-b from-transparent to-black pointer-events-none -mt-64 relative z-10" />

      <main className="relative bg-black">
        {/* Background Decorative Orbs */}
        <div className="aurora-orb left-[-10rem] top-[20%] h-[40rem] w-[40rem] bg-white/[0.03] animate-float-slow" />
        <div className="aurora-orb right-[-10rem] top-[60%] h-[40rem] w-[40rem] bg-white/[0.02] animate-float-slow" />

        {/* System Overview Section */}
        <section className="relative px-6 py-32 md:px-12">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              centered
              eyebrow="ОБЗОР СИСТЕМЫ"
              title="Единая операционная система для стартапа"
              text="Мы собрали все инструменты в одном интерфейсе: от первичного анализа идеи до полной подготовки к инвестициям. Никаких лишних переключений между вкладками."
            />

            <div className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: BarChart3,
                  title: "Моментальная unit-экономика",
                  text: "Считайте окупаемость, CAC, LTV и сценарии роста в одном живом слое данных.",
                },
                {
                  icon: Users,
                  title: "Глубокий CustDev",
                  text: "Синтетические интервью и сегментация сигналов без сухих дашбордов и лишнего шума.",
                },
                {
                  icon: FileText,
                  title: "Гранты и заявки",
                  text: "Собирайте подачу, трекинг и отчётность в единую управляемую систему.",
                },
                {
                  icon: MessageSquare,
                  title: "Ассистент 24/7",
                  text: "AI-слой помогает с RAG, юридическими вопросами и структурированием проектных решений.",
                },
              ].map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  viewport={{ once: true }}
                  className="lovable-glass rounded-[2rem] p-8 group hover:bg-white/[0.05] transition-all"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] mb-8">
                    <item.icon className="h-5 w-5 text-white/70" />
                  </div>
                  <h3 className="text-xl font-medium text-white mb-4 pr-6 leading-tight relative">
                    {item.title}
                    <ArrowUpRight className="absolute top-0 right-0 h-4 w-4 opacity-20 group-hover:opacity-100 transition-opacity" />
                  </h3>
                  <p className="text-sm leading-relaxed text-white/40 font-light">
                    {item.text}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* User Path Section (Workflow) */}
        <section className="relative section-line px-6 py-32 md:px-12">
          <div className="mx-auto max-w-7xl grid gap-16 lg:grid-cols-2 lg:items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
            >
              <div className="font-mono text-white/50 mb-4 tracking-[0.2em] text-xs uppercase">ПУТЬ ПОЛЬЗОВАТЕЛЯ</div>
              <h2 className="text-5xl md:text-7xl text-white leading-[1.1] mb-8" style={{ fontFamily: "'Instrument Serif', serif" }}>
                Путь продукта: от гипотезы до результата
              </h2>
              <p className="text-white/40 text-lg font-light leading-relaxed mb-10">
                Интерфейс адаптируется под текущий этап развития: сбор сигналов, проверка рынка, проведение CustDev и формирование дорожной карты.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/signup">
                  <button className="bg-white text-black px-8 py-4 rounded-full font-medium hover:bg-white/90 transition-all font-mono tracking-tight uppercase text-xs">
                    Начать анализ
                  </button>
                </Link>
                <Link href="/demo">
                  <button className="lovable-glass text-white px-8 py-4 rounded-full font-medium hover:bg-white/5 transition-all font-mono tracking-tight uppercase text-xs">
                    Посмотреть демо
                  </button>
                </Link>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
              className="lovable-glass-strong lovable-liquid-outline rounded-[2.5rem] p-8 md:p-10 shadow-[0_0_80px_-20px_rgba(255,255,255,0.1)] bg-black/40"
            >
              <div className="space-y-4">
                {[
                  { id: "Идея", text: "Сбор сигналов, гипотез и рыночного контекста" },
                  { id: "Скоринг", text: "Оценка потенциала, рисков и unit-экономики" },
                  { id: "Интервью", text: "Синтетическая обратная связь от релевантных персон" },
                  { id: "Roadmap", text: "Приоритезация и структурированный трек исполнения" },
                ].map((step, index) => (
                  <div key={step.id} className="lovable-glass rounded-2xl p-5 flex items-center justify-between group cursor-default border-white/5">
                    <div className="flex items-center gap-6 flex-1">
                      <div className="w-24 px-4 py-2 rounded-full border border-white/10 text-[10px] font-bold uppercase tracking-wider text-center group-hover:bg-white group-hover:text-black transition-all font-mono">
                        {step.id}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 w-1.5 rounded-full bg-white/40" />
                        <span className="text-sm text-white/60 font-light leading-relaxed">{step.text}</span>
                      </div>
                    </div>
                    <span className="font-mono text-white/20 ml-4 text-xs">0{index + 1}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* AI Layer Section */}
        <section className="relative section-line px-6 py-32 md:px-12">
          <div className="mx-auto max-w-7xl grid gap-16 lg:grid-cols-2 lg:items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
              className="lovable-glass-strong lovable-liquid-outline rounded-[2.5rem] p-10 relative overflow-hidden shadow-[0_0_80px_-20px_rgba(255,255,255,0.1)] bg-black/40"
            >
              <div className="flex items-center gap-4 mb-10">
                <div className="h-12 w-12 rounded-full border border-white/10 flex items-center justify-center bg-white/[0.03]">
                  <Sparkles className="h-5 w-5 text-white/50" />
                </div>
                <div>
                  <div className="font-semibold text-white">Умный ассистент</div>
                  <div className="text-sm text-white/30 italic font-mono uppercase tracking-tighter">online / context aware</div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="ml-auto w-fit max-w-[80%] rounded-[1.5rem] bg-white/[0.92] px-5 py-4 text-sm text-black shadow-2xl">
                  Сделай расчёт unit-экономики для B2B SaaS и покажи, где стоит усиливать каналы роста.
                </div>
                <div className="lovable-glass rounded-[1.5rem] p-6 text-sm text-white/60 border-white/5">
                  <div className="mb-4 text-white font-medium flex items-center gap-2">
                     Результат анализа
                  </div>
                  <ul className="space-y-3">
                    <li className="flex items-center gap-3"><span className="h-1 w-1 rounded-full bg-white/40" /> Payback period: ~3.3 месяца</li>
                    <li className="flex items-center gap-3"><span className="h-1 w-1 rounded-full bg-white/40" /> LTV / CAC: 3.6 — в безопасной зоне роста</li>
                    <li className="flex items-center gap-3"><span className="h-1 w-1 rounded-full bg-white/40" /> 12-месячный LTV: ~18 000 ₽</li>
                  </ul>
                  <p className="mt-6 pt-4 border-t border-white/10 text-white font-light">
                    Экономика сходится. Масштабирование можно ускорять.
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
            >
              <div className="font-mono text-white/50 mb-4 tracking-[0.2em] text-xs uppercase">СЛОЙ ИИ</div>
              <h2 className="text-5xl md:text-7xl text-white leading-[1.1] mb-8" style={{ fontFamily: "'Instrument Serif', serif" }}>
                Интеллект в каждом действии.
              </h2>
              <p className="text-white/40 text-lg font-light leading-relaxed mb-10">
                Слой живого ИИ не просто отвечает на вопросы, а анализирует контекст проекта, подбирает релевантные гранты и помогает структурировать юридические аспекты.
              </p>
              
              <div className="lovable-glass rounded-[1.5rem] p-6 flex items-start gap-5 border-white/5">
                <div className="mt-1 h-10 w-10 rounded-xl border border-white/10 flex items-center justify-center bg-white/[0.03]">
                  <Radar className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xl text-white font-medium mb-2">Анализ ЦА</h3>
                  <p className="text-sm text-white/40 font-light">Выявляйте боли, сигналы спроса и скрытые мотивы аудитории.</p>
                  <div className="font-mono mt-4 text-white/20 text-[10px] tracking-widest uppercase">MODULE 01</div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Signal Map Section */}
        <section className="relative section-line px-6 py-32 md:px-12 pb-48">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              centered
              eyebrow="КАРТА СИГНАЛОВ"
              title="Карта рыночных сигналов"
              text="Визуализация спроса, болей аудитории и конкурентной среды в реальном времени."
            />

            <div className="mt-20 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: Target, title: "Инвестор" },
                { icon: Search, title: "Маркетолог" },
                { icon: Code, title: "Разработчик" },
                { icon: Briefcase, title: "HR" },
                { icon: ShieldCheck, title: "Юрист" },
                { icon: UserCheck, title: "Аналитик" },
              ].map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: index * 0.05 }}
                  viewport={{ once: true }}
                  className="lovable-glass lovable-liquid-outline rounded-[1.5rem] p-6 group cursor-default border-white/5 shadow-[0_0_40px_-10px_rgba(255,255,255,0.05)] bg-black/40"
                >
                  <div className="flex items-center gap-4 mb-6">
                    <span className="h-2 w-2 rounded-full bg-white/40 animate-pulse" />
                    <h3 className="text-xl text-white font-medium">{item.title}</h3>
                  </div>
                  <div className="pt-4 border-t border-white/10 italic text-sm text-white/30 font-light leading-relaxed">
                    &ldquo;Сигнал уже виден, но теперь интерфейс не спорит с контентом — он усиливает его.&rdquo;
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
