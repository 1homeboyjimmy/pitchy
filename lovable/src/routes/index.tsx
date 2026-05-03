import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Bot,
  BrainCircuit,
  FileText,
  Gauge,
  Layers3,
  Radar,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "AI Product Studio — Visionary Workflow" },
      {
        name: "description",
        content:
          "Премиальный AI-интерфейс с глубоким чёрным фоном, liquid glass секциями и кинематографичной подачей продукта.",
      },
    ],
  }),
});

const fadeUpInitial = { opacity: 0, y: 28 };

const fadeUpIn = (delay = 0) => ({
  opacity: 1,
  y: 0,
  transition: { duration: 0.8, ease: "easeOut" as const, delay },
});

const capabilityCards = [
  {
    icon: Gauge,
    title: "Моментальная unit-экономика",
    body: "Считайте окупаемость, CAC, LTV и сценарии роста в одном живом слое данных.",
  },
  {
    icon: BrainCircuit,
    title: "Глубокий CustDev",
    body: "Синтетические интервью и сегментация сигналов без сухих дашбордов и лишнего шума.",
  },
  {
    icon: FileText,
    title: "Гранты и заявки",
    body: "Собирайте подачу, трекинг и отчётность в единую управляемую систему.",
  },
  {
    icon: Bot,
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
    <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
      <div className="mono text-foreground/70">{eyebrow}</div>
      <h2 className="mt-4 max-w-4xl text-4xl leading-none text-gradient md:text-6xl">{title}</h2>
      <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">{text}</p>
    </div>
  );
}

function Index() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="aurora-orb left-[-8rem] top-[18rem] h-64 w-64 bg-[oklch(0.58_0.24_285_/_0.34)] animate-float-slow" />
      <div className="aurora-orb right-[-6rem] top-[58rem] h-72 w-72 bg-[oklch(0.62_0.2_210_/_0.24)] animate-float-slow" />

      <section className="relative section-line px-5 pb-14 pt-10 sm:px-8 sm:pt-12 lg:px-12 lg:pt-16">
        <div className="mx-auto flex max-w-7xl justify-end">
          <motion.div
            initial={fadeUpInitial}
            animate={fadeUpIn(0.1)}
            className="glass liquid-outline max-w-xl rounded-[2rem] p-5 text-left md:p-7"
          >
            <div className="mono text-foreground/60">NEXT SECTIONS</div>
            <p className="mt-3 text-sm leading-7 text-muted-foreground md:text-base">
              Ниже — полностью новая подача: глубокий чёрный фон, живое стекло, мягкие свечения,
              тонкие линии и кинематографичный ритм секций.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="relative section-line px-5 py-24 sm:px-8 lg:px-12">
        <div className="absolute inset-0 aurora-bg opacity-80" />
        <div className="relative mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="SYSTEM OVERVIEW"
            title="Всё, что идёт после hero, теперь выглядит как продукт, а не лендинг-болванка."
            text="Я сохранил ощущение премиальности и сделал интерфейс глубже: стеклянные поверхности, тонкие контуры, контрастная типографика и анимации, которые поддерживают композицию, а не отвлекают."
          />

          <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {capabilityCards.map((card, index) => {
              const Icon = card.icon;
              return (
                <motion.article
                  key={card.title}
                  initial={fadeUpInitial}
                  whileInView={fadeUpIn(0.08 * index)}
                  viewport={{ once: true, margin: "-80px" }}
                  className="glass liquid-outline group rounded-[1.75rem] p-6"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5">
                      <Icon className="h-5 w-5 text-foreground" />
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform duration-300 group-hover:-translate-y-1 group-hover:translate-x-1" />
                  </div>
                  <h3 className="mt-10 text-2xl leading-tight text-foreground">{card.title}</h3>
                  <p className="mt-4 text-sm leading-7 text-muted-foreground">{card.body}</p>
                </motion.article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="relative section-line px-5 py-24 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <motion.div
            initial={fadeUpInitial}
            whileInView={fadeUpIn()}
            viewport={{ once: true, margin: "-120px" }}
          >
            <div className="mono text-foreground/70">USER PATH REWIRED</div>
            <h2 className="mt-4 max-w-xl text-4xl leading-none text-gradient md:text-6xl">
              Вместо скучного скролла — управляемая драматургия пути пользователя.
            </h2>
            <p className="mt-6 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
              Каждая следующая зона теперь ведёт глубже: сначала ценность, потом механика процесса,
              затем интеллект системы и в конце — ощущение контроля над исполнением.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button variant="hero" size="lg">
                View roadmap
              </Button>
              <Button variant="glass" size="lg">
                Explore flow
              </Button>
            </div>
          </motion.div>

          <motion.div
            initial={fadeUpInitial}
            whileInView={fadeUpIn(0.14)}
            viewport={{ once: true, margin: "-120px" }}
            className="glass-strong liquid-outline relative rounded-[2rem] p-6 md:p-8"
          >
            <div className="absolute inset-x-10 top-1/2 h-px -translate-y-1/2 bg-white/10" />
            <div className="space-y-5">
              {timeline.map((step, index) => (
                <div
                  key={step.label}
                  className="grid gap-3 md:grid-cols-[160px_1fr] md:items-center"
                >
                  <div className="liquid-outline glass rounded-full px-5 py-3 text-center text-sm font-medium text-foreground">
                    {step.label}
                  </div>
                  <div className="rounded-full border border-white/8 bg-white/[0.03] px-5 py-3 text-sm text-muted-foreground">
                    <span className="mr-3 inline-block h-2 w-2 rounded-full bg-accent align-middle animate-pulse-glow" />
                    {step.note}
                    <span className="mono ml-3 text-foreground/45">0{index + 1}</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <section className="relative section-line px-5 py-24 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
          <motion.div
            initial={fadeUpInitial}
            whileInView={fadeUpIn()}
            viewport={{ once: true, margin: "-120px" }}
            className="glass-strong liquid-outline rounded-[2rem] p-6 md:p-8"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold">Умный ассистент</div>
                <div className="text-sm text-muted-foreground">online / context aware</div>
              </div>
            </div>

            <div className="mt-8 space-y-4">
              <div className="ml-auto max-w-md rounded-[1.5rem] bg-white/[0.92] px-5 py-4 text-sm leading-7 text-black shadow-2xl">
                Сделай расчёт unit-экономики для B2B SaaS и покажи, где стоит усиливать каналы
                роста.
              </div>
              <div className="glass liquid-outline max-w-md rounded-[1.5rem] p-5 text-sm leading-7 text-muted-foreground">
                <div className="mb-3 text-foreground">Результат анализа</div>
                <ul className="space-y-2">
                  <li>Payback period: ~3.3 месяца</li>
                  <li>LTV / CAC: 3.6 — в безопасной зоне роста</li>
                  <li>12-месячный LTV: ~18 000 ₽</li>
                </ul>
                <p className="mt-4 text-foreground">
                  Экономика сходится. Масштабирование можно ускорять.
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={fadeUpInitial}
            whileInView={fadeUpIn(0.1)}
            viewport={{ once: true, margin: "-120px" }}
          >
            <div className="mono text-foreground/70">AI LAYER</div>
            <h2 className="mt-4 text-4xl leading-none text-gradient md:text-6xl">
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
                  <div key={item.title} className="glass liquid-outline rounded-[1.5rem] p-5">
                    <div className="flex items-start gap-4">
                      <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xl text-foreground">{item.title}</h3>
                        <p className="mt-2 text-sm leading-7 text-muted-foreground">{item.text}</p>
                        <div className="mono mt-3 text-foreground/45">module 0{index + 1}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      </section>

      <section className="relative section-line px-5 py-24 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="SIGNAL MAP"
            title="Синтетическая обратная связь теперь подана как коллекция сигналов, а не как сетка карточек без атмосферы."
            text="Я оставил технологичность, но усилил ощущение премиального исследовательского интерфейса: больше воздуха, тоньше рамки, лучше иерархия и мягкая глубина поверхностей."
          />

          <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {signals.map((signal, index) => (
              <motion.div
                key={signal}
                initial={fadeUpInitial}
                whileInView={fadeUpIn(0.06 * index)}
                viewport={{ once: true, margin: "-80px" }}
                className="glass liquid-outline rounded-[1.5rem] p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                  <div className="text-lg text-foreground">{signal}</div>
                </div>
                <div className="mt-5 border-t border-white/8 pt-4 text-sm italic leading-7 text-muted-foreground">
                  “Сигнал уже виден, но теперь интерфейс не спорит с контентом — он усиливает его.”
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
