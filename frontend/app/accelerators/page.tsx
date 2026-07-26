"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Activity,
  QrCode,
  ScanSearch,
  FileOutput,
  Clock,
  Layers,
  Rocket,
  ArrowUpRight,
  Sparkles,
  CheckCircle2,
  Download,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { LandingFooter } from "@/components/landing/LandingFooter";

type CoreModule = {
  icon: LucideIcon;
  short: string;
  title: string;
  desc: string;
};

const modules: CoreModule[] = [
  {
    icon: LayoutDashboard,
    short: "Заявки",
    title: "Дашборд заявок",
    desc: "Карточки вместо бесконечных таблиц: приём и отклонение заявок в один клик, с фильтрами, тегами и статусами. Каждому подавшему сразу приходит ответ на почту о решении.",
  },
  {
    icon: Users,
    short: "Команды",
    title: "Матчмейкинг команд",
    desc: "Карточки стартапов с запросом на нужных людей и отдельная вкладка специалистов со своими компетенциями. Стартап пишет подходящему человеку, а человек — понравившемуся стартапу. Сильные команды собираются по компетенциям, а не по знакомству.",
  },
  {
    icon: Activity,
    short: "Трекинг",
    title: "Трекинг прогресса",
    desc: "Организация и автопроверка домашних заданий, живые статусы, рейтинги и «спящие» команды — весь прогресс потока на одном экране в реальном времени.",
  },
  {
    icon: QrCode,
    short: "QR",
    title: "Посещаемость по QR",
    desc: "При организации офлайн- и онлайн-мероприятий отслеживаем посещаемость резидентов: динамический QR-код и явка в реальном времени, без бумажных списков и ручной сверки.",
  },
  {
    icon: ScanSearch,
    short: "Аудит",
    title: "Глубокий аудит",
    desc: "CustDev, юнит-экономика и разбор любой команды силами ИИ-агентов Pitchy — по запросу трекера, за минуты.",
  },
  {
    icon: FileOutput,
    short: "Демо-день",
    title: "Экспорт к Демо-дню",
    desc: "Единый файл по всему потоку и генерация презентации в вашем фирменном стиле — к Демо-дню всё готово автоматически.",
  },
];

const bundleBrands: { name: string; serif: boolean; role: string; points: string[] }[] = [
  {
    name: "Pitchy",
    serif: false,
    role: "Разбирается с идеей",
    points: [
      "Проверка спроса — двусторонний Кастдев",
      "Экономика: ARPU, CAC, маржа",
      "Дорожная карта с аналитикой на каждом шаге",
      "Подбор и генерация грантовой заявки",
    ],
  },
  {
    name: "Вайбли",
    serif: true,
    role: "Собирает продукт",
    points: [
      "Рабочий продукт из промпта — за часы, без кода",
      "Сайт, приложение, mini-app или игра",
      "RU-интеграции и MCP-подключения в 1 клик",
      "Серверы в РФ — стабильно, без VPN",
    ],
  },
];

const bundleFlow: { step: string; by: string | null; desc: string }[] = [
  { step: "Паспорт", by: null, desc: "Идея, аудитория, гипотеза, основная информация о проекте" },
  { step: "Проверка идеи", by: "Pitchy", desc: "Поиск болей, симуляция фокус-группы и честный вердикт" },
  { step: "Сборка продукта", by: "Вайбли", desc: "Из идеи — рабочий прототип за часы" },
  { step: "Аналитика", by: "Pitchy", desc: "Экономика на реальном продукте" },
  { step: "Демо-день", by: null, desc: "Презентации в стиле акселератора и готовый продукт" },
  { step: "Гранты", by: "Pitchy", desc: "Генерация готовых заявок на гранты" },
];

const bundleTerms = [
  "Полный доступ к Pitchy и Вайбли для всех резидентов",
  "Платформа для организаторов — с первого дня",
  "Совместный разбор результатов после демо-дня",
];

const benefits: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Clock,
    title: "Сотни часов экономии",
    desc: "Администраторы и трекеры перестают вести учёт вручную — платформа берёт рутину на себя.",
  },
  {
    icon: Layers,
    title: "Одна платформа вместо десятка сервисов",
    desc: "Формы, таблицы и мессенджеры заменяются единым цифровым решением потока.",
  },
  {
    icon: Rocket,
    title: "Быстрый запуск потока",
    desc: "Технологический поток разворачивается в кратчайшие сроки — без интеграционного ада.",
  },
];

const RADIUS = 39; // % of the square container
const nodeAt = (i: number) => {
  const a = ((-90 + i * (360 / modules.length)) * Math.PI) / 180;
  return { x: 50 + RADIUS * Math.cos(a), y: 50 + RADIUS * Math.sin(a) };
};

function CoreHub() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setActive((a) => (a + 1) % modules.length);
    }, 3200);
    return () => window.clearInterval(id);
  }, [paused]);

  const ActiveIcon = modules[active].icon;

  return (
    <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
      {/* Orbital hub */}
      <div
        className="relative mx-auto aspect-square w-full max-w-[460px]"
        onMouseLeave={() => setPaused(false)}
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
          <motion.circle
            cx="50"
            cy="50"
            r="15"
            fill="none"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="0.4"
            animate={{ r: [15, 21, 15], opacity: [0.35, 0.08, 0.35] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          />
          {modules.map((_, i) => {
            const n = nodeAt(i);
            const on = i === active;
            return (
              <line
                key={`line-${i}`}
                x1={n.x}
                y1={n.y}
                x2={50}
                y2={50}
                stroke={on ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.14)"}
                strokeWidth={on ? 0.5 : 0.3}
              />
            );
          })}
          {modules.map((_, i) => {
            const n = nodeAt(i);
            return (
              <motion.circle
                key={`signal-${i}`}
                r="0.9"
                fill="rgba(255,255,255,0.9)"
                initial={{ cx: n.x, cy: n.y, opacity: 0 }}
                animate={{ cx: [n.x, 50], cy: [n.y, 50], opacity: [0, 1, 0] }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  delay: i * 0.4,
                  ease: "easeInOut",
                }}
              />
            );
          })}
        </svg>

        {/* Center core */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="lovable-glass-strong flex h-20 w-20 flex-col items-center justify-center rounded-2xl border border-white/15 text-center sm:h-24 sm:w-24">
            <span className="font-display text-sm text-white sm:text-base">Pitchy</span>
            <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
              решение
            </span>
          </div>
        </div>

        {/* Module nodes */}
        {modules.map((m, i) => {
          const n = nodeAt(i);
          const on = i === active;
          const Icon = m.icon;
          return (
            <button
              key={m.title}
              type="button"
              aria-label={m.title}
              onMouseEnter={() => {
                setActive(i);
                setPaused(true);
              }}
              onFocus={() => {
                setActive(i);
                setPaused(true);
              }}
              onClick={() => setActive(i)}
              style={{ left: `${n.x}%`, top: `${n.y}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 outline-none"
            >
              <motion.span
                animate={{ scale: on ? 1.12 : 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors sm:h-14 sm:w-14 ${
                  on
                    ? "border-white/40 bg-white text-black shadow-[0_0_30px_-6px_rgba(255,255,255,0.6)]"
                    : "border-white/12 bg-white/[0.05] text-white/70"
                }`}
              >
                <Icon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.6} />
              </motion.span>
            </button>
          );
        })}
      </div>

      {/* Active module detail + legend */}
      <div>
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -14, filter: "blur(6px)" }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="lovable-glass lovable-liquid-outline min-h-[210px] rounded-[2rem] border-white/5 bg-black/40 p-8"
          >
            <div className="mb-6 flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-white">
                <ActiveIcon className="h-6 w-6" strokeWidth={1.6} />
              </span>
              <span className="font-mono text-xs uppercase tracking-[0.25em] text-white/40">
                0{active + 1} <span className="text-white/20">/ 0{modules.length}</span>
              </span>
            </div>
            <h3
              className="mb-3 text-2xl text-white sm:text-3xl"
              style={{ fontFamily: "var(--font-prata), serif" }}
            >
              {modules[active].title}
            </h3>
            <p className="text-sm font-light leading-relaxed text-white/50 sm:text-base">
              {modules[active].desc}
            </p>
          </motion.div>
        </AnimatePresence>

        <div className="mt-4 flex flex-wrap gap-2">
          {modules.map((m, i) => (
            <button
              key={m.title}
              type="button"
              onMouseEnter={() => {
                setActive(i);
                setPaused(true);
              }}
              onMouseLeave={() => setPaused(false)}
              onClick={() => setActive(i)}
              className={`rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                i === active
                  ? "border-white/30 bg-white/10 text-white"
                  : "border-white/10 text-white/40 hover:text-white/70"
              }`}
            >
              {m.short}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AcceleratorsPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-black text-white antialiased selection:bg-white/10">
      <TopNavBar />

      {/* Hero */}
      <section className="relative overflow-hidden px-6 pb-24 pt-40 md:px-12">
        <div className="aurora-orb left-[-12rem] top-[-6rem] h-[38rem] w-[38rem] bg-white/[0.03] animate-float-slow" />
        <div className="aurora-orb right-[-14rem] top-[30%] h-[34rem] w-[34rem] bg-white/[0.02] animate-float-slow" />
        <div className="relative mx-auto max-w-5xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/60">
                Для акселераторов и вузов
              </span>
            </div>
            <h1
              className="mb-8 text-5xl leading-[1.05] text-white md:text-7xl"
              style={{ fontFamily: "var(--font-prata), serif" }}
            >
              Цифровое решение <span className="italic text-white/60">для вашего акселератора</span>
            </h1>
            <p className="mx-auto mb-10 max-w-2xl text-lg font-light leading-relaxed text-white/50">
              Готовое цифровое решение вместо таблиц, форм и ручного учёта. Приём заявок,
              матчмейкинг, трекинг, аудит и Демо-день — в одном потоке.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <a href="https://t.me/homeboyjimmy" target="_blank" rel="noopener noreferrer">
                <button className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-medium text-black transition-all hover:bg-white/90 hover:scale-[1.02]">
                  Запросить демо
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </a>
              <a
                href="https://disk.yandex.ru/d/zqKIVyyI9CJYIw"
                target="_blank"
                rel="noopener noreferrer"
              >
                <button className="inline-flex items-center gap-2 rounded-full border border-white/15 px-8 py-3.5 text-sm font-medium text-white transition-all hover:bg-white/5">
                  <Download className="h-4 w-4" />
                  Скачать презентацию
                </button>
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      <main className="relative bg-black">
        {/* Core hub */}
        <section className="relative section-line px-6 py-28 md:px-12">
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              viewport={{ once: true, margin: "-100px" }}
              className="mb-16 max-w-3xl"
            >
              <div className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-white/50">
                Единая платформа
              </div>
              <h2
                className="mb-6 text-4xl leading-[1.1] text-white md:text-6xl"
                style={{ fontFamily: "var(--font-prata), serif" }}
              >
                Шесть модулей — один поток
              </h2>
              <p className="max-w-2xl text-lg font-light leading-relaxed text-white/40">
                Всё, что раньше жило в разрозненных таблицах и чатах, стекается в одну платформу.
                Наведите на модуль, чтобы увидеть, что он делает.
              </p>
            </motion.div>

            <CoreHub />
          </div>
        </section>

        {/* Partnership bundle: Pitchy × Вайбли */}
        <section className="relative section-line overflow-hidden px-6 py-28 md:px-12">
          <div className="aurora-orb left-1/2 top-1/3 h-[32rem] w-[32rem] -translate-x-1/2 bg-white/[0.025] animate-float-slow" />
          <div className="relative mx-auto max-w-7xl">
            {/* Header with the × lockup */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              viewport={{ once: true, margin: "-100px" }}
              className="mb-14 text-center"
            >
              <div className="mb-6 font-mono text-xs uppercase tracking-[0.25em] text-white/50">
                Партнёрский бандл
              </div>
              <div className="mb-8 flex items-center justify-center gap-6 sm:gap-12">
                {/* Pitchy — white logo on transparent */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logos/partners/pitchy.png"
                  alt="Pitchy"
                  className="h-[168px] w-auto shrink-0 object-contain sm:h-[240px]"
                  style={{ transform: "translateY(-4.5%)" }}
                />
                <span className="relative flex h-20 w-20 shrink-0 items-center justify-center sm:h-24 sm:w-24">
                  <span className="absolute inset-0 rounded-full bg-white/15 blur-md" />
                  <span className="relative text-5xl font-light text-white sm:text-6xl">×</span>
                </span>
                {/* Вайбли — white wordmark on black bg, dropped via screen blend */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logos/partners/vaibly.svg"
                  alt="Вайбли"
                  className="-mx-[73px] h-[84px] w-auto shrink-0 object-contain sm:-mx-[105px] sm:h-[120px]"
                  style={{ mixBlendMode: "screen" }}
                />
              </div>
              <p className="mx-auto max-w-2xl text-lg font-light leading-relaxed text-white/50">
                Команды анализируют идею — и сразу её собирают. К демо-дню у каждой на руках живой
                продукт, а не сырые слайды. Вы экономите время наставников и ресурсы.
              </p>
            </motion.div>

            {/* Two brands */}
            <div className="grid gap-4 lg:grid-cols-2">
              {bundleBrands.map((b, idx) => (
                <motion.div
                  key={b.name}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: idx * 0.1 }}
                  viewport={{ once: true }}
                  className="lovable-glass lovable-liquid-outline rounded-[2rem] border-white/5 bg-black/40 p-8"
                >
                  <div className="mb-6 flex items-baseline justify-between gap-4">
                    <span
                      className={`text-2xl text-white ${b.serif ? "" : "font-display tracking-tight"}`}
                      style={b.serif ? { fontFamily: "var(--font-prata), serif" } : undefined}
                    >
                      {b.name}
                    </span>
                    <span className="font-mono text-[11px] uppercase tracking-wider text-white/40">
                      {b.role}
                    </span>
                  </div>
                  <ul className="space-y-3">
                    {b.points.map((p) => (
                      <li key={p} className="flex items-start gap-3 text-sm font-light text-white/55">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              ))}
            </div>

            {/* Combined flow */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              viewport={{ once: true }}
              className="lovable-glass-strong lovable-liquid-outline mt-4 rounded-[2rem] bg-black/40 p-6 sm:p-10"
            >
              <div className="mb-3 text-center font-mono text-xs uppercase tracking-[0.2em] text-white/45">
                Один понятный путь для каждой команды
              </div>
              <h3
                className="mb-12 text-center text-2xl text-white sm:text-3xl"
                style={{ fontFamily: "var(--font-prata), serif" }}
              >
                Дорожная карта резидента
              </h3>

              <div className="relative">
                {/* road line + moving signal — desktop */}
                <div className="pointer-events-none absolute inset-x-10 top-7 hidden h-px bg-gradient-to-r from-transparent via-white/20 to-transparent lg:block" />
                <motion.div
                  className="pointer-events-none absolute top-7 hidden h-px w-28 bg-gradient-to-r from-transparent via-white/80 to-transparent lg:block"
                  animate={{ left: ["0%", "100%"] }}
                  transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
                />
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-6 lg:gap-4">
                  {bundleFlow.map((f, i) => (
                    <motion.div
                      key={f.step}
                      initial={{ opacity: 0, y: 18 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45, delay: i * 0.09 }}
                      viewport={{ once: true }}
                      className="flex flex-col items-center lg:items-stretch"
                    >
                      {/* node on the road */}
                      <div className="relative z-10 mb-6 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/25 bg-black font-mono text-base text-white shadow-[0_0_24px_-6px_rgba(255,255,255,0.45)]">
                        {String(i + 1).padStart(2, "0")}
                      </div>
                      {/* step card */}
                      <div className="lovable-glass lovable-liquid-outline flex flex-1 flex-col rounded-[1.5rem] border-white/8 bg-white/[0.03] p-6 text-center lg:text-left">
                        <div className="mb-2 text-lg font-semibold leading-tight text-white">
                          {f.step}
                        </div>
                        <div className="mb-5 flex-1 text-sm font-light leading-relaxed text-white/55">
                          {f.desc}
                        </div>
                        <span className="mx-auto inline-block w-fit rounded-full border border-white/20 bg-white/[0.05] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-white/70 lg:mx-0">
                          {f.by || "Pitchy + Вайбли"}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>

            {/* Pilot terms + CTA */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              viewport={{ once: true }}
              className="lovable-glass lovable-liquid-outline mt-4 rounded-[2rem] border-white/5 bg-black/40 p-8 sm:p-10"
            >
              <h3
                className="mb-8 text-center text-2xl text-white sm:text-left sm:text-3xl"
                style={{ fontFamily: "var(--font-prata), serif" }}
              >
                Что входит в пилот
              </h3>
              <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
                <ul className="grid gap-3">
                  {bundleTerms.map((t, i) => (
                    <motion.li
                      key={t}
                      initial={{ opacity: 0, x: -14 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.45, delay: i * 0.1 }}
                      viewport={{ once: true }}
                      className="flex items-center gap-4 rounded-2xl border border-white/15 bg-white/[0.06] px-5 py-4"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-[0_0_20px_-4px_rgba(255,255,255,0.6)]">
                        <CheckCircle2 className="h-5 w-5" strokeWidth={2.2} />
                      </span>
                      <span className="text-base font-semibold leading-snug text-white sm:text-lg">
                        {t}
                      </span>
                    </motion.li>
                  ))}
                </ul>
                <div className="flex justify-center lg:justify-end">
                  <a href="https://t.me/homeboyjimmy" target="_blank" rel="noopener noreferrer">
                    <button className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 text-sm font-medium text-black transition-all hover:scale-[1.02] hover:bg-white/90">
                      Запустить пилот
                      <ArrowUpRight className="h-4 w-4" />
                    </button>
                  </a>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Ecosystem: integrations, Rybakov structure, support */}
        <section className="relative section-line px-6 py-24 md:px-12">
          <div className="mx-auto max-w-5xl">
            {/* Tier 1 — integrated logos, one row */}
            <div className="mb-12 text-center font-mono text-xs uppercase tracking-[0.25em] text-white/40">
              Уже интегрированы
            </div>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              viewport={{ once: true }}
              className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8 sm:gap-x-20"
            >
              {/* МТУСИ project office — recoloured to white for the mono theme */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logos/partners/mtusi-po.png"
                alt="Проектный офис МТУСИ"
                className="h-[90px] w-auto object-contain opacity-90 sm:h-[108px]"
                style={{ filter: "brightness(0) invert(1)" }}
              />
              {/* Global University — already white on transparent */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logos/partners/global-university.webp"
                alt="Global University by Rybakov"
                className="h-[90px] w-auto object-contain opacity-90 sm:h-[108px]"
              />
              {/* X10 — white on transparent */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logos/partners/x10.svg"
                alt="X10 — международное движение силы сообществ"
                className="h-[90px] w-auto object-contain opacity-90 sm:h-[108px]"
              />
            </motion.div>

            {/* Tier 2 — support / реализуется при поддержке */}
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
              viewport={{ once: true }}
              className="mt-10 text-center"
            >
              <div className="mb-9 font-mono text-[11px] uppercase tracking-[0.2em] text-white/35">
                Проект реализуется при поддержке
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-16 gap-y-8">
                {/* ФСИ — recoloured to white (dark original) */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logos/partners/fsi.webp"
                  alt="Фонд содействия инновациям"
                  className="h-[72px] w-auto object-contain opacity-85 sm:h-[90px]"
                  style={{ filter: "brightness(0) invert(1)" }}
                />
                {/* Платформа — white on black bg, dropped via screen blend */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logos/partners/platform.png"
                  alt="Платформа университетского технологического предпринимательства"
                  className="h-[108px] w-auto object-contain opacity-90 sm:h-[126px]"
                  style={{ mixBlendMode: "screen" }}
                />
                {/* Технологии — федеральный проект. Положите файл
                    public/logos/partners/tehnologii.png и он появится автоматически. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logos/partners/tehnologii.png"
                  alt="Технологии — федеральный проект"
                  className="h-[72px] w-auto object-contain opacity-90 sm:h-[90px]"
                  style={{ mixBlendMode: "screen" }}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
            </motion.div>
          </div>
        </section>

        {/* Benefits */}
        <section className="relative section-line px-6 py-28 md:px-12">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-4 md:grid-cols-3">
              {benefits.map((b, i) => {
                const Icon = b.icon;
                return (
                  <motion.div
                    key={b.title}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: i * 0.1 }}
                    viewport={{ once: true }}
                    className="lovable-glass lovable-liquid-outline rounded-[2rem] border-white/5 bg-black/40 p-8"
                  >
                    <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
                      <Icon className="h-5 w-5 text-white/80" strokeWidth={1.6} />
                    </div>
                    <h3 className="mb-3 text-xl font-medium leading-tight text-white">
                      {b.title}
                    </h3>
                    <p className="text-sm font-light leading-relaxed text-white/45">{b.desc}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="relative section-line px-6 py-28 pb-40 md:px-12">
          <div className="mx-auto max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              viewport={{ once: true }}
              className="lovable-glass-strong lovable-liquid-outline relative overflow-hidden rounded-[2.5rem] bg-black/40 p-10 text-center shadow-[0_0_100px_-24px_rgba(255,255,255,0.18)] sm:p-14"
            >
              <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
                <Sparkles className="h-6 w-6 text-white/80" />
              </div>
              <h2
                className="mb-4 text-3xl text-white sm:text-4xl"
                style={{ fontFamily: "var(--font-prata), serif" }}
              >
                Резиденты получают всю платформу Pitchy
              </h2>
              <p className="mx-auto mb-10 max-w-2xl text-base font-light leading-relaxed text-white/50">
                Каждый резидент получает полный функционал Pitchy для развития своего проекта — умный
                чат, кастдев, подбор грантов и дорожную карту. Вы управляете потоком, они — растут.
              </p>
              <div className="mb-10 flex flex-wrap justify-center gap-3">
                {["Полный функционал платформы", "Единый паспорт проекта", "Аналитика по каждой команде"].map(
                  (item) => (
                    <span
                      key={item}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-white/60"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-white/70" />
                      {item}
                    </span>
                  )
                )}
              </div>
              <a href="https://t.me/homeboyjimmy" target="_blank" rel="noopener noreferrer">
                <button className="inline-flex items-center gap-2 rounded-full bg-white px-10 py-4 text-sm font-medium text-black transition-all hover:scale-[1.02] hover:bg-white/90">
                  Подключить акселератор
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </a>
            </motion.div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
