"use client";

import Link from "next/link";
import {
  ArrowUpRight, Users, FileText, MessageSquare, Map,
  Briefcase, BarChart3, UserCheck
} from "lucide-react";
import { motion } from "framer-motion";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { HeroSection } from "@/components/sections/HeroSection";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { useAuth } from "@/lib/hooks/useAuth";

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

// Декоративный граф «живого кастдева»: центр — продукт, вокруг — ИИ-агенты
// (виртуальная фокус-группа). 4 именованных узла + фоновые точки-агенты.
const custdevAgents = [
  { x: 70, y: 82, label: "Инвестор", labelY: 64, strong: true },
  { x: 330, y: 98, label: "Аналитик", labelY: 80, strong: true },
  { x: 58, y: 300, label: "Юзер №1", labelY: 324, strong: true },
  { x: 342, y: 300, label: "Юзер №2", labelY: 324, strong: true },
  { x: 150, y: 44, label: "", labelY: 0, strong: false },
  { x: 364, y: 198, label: "", labelY: 0, strong: false },
  { x: 40, y: 188, label: "", labelY: 0, strong: false },
  { x: 250, y: 358, label: "", labelY: 0, strong: false },
];

const SectionHeading = ({ eyebrow, title, text, centered = false }: { eyebrow?: string; title: string; text: string; centered?: boolean }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.8, ease: "easeOut" }}
    viewport={{ once: true, margin: "-100px" }}
    className={`max-w-4xl ${centered ? "mx-auto text-center" : ""}`}
  >
    {eyebrow ? <div className="font-mono text-white/50 mb-4 tracking-[0.2em] text-xs uppercase">{eyebrow}</div> : null}
    <h2 className="text-4xl leading-[1.1] text-white md:text-6xl mb-6" style={{ fontFamily: "'Instrument Serif', serif" }}>
      {title}
    </h2>
    <p className="text-sm leading-7 text-white/40 md:text-lg font-light max-w-2xl mx-auto">
      {text}
    </p>
  </motion.div>
);

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const ctaHref = isAuthenticated ? "/dashboard" : "/signup";
  return (
    <div className="antialiased min-h-screen flex flex-col overflow-x-hidden bg-black text-white selection:bg-white/10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />

      <TopNavBar />
      <HeroSection />

      {/* Cinematic Fade Transition */}
      <div className="w-full h-32 bg-gradient-to-b from-transparent to-black pointer-events-none -mt-32 relative z-10" />

      <main className="relative bg-black">
        {/* Background Decorative Orbs */}
        <div className="aurora-orb left-[-10rem] top-[20%] h-[40rem] w-[40rem] bg-white/[0.03] animate-float-slow" />
        <div className="aurora-orb right-[-10rem] top-[60%] h-[40rem] w-[40rem] bg-white/[0.02] animate-float-slow" />

        {/* System Overview Section */}
        <section className="relative px-6 py-32 md:px-12">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              centered
              title="Единая система для стартапа"
              text="Мы собрали все инструменты в одном интерфейсе: от первичного анализа идеи до полной подготовки к инвестициям. Никаких лишних переключений между вкладками."
            />

            <div className="mt-10 sm:mt-20 grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: MessageSquare,
                  title: "Умный чат",
                  text: "Поможет проанализировать ЦА, рассчитать экономику, провести скоринг идеи, прожарить проект, создать презентацию, провести глубокие исследования рынка РФ с указанием источников или проанализировать конкурентов. Ответит на любые вопросы по ходу развития проекта.",
                },
                {
                  icon: Users,
                  title: "Глубокий Кастдев",
                  text: "Узнайте мнение людей о продукте до релиза. Мы создаем общество ИИ-агентов со своими характеристиками, которые формируют виртуальную фокус-группу, реагирующую на ваш продукт, как реальный рынок.",
                },
                {
                  icon: FileText,
                  title: "Упаковка под гранты",
                  text: "Автоматический подбор мер поддержки из баз РФ, генерация унифицированных заявок под каждый грант и помощь в подаче. Недели ручной работы с документами и поиском подходящих программ превращаются в часы — вы экономите время на бюрократии и фокусируетесь на продукте.",
                },
                {
                  icon: Map,
                  title: "Интерактивная дорожная карта",
                  text: "Стартап проходит по динамическому треку. Система задает наводящие вопросы, и по мере ответов ИИ пошагово «разблокирует» следующие этапы. Прохождение каждого чекпоинта даёт мгновенную аналитику.",
                },
              ].map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  viewport={{ once: true }}
                >
                  <Link
                    href={ctaHref}
                    className="block lovable-glass rounded-2xl sm:rounded-[2rem] p-4 sm:p-8 group hover:bg-white/[0.05] hover:border-white/20 transition-all cursor-pointer h-full"
                  >
                    <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl sm:rounded-2xl border border-white/10 bg-white/[0.05] mb-4 sm:mb-8">
                      <item.icon className="h-4 w-4 sm:h-5 sm:w-5 text-white/70" />
                    </div>
                    <h3 className="text-base sm:text-xl font-medium text-white mb-2 sm:mb-4 pr-6 leading-tight relative">
                      {item.title}
                      <ArrowUpRight className="absolute top-0 right-0 h-4 w-4 opacity-20 group-hover:opacity-100 transition-opacity" />
                    </h3>
                    <p className="text-[12px] sm:text-sm leading-relaxed text-white/40 font-light line-clamp-4 sm:line-clamp-none">
                      {item.text}
                    </p>
                  </Link>
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
                От анализа идеи до готовых заявок на гранты — Pitchy ведёт проект через каждый этап и сокращает недели ручной работы до нескольких часов. Меньше рутины и пустых дашбордов — больше времени на сам продукт.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/signup">
                  <button className="bg-white text-black px-8 py-4 rounded-full font-medium hover:bg-white/90 transition-all font-mono tracking-tight uppercase text-xs">
                    Начать анализ
                  </button>
                </Link>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
              className="lovable-glass-strong lovable-liquid-outline rounded-[2.5rem] p-8 md:p-10 shadow-[0_0_100px_-10px_rgba(255,255,255,0.2)] bg-black/40"
            >
              <div className="space-y-4">
                {[
                  { id: "Анализ", text: "Анализ проекта" },
                  { id: "Интервью", text: "Проведение кастдев-интервью" },
                  { id: "Гранты", text: "Генерация заявок на гранты" },
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
              className="lovable-glass-strong lovable-liquid-outline rounded-[2.5rem] p-8 md:p-10 relative overflow-hidden shadow-[0_0_80px_-20px_rgba(255,255,255,0.1)] bg-black/40"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-white text-lg">Путь запроса</div>
                <span className="rounded-full border border-white/20 bg-white/[0.06] px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-white/70">Инновация</span>
              </div>
              <p className="text-sm text-white/40 font-light leading-relaxed mb-8">
                Каждый ваш вопрос за секунды проходит шесть умных шагов — поэтому ответ точный, быстрый и со ссылками на источники.
              </p>
              <div className="space-y-3">
                {[
                  { t: "Мгновенная проверка", d: "Сразу смотрим, есть ли готовый проверенный ответ", s: "0 сек" },
                  { t: "Поиск по всем источникам", d: "Параллельно поднимаем всё, что относится к вашему вопросу", s: "0.2 сек" },
                  { t: "Отбор самого точного", d: "Оставляем только самые релевантные данные", s: "0.8 сек" },
                  { t: "Команда ИИ-моделей", d: "Несколько нейросетей разбирают задачу с разных сторон", s: "1.5 сек" },
                  { t: "Готовый ответ со ссылками", d: "Собираем понятный ответ с источниками", s: "2.0 сек" },
                  { t: "Самопроверка", d: "ИИ перепроверяет себя, прежде чем ответить", s: "3.0 сек" },
                ].map((step, i) => (
                  <motion.div
                    key={step.t}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.08 }}
                    viewport={{ once: true }}
                    className="lovable-glass rounded-2xl p-4 flex items-center gap-4 border-white/5"
                  >
                    <div className="h-7 w-7 shrink-0 rounded-full border border-white/10 bg-white/[0.05] flex items-center justify-center font-mono text-[11px] text-white/70">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium leading-tight">{step.t}</div>
                      <div className="text-[12px] text-white/40 font-light leading-snug mt-0.5">{step.d}</div>
                    </div>
                    <span className="font-mono text-[10px] text-white/30 shrink-0">{step.s}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
            >
              <h2 className="text-5xl md:text-7xl text-white leading-[1.1] mb-8" style={{ fontFamily: "'Instrument Serif', serif" }}>
                Интеллект в каждом действии.
              </h2>
              <p className="text-white/40 text-lg font-light leading-relaxed mb-10">
                Слой живого ИИ не просто отвечает на вопросы, а анализирует контекст проекта, подбирает релевантные гранты и помогает структурировать юридические аспекты.
              </p>

              <div className="lovable-glass lovable-liquid-outline rounded-[2rem] p-6 sm:p-8 border-white/5 bg-black/40">
                <div className="text-xs font-mono uppercase tracking-[0.2em] text-white/40 mb-8">Качество ответов · Pitchy против других моделей</div>
                <div className="grid grid-cols-4 gap-2 sm:gap-4">
                  {[
                    { name: "Pitchy", logo: "/icons/logotip.png", value: 100, delta: "эталон", best: true },
                    { name: "Qwen", logo: "/logos/llm/qwen.svg", value: 80, delta: "−20%", best: false },
                    { name: "DeepSeek", logo: "/logos/llm/deepseek.svg", value: 70, delta: "−30%", best: false },
                    { name: "GLM-5", logo: "/logos/llm/glm.svg", value: 50, delta: "−50%", best: false },
                  ].map((bar, i) => (
                    <div key={bar.name} className="flex flex-col items-center gap-3">
                      <div className="h-7 flex items-center justify-center">
                        <img
                          src={bar.logo}
                          alt={bar.name}
                          className="h-6 w-auto max-w-[72px] object-contain"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                            const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                            if (fb) fb.style.display = "block";
                          }}
                        />
                        <span className="hidden text-xs font-semibold text-white/80">{bar.name}</span>
                      </div>
                      <div className="w-full h-44 flex items-end">
                        <motion.div
                          initial={{ height: 0 }}
                          whileInView={{ height: `${bar.value}%` }}
                          transition={{ duration: 0.9, delay: i * 0.12, ease: "easeOut" }}
                          viewport={{ once: true }}
                          className={bar.best ? "w-full rounded-t-xl bg-white shadow-[0_0_30px_-4px_rgba(255,255,255,0.5)]" : "w-full rounded-t-xl bg-white/20"}
                        />
                      </div>
                      <div className="text-center">
                        <div className="text-[13px] text-white font-medium leading-tight">{bar.name}</div>
                        <div className={bar.best ? "text-[11px] font-mono text-white/70" : "text-[11px] font-mono text-white/30"}>{bar.delta}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Deep CustDev Section — virtual focus group */}
        <section className="relative section-line px-6 py-32 md:px-12 pb-48">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              centered
              eyebrow="ВИРТУАЛЬНАЯ ФОКУС-ГРУППА"
              title="Кастдев ещё до первого пользователя"
              text="Общество ИИ-агентов с разными ролями и характерами реагирует на ваш продукт, как реальный рынок: вы видите возражения, спрос и точки роста до релиза."
            />

            <div className="mt-10 sm:mt-20 grid gap-6 lg:gap-8 lg:grid-cols-2 lg:items-stretch">
              {/* Left: persona reactions */}
              <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
                {[
                  {
                    icon: Briefcase,
                    role: "Инвестор",
                    sentiment: "Скепсис",
                    tone: "border-white/10 text-white/40",
                    quote: "Рынок большой, но где защита от копирования? Покажите retention за три месяца — тогда поверю в юнит-экономику.",
                  },
                  {
                    icon: BarChart3,
                    role: "Аналитик",
                    sentiment: "Нейтрально",
                    tone: "border-white/20 text-white/70",
                    quote: "Спрос подтверждается: три из пяти сегментов реагируют на оффер. В B2B цена выглядит завышенной.",
                  },
                  {
                    icon: Users,
                    role: "Пользователь №1",
                    sentiment: "Боль",
                    tone: "border-white/10 text-white/40",
                    quote: "Не понял ценность за первые тридцать секунд. Онбординг перегружен — я бы закрыл вкладку.",
                  },
                  {
                    icon: UserCheck,
                    role: "Пользователь №2",
                    sentiment: "Восторг",
                    tone: "bg-white text-black border-white",
                    quote: "Именно это я искал. Готов платить уже сейчас, если добавите интеграцию с таблицами.",
                  },
                ].map((p, index) => (
                  <motion.div
                    key={p.role}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: index * 0.08 }}
                    viewport={{ once: true }}
                    className="lovable-glass lovable-liquid-outline rounded-2xl sm:rounded-[1.5rem] p-5 sm:p-6 border-white/5 shadow-[0_0_40px_-10px_rgba(255,255,255,0.05)] bg-black/40 flex flex-col"
                  >
                    <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <p.icon className="h-4 w-4 text-white/60 shrink-0" />
                        <h3 className="text-sm sm:text-base text-white font-medium leading-tight truncate">{p.role}</h3>
                      </div>
                      <span className={`shrink-0 text-[9px] sm:text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border ${p.tone}`}>
                        {p.sentiment}
                      </span>
                    </div>
                    <p className="text-[13px] sm:text-sm text-white/50 font-light italic leading-relaxed">
                      «{p.quote}»
                    </p>
                  </motion.div>
                ))}
              </div>

              {/* Right: live CustDev graph */}
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8 }}
                viewport={{ once: true }}
                className="relative rounded-[2rem] border border-white/10 bg-[#0A0A0A] overflow-hidden min-h-[380px] lg:min-h-0"
                style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
              >
                <div className="absolute top-4 left-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-white/60">Идёт кастдев · live</span>
                </div>

                <svg viewBox="0 0 400 400" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                  {/* edges */}
                  {custdevAgents.map((a, i) => (
                    <motion.line
                      key={`edge-${i}`}
                      x1={a.x}
                      y1={a.y}
                      x2={200}
                      y2={200}
                      stroke="rgba(255,255,255,0.18)"
                      strokeWidth={1}
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 1, delay: 0.2 + i * 0.1 }}
                      viewport={{ once: true }}
                    />
                  ))}

                  {/* signal dots flowing agent -> product */}
                  {custdevAgents.map((a, i) => (
                    <motion.circle
                      key={`signal-${i}`}
                      r={2.5}
                      fill="rgba(255,255,255,0.9)"
                      initial={{ cx: a.x, cy: a.y, opacity: 0 }}
                      animate={{ cx: [a.x, 200], cy: [a.y, 200], opacity: [0, 1, 0] }}
                      transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.45, ease: "easeInOut" }}
                    />
                  ))}

                  {/* agent nodes */}
                  {custdevAgents.map((a, i) => (
                    <motion.circle
                      key={`node-${i}`}
                      cx={a.x}
                      cy={a.y}
                      fill={a.strong ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)"}
                      stroke="rgba(255,255,255,0.4)"
                      strokeWidth={1}
                      initial={{ r: 0 }}
                      whileInView={{ r: a.strong ? 7 : 4.5 }}
                      transition={{ duration: 0.5, delay: 0.3 + i * 0.1 }}
                      viewport={{ once: true }}
                    />
                  ))}

                  {/* labels for named agents */}
                  {custdevAgents.filter((a) => a.label).map((a, i) => (
                    <text
                      key={`label-${i}`}
                      x={a.x}
                      y={a.labelY}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.45)"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {a.label}
                    </text>
                  ))}

                  {/* center product node */}
                  <motion.circle
                    cx={200}
                    cy={200}
                    fill="none"
                    stroke="rgba(255,255,255,0.15)"
                    strokeWidth={1}
                    animate={{ r: [30, 40, 30], opacity: [0.4, 0.08, 0.4] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <circle cx={200} cy={200} r={24} fill="#ffffff" />
                  <text x={200} y={204} textAnchor="middle" fill="#000000" fontSize="11" fontWeight="600">
                    Продукт
                  </text>
                </svg>
              </motion.div>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
