import Link from "next/link";
import { Metadata } from "next";
import { Calculator, Users, Gavel, Cpu, PieChart, MessageSquare, Route, Package, Handshake, Plus } from "lucide-react";
import { LandingNavBar } from "@/components/landing/LandingNavBar";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { AnimatedSection, StaggerContainer, StaggerItem } from "@/components/landing/AnimatedSection";
import { HeroSection } from "@/components/sections/HeroSection";

const features = [
  { icon: <Calculator size={24} strokeWidth={1.5} />, title: "Расчет Юнит-экономики.", desc: "Часто проекты рушатся именно из-за ошибок на этом этапе." },
  { icon: <PieChart size={24} strokeWidth={1.5} />, title: "Расчет ЦА.", desc: "Помогаем проанализировать ЦА вашего продукта." },
  { icon: <MessageSquare size={24} strokeWidth={1.5} />, title: "Deep-Custdev.", desc: "Проводите десятки синтетических CustDev-интервью одновременно." },
  { icon: <Route size={24} strokeWidth={1.5} />, title: "Динамический трек проекта.", desc: "Структурируйте ваш проект, чтобы ничего не забыть." },
  { icon: <Package size={24} strokeWidth={1.5} />, title: "Упаковка под гранты.", desc: "Узнайте, какие меры господдержки вы можете получить уже сейчас." },
  { icon: <Handshake size={24} strokeWidth={1.5} />, title: "MatchMaking-система.", desc: "Найдите себе специалистов в команду, которые реально заинтересованы в вашем продукте." },
];

const agents = [
  { color: "bg-blue-500", role: "Инвестор", quote: "\"Не вижу четкой стратегии монетизации...\"" },
  { color: "bg-green-500", role: "Студент", quote: "\"Выглядит круто, но 500р/мес дороговато.\"" },
  { color: "bg-purple-500", role: "Маркетолог", quote: "\"Нужно доработать онбординг, есть отвал.\"" },
  { color: "bg-yellow-500", role: "Предприниматель", quote: "\"Слишком сложно, нужен быстрый старт.\"" },
  { color: "bg-red-500", role: "Дизайнер", quote: "\"Интерфейс перегружен.\"" },
  { color: "bg-cyan-500", role: "Разработчик", quote: "\"Где API документация?\"" },
  { color: "bg-pink-500", role: "HR", quote: "\"Непонятно позиционирование команды.\"" },
  { color: "bg-orange-500", role: "Менеджер", quote: "\"Не хватает интеграции с таск-трекерами.\"" },
  { color: "bg-teal-500", role: "Юрист", quote: "\"Проверьте пользовательское соглашение.\"" },
  { color: "bg-indigo-500", role: "Аналитик", quote: "\"Дашборды неинформативны.\"" },
];

const faqItems = [
  { q: "Что такое синтетический CustDev?", a: "Это метод тестирования идей, при котором вместо реальных людей используются специализированные ИИ-агенты, настроенные на профили вашей целевой аудитории. Они симулируют поведение пользователей, позволяя получить обратную связь за минуты, а не недели." },
  { q: "Какие фонды поддерживаются для получения грантов?", a: "Мы анализируем требования крупнейших государственных и частных фондов (ФСИ, Сколково, РФРИТ и др.) и помогаем адаптировать вашу заявку под их специфические критерии." },
  { q: "Как работает скоринг идеи?", a: "Система анализирует вашу идею по десяткам параметров: объем рынка (TAM/SAM/SOM), наличие конкурентов, сложность реализации и тренды. На основе этих данных формируется объективная оценка жизнеспособности продукта." },
  { q: "Безопасны ли мои данные?", a: "Все данные шифруются по стандарту AES-256. Мы не используем ваши идеи для обучения общих моделей ИИ и гарантируем полную конфиденциальность." },
];

const withPitchy = ["Идея", "Скоринг", "Анализ"];
const withoutPitchy = ["Идея", "Долгая проверка гипотез", "Проблемы с недостатком информации", "Неверно посчитанная юнит-экономика", "Ошибки в анализе ЦА", "Затрудненная подача на грант", "Маловероятное получение финансирования"];

export const metadata: Metadata = {
  alternates: {
    canonical: '/',
  },
};

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

      {/* Cinematic Fade Top */}
      <div className="w-full h-32 bg-gradient-to-b from-transparent to-black pointer-events-none -mt-32 relative z-10" />

      <main className="flex-grow w-full max-w-[1440px] mx-auto px-4 md:px-12 py-12 space-y-32">


        {/* User Journey */}
        <section className="py-24 border-t border-white/[0.08]">
          <AnimatedSection direction="up" className="max-w-4xl mx-auto text-center mb-16">
            <h2 className="text-[40px] md:text-[56px] leading-tight font-normal tracking-tight mb-6" style={{ fontFamily: "'Instrument Serif', serif" }}>Путь пользователя.</h2>
            <p className="text-white/60 text-lg font-light">Ускоряй процесс, повышай качество, реализуй идею.</p>
          </AnimatedSection>
          <div className="relative w-full max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 px-8">
            <AnimatedSection direction="left" className="flex flex-col items-center">
              <h3 className="text-white text-lg mb-12 tracking-[0.2em] uppercase font-semibold">С Pitchy</h3>
              <div className="relative w-full flex flex-col items-center h-full justify-between gap-8 py-2">
                <div className="absolute top-6 bottom-6 w-[1px] bg-gradient-to-b from-white/40 to-transparent shadow-[0_0_8px_rgba(255,255,255,0.5)] z-0" />
                {withPitchy.map((s) => (
                  <div key={s} className="relative z-10 liquid-glass rounded-full px-8 py-4 w-64 text-center">
                    <span className="relative z-10 text-white font-medium text-sm">{s}</span>
                  </div>
                ))}
                <div className="relative z-10 liquid-glass-strong rounded-full px-8 py-4 w-64 text-center">
                  <span className="relative z-10 font-bold text-sm uppercase tracking-wider text-white">Получение гранта</span>
                </div>
              </div>
            </AnimatedSection>
            <AnimatedSection direction="right" className="flex flex-col items-center opacity-40">
              <h3 className="text-neutral-500 text-lg mb-12 tracking-[0.2em] uppercase font-semibold">Без Pitchy</h3>
              <div className="relative w-full flex flex-col items-center gap-6 py-2">
                <div className="absolute top-6 bottom-6 w-px border-l-2 border-dotted border-white/20 z-0" />
                {withoutPitchy.map((s, i) => (
                  <div key={s} className={`relative z-10 liquid-glass rounded-full px-6 py-3 w-72 text-center`}>
                    <span className="relative z-10 text-white/70 text-xs">{s}</span>
                  </div>
                ))}
              </div>
            </AnimatedSection>
          </div>
        </section>

        {/* Smart Assistant */}
        <section className="py-24 border-t border-white/[0.08]">
          <div className="max-w-6xl mx-auto px-8 grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
            <AnimatedSection direction="left" className="liquid-glass rounded-2xl flex flex-col h-[400px]">
              <div className="bg-[#1A1A1A] px-6 py-4 flex items-center gap-4 relative z-10">
                <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center"><Cpu size={20} strokeWidth={1.5} className="text-white" /></div>
                <div><h3 className="text-white font-semibold text-sm">Умный ассистент</h3><p className="text-neutral-500 text-xs">Online</p></div>
              </div>
              <div className="p-6 flex-1 overflow-y-auto space-y-6 bg-transparent relative z-10">
                <div className="flex justify-end"><div className="bg-white text-black rounded-2xl rounded-tr-sm px-4 py-3 max-w-[80%] text-sm">Сделай расчет юнит-экономики для B2B SaaS продукта при CAC=5000р и ARPU=1500р/мес.</div></div>
                <div className="flex justify-start"><div className="bg-[#1A1A1A] border border-white/10 text-white rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] text-sm space-y-2"><p className="text-neutral-300">Результат анализа:</p><ul className="list-disc pl-4 space-y-1 text-neutral-400"><li>Payback period: ~3.3 месяца</li><li>При Lifetime 12 мес: LTV = 18,000р</li><li>LTV/CAC Ratio = 3.6 (Оптимально &gt; 3)</li></ul><p className="text-white font-medium mt-2">Вывод: Экономика сходится. Рекомендую масштабировать каналы привлечения.</p></div></div>
                <div className="flex justify-start opacity-50"><div className="bg-[#1A1A1A] border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1"><div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" /><div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} /><div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} /></div></div>
              </div>
            </AnimatedSection>
            <AnimatedSection direction="right">
              <h2 className="text-[32px] md:text-[40px] leading-tight font-normal tracking-tight mb-12" style={{ fontFamily: "'Instrument Serif', serif" }}>Умный ассистент 24/7</h2>
              <StaggerContainer className="space-y-8">
                {[{ icon: <Calculator size={20} strokeWidth={1.5} />, t: "Мгновенный расчет Unit-экономики", d: "Получайте точные расчеты окупаемости, CAC, LTV и других метрик в реальном времени." },
                  { icon: <Users size={20} strokeWidth={1.5} />, t: "Анализ ЦА", d: "Сегментируйте аудиторию, выявляйте боли и потребности с помощью алгоритмов семантического анализа." },
                  { icon: <Gavel size={20} strokeWidth={1.5} />, t: "Юридические консультации", d: "Базовый аудит документов, помощь в регистрации и ответы на правовые вопросы стартапов." },
                  { icon: <Cpu size={20} strokeWidth={1.5} />, t: "Интеграция RAG", d: "Ассистент опирается на вашу документацию и базу знаний проекта для релевантных ответов." },
                ].map((f) => (
                  <StaggerItem key={f.t} className="flex gap-4 items-start">
                    <div className="mt-1 bg-white/10 p-2 rounded shrink-0">{f.icon}</div>
                    <div><h3 className="font-bold text-lg mb-1">{f.t}</h3><p className="text-neutral-400 text-sm leading-relaxed">{f.d}</p></div>
                  </StaggerItem>
                ))}
              </StaggerContainer>
            </AnimatedSection>
          </div>
        </section>

        {/* Grant Automation */}
        <section className="py-24 border-t border-white/[0.08] relative overflow-hidden">
          <AnimatedSection direction="up" className="text-center mb-16"><h2 className="text-[40px] md:text-[56px] leading-tight font-normal tracking-tight mb-6" style={{ fontFamily: "'Instrument Serif', serif" }}>Автоматизация грантового цикла</h2><p className="text-white/60 text-sm">SCAN_FUNDS // DYNAMIC_TRACK_ENGAGED</p></AnimatedSection>
          <div className="relative w-full max-w-5xl mx-auto px-8">
            <div className="absolute top-1/2 left-8 right-8 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-y-1/2" />
            <StaggerContainer className="grid grid-cols-1 md:grid-cols-3 gap-8 relative" staggerDelay={0.15}>
              {["ПОДАЧА", "ТРЕКШН", "ОТЧЕТНОСТЬ"].map((label, i) => (
                <StaggerItem key={label} className="group liquid-glass rounded-2xl p-6 transition-all duration-300">
                  <div className="relative z-10 w-4 h-4 bg-white rounded-full mx-auto mb-6"><div className="absolute inset-0 bg-white rounded-full animate-ping opacity-50" style={{ animationDelay: `${i * 0.3}s` }} /></div>
                  <div className="text-center relative z-10"><h3 className="text-white text-lg mb-2 tracking-wider">{label}</h3></div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>

        {/* Deep CustDev */}
        <section className="py-24 border-t border-white/[0.08]">
          <AnimatedSection direction="up" className="max-w-4xl mx-auto text-center mb-24"><h2 className="text-[40px] md:text-[56px] leading-tight font-normal tracking-tight mb-6" style={{ fontFamily: "'Instrument Serif', serif" }}>Deep CustDev: Синтетические интервью</h2><p className="text-white/60 text-lg font-light">Множество ИИ-агентов в реальном времени дают обратную связь по вашему проекту. Каждому агенту заданы личные характеристики.</p></AnimatedSection>
          <AnimatedSection direction="fade" className="relative w-full max-w-6xl mx-auto liquid-glass rounded-3xl p-8">
            <StaggerContainer className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4" staggerDelay={0.05}>
              {agents.map((a) => (
                <StaggerItem key={a.role} className="liquid-glass rounded-2xl p-4 flex flex-col h-full bg-transparent">
                  <div className="flex items-center gap-2 mb-3 pb-2 relative z-10"><span className={`w-2 h-2 rounded-full ${a.color}`} /><span className="text-white text-xs">{a.role}</span></div>
                  <div className="flex-grow flex items-center justify-center relative z-10"><p className="text-white/70 text-xs italic text-center">"{a.quote}"</p></div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </AnimatedSection>
        </section>

        {/* Roadmap */}
        <section className="py-24 border-t border-white/[0.08]">
          <AnimatedSection direction="up" className="max-w-4xl mx-auto text-center mb-24"><h2 className="text-[40px] md:text-[56px] leading-tight font-normal tracking-tight mb-6" style={{ fontFamily: "'Instrument Serif', serif" }}>Структурированная дорожная карта проекта.</h2></AnimatedSection>
          <AnimatedSection direction="fade" className="relative w-full max-w-5xl mx-auto h-[400px] liquid-glass rounded-3xl p-8">
            <div className="absolute left-[15%] w-[60%] top-1/2 h-[1px] bg-white/20 z-0" />
            <div className="relative h-full text-xs text-neutral-400 z-10">
              <div className="absolute left-[10%] top-1/2 -mt-4 liquid-glass-strong rounded-full px-3 py-1.5 flex items-center gap-2 font-medium">
                <span className="relative z-10 text-white">● production</span>
              </div>
              <div className="absolute left-[28%] top-[25%] liquid-glass rounded-full px-3 py-1.5">
                <span className="relative z-10 text-white">● preview-branch</span>
              </div>
              <div className="absolute left-[55%] top-[75%] liquid-glass rounded-full px-3 py-1.5">
                <span className="relative z-10 text-white">● test-branch</span>
              </div>
              <div className="absolute left-[70%] top-[30%] liquid-glass-strong rounded-full px-3 py-1.5 flex items-center gap-2 font-medium">
                <span className="relative z-10 text-white">● dev-branch</span>
              </div>
            </div>
          </AnimatedSection>
        </section>

        {/* Feature Grid */}
        <section className="py-24 border-t border-white/[0.08]">
          <div className="max-w-6xl mx-auto px-8">
            <AnimatedSection direction="up">
              <h2 className="text-[40px] md:text-[56px] leading-tight font-normal tracking-tight mb-16 text-center max-w-4xl mx-auto" style={{ fontFamily: "'Instrument Serif', serif" }}>Сокращение рутины стартапера - наша главная задача.</h2>
            </AnimatedSection>
            <StaggerContainer className="grid grid-cols-1 md:grid-cols-3 gap-6" staggerDelay={0.1}>
              {features.map((f) => (
                <StaggerItem key={f.title} className="liquid-glass rounded-2xl p-8 transition-colors">
                  <div className="relative z-10">
                    <div className="text-white mb-6">{f.icon}</div>
                    <h3 className="text-white font-semibold mb-3">{f.title}</h3>
                    <p className="text-neutral-400 text-sm">{f.desc}</p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-24 border-t border-white/[0.08]">
          <div className="max-w-3xl mx-auto px-8">
            <AnimatedSection direction="up">
              <h2 className="text-[40px] md:text-[56px] leading-tight font-normal tracking-tight mb-12 text-center" style={{ fontFamily: "'Instrument Serif', serif" }}>Частые вопросы</h2>
            </AnimatedSection>
            <StaggerContainer className="space-y-4" staggerDelay={0.08}>
              {faqItems.map((faq) => (
                <StaggerItem key={faq.q}>
                  <details className="liquid-glass rounded-2xl group" name="faq">
                    <summary className="cursor-pointer p-6 flex justify-between items-center font-semibold text-white relative z-10">
                      {faq.q}
                      <Plus size={20} strokeWidth={1.5} className="text-neutral-500 group-open:rotate-45 transition-transform duration-200 shrink-0 ml-4" />
                    </summary>
                    <div className="px-6 pb-6 text-neutral-400 text-sm leading-relaxed relative z-10">{faq.a}</div>
                  </details>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
