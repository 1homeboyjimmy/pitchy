import { Zap, Search, Shield, ScanSearch, Rocket } from "lucide-react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";

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

export default function AboutPage() {
  return (
    <div className="bg-background text-on-background antialiased min-h-screen flex flex-col">
      <TopNavBar />

      <main className="flex-grow pt-24 pb-16 px-6 md:px-12 max-w-[1440px] mx-auto w-full">
        {/* Header */}
        <header className="mb-16 md:mb-24 mt-8 md:mt-16">
          <div className="inline-block bg-white/5 border border-white/[0.08] rounded px-3 py-1 mb-6">
            <span className="font-mono-label text-mono-label text-neutral-400">PITCHY.PRO / INFO</span>
          </div>
          <h1 className="font-display text-display text-primary mb-6 max-w-3xl">О Pitchy.pro</h1>
          <p className="font-body-lg text-body-lg text-neutral-400 max-w-2xl">
            Платформа для глубокого анализа и оптимизации питч-деков на базе искусственного интеллекта. Мы переводим идеи в метрики.
          </p>
        </header>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Mission Card */}
          <section className="md:col-span-8 bg-[#111111] border border-white/[0.08] rounded p-8 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
            <div className="flex items-start gap-4 mb-12">
              <Rocket size={24} strokeWidth={1.5} className="text-primary mt-1" />
              <div>
                <h2 className="font-h2 text-h2 text-primary mb-2">Миссия</h2>
                <p className="font-body-sm text-body-sm text-neutral-500">Системный подход</p>
              </div>
            </div>
            <div className="max-w-2xl">
              <p className="font-body-lg text-body-lg text-neutral-300 leading-relaxed">
                Предоставить фаундерам мощные AI-инструменты для объективной оценки и структурирования бизнес-идей. Мы устраняем неопределенность на ранних стадиях, заменяя догадки на данные, а эмоции — на расчеты. Наша цель — сократить путь от концепции до успешного раунда финансирования.
              </p>
            </div>
            {/* Stats */}
            <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-white/[0.08] pt-8">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <div className="font-display text-display text-primary">{stat.value}</div>
                  <div className="font-mono-label text-mono-label text-neutral-500 uppercase mt-2">{stat.label}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Image Section */}
          <div className="md:col-span-4 bg-[#111111] border border-white/[0.08] rounded overflow-hidden relative min-h-[300px]">
            <img
              alt="Абстрактная 3D визуализация нейронной сети"
              className="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-screen grayscale"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDr37TQWAGWLTJnqUptk8FTOVbvTl8Z9UwtzdyUqZuvlzkh-4eBgCzMBJT9GaE-j2kM3eNteksWzRUqxyJtLzBCu8GeoaWDZJRaYuQUFrHOae2UEAcoP7rR7hl1bBl94cSaAHEcB2x8sPUJXdVnl3ywFXB7Fllee-wj2WFPWcG4egCQHUevkpKNqLG9rue5la6rs_FbEnbBJp7-GhjjBQJ0cN7ZfAPbKwdQutQ0GMQIJxcoar6DIpzCjYW3waWsLE01rMaprZSuUDw"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#111111] via-transparent to-transparent" />
            <div className="absolute bottom-4 left-4 font-mono text-[10px] text-neutral-500 tracking-widest uppercase">
              SYS.IMG_RENDER_01
            </div>
          </div>

          {/* Values Header */}
          <div className="md:col-span-12 mt-8 mb-4">
            <h2 className="font-code text-code text-neutral-400 uppercase tracking-widest border-b border-white/[0.08] pb-4">
              Ключевые ценности
            </h2>
          </div>

          {/* Value Cards */}
          {values.map((val) => (
            <div
              key={val.title}
              className="md:col-span-3 bg-[#111111] border border-white/[0.08] rounded p-6 hover:bg-white/[0.02] transition-colors duration-300"
            >
              <div className="text-neutral-400 mb-6">{val.icon}</div>
              <h3 className="font-h2 text-[20px] text-primary mb-3">{val.title}</h3>
              <p className="font-body-sm text-body-sm text-neutral-500">{val.description}</p>
            </div>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
