"use client";

import Link from "next/link";
import { ArrowUpRight, BarChart3, Users, FileText, Sparkles, MessageSquare, Plus, Radar, Layers3 } from "lucide-react";
import { motion } from "framer-motion";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { HeroSection } from "@/components/sections/HeroSection";

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Pitchy.pro",
  "url": "https://pitchy.pro",
  "logo": "https://pitchy.pro/logo.png",
  "description": "ИИ-экосистема для стартапов: от анализа идеи до получения грантов.",
  "sameAs": [
    "https://t.me/pitchy_pro"
  ]
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Pitchy.pro",
  "url": "https://pitchy.pro",
  "description": "Анализ идеи, синтетические CustDev интервью и подбор грантов с помощью ИИ."
};

const SectionHeading = ({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.8, ease: "easeOut" }}
    viewport={{ once: true, margin: "-100px" }}
    className="max-w-3xl"
  >
    <div className="mono-lovable text-white/50">{eyebrow}</div>
    <h2 className="mt-4 text-4xl leading-none text-gradient md:text-6xl" style={{ fontFamily: "'Instrument Serif', serif" }}>
      {title}
    </h2>
    <p className="mt-6 text-sm leading-7 text-white/60 md:text-lg font-light">
      {text}
    </p>
  </motion.div>
);

const signals = [
  "B2B SaaS — Сильный сигнал в Enterprise",
  "FinTech — Рост интереса к KYC/AML",
  "AI Agents — Высокий спрос на автоматизацию",
  "EdTech — Запрос на персонализацию",
  "HealthTech — Сигнал в превентивной медицине",
  "PropTech — Рост в управлении активами",
];

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
        <div className="aurora-orb left-[-8rem] top-[18rem] h-64 w-64 bg-[oklch(0.5_0.15_280_/_0.15)] animate-float-slow" />
        <div className="aurora-orb right-[-6rem] top-[58rem] h-72 w-72 bg-[oklch(0.45_0.12_270_/_0.12)] animate-float-slow" />

        {/* Capabilities Section */}
        <section className="relative px-5 py-24 sm:px-8 lg:px-12">
          <div className="mx-auto w-full max-w-7xl">
            <SectionHeading
              eyebrow="CAPABILITIES"
              title="От идеи до запуска за считанные дни."
              text="Используйте мощь генеративного ИИ для того, чтобы завалить рынок качественными гипотезами, а не случайными догадками."
            />

            <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: BarChart3,
                  title: "Анализ идеи",
                  text: "Глубокая проверка рынка, поиск конкурентов и оценка потенциала вашего стартапа.",
                },
                {
                  icon: Users,
                  title: "Synthetic CustDev",
                  text: "Проводите тысячи интервью с виртуальными персонами вашей ЦА за секунды.",
                },
                {
                  icon: FileText,
                  title: "Грантовый сканер",
                  text: "Автоматический подбор подходящих грантов и программ акселерации.",
                },
              ].map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 28 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 * index }}
                  viewport={{ once: true, margin: "-100px" }}
                  className="lovable-glass-strong rounded-[2rem] p-8"
                >
                  <div className="relative z-10 h-full flex flex-col">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
                      <item.icon className="h-6 w-6" />
                    </div>
                    <h3 className="mt-6 text-2xl font-medium text-white">{item.title}</h3>
                    <p className="mt-4 text-sm leading-7 text-white/60 font-light flex-1">
                      {item.text}
                    </p>
                    <div className="mt-8 flex items-center gap-2 text-xs font-medium text-white/40 uppercase tracking-widest">
                      <span>Module 0{index + 1}</span>
                      <Plus className="h-3 w-3" />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Vertical Stepper Section */}
        <section className="relative section-line px-5 py-24 sm:px-8 lg:px-12">
          <div className="mx-auto w-full max-w-7xl">
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              transition={{ duration: 1 }}
              viewport={{ once: true }}
              className="grid gap-12 lg:grid-cols-2"
            >
              <div className="space-y-6">
                <div className="mono-lovable text-white/50">WORKFLOW</div>
                <h2 className="text-4xl leading-none text-gradient md:text-6xl" style={{ fontFamily: "'Instrument Serif', serif" }}>
                  Путь к вашему <br /> успеху.
                </h2>
                <p className="text-white/60 text-lg font-light leading-relaxed max-w-md">
                  Мы структурировали процесс создания стартапа в понятные, автоматизированные шаги.
                </p>
                <div className="pt-8">
                  <Link href="/signup">
                    <button className="lovable-glass-strong lovable-liquid-outline rounded-full px-8 py-4 text-sm font-medium transition-all hover:scale-105 active:scale-95">
                      Начать анализ
                    </button>
                  </Link>
                </div>
              </div>

              <div className="space-y-4">
                {[
                  { title: "Загрузка концепта", note: "Просто опишите идею в свободной форме." },
                  { title: "Синтетический опрос", note: "ИИ моделирует поведение 100+ респондентов." },
                  { title: "Отчет по рискам", note: "Получите честный разбор слабых мест проекта." },
                  { title: "Matching с грантами", note: "Список фондов, готовых поддержать ваш сектор." },
                ].map((step, index) => (
                  <div key={step.title} className="lovable-glass-strong lovable-liquid-outline rounded-[1.5rem] p-6">
                    <div className="flex items-center text-sm font-light text-white/80">
                      <span className="mr-3 inline-block h-2 w-2 shrink-0 rounded-full bg-white/40 align-middle animate-pulse-glow-lovable" />
                      <span className="flex-1 font-medium">{step.title}</span>
                      <span className="mono-lovable ml-3 shrink-0 text-white/30">0{index + 1}</span>
                    </div>
                    <p className="mt-3 text-sm text-white/40 leading-relaxed pl-5">
                      {step.note}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* AI Layer Section */}
        <section className="relative section-line px-5 py-24 sm:px-8 lg:px-12">
          <div className="mx-auto grid w-full max-w-7xl gap-12 lg:grid-cols-2 lg:items-center">
            <motion.div
              initial={{ opacity: 0, x: -28 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              viewport={{ once: true }}
              className="lovable-glass-strong lovable-liquid-outline rounded-[2rem] p-8"
            >
              <div className="flex items-center gap-3 w-full">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-white">Умный ассистент</div>
                  <div className="text-sm text-white/40 italic">online / context aware</div>
                </div>
              </div>

              <div className="mt-8 space-y-4 w-full flex flex-col">
                <div className="ml-auto w-fit max-w-[85%] rounded-[1.5rem] bg-white/[0.92] px-4 py-3 text-sm text-black shadow-2xl">
                  Сделай расчёт unit-экономики для B2B SaaS и покажи, где стоит усиливать каналы роста.
                </div>
                <div className="lovable-glass lovable-liquid-outline w-fit max-w-[85%] rounded-[1.5rem] p-5 text-sm text-white/60">
                  <div className="mb-3 text-white font-medium">Результат анализа</div>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-white/40" /> Payback period: ~3.3 месяца</li>
                    <li className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-white/40" /> LTV / CAC: 3.6 — в безопасной зоне роста</li>
                  </ul>
                  <p className="mt-4 text-white border-t border-white/10 pt-3">
                    Экономика сходится. Масштабирование можно ускорять.
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 28 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              viewport={{ once: true }}
            >
              <div className="mono-lovable text-white/70">AI LAYER</div>
              <h2 className="mt-4 text-4xl leading-none text-gradient md:text-6xl" style={{ fontFamily: "'Instrument Serif', serif" }}>
                Интеллект в каждом действии.
              </h2>
              <p className="mt-6 text-sm leading-7 text-white/60 md:text-lg font-light">
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
                ].map((item, index) => (
                  <div key={item.title} className="lovable-glass lovable-liquid-outline rounded-[1.5rem] p-5">
                    <div className="flex items-start gap-4">
                      <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xl text-white font-medium">{item.title}</h3>
                        <p className="mt-2 text-sm text-white/60 font-light">{item.text}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* Signal Map Section */}
        <section className="relative section-line px-5 py-24 sm:px-8 lg:px-12 pb-32">
          <div className="mx-auto w-full max-w-7xl">
            <SectionHeading
              eyebrow="SIGNAL MAP"
              title="Карта рыночных сигналов"
              text="Визуализация спроса, болей аудитории и конкурентной среды в реальном времени."
            />

            <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {signals.map((signal) => (
                <motion.div
                  key={signal}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  viewport={{ once: true }}
                  className="lovable-glass lovable-liquid-outline rounded-[1.5rem] p-5"
                >
                  <div className="flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full bg-white/40 animate-pulse" />
                    <div className="text-lg text-white font-medium">{signal}</div>
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
