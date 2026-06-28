"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Banknote, Calendar, Sparkles, Loader, MapPin,
  Clock, ArrowUpRight, FolderOpen, FileText, Rocket, ArrowRight,
} from "lucide-react";
import { getToken } from "@/lib/auth";
import { notifyError } from "@/lib/ui";
import {
  getProjects, getGrants, matchGrants, onboardProject,
  type ProjectListItem, type Grant, type GrantMatch,
} from "@/lib/api";

const EASE = [0.16, 1, 0.3, 1] as const;

function formatAmount(min: number | null, max: number | null): string | null {
  const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
  if (min != null && max != null) {
    if (min === max) return `${fmt(min)} ₽`;
    return `${fmt(min)} – ${fmt(max)} ₽`;
  }
  if (max != null) return `до ${fmt(max)} ₽`;
  if (min != null) return `от ${fmt(min)} ₽`;
  return null;
}

function formatDate(s: string | null): string | null {
  if (!s) return null;
  try {
    return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return s;
  }
}

function daysLeft(s: string | null): number | null {
  if (!s) return null;
  const d = new Date(s).getTime() - Date.now();
  return Math.ceil(d / (1000 * 60 * 60 * 24));
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-white/40";
}

const STATUS_META: Record<Grant["status"], { label: string; cls: string }> = {
  open: { label: "Приём открыт", cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20" },
  upcoming: { label: "Скоро приём", cls: "text-sky-300 bg-sky-500/10 border-sky-500/20" },
  closed: { label: "Завершён", cls: "text-white/40 bg-white/5 border-white/10" },
};

/** Маленький favicon (Google S2) — не показываем крупно, используем монограмму. */
function isFavicon(src: string | null): boolean {
  return !!src && src.includes("google.com/s2/favicons");
}
/** Обложка с CDN Tilda (запарсенные программы) — цветная картинка-превью. */
function isCoverImage(src: string | null): boolean {
  return !!src && src.includes("tildacdn.com");
}

// Палитра монограмм по категории — чтобы у программ без картинки всё равно был
// узнаваемый цветной значок (логотип есть «у всех», без дыр в сетке).
const CATEGORY_BADGE: Record<string, string> = {
  grant: "from-emerald-500/30 to-emerald-500/5 text-emerald-200",
  contest: "from-amber-500/30 to-amber-500/5 text-amber-200",
  accelerator: "from-violet-500/30 to-violet-500/5 text-violet-200",
  event: "from-sky-500/30 to-sky-500/5 text-sky-200",
  pitch: "from-rose-500/30 to-rose-500/5 text-rose-200",
  investor: "from-cyan-500/30 to-cyan-500/5 text-cyan-200",
  support_measure: "from-teal-500/30 to-teal-500/5 text-teal-200",
};

// Категории, на которые подаётся заявка (грант/акселератор/мера поддержки):
// у них показываем «соответствие» проекту, требования и блок работы с заявкой.
// Остальные (конкурсы/мероприятия/питчи/инвесторы) — только информация.
const APPLYABLE_CATEGORIES = new Set(["grant", "accelerator", "support_measure"]);

// Вкладки каталога по категориям программ. Порядок = порядок вкладок.
const CATEGORY_TABS: { key: string; label: string }[] = [
  { key: "grant", label: "Гранты" },
  { key: "support_measure", label: "Меры поддержки" },
  { key: "contest", label: "Конкурсы" },
  { key: "accelerator", label: "Акселераторы" },
  { key: "event", label: "Мероприятия" },
  { key: "pitch", label: "Питчи" },
  { key: "investor", label: "Инвесторы" },
];

/** Значок программы. Грамотная стратегия «лого у всех»:
 *  1) обложка Tilda (запарсенные) — цветная картинка-превью;
 *  2) настоящий лого организации (прозрачный) — белым силуэтом на тёмном фоне;
 *  3) иначе (favicon/пусто) — цветная монограмма по категории.
 *  Так в сетке нет пустых/битых логотипов. */
function OrgLogo({ grant, size = 52 }: { grant: Grant; size?: number }) {
  const [errored, setErrored] = useState(false);
  const logo = grant.logo_url && !errored ? grant.logo_url : null;

  if (logo && isCoverImage(logo)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt={grant.name}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setErrored(true)}
        style={{ width: size, height: size }}
        className="block object-cover rounded-2xl shrink-0 border border-white/10"
      />
    );
  }

  if (logo && !isFavicon(logo)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt={grant.organization || grant.name}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setErrored(true)}
        style={{ height: size, width: "auto", maxWidth: size * 2.35, filter: "brightness(0) invert(1)" }}
        className="block object-contain object-left shrink-0"
      />
    );
  }

  // Favicon официального сайта организатора — реальная иконка «как на сайте».
  // Рисуем на светлой подложке, чтобы цветные иконки читались на тёмной карточке.
  if (logo && isFavicon(logo)) {
    return (
      <div
        style={{ width: size, height: size }}
        className="shrink-0 rounded-2xl bg-white border border-white/10 flex items-center justify-center overflow-hidden p-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logo}
          alt={grant.organization || grant.name}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setErrored(true)}
          style={{ maxWidth: "100%", maxHeight: "100%" }}
          className="object-contain"
        />
      </div>
    );
  }

  const initial = (grant.organization || grant.name || "?").trim().charAt(0).toUpperCase();
  const badge = CATEGORY_BADGE[grant.category || "grant"] || CATEGORY_BADGE.grant;
  return (
    <div
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-2xl bg-gradient-to-br ${badge} border border-white/10 flex items-center justify-center font-display`}
    >
      <span style={{ fontSize: size * 0.42 }}>{initial}</span>
    </div>
  );
}

/** Карточка меры поддержки — основной строительный блок витрины грантов. */
function SupportMeasureCard({ grant, match, href }: { grant: Grant; match?: GrantMatch; href: string }) {
  const dl = daysLeft(grant.deadline);
  const amount = formatAmount(grant.amount_min, grant.amount_max);
  const st = STATUS_META[grant.status];
  const matched = (match?.reasons.matched || []).slice(0, 3);
  const missing = (match?.reasons.missing || []).slice(0, 2);
  const urgent = dl != null && dl >= 0 && dl <= 7 && grant.status !== "closed";
  const isApplyable = APPLYABLE_CATEGORIES.has(grant.category || "grant");
  const isEventLike = ["event", "pitch"].includes(grant.category || "grant");
  const showScore = isApplyable && !!match;

  return (
    <Link
      href={href}
      className="group relative flex min-w-0 flex-col h-full lovable-glass rounded-3xl border border-white/10 hover:border-white/25 hover:bg-white/[0.04] p-4 sm:p-5 transition-all overflow-hidden"
    >
      {/* Шапка: логотип + матч-балл */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <OrgLogo grant={grant} size={52} />
        {showScore ? (
          <div className={`flex flex-col items-end leading-none ${scoreColor(match!.score)}`}>
            <span className="font-mono font-bold text-xl tabular-nums">{match!.score}</span>
            <span className="text-[9px] text-white/30 uppercase tracking-[0.16em] mt-1">соответствие</span>
          </div>
        ) : isApplyable ? (
          <Banknote size={18} className="text-white/20 mt-1" />
        ) : null}
      </div>

      {/* Статус */}
      <span className={`self-start text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border mb-2.5 ${st.cls}`}>
        {isEventLike && grant.status === "open" ? "Предстоит" : st.label}
      </span>

      {/* Название + организация */}
      <h3 className="font-display text-lg text-white leading-snug line-clamp-2 break-words">{grant.name}</h3>
      {grant.organization && <p className="text-white/40 text-[13px] truncate mt-1">{grant.organization}</p>}

      {/* Описание */}
      {grant.description && (
        <p className="text-white/45 text-sm leading-relaxed line-clamp-2 mt-2.5">{grant.description}</p>
      )}

      {/* Совпадения по паспорту, либо направления гранта */}
      {isApplyable && matched.length > 0 ? (
        <div className="mt-3.5">
          <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-emerald-300/50 mb-1.5">Совпало по</p>
          <div className="flex flex-wrap gap-1.5">
            {matched.map((r) => (
              <span key={r} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300/80 border border-emerald-500/15">
                {r}
              </span>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="text-[10px] text-amber-300/60 mt-2 leading-snug">
              В паспорте не хватает: {missing.join(", ")}
            </p>
          )}
        </div>
      ) : grant.sectors.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mt-3.5">
          {grant.sectors.slice(0, 3).map((s) => (
            <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-white/50 border border-white/10">
              {s}
            </span>
          ))}
        </div>
      ) : null}

      {/* Подвал: сумма + дедлайн */}
      <div className="mt-auto flex items-end justify-between gap-3 pt-4 mt-4 border-t border-white/5 min-w-0">
        <div className="min-w-0">
          {amount ? (
            <div className="text-white font-semibold text-sm break-words">{amount}</div>
          ) : isApplyable ? (
            <div className="text-white/30 text-sm">Сумма не указана</div>
          ) : null}
          {dl != null && grant.status !== "closed" && (
            <div className={`flex items-center gap-1 text-xs mt-1 ${urgent ? "text-amber-400" : "text-white/40"}`}>
              <Clock size={11} /> {isEventLike
                ? (dl < 0 ? "завершено" : dl === 0 ? "сегодня" : formatDate(grant.deadline))
                : (dl < 0 ? "приём завершён" : dl === 0 ? "дедлайн сегодня" : `осталось ${dl} дн.`)}
            </div>
          )}
          {grant.location && (
            <div className="flex items-center gap-1 text-xs mt-1 text-white/40 min-w-0">
              <MapPin size={11} className="shrink-0" /> <span className="truncate">{grant.location}</span>
            </div>
          )}
        </div>
        <div className="shrink-0 w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-white/40 group-hover:text-black group-hover:bg-white group-hover:border-white transition-all">
          <ArrowUpRight size={16} />
        </div>
      </div>
    </Link>
  );
}

export function GrantsPageClient() {
  const [token, setTok] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [activeProject, setActiveProject] = useState<number | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [matches, setMatches] = useState<GrantMatch[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [onlyEligible, setOnlyEligible] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // Онбординг «2 минуты до матча»: описание идеи → папка с черновиком паспорта.
  const [idea, setIdea] = useState("");
  const [onboarding, setOnboarding] = useState(false);
  const [onboardSummary, setOnboardSummary] = useState<string | null>(null);

  useEffect(() => {
    const t = getToken();
    setTok(t);
    if (!t) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const [pj, gr] = await Promise.all([getProjects(t), getGrants(t)]);
        setProjects(pj);
        setGrants(gr);
        // Не выбираем проект автоматически: сначала показываем ВСЕ программы,
        // подбор под паспорт — по желанию пользователя (клик по проекту ниже).
      } catch (e) {
        console.error(e);
        notifyError("Не удалось загрузить гранты");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Автоподбор под выбранный проект.
  useEffect(() => {
    if (!token || activeProject == null) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setMatchLoading(true);
    matchGrants(activeProject, token, { onlyEligible })
      .then((m) => { if (!cancelled) setMatches(m); })
      .catch((e) => { console.error(e); if (!cancelled) notifyError("Не удалось подобрать гранты"); })
      .finally(() => { if (!cancelled) setMatchLoading(false); });
    return () => { cancelled = true; };
  }, [token, activeProject, onlyEligible]);

  const handleOnboard = async () => {
    const t = token || getToken();
    if (!t || idea.trim().length < 12 || onboarding) return;
    setOnboarding(true);
    try {
      const res = await onboardProject(idea.trim(), t);
      const p = res.project;
      const item: ProjectListItem = {
        id: p.id,
        name: p.name,
        readiness_index: p.readiness_index,
        status: p.status,
        session_count: 0,
        updated_at: p.updated_at,
      };
      setProjects([item]);
      setActiveProject(p.id); // запускает эффект автоподбора
      setOnboardSummary(res.summary || null);
      setIdea("");
    } catch (e) {
      console.error(e);
      notifyError("Не удалось разобрать идею. Попробуйте ещё раз или создайте папку вручную.");
    } finally {
      setOnboarding(false);
    }
  };

  // «Сейчас идёт приём» — открытые и ещё не прошедшие по дате (без дедлайна
  // считаем активными: постоянные программы/инвесторы).
  const openGrants = useMemo(
    () => grants.filter((g) => g.status === "open" && (daysLeft(g.deadline) ?? 0) >= 0),
    [grants],
  );
  // Календарь — только будущие дедлайны (завершённые сюда не попадают).
  const calendar = useMemo(() => {
    return grants
      .filter((g) => g.deadline && (daysLeft(g.deadline) ?? -1) >= 0)
      .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())
      .slice(0, 12);
  }, [grants]);

  const grantHref = (id: number) =>
    activeProject != null ? `/grants/${id}?project=${activeProject}` : `/grants/${id}`;

  const catOf = (g: Grant) => g.category || "grant";
  // Какие вкладки реально показывать (только непустые категории).
  const availableTabs = useMemo(() => {
    const present = new Set(grants.map(catOf));
    return CATEGORY_TABS.filter((t) => present.has(t.key));
  }, [grants]);
  // Сетка каталога/матчей, отфильтрованная активной вкладкой.
  const visibleGrants = useMemo(
    () => (activeCategory ? grants.filter((g) => catOf(g) === activeCategory) : grants),
    [grants, activeCategory],
  );
  const visibleMatches = useMemo(
    () => (activeCategory ? matches.filter((m) => catOf(m.grant) === activeCategory) : matches),
    [matches, activeCategory],
  );

  if (loading) {
    return (
      <div className="h-full bg-black flex items-center justify-center">
        <Loader className="animate-spin text-white/40" size={28} />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center">
        <h1 className="text-4xl text-white mb-4" style={{ fontFamily: "'Instrument Serif', serif" }}>
          Войдите, чтобы подбирать гранты
        </h1>
        <Link href="/login" className="bg-white text-black font-semibold text-sm px-8 py-3 rounded-full mt-4">
          Войти ›
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-8 pt-24 pb-10 relative z-10 overflow-hidden">
        <div className="flex items-center justify-end gap-4 mb-8">
          <Link href="/grants/my" className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors">
            <FileText size={16} /> Мои гранты
          </Link>
        </div>

        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <Banknote className="text-white/70" size={28} strokeWidth={1.5} />
            <h1 className="text-4xl md:text-5xl tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>
              Гранты
            </h1>
          </div>
          <p className="text-white/40 font-light max-w-2xl">
            Автоподбор грантовых программ под паспорт вашего проекта и генерация готовой заявки в один клик.
          </p>
        </div>

        {/* Выбор проекта */}
        {projects.length === 0 ? (
          <div className="lovable-glass rounded-3xl p-7 md:p-9 mb-10 border border-white/10">
            <div className="flex items-center gap-2 mb-3 text-white/40">
              <Rocket size={15} className="text-white/60" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">2 минуты до подбора</span>
            </div>
            <h2 className="font-display text-2xl text-white mb-2">Опишите идею — подберём гранты</h2>
            <p className="text-white/50 text-sm leading-relaxed mb-5 max-w-2xl">
              Расскажите в нескольких предложениях, что вы делаете: какую проблему решаете, для кого и на какой вы стадии. Мы создадим папку проекта, соберём черновик паспорта и сразу покажем подходящие программы. Все поля потом можно поправить.
            </p>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              rows={4}
              placeholder="Например: платформа для онлайн-репетиторов с ИИ-проверкой домашних заданий. Помогаем школьникам 5–9 классов, экономим время преподавателям. Есть прототип и первые 200 пользователей…"
              className="w-full bg-white/[0.03] rounded-2xl p-4 text-white text-sm border border-white/10 focus:border-white/30 outline-none resize-none placeholder:text-white/25 leading-relaxed"
            />
            <div className="flex items-center justify-between gap-4 mt-4 flex-wrap">
              <p className="text-white/30 text-xs">
                Уже есть папка? <Link href="/dashboard" className="text-white/60 hover:text-white underline underline-offset-2">Открыть дашборд</Link>
              </p>
              <button
                onClick={handleOnboard}
                disabled={onboarding || idea.trim().length < 12}
                className="bg-white text-black font-semibold text-sm px-6 py-3 rounded-full hover:bg-neutral-200 transition-all flex items-center gap-2 disabled:opacity-40"
              >
                {onboarding ? (
                  <><Loader className="animate-spin" size={16} /> Разбираем идею…</>
                ) : (
                  <><Sparkles size={16} /> Подобрать гранты</>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-1.5 text-white/40">
              <FolderOpen size={15} />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Подобрать под проект</span>
            </div>
            <p className="text-white/30 text-xs mb-3">
              {activeProject != null
                ? "Показаны программы под выбранный паспорт. Нажмите проект ещё раз, чтобы вернуться ко всем."
                : "Необязательно. Выберите проект, чтобы оценить соответствие программ его паспорту."}
            </p>
            <div className="flex flex-wrap gap-2">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActiveProject(activeProject === p.id ? null : p.id)}
                  className={`px-4 py-2.5 rounded-2xl text-sm transition-all border ${
                    activeProject === p.id
                      ? "bg-white text-black border-white font-medium"
                      : "lovable-glass text-white/60 hover:text-white border-white/10"
                  }`}
                >
                  {p.name}
                  <span className={`ml-2 text-[11px] ${activeProject === p.id ? "text-black/50" : "text-white/30"}`}>
                    {p.readiness_index}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Мгновенный разбор идеи после онбординга */}
        {onboardSummary && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="lovable-glass rounded-2xl p-6 mb-10 border border-violet-500/20"
          >
            <div className="flex items-center gap-2 mb-2.5 text-violet-300/70">
              <Sparkles size={15} />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Разбор вашей идеи</span>
            </div>
            <p className="text-white/70 text-sm leading-relaxed">{onboardSummary}</p>
            <p className="text-white/30 text-xs mt-3 flex items-center gap-1.5">
              <ArrowRight size={12} /> Черновик паспорта собран, ниже — подобранные программы. Уточните детали в паспорте проекта, чтобы повысить точность.
            </p>
          </motion.div>
        )}

        {/* Верхний блок: слева — текущие программы, справа — календарь */}
        {(openGrants.length > 0 || calendar.length > 0) && (
          <div className="grid lg:grid-cols-2 gap-6 mb-12">
            {/* Слева: сейчас идёт приём */}
            <section>
              <div className="flex items-center gap-2 mb-4 text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Сейчас идёт приём</span>
              </div>
              {openGrants.length > 0 ? (
                <div className="space-y-3">
                  {openGrants.slice(0, 5).map((g) => {
                    const dl = daysLeft(g.deadline);
                    return (
                      <Link key={g.id} href={grantHref(g.id)}
                        className="block min-w-0 lovable-glass rounded-2xl p-4 sm:p-5 border border-white/10 hover:border-white/20 transition-all group">
                        <div className="flex min-w-0 items-start gap-3">
                          <OrgLogo grant={g} size={40} />
                          <div className="min-w-0 flex-1">
                            <p className="font-display text-lg text-white leading-snug line-clamp-2 break-words group-hover:text-white">{g.name}</p>
                            {g.organization && <p className="text-white/40 text-sm truncate">{g.organization}</p>}
                          </div>
                          <ArrowUpRight className="text-white/30 group-hover:text-white shrink-0" size={18} />
                        </div>
                        <div className="flex items-center gap-3 mt-4 text-xs flex-wrap">
                          {formatAmount(g.amount_min, g.amount_max) && (
                            <span className="text-white/70 font-medium">{formatAmount(g.amount_min, g.amount_max)}</span>
                          )}
                          {dl != null && dl >= 0 && (
                            <span className={`flex items-center gap-1 ${dl <= 7 ? "text-amber-400" : "text-white/40"}`}>
                              <Clock size={12} /> {dl === 0 ? "сегодня" : `${dl} дн.`}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="lovable-glass rounded-2xl p-6 text-white/40 text-sm border border-white/10">
                  Сейчас нет программ с открытым приёмом.
                </div>
              )}
            </section>

            {/* Справа: календарь дедлайнов */}
            <section>
              <div className="flex items-center gap-2 mb-4 text-white/70">
                <Calendar size={16} />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Календарь дедлайнов</span>
              </div>
              {calendar.length > 0 ? (
                <div className="lovable-glass rounded-3xl border border-white/10 divide-y divide-white/5 overflow-hidden">
                  {calendar.map((g) => {
                    const dl = daysLeft(g.deadline);
                    return (
                      <Link key={g.id} href={grantHref(g.id)}
                        className="flex min-w-0 items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4 hover:bg-white/[0.03] transition-colors group">
                        <div className="text-center shrink-0 w-14 sm:w-16">
                          <div className="text-xs sm:text-sm font-mono text-white/70">{formatDate(g.deadline)?.replace(/ \d{4} г\.?$/, "")}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white leading-snug line-clamp-2 break-words group-hover:text-white font-display">{g.name}</p>
                          {g.organization && <p className="text-white/35 text-xs truncate">{g.organization}</p>}
                        </div>
                        {dl != null && (
                          <span className={`text-xs shrink-0 whitespace-nowrap ${dl <= 7 ? "text-amber-400" : "text-white/35"}`}>
                            {dl < 0 ? "завершён" : dl === 0 ? "сегодня" : `${dl} дн.`}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="lovable-glass rounded-2xl p-6 text-white/40 text-sm border border-white/10">
                  Ближайших дедлайнов нет.
                </div>
              )}
            </section>
          </div>
        )}

        {/* Вкладки категорий программ */}
        {availableTabs.length > 1 && (
          <div className="pitchy-muted-x-scroll mb-6 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            <button
              onClick={() => setActiveCategory(null)}
              className={`shrink-0 px-4 py-2 rounded-full text-sm transition-all border ${
                activeCategory === null
                  ? "bg-white text-black border-white font-medium"
                  : "lovable-glass text-white/60 hover:text-white border-white/10"
              }`}
            >
              Все
            </button>
            {availableTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveCategory(t.key)}
                className={`shrink-0 px-4 py-2 rounded-full text-sm transition-all border ${
                  activeCategory === t.key
                    ? "bg-white text-black border-white font-medium"
                    : "lovable-glass text-white/60 hover:text-white border-white/10"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Основная секция: карточки мер поддержки */}
        <section className="mb-12">
          <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
            <div className="flex items-center gap-2 text-white/70">
              <Sparkles size={16} />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">
                {activeProject != null ? "Меры поддержки под ваш проект" : "Все меры поддержки"}
              </span>
            </div>
            {activeProject != null && (
              <label className="flex items-center gap-2 text-sm text-white/50 cursor-pointer select-none">
                <input type="checkbox" checked={onlyEligible}
                  onChange={(e) => setOnlyEligible(e.target.checked)}
                  className="accent-white w-4 h-4" />
                Только подходящие
              </label>
            )}
          </div>

          {activeProject != null ? (
            matchLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader className="animate-spin text-white/30" size={22} />
              </div>
            ) : visibleMatches.length === 0 ? (
              <div className="lovable-glass rounded-2xl p-6 text-white/40 text-sm border border-white/10">
                Нет программ по текущим условиям. Попробуйте другую категорию или снимите фильтр «только подходящие».
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {visibleMatches.map((m, i) => (
                  <motion.div
                    key={m.grant.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, delay: i * 0.03 } }}
                  >
                    <SupportMeasureCard grant={m.grant} match={m} href={grantHref(m.grant.id)} />
                  </motion.div>
                ))}
              </div>
            )
          ) : visibleGrants.length === 0 ? (
            <div className="lovable-glass rounded-3xl p-10 text-center text-white/40 border border-white/10">
              {grants.length === 0
                ? "Каталог пока пуст. Скоро здесь появятся актуальные программы."
                : "В этой категории пока нет программ."}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleGrants.map((g, i) => (
                <motion.div
                  key={g.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, delay: i * 0.03 } }}
                >
                  <SupportMeasureCard grant={g} href={grantHref(g.id)} />
                </motion.div>
              ))}
            </div>
          )}
        </section>
    </div>
  );
}
