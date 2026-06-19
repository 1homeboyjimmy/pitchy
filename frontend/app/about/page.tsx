"use client";

import Image from "next/image";
import { Zap, Search, Shield, ScanSearch, Rocket } from "lucide-react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";
import { PitchyLogo } from "@/components/shared/PitchyLogo";

const stats = [
  { value: "100+", label: "Стартапов" },
  { value: "5+", label: "Инвесторов" },
  { value: "30s", label: "Анализ" },
  { value: "92%", label: "Точность" },
];

const values = [
  {
    icon: <Zap size={24} strokeWidth={1.5} />,
    title: "Молниеносный анализ",
    description: "Обработка данных и выдача результатов занимает секунды, экономя часы ручной работы.",
  },
  {
    icon: <Search size={24} strokeWidth={1.5} />,
    title: "Точная оценка",
    description: "Алгоритмы обучены на тысячах успешных презентаций для максимальной релевантности.",
  },
  {
    icon: <Shield size={24} strokeWidth={1.5} />,
    title: "Защита данных",
    description: "Абсолютная конфиденциальность. Ваши идеи остаются только вашими. Шифрование на всех уровнях.",
  },
  {
    icon: <ScanSearch size={24} strokeWidth={1.5} />,
    title: "Детализация",
    description: "Разбор каждого слайда с конкретными рекомендациями по улучшению структуры и подачи.",
  },
];

type TeamMember = {
  name: string;
  role: string;
  image: string;
  competencies: string[];
  imagePosition?: string;
  accent: string;
};

const founders: TeamMember[] = [
  {
    name: "Александр Николенко",
    role: "Co-Founder",
    image: "/team/alexander-nikolenko.jpg",
    imagePosition: "50% 38%",
    accent: "from-violet-400/60 via-fuchsia-400/20 to-transparent",
    competencies: [
      "Веб-разработка и UI/UX",
      "1 курс РТУ МИРЭА (Инфраструктура ИТ)",
      "Победитель стартап-интенсива МТУСИ и МГУ",
    ],
  },
  {
    name: "Егор Фигурняк",
    role: "CEO",
    image: "/team/egor-figurnyak.jpg",
    imagePosition: "50% 34%",
    accent: "from-blue-400/60 via-cyan-400/20 to-transparent",
    competencies: [
      "Опыт работы: Ростелеком",
      "3 курс МТУСИ (ИБ), ML и Backend архитектура",
      "Большой опыт в создании/разворачивании ML моделей и оценки их эффективности",
      "Победитель стартап-интенсива МТУСИ и МГУ",
      "Участник акселератора МТУСИ x Skolkovo",
    ],
  },
];

const leadership: TeamMember[] = [
  {
    name: "Руслан Романов",
    role: "Ментор",
    image: "/team/ruslan-romanov.jpg",
    accent: "from-amber-300/55 via-yellow-300/15 to-transparent",
    competencies: [
      "Валидатор расчета unit-экономики",
      "15 лет опыта: МТС, Мишлен, МТС Юрент, Philips, Gett, Транснефть, Gibson, Advertu",
      "Эксперт по развитию продуктов",
      "Кандидат экономических наук",
    ],
  },
  {
    name: "Александр Углов",
    role: "Директор по развитию",
    image: "/team/alexander-uglov.jpg",
    accent: "from-emerald-400/55 via-teal-300/15 to-transparent",
    competencies: [
      "Серийный предприниматель,",
      "Основатель акселератора Global Pilots (совместно с Microsoft, EY, Startupbootcamp) и The Gate Club (совместно с правительством Москвы),",
      "Управляющий партнер АНО \"Рубежи Науки\"",
      "партнер корпоративной венчурной студии Founders Lane (Берлин).",
      "Директор по развитию инвестиционного фонда Altergate (Сингапур) и \"Орбитальный экспресс\" (Сколково).",
    ],
  },
];

const specialists: TeamMember[] = [
  {
    name: "Елена Чиркова",
    role: "Ментор",
    image: "/team/elena-chirkova.jpg",
    imagePosition: "50% 28%",
    accent: "from-amber-300/50 via-orange-300/15 to-transparent",
    competencies: [
      "Валидатор анализа ЦА и синтетических CustDev",
      "Трекер Сколково, Газпром Нефть, Scrum Master",
      "100+ проектов до финансирования",
    ],
  },
  {
    name: "Вероника Ланичкина",
    role: "Юрист",
    image: "/team/veronika-lanichkina.jpg",
    imagePosition: "50% 30%",
    accent: "from-pink-400/50 via-fuchsia-300/15 to-transparent",
    competencies: [
      "Legal & Compliance",
      "2 курс МГУ (Юриспруденция)",
      "Победительница стартап-интенсива МТУСИ и МГУ",
      "Валидация юридических ответов ИИ",
    ],
  },
  {
    name: "Вячеслав Харламов",
    role: "BizDev & Backend Engineer",
    image: "/team/vyacheslav-kharlamov.jpg",
    imagePosition: "50% 26%",
    accent: "from-orange-300/50 via-amber-300/15 to-transparent",
    competencies: [
      "4 года опыта: amoCrm, МЧС России, Эволента",
      "1 место Хакатон СПбГУ («Лидеры перемен»)",
      "2 место IFBEST (технический лидер)",
      "Топ-10 Блокчейн-хакатон Сбера",
      "3 место МТУСИ «Путь к успеху»",
    ],
  },
];

function TeamCard({ member, featured = false }: { member: TeamMember; featured?: boolean }) {
  return (
    <article
      className={`lovable-glass group relative overflow-hidden rounded-3xl transition-transform duration-500 hover:-translate-y-1 ${
        featured ? "min-h-[540px] md:min-h-[430px]" : "min-h-[500px]"
      }`}
    >
      <div
        className={`relative overflow-hidden ${
          featured ? "h-72 md:absolute md:inset-y-0 md:left-0 md:h-full md:w-[44%]" : "h-64"
        }`}
      >
        <Image
          src={member.image}
          alt={member.name}
          fill
          sizes={featured ? "(max-width: 768px) 100vw, 44vw" : "(max-width: 768px) 100vw, 33vw"}
          className="object-cover saturate-[0.88] transition duration-700 group-hover:scale-[1.025] group-hover:saturate-100"
          style={{ objectPosition: member.imagePosition ?? "50% 35%" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/5 to-transparent md:bg-gradient-to-r md:from-transparent md:via-transparent md:to-black/35" />
      </div>

      <div
        className={`relative flex h-full flex-col p-7 md:p-8 ${
          featured ? "md:ml-[44%] md:min-h-[430px] md:justify-center md:p-10" : ""
        }`}
      >
        <div className={`mb-6 h-px w-20 bg-gradient-to-r ${member.accent}`} />
        <h3 className={`${featured ? "text-3xl md:text-4xl" : "text-2xl"} font-display tracking-tight text-white`}>
          {member.name}
        </h3>
        <p className="mt-3 font-mono-label text-[10px] uppercase tracking-[0.22em] text-white/45">
          {member.role}
        </p>
        <ul className="mt-7 space-y-3 text-sm leading-relaxed text-white/60">
          {member.competencies.map((competency) => (
            <li key={competency} className="flex gap-3">
              <span className="mt-[0.65em] h-1 w-1 shrink-0 rounded-full bg-white/35" />
              <span>{competency}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

export default function AboutPage() {
  return (
    <div className="bg-black text-foreground antialiased min-h-screen flex flex-col relative overflow-hidden">
      {/* Decorative Orbs */}
      <div className="aurora-orb top-[-10rem] right-[-5rem] h-96 w-96 bg-white/[0.03] animate-pulse" />
      <div className="aurora-orb bottom-[20rem] left-[-10rem] h-80 w-80 bg-white/[0.02] animate-float-slow" />

      <TopNavBar />

      <main className="flex-grow pt-12 pb-24 px-6 md:px-12 max-w-[1440px] mx-auto w-full relative z-10">
        {/* Header */}
        <header className="mb-16 md:mb-24 mt-8 md:mt-16">
          <h1 className="font-display text-6xl md:text-8xl text-white mb-8 max-w-4xl tracking-tighter leading-none">
            О <PitchyLogo size="none" />
          </h1>
          <p className="font-body-lg text-xl text-foreground/60 max-w-2xl leading-relaxed">
            Платформа для глубокого анализа и оптимизации питч-деков на базе искусственного интеллекта. Мы переводим идеи в метрики.
          </p>
        </header>

        {/* Team */}
        <section className="mb-24 md:mb-32" aria-labelledby="team-title">
          <div className="mb-10 flex flex-col gap-5 md:mb-14 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono-label text-[10px] uppercase tracking-[0.3em] text-white/35">
                Команда Pitchy
              </p>
              <h2 id="team-title" className="mt-4 font-display text-5xl tracking-tighter text-white md:text-7xl">
                Команда
              </h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-white/45 md:text-right">
              Технический фундамент и венчурная экспертиза
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
            {founders.map((member) => (
              <div key={member.name} className="md:col-span-6">
                <TeamCard member={member} featured />
              </div>
            ))}

            {leadership.map((member) => (
              <div key={member.name} className="md:col-span-6">
                <TeamCard member={member} />
              </div>
            ))}

            {specialists.map((member) => (
              <div key={member.name} className="md:col-span-4">
                <TeamCard member={member} />
              </div>
            ))}
          </div>
        </section>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Mission Card */}
          <section className="md:col-span-8 lovable-glass rounded-3xl p-10 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
            <div className="flex items-start gap-5 mb-16">
              <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
                <Rocket size={24} strokeWidth={1.5} className="text-white" />
              </div>
              <div>
                <h2 className="font-display text-3xl text-white mb-2">Миссия</h2>
                <p className="font-mono-label text-[10px] text-white/30 tracking-widest uppercase">Системный подход</p>
              </div>
            </div>
            <div className="max-w-2xl">
              <p className="font-body-lg text-2xl text-foreground/80 leading-relaxed tracking-tight">
                Предоставить фаундерам мощные AI-инструменты для объективной оценки и структурирования бизнес-идей. Мы устраняем неопределенность на ранних стадиях, заменяя догадки на данные, а эмоции — на расчеты.
              </p>
            </div>
            {/* Stats */}
            <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-8 border-t border-white/5 pt-10">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <div className="font-display text-4xl text-white tracking-tighter">{stat.value}</div>
                  <div className="font-mono-label text-[10px] text-white/30 uppercase tracking-[0.2em] mt-3">{stat.label}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Image Section */}
          <div className="md:col-span-4 lovable-glass rounded-3xl overflow-hidden relative min-h-[400px]">
            <img
              alt="Абстрактная 3D визуализация нейронной сети"
              className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-screen grayscale"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDr37TQWAGWLTJnqUptk8FTOVbvTl8Z9UwtzdyUqZuvlzkh-4eBgCzMBJT9GaE-j2kM3eNteksWzRUqxyJtLzBCu8GeoaWDZJRaYuQUFrHOae2UEAcoP7rR7hl1bBl94cSaAHEcB2x8sPUJXdVnl3ywFXB7Fllee-wj2WFPWcG4egCQHUevkpKNqLG9rue5la6rs_FbEnbBJp7-GhjjBQJ0cN7ZfAPbKwdQutQ0GMQIJxcoar6DIpzCjYW3waWsLE01rMaprZSuUDw"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
            <div className="absolute bottom-6 left-6 font-mono text-[9px] text-white/20 tracking-[0.3em] uppercase">
              SYS.IMG_RENDER_01
            </div>
          </div>

          {/* Values Header */}
          <div className="md:col-span-12 mt-12 mb-6">
            <div className="flex items-center gap-4">
               <h2 className="font-mono-label text-[11px] text-white/40 uppercase tracking-[0.3em] whitespace-nowrap">
                Ключевые ценности
              </h2>
              <div className="w-full h-px bg-white/5" />
            </div>
          </div>

          {/* Value Cards */}
          {values.map((val) => (
            <div
              key={val.title}
              className="md:col-span-3 lovable-glass rounded-3xl p-8 hover:translate-y-[-4px] transition-all duration-500 group"
            >
              <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-500">
                <div className="text-white/60">{val.icon}</div>
              </div>
              <h3 className="font-display text-xl text-white mb-4 tracking-tight">{val.title}</h3>
              <p className="font-body-sm text-foreground/50 leading-relaxed">{val.description}</p>
            </div>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
