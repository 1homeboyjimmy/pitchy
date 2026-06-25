"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  Loader, ChevronLeft, Banknote, MapPin, Building2, Clock, Sparkles,
  ExternalLink, CheckCircle2, AlertTriangle, FileText, LayoutGrid, Check,
  CalendarDays, Users, ListChecks, TicketCheck, Wifi,
} from "lucide-react";
import { getToken } from "@/lib/auth";
import { notifyError } from "@/lib/ui";
import {
  getGrant, getProjects, generateGrantApplication, trackGrant, matchGrants,
  type Grant, type ProjectListItem, type GrantApplication, type GrantMatch,
} from "@/lib/api";

const SECTION_LABELS: Record<string, string> = {
  summary: "Резюме проекта",
  problem: "Проблема",
  solution: "Решение",
  market: "Рынок",
  team: "Команда",
  budget: "Бюджет",
  impact: "Эффект и значимость",
};

function formatAmount(min: number | null, max: number | null): string | null {
  const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
  if (min != null && max != null) return min === max ? `${fmt(min)} ₽` : `${fmt(min)} – ${fmt(max)} ₽`;
  if (max != null) return `до ${fmt(max)} ₽`;
  if (min != null) return `от ${fmt(min)} ₽`;
  return null;
}

function formatDate(s: string | null): string | null {
  if (!s) return null;
  try {
    return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  } catch { return s; }
}

function formatDateTime(s: string | null): string | null {
  if (!s) return null;
  try {
    const d = new Date(s);
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || /T\d{2}:\d{2}| \d{2}:\d{2}/.test(s);
    return d.toLocaleString("ru-RU", {
      day: "numeric", month: "long", year: "numeric",
      ...(hasTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  } catch { return s; }
}

const CATEGORY_LABELS: Record<string, string> = {
  grant: "Грант", support_measure: "Мера поддержки", contest: "Конкурс",
  accelerator: "Акселератор", event: "Мероприятие", pitch: "Питч",
  investor: "Инвестор",
};

const FORMAT_LABELS: Record<string, string> = {
  online: "Онлайн", offline: "Офлайн", hybrid: "Гибридный формат",
};

export function GrantDetailClient() {
  const params = useParams();
  const search = useSearchParams();
  const grantId = Number(params.id);
  const projectParam = search.get("project");

  const [token, setTok] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectId, setProjectId] = useState<number | null>(projectParam ? Number(projectParam) : null);
  const [extra, setExtra] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GrantApplication | null>(null);
  const [match, setMatch] = useState<GrantMatch | null>(null);
  const [tracking, setTracking] = useState(false);
  const [tracked, setTracked] = useState(false);

  useEffect(() => {
    const t = getToken();
    setTok(t);
    if (!t) { setLoading(false); return; }
    (async () => {
      try {
        const [g, pj] = await Promise.all([getGrant(grantId, t), getProjects(t)]);
        setGrant(g);
        setProjects(pj);
        setProjectId((current) => current == null && pj.length > 0 ? pj[0].id : current);
      } catch (e) {
        console.error(e);
        notifyError("Не удалось загрузить грант");
      } finally {
        setLoading(false);
      }
    })();
  }, [grantId]);

  // Объяснение матча: подтягиваем оценку этого гранта под выбранный проект.
  useEffect(() => {
    if (!token || projectId == null) { setMatch(null); return; }
    let cancelled = false;
    matchGrants(projectId, token)
      .then((list) => {
        if (!cancelled) setMatch(list.find((m) => m.grant.id === grantId) ?? null);
      })
      .catch((e) => console.error(e));
    return () => { cancelled = true; };
  }, [token, projectId, grantId]);

  const handleGenerate = async () => {
    if (!token || projectId == null) return;
    setGenerating(true);
    try {
      const app = await generateGrantApplication(grantId, projectId, token, extra || undefined);
      setResult(app);
      setTracked(true); // заявка попала на канбан «Мои гранты» (стадия «Готовлю»)
    } catch (e) {
      console.error(e);
      notifyError("Не удалось сгенерировать заявку");
    } finally {
      setGenerating(false);
    }
  };

  const handleTrack = async () => {
    if (!token || projectId == null) return;
    setTracking(true);
    try {
      await trackGrant(grantId, projectId, token);
      setTracked(true);
    } catch (e) {
      console.error(e);
      notifyError("Не удалось добавить в «Мои гранты»");
    } finally {
      setTracking(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full bg-black flex items-center justify-center">
        <Loader className="animate-spin text-white/40" size={28} />
      </div>
    );
  }

  if (!grant) {
    return (
      <div className="h-full flex items-center justify-center text-white/40">Грант не найден</div>
    );
  }

  const content = result?.content;
  const sections = content?.sections || {};
  const gaps = content?.gaps || [];
  const sectionMeta = content?.section_meta || [];
  const staticEntries = Object.values(content?.static || {});
  const userInput = content?.user_input || [];
  const templateTitle = content?.template_title;

  // Разделы для рендера: из section_meta (новая структура под грант) либо из
  // старой карты SECTION_LABELS (заявки, сгенерированные до шаблонов).
  const renderSections = sectionMeta.length
    ? sectionMeta.filter((m) => sections[m.key])
    : Object.keys(SECTION_LABELS)
        .filter((k) => sections[k])
        .map((k) => ({ key: k, label: SECTION_LABELS[k], group_id: "main", group_title: "" }));

  // Группировка по group_title с сохранением порядка.
  const groupedSections: { title: string; items: { key: string; label: string }[] }[] = [];
  for (const m of renderSections) {
    let g = groupedSections.find((x) => x.title === (m.group_title || ""));
    if (!g) { g = { title: m.group_title || "", items: [] }; groupedSections.push(g); }
    g.items.push({ key: m.key, label: m.label });
  }

  // Подача заявки/трекинг и блок «Требования» — только у applyable-категорий
  // (грант/акселератор/мера поддержки). Остальное — справочные карточки.
  const isApplyable = ["grant", "accelerator", "support_measure"].includes(grant.category || "grant");
  const isEventLike = ["event", "pitch"].includes(grant.category || "grant");
  const categoryLabel = CATEGORY_LABELS[grant.category || "grant"] || "Программа";
  const details = grant.event_details || {};
  const agenda = details.agenda || [];
  const speakers = details.speakers || [];
  const publicSourceUrl = grant.source_url || grant.registration_url || grant.url;
  const showSeparateRegistration = !!grant.registration_url && grant.registration_url !== publicSourceUrl;
  const displayGeo = grant.geo === "RF" ? "РФ" : grant.geo;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-8 pt-24 pb-10 relative z-10">
        <Link href="/grants" className="flex items-center gap-2 text-white/40 hover:text-white text-sm mb-8 transition-colors">
          <ChevronLeft size={16} /> Все гранты
        </Link>

        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="inline-flex px-2.5 py-1 rounded-full border border-sky-400/20 bg-sky-400/10 text-sky-200 text-[10px] font-mono uppercase tracking-wider">
              {categoryLabel}
            </span>
          {grant.status === "open" && (
            <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-mono uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {isEventLike ? "Предстоит" : "Приём открыт"}
            </span>
          )}
          </div>
          {grant.logo_url && !grant.logo_url.includes("google.com/s2/favicons") && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={grant.logo_url}
              alt={grant.organization || grant.name}
              referrerPolicy="no-referrer"
              className="h-12 md:h-16 w-auto max-w-[280px] object-contain object-left mb-5"
              style={{ filter: "brightness(0) invert(1)" }}
            />
          )}
          <h1 className="text-3xl md:text-4xl tracking-tight mb-2" style={{ fontFamily: "'Instrument Serif', serif" }}>
            {grant.name}
          </h1>
          {grant.organization && (
            <p className="flex items-center gap-2 text-white/50"><Building2 size={15} /> {grant.organization}</p>
          )}
        </div>

        {/* Факты */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {formatAmount(grant.amount_min, grant.amount_max) && (
            <div className="lovable-glass rounded-2xl p-4 border border-white/10">
              <Banknote size={16} className="text-white/40 mb-2" />
              <div className="text-white font-medium text-sm">{formatAmount(grant.amount_min, grant.amount_max)}</div>
            </div>
          )}
          {(grant.location || grant.geo) && (
            <div className="lovable-glass rounded-2xl p-4 border border-white/10">
              <MapPin size={16} className="text-white/40 mb-2" />
              {grant.location && (
                <div className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-0.5">Место</div>
              )}
              <div className="text-white font-medium text-sm">{grant.location || displayGeo}</div>
            </div>
          )}
          {grant.event_format && (
            <div className="lovable-glass rounded-2xl p-4 border border-white/10">
              <Wifi size={16} className="text-white/40 mb-2" />
              <div className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-0.5">Формат</div>
              <div className="text-white font-medium text-sm">{FORMAT_LABELS[grant.event_format] || grant.event_format}</div>
            </div>
          )}
          {grant.opens_at && (
            <div className="lovable-glass rounded-2xl p-4 border border-white/10">
              <Clock size={16} className="text-white/40 mb-2" />
              <div className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-0.5">Старт приёма</div>
              <div className="text-white font-medium text-sm">{formatDate(grant.opens_at)}</div>
            </div>
          )}
          {grant.deadline && (
            <div className="lovable-glass rounded-2xl p-4 border border-white/10">
              {isEventLike ? <CalendarDays size={16} className="text-white/40 mb-2" /> : <Clock size={16} className="text-white/40 mb-2" />}
              <div className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-0.5">{isEventLike ? "Дата и время" : "Дедлайн"}</div>
              <div className="text-white font-medium text-sm">{isEventLike ? formatDateTime(grant.deadline) : formatDate(grant.deadline)}</div>
            </div>
          )}
          {publicSourceUrl && /^https?:\/\//i.test(publicSourceUrl) && (
            <a href={publicSourceUrl} target="_blank" rel="noopener noreferrer"
              className="lovable-glass rounded-2xl p-4 border border-white/10 hover:border-white/20 transition-all">
              <ExternalLink size={16} className="text-white/40 mb-2" />
              <div className="text-white font-medium text-sm">{isEventLike ? "Первоисточник" : "Сайт программы"}</div>
            </a>
          )}
          {showSeparateRegistration && (
            <a href={grant.registration_url!} target="_blank" rel="noopener noreferrer"
              className="lovable-glass rounded-2xl p-4 border border-emerald-400/20 hover:border-emerald-400/40 transition-all">
              <TicketCheck size={16} className="text-emerald-300/70 mb-2" />
              <div className="text-white font-medium text-sm">Регистрация</div>
            </a>
          )}
        </div>

        {/* Насколько подходит вам (объяснение соответствия под выбранный проект) */}
        {isApplyable && match && (
          <div className="lovable-glass rounded-2xl p-6 border border-emerald-500/15 mb-8">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="font-display text-lg text-white">Насколько подходит вам</h3>
              <div className="flex items-baseline gap-1.5">
                <span className={`font-mono font-bold text-2xl tabular-nums ${match.score >= 70 ? "text-emerald-300" : match.score >= 40 ? "text-amber-300" : "text-white/50"}`}>{match.score}</span>
                <span className="text-white/30 text-xs">/ 100</span>
              </div>
            </div>
            {(match.reasons.matched?.length ?? 0) > 0 && (
              <div className="mb-3">
                <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-emerald-300/50 mb-2">Совпало по паспорту</p>
                <div className="flex flex-wrap gap-1.5">
                  {match.reasons.matched!.map((r) => (
                    <span key={r} className="text-xs px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-300/80 border border-emerald-500/15">{r}</span>
                  ))}
                </div>
              </div>
            )}
            {(match.reasons.missing?.length ?? 0) > 0 && (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-amber-300/50 mb-2">Чего не хватает в паспорте</p>
                <div className="flex flex-wrap gap-1.5">
                  {match.reasons.missing!.map((r) => (
                    <span key={r} className="text-xs px-3 py-1 rounded-full bg-amber-500/10 text-amber-200/80 border border-amber-500/15">{r}</span>
                  ))}
                </div>
                <p className="text-white/40 text-xs mt-2.5 leading-snug">Заполните эти поля в паспорте проекта — оценка соответствия вырастет, а заявка станет полнее.</p>
              </div>
            )}
            {match.reasons.conflict && (
              <p className="text-amber-300/70 text-xs mt-3 flex items-start gap-1.5">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" /> По одному из жёстких критериев (стадия / юр. форма / гео) проект не проходит — грант показан для справки.
              </p>
            )}
          </div>
        )}

        {grant.description && (
          <div className="lovable-glass rounded-2xl p-6 border border-white/10 mb-8">
            {isEventLike && <h2 className="font-display text-xl text-white mb-3">О мероприятии</h2>}
            <p className="text-white/70 leading-relaxed whitespace-pre-wrap">{grant.description}</p>
          </div>
        )}

        {agenda.length > 0 && (
          <div className="lovable-glass rounded-2xl p-6 border border-white/10 mb-8">
            <div className="flex items-center gap-2 mb-4 text-white">
              <ListChecks size={18} className="text-sky-300/70" />
              <h2 className="font-display text-xl">Программа и ключевые тезисы</h2>
            </div>
            <ul className="space-y-3">
              {agenda.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-3 text-sm text-white/70 leading-relaxed">
                  <span className="font-mono text-sky-300/60 text-xs mt-0.5">{String(index + 1).padStart(2, "0")}</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {speakers.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4 text-white/70">
              <Users size={18} />
              <h2 className="font-display text-xl">Спикеры</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {speakers.map((speaker, index) => (
                <div key={`${speaker.name || "speaker"}-${index}`} className="lovable-glass rounded-2xl p-5 border border-white/10">
                  <div className="text-white font-medium">{speaker.name || "Спикер"}</div>
                  {(speaker.role || speaker.organization) && (
                    <div className="text-white/50 text-sm mt-1">{[speaker.role, speaker.organization].filter(Boolean).join(", ")}</div>
                  )}
                  {speaker.bio && <p className="text-white/45 text-sm leading-relaxed mt-3">{speaker.bio}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {details.participation_terms && (
          <div className="lovable-glass rounded-2xl p-6 border border-white/10 mb-8">
            <div className="flex items-center gap-2 mb-3 text-white">
              <TicketCheck size={18} className="text-emerald-300/70" />
              <h2 className="font-display text-xl">Условия участия</h2>
            </div>
            <p className="text-white/70 leading-relaxed whitespace-pre-wrap">{details.participation_terms}</p>
          </div>
        )}

        {(grant.stages.length > 0 || grant.sectors.length > 0 || grant.entity_types.length > 0) && (
          <div className="grid sm:grid-cols-3 gap-5 mb-10">
            {grant.sectors.length > 0 && (
              <div>
                <h3 className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-2.5">Направления</h3>
                <div className="flex flex-wrap gap-2">
                  {grant.sectors.map((s) => <span key={s} className="text-xs px-3 py-1 rounded-full bg-white/5 text-white/70 border border-white/10">{s}</span>)}
                </div>
              </div>
            )}
            {grant.entity_types.length > 0 && (
              <div>
                <h3 className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-2.5">Кому подходит</h3>
                <div className="flex flex-wrap gap-2">
                  {grant.entity_types.map((s) => <span key={s} className="text-xs px-3 py-1 rounded-full bg-white/5 text-white/70 border border-white/10">{s}</span>)}
                </div>
              </div>
            )}
            {grant.stages.length > 0 && (
              <div>
                <h3 className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-2.5">Стадии</h3>
                <div className="flex flex-wrap gap-2">
                  {grant.stages.map((s) => <span key={s} className="text-xs px-3 py-1 rounded-full bg-white/5 text-white/70 border border-white/10">{s}</span>)}
                </div>
              </div>
            )}
          </div>
        )}

        {isApplyable && grant.requirements && Object.keys(grant.requirements).length > 0 && (
          <div className="lovable-glass rounded-2xl p-6 border border-white/10 mb-10">
            <h3 className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-3">Требования и условия</h3>
            <ul className="space-y-2">
              {Object.entries(grant.requirements).map(([k, v]) => (
                <li key={k} className="flex gap-2 text-sm text-white/70">
                  <CheckCircle2 size={15} className="text-emerald-400/70 shrink-0 mt-0.5" />
                  <span>{typeof v === "string" || typeof v === "number" ? `${k}: ${v}` : k}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Генерация заявки / трекинг — только для applyable-категорий */}
        {isApplyable && (
        <section className="border-t border-white/10 pt-8">
          <div className="flex items-center gap-2 mb-4 text-white/70">
            <Sparkles size={18} />
            <h2 className="font-display text-xl">
              {grant.has_template ? "Сгенерировать заявку из паспорта" : "Добавить программу в работу"}
            </h2>
          </div>

          {!grant.has_template && (
            <div className="lovable-glass rounded-2xl p-4 border border-white/10 mb-4 flex items-start gap-3">
              <AlertTriangle className="text-white/40 shrink-0 mt-0.5" size={16} />
              <p className="text-white/55 text-sm">
                Генерация заявки для этой программы пока недоступна — мы готовим шаблон под требования фонда.
                Программу можно добавить в «Мои гранты» и отслеживать статус.
              </p>
            </div>
          )}

          {projects.length === 0 ? (
            <div className="lovable-glass rounded-2xl p-6 border border-amber-500/20 flex items-start gap-3">
              <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={18} />
              <p className="text-white/60 text-sm">
                Чтобы собрать заявку, нужен проект с паспортом. Создайте папку проекта в дашборде.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-white/40 text-xs font-mono uppercase tracking-wider mb-2">Проект</label>
                <div className="flex flex-wrap gap-2">
                  {projects.map((p) => (
                    <button key={p.id} onClick={() => setProjectId(p.id)}
                      className={`px-4 py-2 rounded-xl text-sm transition-all border ${
                        projectId === p.id ? "bg-white text-black border-white font-medium" : "lovable-glass text-white/60 border-white/10 hover:text-white"
                      }`}>
                      {p.name} <span className={projectId === p.id ? "text-black/50" : "text-white/30"}>{p.readiness_index}%</span>
                    </button>
                  ))}
                </div>
              </div>

              {grant.has_template && (
                <textarea
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  placeholder="Дополнительный контекст под этот грант (необязательно)…"
                  rows={3}
                  className="w-full lovable-glass rounded-2xl p-4 text-white text-sm border border-white/10 focus:border-white/30 outline-none resize-none mb-4 placeholder:text-white/25"
                />
              )}

              <div className="flex flex-wrap items-center gap-3">
                {grant.has_template && (
                  <button
                    onClick={handleGenerate}
                    disabled={generating || projectId == null}
                    className="bg-white text-black font-semibold text-sm px-7 py-3.5 rounded-full hover:bg-neutral-200 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {generating ? <><Loader className="animate-spin" size={16} /> Собираем заявку…</> : <><Sparkles size={16} /> Сгенерировать</>}
                  </button>
                )}

                {tracked ? (
                  <Link
                    href="/grants/my"
                    className="lovable-glass text-emerald-300/90 font-medium text-sm px-6 py-3.5 rounded-full border border-emerald-500/25 hover:border-emerald-500/40 transition-all flex items-center gap-2"
                  >
                    <Check size={16} /> В вашей воронке — открыть
                  </Link>
                ) : (
                  <button
                    onClick={handleTrack}
                    disabled={tracking || projectId == null}
                    className="lovable-glass text-white/70 font-medium text-sm px-6 py-3.5 rounded-full border border-white/15 hover:border-white/30 hover:text-white transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {tracking ? <Loader className="animate-spin" size={16} /> : <LayoutGrid size={16} />} В мои гранты
                  </button>
                )}
              </div>
              <p className="text-white/30 text-xs mt-3">
                «В мои гранты» добавит программу на канбан без генерации — отслеживайте статус и требования в разделе «Мои гранты».
              </p>
            </>
          )}
        </section>
        )}

        {/* Результат */}
        {result && (
          <section className="mt-10">
            <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 size={18} /> <span className="font-display text-lg text-white">Заявка готова</span>
              </div>
              <Link href="/grants/my" className="flex items-center gap-2 text-white/60 hover:text-white text-sm">
                <FileText size={15} /> Мои гранты
              </Link>
            </div>

            {templateTitle && (
              <p className="text-white/40 text-xs mb-5 font-mono uppercase tracking-wider">
                Шаблон: {templateTitle}
              </p>
            )}

            {gaps.length > 0 && (
              <div className="lovable-glass rounded-2xl p-5 border border-amber-500/20 mb-5">
                <p className="flex items-center gap-2 text-amber-400 text-sm font-medium mb-2">
                  <AlertTriangle size={15} /> Нужно дозаполнить
                </p>
                <ul className="list-disc list-inside text-white/50 text-sm space-y-1">
                  {gaps.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              </div>
            )}

            {/* Зафиксировано положением — без ИИ */}
            {staticEntries.length > 0 && (
              <div className="lovable-glass rounded-2xl p-6 border border-white/10 mb-6">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4">Зафиксировано положением</h3>
                <div className="space-y-3">
                  {staticEntries.map((f, i) => (
                    <div key={i} className="flex flex-col sm:flex-row sm:gap-4">
                      <div className="text-white/50 text-sm sm:w-1/3 shrink-0">{f.label}</div>
                      <div className="text-white/80 text-sm whitespace-pre-wrap">{f.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Сгенерированные разделы — по группам шаблона */}
            <div className="space-y-6">
              {groupedSections.map((grp, gi) => (
                <div key={gi} className="space-y-4">
                  {grp.title && (
                    <h2 className="font-display text-white text-base mt-2">{grp.title}</h2>
                  )}
                  {grp.items.map((it) => (
                    <div key={it.key} className="lovable-glass rounded-2xl p-6 border border-white/10">
                      <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-3">{it.label}</h3>
                      <p className="text-white/80 leading-relaxed whitespace-pre-wrap">{sections[it.key]}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Заполняет заявитель сам — ИИ не выдумывает */}
            {userInput.length > 0 && (
              <div className="lovable-glass rounded-2xl p-6 border border-amber-500/20 mt-6">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400 mb-2">Заполните самостоятельно</h3>
                <p className="text-white/40 text-xs mb-4">Эти поля ИИ не генерирует — внесите реальные данные при подаче.</p>
                <ul className="space-y-3">
                  {userInput.map((u) => (
                    <li key={u.key}>
                      <div className="text-white/80 text-sm">{u.label}</div>
                      {u.hint && <div className="text-white/40 text-xs mt-0.5">{u.hint}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
    </div>
  );
}
