"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Minus,
  Zap,
  MessageSquareText,
  Users,
  Landmark,
} from "lucide-react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";
import { PitchyLogo } from "@/components/shared/PitchyLogo";

type CategoryId = "general" | "analysis" | "custdev" | "grants";

type FAQ = {
  id: string;
  category: CategoryId;
  question: string;
  answer: string;
  featured?: boolean;
};

const categories: Array<{
  id: CategoryId;
  icon: typeof Zap;
  label: string;
  shortLabel: string;
}> = [
  { id: "general", icon: Zap, label: "ОБЩЕЕ", shortLabel: "Общее" },
  {
    id: "analysis",
    icon: MessageSquareText,
    label: "АНАЛИЗ, ЧАТ И КАРТА",
    shortLabel: "Анализ, чат и дорожная карта",
  },
  {
    id: "custdev",
    icon: Users,
    label: "ГЛУБОКИЙ КАСТДЕВ",
    shortLabel: "Глубокий кастдев",
  },
  {
    id: "grants",
    icon: Landmark,
    label: "ГРАНТЫ И ПОДДЕРЖКА",
    shortLabel: "Гранты и поддержка",
  },
];

const faqs: FAQ[] = [
  {
    id: "general-what-is-pitchy",
    category: "general",
    featured: true,
    question: "Что такое Pitchy?",
    answer:
      "Pitchy — это ИИ-платформа для развития стартапов и технологических проектов. Она помогает проанализировать идею, изучить рынок и аудиторию, проверить гипотезы, составить дорожную карту и подготовить проект к получению грантов и инвестиций.",
  },
  {
    id: "general-who-is-it-for",
    category: "general",
    featured: true,
    question: "Кому подойдёт Pitchy?",
    answer:
      "Pitchy подходит стартапам для подготовки заявок на гранты, создания питч-деков и дорожных карт; акселераторам и вузам — для ведения проектов и первичной экспертной оценки; инвесторам — для скоринга заявок и проверки бизнес-моделей; корпорациям — для развития внутренних инициатив и оценки идей сотрудников.",
  },
  {
    id: "general-getting-started",
    category: "general",
    question: "С чего начать работу?",
    answer:
      "Создайте аккаунт, добавьте проект и опишите его своими словами. Чем подробнее вы расскажете о продукте, аудитории и текущем этапе, тем точнее Pitchy сможет учитывать контекст в анализе и рекомендациях.",
  },
  {
    id: "general-replace-expert",
    category: "general",
    question: "Может ли Pitchy заменить эксперта или консультанта?",
    answer:
      "Pitchy не может полностью заменить профильного эксперта, но заметно ускоряет процессы развития проекта и подходит для его первичной оценки. Даже высокоточные ответы Pitchy могут содержать ошибки.",
  },
  {
    id: "general-free-plan",
    category: "general",
    question: "Можно ли пользоваться Pitchy бесплатно?",
    answer:
      "Да. Бесплатный тариф позволяет создать один проект и познакомиться с базовыми возможностями платформы. Для большего количества проектов и расширенных функций доступны платные тарифы.",
  },
  {
    id: "general-payment",
    category: "general",
    question: "Как оплачивается подписка?",
    answer:
      "Выбрать подходящий тариф можно на странице «Тарифы». Доступ к функциям подключается автоматически после подтверждения платежа. Доступны варианты оплаты на месяц и на год.",
  },
  {
    id: "general-security",
    category: "general",
    question: "Насколько безопасно хранить данные проекта в Pitchy?",
    answer:
      "Данные шифруются при передаче и хранении, а серверы расположены на территории России. Pitchy не продаёт пользовательские данные третьим лицам и обрабатывает персональные данные в соответствии с требованиями 152-ФЗ.",
  },
  {
    id: "general-material-rights",
    category: "general",
    question: "Кому принадлежат созданные в Pitchy материалы?",
    answer:
      "Права на сгенерированные для проекта материалы — тексты, результаты анализа и отчёты — передаются пользователю. Вы можете использовать их для дальнейшей работы над проектом, презентаций и заявок.",
  },
  {
    id: "analysis-chat-tasks",
    category: "analysis",
    featured: true,
    question: "Какие задачи можно решать в умном чате Pitchy?",
    answer:
      "Чат помогает проверить бизнес-идею, изучить целевую аудиторию и конкурентов, рассчитать юнит-экономику, исследовать рынок, подготовить презентацию и найти слабые места проекта. Ему также можно задавать вопросы по мере развития проекта.",
  },
  {
    id: "analysis-how-it-works",
    category: "analysis",
    featured: true,
    question: "Как Pitchy анализирует проект?",
    answer:
      "Pitchy учитывает контекст проекта и опирается на актуальные и точные данные российского рынка. Несколько ИИ-моделей анализируют задачу, после чего система собирает результат, добавляет источники и перепроверяет выводы.",
  },
  {
    id: "analysis-required-data",
    category: "analysis",
    question: "Какие данные нужно предоставить для анализа?",
    answer:
      "Для начала достаточно описать идею, проблему, решение и целевую аудиторию. Дополнительно можно указать стадию проекта, бизнес-модель, метрики, конкурентов и другие известные данные. Чем полнее контекст, тем точнее результат.",
  },
  {
    id: "analysis-sources",
    category: "analysis",
    question: "Показывает ли Pitchy источники информации?",
    answer:
      "Да. При проведении исследований Pitchy может искать актуальную информацию в интернете и прикладывать ссылки на использованные источники. Это позволяет самостоятельно проверить данные и выводы ИИ.",
  },
  {
    id: "analysis-shared-memory",
    category: "analysis",
    question: "Сохраняет ли чат контекст проекта?",
    answer:
      "Да. Чаты внутри одной папки проекта используют общую память и паспорт проекта. Благодаря этому не нужно заново пересказывать основную информацию в каждом новом диалоге.",
  },
  {
    id: "analysis-roadmap",
    category: "analysis",
    question: "Что такое дорожная карта проекта?",
    answer:
      "Это пошаговый маршрут развития проекта. Он помогает последовательно проработать идею и проблему, рынок, бизнес-модель и метрики, команду и юридические данные.",
  },
  {
    id: "analysis-roadmap-stages",
    category: "analysis",
    question: "Как проходить этапы дорожной карты?",
    answer:
      "Pitchy задаёт наводящие вопросы и открывает следующие этапы по мере заполнения предыдущих. После каждого чекпоинта пользователь получает краткий ИИ-разбор и рекомендацию по следующему шагу.",
  },
  {
    id: "analysis-roadmap-value",
    category: "analysis",
    question: "Зачем заполнять дорожную карту полностью?",
    answer:
      "Заполненные данные формируют паспорт проекта и используются во всех связанных инструментах Pitchy. Чем полнее паспорт, тем точнее анализ, подбор грантов и подготовка заявок.",
  },
  {
    id: "custdev-what-is-it",
    category: "custdev",
    featured: true,
    question: "Что такое глубокий кастдев в Pitchy?",
    answer:
      "Это гибридная проверка спроса, объединяющая реальные сигналы рынка и симуляцию общества ИИ-агентов. Их совместный анализ помогает точнее оценить гипотезу до начала разработки.",
  },
  {
    id: "custdev-difference",
    category: "custdev",
    featured: true,
    question: "Чем этот подход отличается от обычной ИИ-фокус-группы?",
    answer:
      "ИИ-агенты отвечают не в отрыве от реальности. Pitchy дополняет симуляцию живыми обсуждениями, жалобами и пользовательскими формулировками из открытых сообществ, поэтому выводы опираются не только на моделируемое поведение.",
  },
  {
    id: "custdev-signal-interaction",
    category: "custdev",
    question: "Как взаимодействуют сигналы рынка и ИИ-агенты?",
    answer:
      "Сначала Pitchy находит реальные подтверждения или опровержения проблемы. Затем эти данные становятся контекстом для общества ИИ-агентов, которое проверяет реакцию разных сегментов на вашу гипотезу. В финале система сопоставляет результаты обоих этапов и формирует общий вывод.",
  },
  {
    id: "custdev-getting-started",
    category: "custdev",
    question: "С чего начать проверку гипотезы?",
    answer:
      "Опишите гипотезу вручную, сформируйте её из паспорта проекта или загрузите готовый дек. Укажите проблему, предлагаемое решение, сегменты аудитории и ключевое предположение, которое нужно проверить.",
  },
  {
    id: "custdev-market-signals",
    category: "custdev",
    question: "Какие реальные сигналы анализирует Pitchy?",
    answer:
      "Pitchy изучает релевантные обсуждения на Хабре, vc.ru, Пикабу и других открытых площадках. Система ищет жалобы, повторяющиеся боли, текущие способы решения проблемы и признаки заинтересованности пользователей.",
  },
  {
    id: "custdev-simulation",
    category: "custdev",
    question: "Как проходит симуляция общества ИИ-агентов?",
    answer:
      "ИИ-агенты с разными ролями и характеристиками реагируют на гипотезу с учётом найденных рыночных сигналов. Они отвечают на CustDev-вопросы, выражают возражения и показывают различия между сегментами аудитории.",
  },
  {
    id: "custdev-agent-interview",
    category: "custdev",
    question: "Можно ли подробнее изучить реакцию отдельного агента?",
    answer:
      "Да. С любой персоной можно провести углублённое интервью, чтобы уточнить её мотивацию, потребности и причины конкретной реакции.",
  },
  {
    id: "custdev-result",
    category: "custdev",
    question: "Что происходит во время кастдева и какой результат я получу?",
    answer:
      "Во время кастдева можно общаться с отдельными ИИ-агентами, задавать уточняющие вопросы и глубже разбирать их реакции. После завершения исследования Pitchy формирует подробный отчёт с анализом рыночных сигналов, результатами симуляции, ключевыми выводами и оценкой гипотезы.",
  },
  {
    id: "grants-opportunities",
    category: "grants",
    featured: true,
    question: "Какие возможности Pitchy подбирает для проекта?",
    answer:
      "Pitchy подбирает гранты, меры поддержки, акселераторы, бизнес-мероприятия и другие программы, которые могут помочь развитию проекта.",
  },
  {
    id: "grants-matching",
    category: "grants",
    featured: true,
    question: "Как Pitchy определяет подходящие программы?",
    answer:
      "Система сопоставляет данные из паспорта проекта с условиями программ: направлением, стадией, географией, юридической формой и другими критериями.",
  },
  {
    id: "grants-incomplete-passport",
    category: "grants",
    question: "Можно ли искать программы с незаполненным паспортом?",
    answer:
      "Да, подбор доступен и по частично заполненному паспорту. Однако чем больше информации указано о проекте, тем точнее рекомендации и оценка соответствия.",
  },
  {
    id: "grants-match-details",
    category: "grants",
    question: "Как узнать, почему программа подходит проекту?",
    answer:
      "Pitchy показывает уровень соответствия, совпавшие требования и недостающие данные. Если проект не проходит по обязательному критерию, система отдельно предупреждает об этом.",
  },
  {
    id: "grants-application-requirements",
    category: "grants",
    question: "Что нужно для подачи заявки на грант?",
    answer:
      "Необходимо полностью заполнить паспорт проекта. В нём должны быть указаны сведения об идее, рынке, бизнес-модели, метриках, команде и юридическом статусе проекта.",
  },
  {
    id: "grants-auto-application",
    category: "grants",
    question: "Как происходит автоматическая подача заявки?",
    answer:
      "Pitchy использует данные паспорта, адаптирует их под требования выбранного гранта, формирует необходимые разделы и автоматически подаёт готовую заявку.",
  },
  {
    id: "grants-deadlines",
    category: "grants",
    question: "Показывает ли Pitchy актуальные сроки и условия?",
    answer:
      "Да. В каталоге отображаются программы с открытым приёмом, требования и ближайшие дедлайны. В карточке каждой возможности также доступна ссылка на первоисточник.",
  },
  {
    id: "grants-tracking",
    category: "grants",
    question: "Можно ли отслеживать поданные заявки?",
    answer:
      "Да. В разделе «Мои гранты» можно следить за этапами и статусами заявок, контролировать требования и видеть, какие действия необходимо выполнить дальше.",
  },
];

function FAQItem({ question, answer }: Pick<FAQ, "question" | "answer">) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className={`lovable-glass rounded-3xl overflow-hidden transition-all duration-500 ${
        isOpen ? "border-white/20" : "hover:border-white/10"
      }`}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-6 sm:p-8 text-left cursor-pointer group"
      >
        <span className="font-display text-lg sm:text-xl text-white group-hover:text-white/80 transition-colors pr-6 tracking-tight">
          {question}
        </span>
        <div
          className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center border border-white/10 transition-all duration-500 ${
            isOpen
              ? "bg-white text-black rotate-180"
              : "bg-white/5 text-white"
          }`}
        >
          {isOpen ? <Minus size={18} /> : <Plus size={18} />}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="px-6 pb-6 sm:px-8 sm:pb-8">
              <div className="pt-6 sm:pt-8 border-t border-white/5 text-foreground/50 font-body-sm leading-relaxed text-[15px] sm:text-[16px] max-w-3xl">
                {answer}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FAQPage() {
  const [activeCategory, setActiveCategory] = useState<CategoryId | null>(null);

  const visibleFaqs = activeCategory
    ? faqs.filter((faq) => faq.category === activeCategory)
    : faqs.filter((faq) => faq.featured);

  const activeCategoryData = categories.find(
    (category) => category.id === activeCategory,
  );

  const handleCategoryClick = (categoryId: CategoryId) => {
    setActiveCategory((current) =>
      current === categoryId ? null : categoryId,
    );
  };

  return (
    <div className="bg-black text-foreground antialiased min-h-screen flex flex-col relative overflow-hidden">
      <div className="aurora-orb top-[-10rem] right-[-10rem] h-96 w-96 bg-white/[0.03] animate-pulse" />
      <div className="aurora-orb bottom-[10rem] left-[-10rem] h-80 w-80 bg-white/[0.02] animate-float-slow" />

      <TopNavBar />

      <main className="flex-grow pt-12 pb-24 px-6 md:px-12 max-w-[1440px] mx-auto w-full relative z-10">
        <div className="max-w-5xl mx-auto py-8">
          <section className="mb-16 sm:mb-24">
            <h1 className="font-display text-5xl sm:text-6xl md:text-8xl text-white mb-8 tracking-tighter leading-none">
              Часто задаваемые{" "}
              <span className="text-white/30 italic">вопросы</span>.
            </h1>
            <p className="text-foreground/60 font-body-lg text-lg sm:text-xl max-w-2xl mb-12 sm:mb-16 leading-relaxed">
              Ответы о возможностях <PitchyLogo size="none" />, работе с
              проектом, глубоком кастдеве и подборе мер поддержки.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mb-5">
              {categories.map((category) => {
                const isActive = activeCategory === category.id;
                const questionCount = faqs.filter(
                  (faq) => faq.category === category.id,
                ).length;

                return (
                  <button
                    type="button"
                    key={category.id}
                    aria-pressed={isActive}
                    onClick={() => handleCategoryClick(category.id)}
                    className={`lovable-glass p-6 sm:p-8 rounded-3xl transition-all duration-500 text-left group ${
                      isActive
                        ? "border-white/30 bg-white/[0.08] -translate-y-1"
                        : "hover:-translate-y-1"
                    }`}
                  >
                    <div
                      className={`w-12 h-12 rounded-2xl border border-white/10 flex items-center justify-center mb-8 sm:mb-10 transition-all duration-500 ${
                        isActive
                          ? "bg-white text-black"
                          : "bg-white/5 group-hover:bg-white group-hover:text-black"
                      }`}
                    >
                      <category.icon size={20} />
                    </div>
                    <div>
                      <span className="font-mono-label text-[11px] sm:text-[12px] leading-relaxed text-white block mb-2 uppercase tracking-[0.16em]">
                        {category.label}
                      </span>
                      <span className="text-[10px] text-white/30 uppercase tracking-[0.25em]">
                        {questionCount} вопросов
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-white/30 text-xs font-light">
              Выберите тему, чтобы увидеть все вопросы раздела. Нажмите на неё
              повторно, чтобы вернуться к главным вопросам.
            </p>
          </section>

          <section className="space-y-6" aria-live="polite">
            <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-6 mb-12">
              <h2 className="font-mono-label text-[12px] text-white/40 tracking-[0.3em] uppercase">
                {activeCategoryData
                  ? activeCategoryData.shortLabel
                  : "Главные вопросы"}
              </h2>
              <span className="text-white/20 text-[10px] font-mono tracking-widest whitespace-nowrap">
                {visibleFaqs.length} вопросов
              </span>
            </div>

            <motion.div layout className="grid grid-cols-1 gap-4">
              <AnimatePresence mode="popLayout" initial={false}>
                {visibleFaqs.map((faq) => (
                  <motion.div
                    layout
                    key={faq.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                  >
                    <FAQItem question={faq.question} answer={faq.answer} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          </section>

          <section className="mt-16 border-t border-white/5 py-10 sm:mt-24 sm:py-14">
            <div className="lovable-glass grid grid-cols-1 items-center gap-8 rounded-3xl p-6 sm:rounded-[40px] sm:px-10 sm:py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:px-12">
              <div className="min-w-0 max-w-[760px] text-center lg:text-left">
                <h3 className="text-white font-display tracking-tight text-3xl sm:text-4xl mb-3 sm:mb-4">
                  Остались вопросы?
                </h3>
                <p className="text-foreground/40 font-body-sm text-[14px] sm:text-[15px] leading-relaxed">
                  Напишите нам — поможем разобраться в возможностях Pitchy и
                  подобрать подходящий сценарий работы.
                </p>
              </div>
              <a
                href="mailto:support@pitchy.pro"
                className="w-full bg-white text-black px-6 sm:px-10 py-3 sm:py-4 rounded-full font-mono-label text-[11px] uppercase tracking-[0.2em] font-black hover:scale-105 transition-all text-center whitespace-nowrap sm:w-auto lg:justify-self-end"
              >
                Связаться с нами
              </a>
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
