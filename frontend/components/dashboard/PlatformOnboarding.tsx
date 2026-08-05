"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  FileText,
  HandCoins,
  Lightbulb,
  Loader,
  MessageSquareText,
  Network,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { patchAuthJson } from "@/lib/api";
import { trackMetrikaGoal } from "@/components/analytics/YandexMetrika";

type ProjectStage = "no-idea" | "has-idea";

type Step = {
  title: string;
  description: string;
  icon: LucideIcon;
};

const custdevDescription =
  "Проведем интервью с обществом ИИ-агентов, чтобы найти скрытые паттерны спроса, опираясь на реальные данные рынка";

const stageOptions: Array<{
  id: ProjectStage;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    id: "no-idea",
    title: "Нет идеи",
    description: "Найдем перспективное направление и превратим его в рабочую гипотезу.",
    icon: Sparkles,
  },
  {
    id: "has-idea",
    title: "Есть идея",
    description: "Разложим проект по структуре и подготовим его к проверке рынком.",
    icon: Lightbulb,
  },
];

const stepsByStage: Record<ProjectStage, Step[]> = {
  "no-idea": [
    {
      title: "Генерируем идею",
      description: "Подберем направление под ваш опыт, рынок и цели, а затем превратим его в гипотезу.",
      icon: MessageSquareText,
    },
    {
      title: "Собираем паспорт проекта",
      description: "Зафиксируем продукт, аудиторию, боли, ценность и гипотезы в единой структуре.",
      icon: FileText,
    },
    {
      title: "Считаем метрики",
      description: "Оценим рынок, экономику, риски, потенциал роста и инвестиционную привлекательность.",
      icon: BarChart3,
    },
    {
      title: "Запускаем симуляцию CustDev",
      description: custdevDescription,
      icon: Network,
    },
    {
      title: "Готовим грантовую заявку",
      description: "Подберем меры поддержки и соберем материалы на основе паспорта, метрик и CustDev.",
      icon: HandCoins,
    },
  ],
  "has-idea": [
    {
      title: "Собираем паспорт проекта",
      description: "Превратим идею в структурированный проект: продукт, аудитория, боли и точки роста.",
      icon: FileText,
    },
    {
      title: "Считаем метрики",
      description: "Проверим рынок, экономику, риски и потенциал проекта перед развитием или подачей.",
      icon: BarChart3,
    },
    {
      title: "Запускаем симуляцию CustDev",
      description: custdevDescription,
      icon: Network,
    },
    {
      title: "Готовим грантовую заявку",
      description: "Подберем программы поддержки и подготовим заявку на основе уже собранных данных.",
      icon: HandCoins,
    },
  ],
};

const slideVariants = {
  enter: { opacity: 0, y: 18, filter: "blur(8px)" },
  center: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -18, filter: "blur(8px)" },
};

type PlatformOnboardingProps = {
  token: string;
  onComplete: () => void;
};

export function PlatformOnboarding({ token, onComplete }: PlatformOnboardingProps) {
  const [slide, setSlide] = useState(0);
  const [stage, setStage] = useState<ProjectStage | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selectedSteps = useMemo(() => {
    return stage ? stepsByStage[stage] : [];
  }, [stage]);

  const complete = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await patchAuthJson("/me", { onboarding_completed: true }, token);
      trackMetrikaGoal("onboarding_completed");
    } catch (error) {
      console.error("Failed to save onboarding state:", error);
    } finally {
      onComplete();
    }
  };

  const goNext = () => {
    if (slide === 0) {
      if (!stage) return;
      setSlide(1);
      return;
    }
    void complete();
  };

  const goBack = () => {
    if (slide === 1) setSlide(0);
  };

  return (
    <motion.div
      className="fixed inset-0 z-[300] bg-[#111111] text-white overflow-y-auto overscroll-contain"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.08),transparent_42%)] pointer-events-none" />

      <div className="relative z-10 min-h-[100dvh] flex flex-col items-center px-4 pt-14 pb-36 sm:pt-24 sm:pb-40">
        <AnimatePresence mode="wait">
          {slide === 0 ? (
            <motion.section
              key="stage"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-3xl flex flex-col items-center"
            >
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05, duration: 0.35 }}
                className="text-center mb-10 sm:mb-12"
              >
                <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold leading-tight">
                  С чего начнем?
                </h1>
                <p className="mt-4 text-base sm:text-lg text-white/55 leading-relaxed">
                  Выберите текущую стадию проекта, чтобы Pitchy показал правильный маршрут.
                </p>
              </motion.div>

              <div className="grid w-full gap-3 sm:grid-cols-2">
                {stageOptions.map((option, index) => {
                  const Icon = option.icon;
                  const selected = stage === option.id;
                  return (
                    <motion.button
                      key={option.id}
                      type="button"
                      initial={{ opacity: 0, y: 18 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.12 + index * 0.08, duration: 0.35 }}
                      whileHover={{ y: -3 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setStage(option.id)}
                      className={`group rounded-lg border p-5 sm:p-6 text-left transition-all ${
                        selected
                          ? "border-white/55 bg-white/[0.09] shadow-2xl shadow-white/5"
                          : "border-white/10 bg-white/[0.035] hover:border-white/25 hover:bg-white/[0.055]"
                      }`}
                      aria-pressed={selected}
                    >
                      <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-white/75 group-hover:text-white">
                        <Icon className="h-6 w-6" strokeWidth={1.7} />
                      </div>
                      <h2 className="text-xl sm:text-2xl font-semibold leading-tight">{option.title}</h2>
                      <p className="mt-3 text-sm sm:text-base leading-relaxed text-white/55">
                        {option.description}
                      </p>
                    </motion.button>
                  );
                })}
              </div>
            </motion.section>
          ) : (
            <motion.section
              key="steps"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-6xl flex flex-col items-center"
            >
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05, duration: 0.35 }}
                className="text-center mb-8 sm:mb-12"
              >
                <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold leading-tight">
                  Как будет расти проект
                </h1>
                <p className="mt-4 text-base sm:text-lg text-white/55 leading-relaxed">
                  {stage === "no-idea"
                    ? "Начнем с поиска идеи и доведем ее до заявки."
                    : "Начнем со структуры проекта и перейдем к проверке рынка."}
                </p>
              </motion.div>

              <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                {selectedSteps.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <motion.article
                      key={step.title}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + index * 0.06, duration: 0.35 }}
                      className="relative rounded-lg border border-white/10 bg-white/[0.035] p-4 sm:p-5 min-h-[210px]"
                    >
                      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-white/75">
                        <Icon className="h-5 w-5" strokeWidth={1.7} />
                      </div>
                      <div className="text-xs font-semibold text-white/35">
                        Шаг {index + 1}
                      </div>
                      <h2 className="mt-2 text-lg font-semibold leading-snug">{step.title}</h2>
                      <p className="mt-3 text-sm leading-relaxed text-white/55">
                        {step.description}
                      </p>
                    </motion.article>
                  );
                })}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-8 left-0 right-0 z-20 flex flex-col items-center gap-3 sm:gap-4 px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={slide === 0 || isSaving}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/75 transition hover:border-white/30 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
            aria-label="Назад"
            title="Назад"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={(slide === 0 && !stage) || isSaving}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white bg-white text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-white/15 disabled:text-white/35"
            aria-label="Далее"
            title="Далее"
          >
            {isSaving ? (
              <Loader className="h-5 w-5 animate-spin" strokeWidth={2} />
            ) : (
              <ArrowRight className="h-5 w-5" strokeWidth={2} />
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={() => void complete()}
          disabled={isSaving}
          className="text-sm text-white/38 transition hover:text-white/70 disabled:opacity-35"
        >
          Пропустить
        </button>
      </div>
    </motion.div>
  );
}
