"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight, Users, FileText, MessageSquare, Map,
  Briefcase, BarChart3, UserCheck, Megaphone, Landmark, Rocket, GraduationCap, CheckCircle2, Sparkles, IdCard
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
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

type PersonaReaction = {
  icon: LucideIcon;
  role: string;
  graphLabel: string;
  sentiment: string;
  tone: string;
  quotes: string[];
};

type ActivePersonaReaction = PersonaReaction & {
  quote: string;
};

const personaReactions: PersonaReaction[] = [
  {
    icon: Megaphone,
    role: "Маркетолог",
    graphLabel: "Маркетолог",
    sentiment: "Фокус",
    tone: "border-white/20 text-white/70",
    quotes: [
      "Оффер цепляет, но сообщение расплывается. Я бы вынес один конкретный результат в первый экран и проверил три креатива на разных сегментах.",
      "В коммуникации есть сильная боль, но не хватает языка аудитории. Добавьте формулировки из реальных интервью и уберите общие обещания.",
      "Каналы продвижения выглядят слишком широкими. Сначала выберите один сегмент, один триггер покупки и один измеримый CTA.",
    ],
  },
  {
    icon: Landmark,
    role: "Финансист",
    graphLabel: "Финансист",
    sentiment: "Расчёт",
    tone: "border-white/10 text-white/40",
    quotes: [
      "Экономика сходится только при низкой стоимости привлечения. Нужны сценарии по марже, возвратам и точке безубыточности до масштабирования.",
      "План выручки оптимистичный: CAC растёт быстрее среднего чека. Я бы пересчитал модель через консервативный сценарий и лимит burn rate.",
      "Подписка может работать, если удержание выше второго месяца. Без cohort-анализа сейчас сложно понять реальную окупаемость.",
    ],
  },
  {
    icon: Briefcase,
    role: "Инвестор",
    graphLabel: "Инвестор",
    sentiment: "Скепсис",
    tone: "border-white/10 text-white/40",
    quotes: [
      "Рынок большой, но где защита от копирования? Покажите retention за три месяца — тогда поверю в юнит-экономику.",
      "Мне нравится скорость команды, но пока не вижу moat. Докажите, что данные и процесс улучшаются с каждым новым клиентом.",
      "Питч звучит убедительно, но нужен фокус: кто покупает первым, почему сейчас и какой сигнал покажет готовность к раунду.",
    ],
  },
  {
    icon: BarChart3,
    role: "Аналитик",
    graphLabel: "Аналитик",
    sentiment: "Нейтрально",
    tone: "border-white/20 text-white/70",
    quotes: [
      "Спрос подтверждается: три из пяти сегментов реагируют на оффер. В B2B цена выглядит завышенной.",
      "Данные говорят, что проблема частая, но платёжная готовность неоднородная. Нужен разрез по размеру команды и срочности задачи.",
      "Сравнение конкурентов неполное: у двух игроков слабее UX, но сильнее дистрибуция. Это стоит учесть в go-to-market.",
    ],
  },
  {
    icon: GraduationCap,
    role: "Акселератор вуза",
    graphLabel: "Акселератор",
    sentiment: "Отбор",
    tone: "border-white/20 text-white/70",
    quotes: [
      "Команда выглядит сильной, но заявка пока слишком продуктовая. Добавьте научно-технологическую новизну и понятный план пилота с кафедрой.",
      "Для акселератора важно показать образовательный эффект: кто из студентов вовлечён, какие компетенции растут и что можно масштабировать.",
      "Проект проходит по тематике, если усилить исследовательскую часть. Нужны гипотеза, методика проверки и измеримый результат пилота.",
    ],
  },
  {
    icon: Users,
    role: "Пользователь №1",
    graphLabel: "Пользователь №1",
    sentiment: "Боль",
    tone: "border-white/10 text-white/40",
    quotes: [
      "Не понял ценность за первые тридцать секунд. Онбординг перегружен — я бы закрыл вкладку.",
      "Мне нужно быстрее увидеть результат. Сейчас слишком много объяснений до первого полезного действия.",
      "Если сервис сам подскажет следующий шаг, я останусь. Но вручную разбираться в логике продукта не хочется.",
    ],
  },
  {
    icon: UserCheck,
    role: "Пользователь №2",
    graphLabel: "Пользователь №2",
    sentiment: "Восторг",
    tone: "bg-white text-black border-white",
    quotes: [
      "Именно это я искал. Готов платить уже сейчас, если добавите интеграцию с таблицами.",
      "Мне нравится, что результат можно показать команде сразу. Добавьте экспорт в PDF — и это станет рабочим инструментом.",
      "Ценность понятна после первого примера. Я бы хотел шаблоны под разные типы проектов, чтобы стартовать быстрее.",
    ],
  },
  {
    icon: Users,
    role: "Пользователь Саша",
    graphLabel: "Саша",
    sentiment: "Боль",
    tone: "border-white/10 text-white/40",
    quotes: [
      "Я быстро понял проблему, но не увидел, чем это лучше моего текущего процесса. Дайте пример результата за минуту — тогда останусь.",
      "Сервис выглядит полезным, но мне страшно доверять весь проект ИИ. Покажите, где я могу проверить источники и выводы.",
      "Если вы сократите первый сценарий до трёх шагов, я попробую. Сейчас ощущение, что надо заранее всё подготовить.",
    ],
  },
  {
    icon: UserCheck,
    role: "Пользователь Егор",
    graphLabel: "Егор",
    sentiment: "Восторг",
    tone: "bg-white text-black border-white",
    quotes: [
      "Именно это я искал. Готов платить уже сейчас, если добавите интеграцию с таблицами и экспорт короткого отчёта для команды.",
      "Главная ценность — быстро понять, где идея слабая. Я бы использовал это перед каждой встречей с ментором.",
      "Если можно сохранять версии гипотез, продукт станет частью еженедельной работы, а не разовой проверки.",
    ],
  },
  {
    icon: BarChart3,
    role: "Пользователь Руслан",
    graphLabel: "Руслан",
    sentiment: "Проверка",
    tone: "border-white/20 text-white/70",
    quotes: [
      "Идея сильная, но мне нужны доказательства на моём сегменте. Покажите сравнение с конкурентами и источники по рынку.",
      "Я бы не платил до тестового отчёта. Если первый вывод окажется точным, дальше готов обсуждать подписку.",
      "Хорошо, что есть критика идеи. Но мне важно видеть не только проблемы, а приоритеты: что исправлять первым.",
    ],
  },
  {
    icon: MessageSquare,
    role: "Пользователь Вероника",
    graphLabel: "Вероника",
    sentiment: "Ясность",
    tone: "border-white/20 text-white/70",
    quotes: [
      "Текст стал понятнее, когда появились конкретные сценарии. Я бы добавила больше человеческого языка и меньше терминов в онбординг.",
      "Мне важна уверенность, что я не упущу важный пункт. Хорошо бы видеть чеклист после каждого анализа.",
      "В интерфейсе хочется больше подсказок по контексту. Не обучающих текстов, а коротких вопросов в нужный момент.",
    ],
  },
  {
    icon: Rocket,
    role: "Пользователь Слава",
    graphLabel: "Слава",
    sentiment: "Скорость",
    tone: "bg-white text-black border-white",
    quotes: [
      "Мне нравится, что можно быстро собрать первую гипотезу и сразу увидеть слабые места. Главное — не перегрузить интерфейс настройками.",
      "Я бы использовал продукт как быстрый стресс-тест перед запуском рекламы. Нужен режим короткого отчёта на одну страницу.",
      "Скорость впечатляет. Если ответы будут сохранять историю решений, команда перестанет спорить по кругу.",
    ],
  },
  {
    icon: FileText,
    role: "Пользователь Полина",
    graphLabel: "Полина",
    sentiment: "Доверие",
    tone: "border-white/10 text-white/40",
    quotes: [
      "Я бы попробовала сервис, если увижу прозрачные источники и примеры готовых документов. Без этого сложно доверять рекомендациям ИИ.",
      "Мне нужен аккуратный результат, который не стыдно отправить партнёру. Черновик должен быть ближе к финальному документу.",
      "Если сервис объясняет, почему предлагает именно такие шаги, доверия становится больше. Просто список советов не убедит.",
    ],
  },
  {
    icon: Briefcase,
    role: "Основатель",
    graphLabel: "Основатель",
    sentiment: "Приоритет",
    tone: "bg-white text-black border-white",
    quotes: [
      "Мне нужен не красивый отчёт, а решение, что делать завтра. Хорошо, если система сразу ранжирует гипотезы по влиянию.",
      "Продукт экономит время, если снимает неопределённость перед встречами. Добавьте режим подготовки к питчу и список слабых мест.",
      "Я готов платить за скорость принятия решений. Но хочу видеть, какие выводы основаны на данных, а какие являются предположениями.",
    ],
  },
  {
    icon: Landmark,
    role: "Грантовый эксперт",
    graphLabel: "Грантовый эксперт",
    sentiment: "Форма",
    tone: "border-white/20 text-white/70",
    quotes: [
      "Проект можно упаковать под грант, но сейчас не хватает общественной значимости и измеримых результатов для комиссии.",
      "Формулировки должны звучать языком конкурса. Добавьте цели, KPI и календарный план без маркетинговых обещаний.",
      "Сильная часть — команда и рынок. Слабая — обоснование бюджета: каждая статья должна быть связана с результатом.",
    ],
  },
  {
    icon: BarChart3,
    role: "Продакт-менеджер",
    graphLabel: "Продакт",
    sentiment: "MVP",
    tone: "border-white/20 text-white/70",
    quotes: [
      "MVP стоит сузить до одного повторяемого сценария. Сейчас продукт пытается закрыть слишком много задач одновременно.",
      "Хорошая гипотеза для первой версии — отчёт за десять минут. Всё, что не ведёт к этому результату, можно убрать.",
      "Нужны события аналитики: активация, возврат к отчёту, экспорт и повторная проверка идеи. Без этого не поймём ценность.",
    ],
  },
  {
    icon: MessageSquare,
    role: "UX-исследователь",
    graphLabel: "UX-исследователь",
    sentiment: "Инсайт",
    tone: "border-white/20 text-white/70",
    quotes: [
      "Пользователь хочет не анализ, а уверенность. В интерфейсе стоит показать прогресс от сырой идеи к понятному плану.",
      "Первое впечатление перегружено терминами. Лучше начать с вопроса о цели пользователя, а не со списка возможностей.",
      "Самый сильный момент — когда система спорит с идеей. Это надо подать как пользу, а не как ошибку пользователя.",
    ],
  },
  {
    icon: UserCheck,
    role: "B2B-клиент",
    graphLabel: "B2B-клиент",
    sentiment: "Закупка",
    tone: "border-white/10 text-white/40",
    quotes: [
      "Для компании важны права доступа, история изменений и экспорт. Без этого сервис останется личным инструментом.",
      "Цена приемлема, если отчёты экономят часы аналитика. Нужны примеры внедрения и понятный SLA.",
      "Я бы купил пилот на команду, но сначала хочу увидеть безопасность данных и возможность выгрузить результат в наши шаблоны.",
    ],
  },
  {
    icon: Rocket,
    role: "Ментор стартапов",
    graphLabel: "Ментор",
    sentiment: "Рывок",
    tone: "bg-white text-black border-white",
    quotes: [
      "Инструмент полезен, если основатель приходит на встречу уже с гипотезами и цифрами. Тогда менторство становится предметным.",
      "Сильный эффект будет в подготовке к демо-дню: сервис быстро вытаскивает слабые аргументы из презентации.",
      "Я бы рекомендовал продукт командам на ранней стадии, если он помогает формулировать не только идею, но и следующий эксперимент.",
    ],
  },
  {
    icon: FileText,
    role: "Юрист",
    graphLabel: "Юрист",
    sentiment: "Риски",
    tone: "border-white/10 text-white/40",
    quotes: [
      "Проверьте пользовательские данные, договоры и права на контент. Если продукт работает с ИИ, юридическая рамка нужна сразу.",
      "В питче не хватает блока про риски регулирования. Инвестор всё равно спросит, лучше подготовить ответ заранее.",
      "Если сервис генерирует документы, важно явно разделить рекомендацию и юридически значимое решение.",
    ],
  },
  {
    icon: Megaphone,
    role: "PR-специалист",
    graphLabel: "PR",
    sentiment: "Позиция",
    tone: "border-white/20 text-white/70",
    quotes: [
      "История проекта есть, но её нужно упростить. Медиа зацепит конкретный конфликт: почему стартапам больно запускаться сейчас.",
      "Лучший инфоповод — кейс команды, которая изменила идею после анализа и сэкономила бюджет на запуск.",
      "Тон коммуникации должен быть уверенным, но не магическим. Обещайте ясность и скорость, а не замену предпринимателю.",
    ],
  },
  {
    icon: Landmark,
    role: "Корпоративный партнёр",
    graphLabel: "Партнёр",
    sentiment: "Пилот",
    tone: "border-white/20 text-white/70",
    quotes: [
      "Для пилота нужен понятный периметр: команда, сроки, метрики успеха и ответственный с обеих сторон.",
      "Нам интересно, если продукт ускоряет внутренние инновации. Покажите, как он фильтрует идеи до траты бюджета.",
      "Решение может зайти в корпоративный акселератор, если есть контроль качества выводов и отчётность для руководителя.",
    ],
  },
  {
    icon: Users,
    role: "Студент-предприниматель",
    graphLabel: "Студент",
    sentiment: "Старт",
    tone: "bg-white text-black border-white",
    quotes: [
      "Мне нужен простой маршрут: идея, проверка, презентация, грант. Если это в одном месте, я быстрее начну действовать.",
      "Сервис снижает страх первого шага. Главное, чтобы он не говорил сложным языком и показывал примеры похожих проектов.",
      "Я бы пользовался перед хакатоном: быстро проверить идею, собрать аргументы и понять, где команда ошибается.",
    ],
  },
];

const initialPersonaIndexes = [2, 3, 5, 6];

const namedAgentPositions = [
  { x: 70, y: 82, labelY: 64 },
  { x: 330, y: 98, labelY: 80 },
  { x: 58, y: 300, labelY: 324 },
  { x: 342, y: 300, labelY: 324 },
];

const backgroundAgents = [
  { x: 150, y: 44 },
  { x: 364, y: 198 },
  { x: 40, y: 188 },
  { x: 250, y: 358 },
];

const grantProjectSignals = [
  { label: "Стадия", value: "MVP" },
  { label: "Отрасль", value: "EdTech" },
  { label: "Регион", value: "Москва" },
  { label: "Цель", value: "Разработка" },
];

const grantMatches = [
  { title: "Грант на развитие IT", value: "92%", amount: "до 5 млн ₽", deadline: "12 дней" },
  { title: "Субсидия для МСП", value: "84%", amount: "до 2 млн ₽", deadline: "21 день" },
  { title: "Акселератор с финансированием", value: "76%", amount: "пилот + грант", deadline: "34 дня" },
];

const grantApplicationFields = [
  "Описание проекта",
  "Цель финансирования",
  "План работ",
  "Бюджет заявки",
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

const PersonaReactionCard = ({ persona, index }: { persona: ActivePersonaReaction; index: number }) => {
  const Icon = persona.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.08 }}
      viewport={{ once: true }}
      className="lovable-glass lovable-liquid-outline rounded-2xl sm:rounded-[1.5rem] p-5 sm:p-6 border-white/5 shadow-[0_0_40px_-10px_rgba(255,255,255,0.05)] bg-black/40 flex min-h-[220px] flex-col overflow-hidden"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={persona.role}
          initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -16, filter: "blur(6px)" }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="flex h-full flex-col"
        >
          <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <Icon className="h-4 w-4 text-white/60 shrink-0" />
              <h3 className="text-sm sm:text-base text-white font-medium leading-tight truncate">{persona.role}</h3>
            </div>
            <span className={`shrink-0 text-[9px] sm:text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border ${persona.tone}`}>
              {persona.sentiment}
            </span>
          </div>
          <p className="text-[13px] sm:text-sm text-white/50 font-light italic leading-relaxed">
            «{persona.quote}»
          </p>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
};

const GrantSupportSection = () => (
  <section className="relative section-line px-6 py-32 md:px-12 overflow-hidden">
    <div className="absolute inset-x-0 top-20 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
    <div className="mx-auto max-w-7xl grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        viewport={{ once: true, margin: "-100px" }}
      >
        <div className="font-mono text-white/50 mb-4 tracking-[0.2em] text-xs uppercase">
          МЕРЫ ПОДДЕРЖКИ
        </div>
        <h2 className="text-5xl md:text-7xl text-white leading-[1.05] mb-8" style={{ fontFamily: "'Instrument Serif', serif" }}>
          Автоматический подбор мер поддержки
        </h2>
        <p className="text-white/40 text-lg font-light leading-relaxed mb-10 max-w-2xl">
          Не тратьте недели на поиск грантов и разбор требований. Pitchy подбирает меры поддержки под ваш проект и подготавливает заявку с помощью ИИ.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            "Поиск по грантам и программам",
            "Оценка соответствия требованиям",
            "Черновик заявки под конкурс",
          ].map((item) => (
            <div key={item} className="lovable-glass rounded-2xl p-4 border-white/5 bg-black/30">
              <CheckCircle2 className="mb-3 h-4 w-4 text-white/70" />
              <p className="text-[13px] leading-relaxed text-white/45 font-light">{item}</p>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: 24, scale: 0.98 }}
        whileInView={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        viewport={{ once: true, margin: "-100px" }}
        className="lovable-glass-strong lovable-liquid-outline rounded-[2.5rem] p-5 sm:p-8 bg-black/50 shadow-[0_0_100px_-24px_rgba(255,255,255,0.18)] overflow-hidden"
      >
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <div className="text-sm font-semibold text-white">Навигатор мер поддержки</div>
            <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">live matching</div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-white/60">ИИ ищет</span>
          </div>
        </div>

        <div className="space-y-5">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
            className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#0A0A0A] p-5"
          >
            <motion.div
              className="absolute inset-y-0 w-28 bg-gradient-to-r from-transparent via-white/20 to-transparent blur-sm"
              animate={{ x: ["-140%", "520%"] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.6 }}
            />
            <div className="relative flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35 mb-2">Проект</div>
                <h3 className="text-xl text-white font-medium leading-tight">EdTech-платформа для студентов</h3>
              </div>
              <Sparkles className="h-5 w-5 text-white/50 shrink-0" />
            </div>
            <div className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {grantProjectSignals.map((signal, index) => (
                <motion.div
                  key={signal.label}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.15 + index * 0.08 }}
                  viewport={{ once: true }}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                >
                  <div className="text-[10px] font-mono uppercase tracking-wider text-white/30">{signal.label}</div>
                  <div className="mt-1 text-sm text-white/75">{signal.value}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <div className="grid gap-3">
            {grantMatches.map((match, index) => (
              <motion.div
                key={match.title}
                initial={{ opacity: 0, x: -18 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, delay: 0.45 + index * 0.15 }}
                viewport={{ once: true }}
                className={`rounded-2xl border p-4 transition-all ${index === 0 ? "border-white/25 bg-white/[0.08] shadow-[0_0_36px_-18px_rgba(255,255,255,0.6)]" : "border-white/10 bg-white/[0.035]"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-tight">{match.title}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-mono text-white/35">
                      <span>{match.amount}</span>
                      <span>·</span>
                      <span>дедлайн: {match.deadline}</span>
                    </div>
                  </div>
                  <div className="rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[11px] font-mono text-white/70">
                    Подходит на {match.value}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.65, delay: 0.95, ease: "easeOut" }}
            viewport={{ once: true }}
            className="rounded-[1.75rem] border border-white/15 bg-white/[0.07] p-5 overflow-hidden"
          >
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Заявка</div>
                <div className="mt-1 text-base font-medium text-white">Грант на развитие IT</div>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-black">
                готовится
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {grantApplicationFields.map((field, index) => (
                <div key={field} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="mb-3 text-[11px] text-white/55">{field}</div>
                  <motion.div
                    initial={{ width: "18%" }}
                    whileInView={{ width: index === 3 ? "58%" : "86%" }}
                    transition={{ duration: 0.9, delay: 1.15 + index * 0.12, ease: "easeOut" }}
                    viewport={{ once: true }}
                    className="h-2 rounded-full bg-white/70"
                  />
                  <motion.div
                    initial={{ width: "8%" }}
                    whileInView={{ width: index === 1 ? "72%" : "46%" }}
                    transition={{ duration: 0.75, delay: 1.3 + index * 0.12, ease: "easeOut" }}
                    viewport={{ once: true }}
                    className="mt-2 h-2 rounded-full bg-white/20"
                  />
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  </section>
);

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const ctaHref = isAuthenticated ? "/dashboard" : "/signup";
  const [rotation, setRotation] = useState({
    step: 0,
    indexes: initialPersonaIndexes,
    quoteIndexes: initialPersonaIndexes.map(() => 0),
  });
  const activePersonas = rotation.indexes.map((personaIndex, index) => {
    const persona = personaReactions[personaIndex];
    const quoteIndex = rotation.quoteIndexes[index] % persona.quotes.length;

    return {
      ...persona,
      quote: persona.quotes[quoteIndex],
    };
  });
  const namedAgents = activePersonas.map((persona, index) => ({
    ...namedAgentPositions[index],
    label: persona.graphLabel,
  }));
  const graphKey = namedAgents.map((agent) => agent.label).join("|");

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRotation(({ step, indexes, quoteIndexes }) => {
        const slot = step % initialPersonaIndexes.length;
        const nextPersonaIndex = step % personaReactions.length;
        const nextPersona = personaReactions[nextPersonaIndex];
        const nextIndexes = [...indexes];
        const nextQuoteIndexes = [...quoteIndexes];
        nextIndexes[slot] = nextPersonaIndex;
        nextQuoteIndexes[slot] = Math.floor(step / personaReactions.length) % nextPersona.quotes.length;

        return {
          step: step + 1,
          indexes: nextIndexes,
          quoteIndexes: nextQuoteIndexes,
        };
      });
    }, 7000);

    return () => window.clearInterval(interval);
  }, []);

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

            {/* Project Passport — unified context hub */}
            <div className="relative mt-4 sm:mt-6">
              {/* Converging connectors with flowing signals (desktop only) */}
              <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-[220px] lg:block" aria-hidden="true">
                <svg viewBox="0 0 1000 220" preserveAspectRatio="none" className="h-full w-full">
                  {[
                    { d: "M125,0 C125,120 455,120 470,214", dur: "2.6s", begin: "0s", begin2: "-1.3s" },
                    { d: "M375,0 C375,132 492,150 492,214", dur: "2.9s", begin: "0.6s", begin2: "-0.85s" },
                    { d: "M625,0 C625,132 508,150 508,214", dur: "3.1s", begin: "1s", begin2: "-0.55s" },
                    { d: "M875,0 C875,120 545,120 530,214", dur: "2.7s", begin: "0.3s", begin2: "-1.05s" },
                  ].map((c, i) => (
                    <g key={`pp-conn-${i}`}>
                      <motion.path
                        d={c.d}
                        fill="none"
                        stroke="rgba(255,255,255,0.16)"
                        strokeWidth={1}
                        initial={{ pathLength: 0, opacity: 0 }}
                        whileInView={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 1, delay: 0.3 + i * 0.12, ease: "easeInOut" }}
                        viewport={{ once: true }}
                      />
                      <g className="passport-signal">
                        {[c.begin, c.begin2].map((b, k) => (
                          <g key={`pp-ball-${i}-${k}`}>
                            <circle r={6} fill="rgba(255,255,255,0.12)">
                              <animateMotion dur={c.dur} begin={b} repeatCount="indefinite" path={c.d} />
                              <animate attributeName="opacity" values="0;0.5;0.5;0" keyTimes="0;0.15;0.8;1" dur={c.dur} begin={b} repeatCount="indefinite" />
                            </circle>
                            <circle r={2.5} fill="rgba(255,255,255,0.92)">
                              <animateMotion dur={c.dur} begin={b} repeatCount="indefinite" path={c.d} />
                              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.85;1" dur={c.dur} begin={b} repeatCount="indefinite" />
                            </circle>
                          </g>
                        ))}
                      </g>
                    </g>
                  ))}
                </svg>
              </div>

              <div className="relative lg:pt-[200px]">
                <motion.div
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                  viewport={{ once: true }}
                  className="w-full"
                >
                  <div className="lovable-glass-strong lovable-liquid-outline relative overflow-hidden rounded-[2rem] sm:rounded-[2.5rem] bg-black/40 p-8 text-center shadow-[0_0_100px_-24px_rgba(255,255,255,0.18)] sm:p-10">
                    <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
                      <IdCard className="h-6 w-6 text-white/80" />
                    </div>
                    <div className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-white/50">Единый контекст</div>
                    <h3 className="mb-4 text-3xl text-white sm:text-4xl" style={{ fontFamily: "'Instrument Serif', serif" }}>
                      Паспорт проекта
                    </h3>
                    <p className="text-sm font-light leading-relaxed text-white/45 sm:text-base">
                      Всё, что вы делаете в Pitchy — чат, кастдев, гранты и дорожная карта — стекается в единый паспорт проекта. Контекст переносится между функциями автоматически: каждая функция знает всё о проекте, и вам не нужно объяснять заново.
                    </p>
                  </div>
                </motion.div>
              </div>
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
                Интеллект в каждом действии
              </h2>
              <p className="text-white/40 text-lg font-light leading-relaxed mb-10">
                Команда ИИ-агентов не просто отвечает на вопросы, а анализирует контекст проекта, подбирает релевантные гранты и помогает структурировать юридические аспекты.
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

        <GrantSupportSection />

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
                {activePersonas.map((persona, index) => (
                  <PersonaReactionCard key={`persona-slot-${index}`} persona={persona} index={index} />
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
                  <g key={`named-edges-${graphKey}`}>
                    {namedAgents.map((a, i) => (
                      <motion.line
                        key={`edge-${i}-${a.label}`}
                        x1={a.x}
                        y1={a.y}
                        x2={200}
                        y2={200}
                        stroke="rgba(255,255,255,0.18)"
                        strokeWidth={1}
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 0.55, delay: 0.45 + i * 0.04, ease: "easeInOut" }}
                      />
                    ))}
                  </g>

                  {backgroundAgents.map((a, i) => (
                    <motion.line
                      key={`background-edge-${i}`}
                      x1={a.x}
                      y1={a.y}
                      x2={200}
                      y2={200}
                      stroke="rgba(255,255,255,0.18)"
                      strokeWidth={1}
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 1, delay: 0.6 + i * 0.1 }}
                      viewport={{ once: true }}
                    />
                  ))}

                  {/* signal dots flowing agent -> product */}
                  <g key={`named-signals-${graphKey}`}>
                    {namedAgents.map((a, i) => (
                      <motion.circle
                        key={`signal-${i}-${a.label}`}
                        r={2.5}
                        fill="rgba(255,255,255,0.9)"
                        initial={{ cx: a.x, cy: a.y, opacity: 0 }}
                        animate={{ cx: [a.x, 200], cy: [a.y, 200], opacity: [0, 1, 0] }}
                        transition={{ duration: 2.4, repeat: Infinity, delay: 0.45 + i * 0.45, ease: "easeInOut" }}
                      />
                    ))}
                  </g>

                  {/* agent nodes */}
                  <g key={`named-nodes-${graphKey}`}>
                    {namedAgents.map((a, i) => (
                      <motion.circle
                        key={`node-${i}-${a.label}`}
                        cx={a.x}
                        cy={a.y}
                        fill="rgba(255,255,255,0.85)"
                        stroke="rgba(255,255,255,0.4)"
                        strokeWidth={1}
                        initial={{ r: 0 }}
                        animate={{ r: 7 }}
                        transition={{ duration: 0.35, delay: i * 0.04 }}
                      />
                    ))}
                  </g>

                  {backgroundAgents.map((a, i) => (
                    <motion.circle
                      key={`background-node-${i}`}
                      cx={a.x}
                      cy={a.y}
                      fill="rgba(255,255,255,0.25)"
                      stroke="rgba(255,255,255,0.4)"
                      strokeWidth={1}
                      initial={{ r: 0 }}
                      whileInView={{ r: 4.5 }}
                      transition={{ duration: 0.5, delay: 0.7 + i * 0.1 }}
                      viewport={{ once: true }}
                    />
                  ))}

                  {/* labels for named agents */}
                  <motion.g
                    key={`named-labels-${graphKey}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.35, delay: 0.45, ease: "easeOut" }}
                  >
                    {namedAgents.map((a) => (
                      <text
                        key={`label-${a.label}`}
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
                  </motion.g>

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
