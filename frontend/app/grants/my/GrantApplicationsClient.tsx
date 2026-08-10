"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Loader, ChevronLeft, LayoutGrid, Banknote, CheckCircle2, Circle,
  AlertTriangle, ChevronDown, ChevronUp, ExternalLink,
  LockKeyhole,
} from "lucide-react";
import { getToken } from "@/lib/auth";
import { notifyError } from "@/lib/ui";
import {
  getGrantApplications, getGrants, matchGrants, updateGrantApplication,
  type GrantApplication, type Grant, type GrantMatch, type CrmStage,
} from "@/lib/api";
import { GrantActionsPaywall } from "../GrantActionsPaywall";
import { useGrantAccess } from "../GrantAccessContext";

// Колонки воронки CRM. Порядок = слева направо.
const STAGES: { key: CrmStage; label: string; accent: string; dot: string }[] = [
  { key: "interested", label: "Интересует", accent: "text-white/50",     dot: "bg-white/30" },
  { key: "preparing",  label: "Готовлю",    accent: "text-amber-300/80",  dot: "bg-amber-400/60" },
  { key: "submitted",  label: "Подана",     accent: "text-sky-300/80",    dot: "bg-sky-400/60" },
  { key: "won",        label: "Победа",     accent: "text-emerald-300/80",dot: "bg-emerald-400/70" },
  { key: "rejected",   label: "Отказ",      accent: "text-white/30",      dot: "bg-white/15" },
];

const SECTION_LABELS: Record<string, string> = {
  summary: "Резюме проекта",
  problem: "Проблема",
  solution: "Решение",
  market: "Рынок",
  team: "Команда",
  budget: "Бюджет",
  impact: "Эффект и значимость",
};

function scoreColor(s: number): string {
  if (s >= 70) return "text-emerald-300/90";
  if (s >= 40) return "text-amber-300/90";
  return "text-white/40";
}

function humanizeKey(k: string): string {
  const s = k.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : k;
}

// Превращает freeform Grant.requirements в плоский чеклист требований.
function requirementItems(requirements: Record<string, unknown> | null): string[] {
  if (!requirements) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(requirements)) {
    if (v == null || v === false || v === "") continue;
    if (Array.isArray(v)) {
      for (const it of v) {
        const s = String(it).trim();
        if (s) out.push(s);
      }
    } else if (v === true) {
      out.push(humanizeKey(k));
    } else if (typeof v === "object") {
      out.push(`${humanizeKey(k)}: ${JSON.stringify(v)}`);
    } else {
      out.push(`${humanizeKey(k)}: ${String(v)}`);
    }
  }
  return out.slice(0, 20);
}

function applicationSectionEntries(app: GrantApplication): [string, string][] {
  const sections = app.content.sections ?? {};
  const meta = app.content.section_meta ?? [];
  // Новые заявки под шаблон гранта: порядок и состав — из section_meta.
  if (meta.length) {
    return meta
      .filter((m) => typeof sections[m.key] === "string" && sections[m.key].trim().length > 0)
      .map((m) => [m.key, sections[m.key]] as [string, string]);
  }
  // Старые заявки: порядок по фиксированной карте SECTION_LABELS.
  return Object.entries(sections)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .sort(([a], [b]) => {
      const ai = Object.keys(SECTION_LABELS).indexOf(a);
      const bi = Object.keys(SECTION_LABELS).indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
}

// Подпись раздела: из section_meta (под грант) → из карты → humanize.
function sectionLabel(app: GrantApplication, key: string): string {
  const m = (app.content.section_meta ?? []).find((x) => x.key === key);
  return m?.label ?? SECTION_LABELS[key] ?? humanizeKey(key);
}

function formatUpdatedAt(value: string): string {
  try {
    return new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return value;
  }
}

export function GrantApplicationsClient() {
  const { loading: accessLoading, canUseGrantActions } = useGrantAccess();
  const [token, setTok] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState<GrantApplication[]>([]);
  const [grants, setGrants] = useState<Record<number, Grant>>({});
  // matchByProject[projectId][grantId] = матч паспорта с грантом (gap-анализ).
  const [matchByProject, setMatchByProject] = useState<Record<number, Record<number, GrantMatch>>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [expandedDraft, setExpandedDraft] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    const t = getToken();
    setTok(t);
    if (!t) { setLoading(false); return; }
    (async () => {
      try {
        const [list, allGrants] = await Promise.all([
          getGrantApplications(t),
          getGrants(t, { includeExpired: true }),
        ]);
        setApps(list);
        const gmap: Record<number, Grant> = {};
        for (const g of allGrants) gmap[g.id] = g;
        setGrants(gmap);

        // Gap-анализ берём из автоподбора: по одному запросу на каждую папку,
        // в которой есть заявки (closed-гранты тоже, чтобы карточки не теряли матч).
        const projectIds = [...new Set(list.map((a) => a.project_id))];
        const entries = await Promise.all(
          projectIds.map(async (pid) => {
            try {
              const ms = await matchGrants(pid, t, { includeClosed: true });
              return [pid, ms] as const;
            } catch {
              return [pid, [] as GrantMatch[]] as const;
            }
          })
        );
        const mbp: Record<number, Record<number, GrantMatch>> = {};
        for (const [pid, ms] of entries) {
          const byGrant: Record<number, GrantMatch> = {};
          for (const m of ms) byGrant[m.grant.id] = m;
          mbp[pid] = byGrant;
        }
        setMatchByProject(mbp);
      } catch (e) {
        console.error(e);
        notifyError("Не удалось загрузить «Мои гранты»");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const moveStage = async (app: GrantApplication, stage: CrmStage) => {
    if (stage === app.stage || !token || !canUseGrantActions) return;
    const before = apps;
    setBusyId(app.id);
    setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, stage } : a)));
    try {
      await updateGrantApplication(app.id, { stage }, token);
    } catch (e) {
      console.error(e);
      setApps(before);
      notifyError("Не удалось переместить карточку");
    } finally {
      setBusyId(null);
    }
  };

  const toggleRequirement = async (app: GrantApplication, item: string) => {
    if (!token || !canUseGrantActions) return;
    const checked = new Set(app.content.checklist ?? []);
    if (checked.has(item)) checked.delete(item);
    else checked.add(item);
    const newContent = { ...app.content, checklist: [...checked] };
    const before = apps;
    setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, content: newContent } : a)));
    try {
      await updateGrantApplication(app.id, { content: newContent }, token);
    } catch (e) {
      console.error(e);
      setApps(before);
      notifyError("Не удалось сохранить отметку");
    }
  };

  const generatedApplications = apps.filter((app) => applicationSectionEntries(app).length > 0);

  if (loading) {
    return (
      <div className="h-full bg-black flex items-center justify-center">
        <Loader className="animate-spin text-white/40" size={28} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-8 pt-24 pb-10 relative z-10">
      <Link href="/grants" className="flex items-center gap-2 text-white/40 hover:text-white text-sm mb-8 transition-colors">
        <ChevronLeft size={16} /> Гранты
      </Link>

      <div className="flex items-center gap-3 mb-3">
        <LayoutGrid className="text-white/70" size={26} strokeWidth={1.5} />
        <h1 className="text-4xl tracking-tight" style={{ fontFamily: "var(--font-prata), serif" }}>Мои гранты</h1>
      </div>
      <p className="text-white/40 text-sm mb-10 max-w-2xl">
        Воронка заявок: ведите гранты по стадиям, отмечайте выполненные требования и видите,
        чего не хватает в паспорте под каждую программу.
      </p>

      {!accessLoading && !canUseGrantActions && (
        <div className="mb-10">
          <GrantActionsPaywall compact />
        </div>
      )}

      {apps.length === 0 ? (
        <div className="lovable-glass rounded-3xl p-6 sm:p-10 text-center border border-white/10">
          <Banknote className="mx-auto text-white/20 mb-4" size={36} />
          <p className="text-white/50 mb-5">
            {canUseGrantActions
              ? "Пока пусто. Добавьте грант на доску со страницы подбора."
              : "Здесь появятся сохранённые программы и заявки после подключения подачи."}
          </p>
          <Link href={canUseGrantActions ? "/grants" : "/pricing"} className="inline-flex bg-white text-black font-semibold text-sm px-7 py-3 rounded-full hover:bg-neutral-200 transition-all">
            {canUseGrantActions ? "Подобрать грант ›" : "Докупить подачу ›"}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col">
          {generatedApplications.length > 0 && (
            <section className="order-2 mt-10">
              <div className="flex items-end justify-between gap-4 mb-4">
                <div>
                  <h2 className="font-display text-2xl text-white tracking-tight">Сохранённые заявки</h2>
                  <p className="text-white/35 text-sm mt-1">Горизонтальные карточки с текстами, которые были собраны из паспорта проекта.</p>
                </div>
                <span className="hidden sm:inline text-xs font-mono text-white/30">{generatedApplications.length}</span>
              </div>

              <div className="space-y-3">
                {generatedApplications.map((app) => {
                  const g = grants[app.grant_id];
                  const sections = applicationSectionEntries(app);
                  const preview = sections[0]?.[1] ?? "";
                  const isOpen = expandedDraft === app.id;

                  return (
                    <article
                      key={`generated-${app.id}`}
                      className="lovable-glass rounded-2xl border border-white/10 bg-white/[0.015] p-4 sm:p-5 transition-all hover:border-white/20"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-300/80">
                              Заявка
                            </span>
                            <span className={`text-[11px] font-mono ${scoreColor(app.match_score)}`}>
                              матч {app.match_score}
                            </span>
                            <span className="text-[11px] text-white/30">обновлено {formatUpdatedAt(app.updated_at)}</span>
                          </div>
                          <h3 className="font-display text-lg text-white leading-snug truncate">
                            {g?.name || `Грант #${app.grant_id}`}
                          </h3>
                          {g?.organization && (
                            <p className="text-white/40 text-xs truncate mt-0.5">{g.organization}</p>
                          )}
                          {!isOpen && (
                            <p className="text-white/45 text-sm leading-relaxed line-clamp-2 mt-2">
                              {preview}
                            </p>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <Link
                            href={`/grants/${app.grant_id}?project=${app.project_id}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-xs text-white/55 transition-all hover:border-white/25 hover:text-white"
                          >
                            Грант <ExternalLink size={12} />
                          </Link>
                          <button
                            type="button"
                            onClick={() => setExpandedDraft(isOpen ? null : app.id)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-all hover:bg-neutral-200"
                          >
                            {isOpen ? "Свернуть" : "Читать"} {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="mt-5 border-t border-white/10 pt-5">
                          {app.content.gaps && app.content.gaps.length > 0 && (
                            <div className="mb-5 rounded-2xl border border-amber-500/15 bg-amber-500/[0.04] p-4">
                              <p className="flex items-center gap-2 text-sm font-medium text-amber-300/90">
                                <AlertTriangle size={15} /> Нужно дозаполнить
                              </p>
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/55">
                                {app.content.gaps.map((gap, index) => (
                                  <li key={index}>{gap}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="grid gap-4">
                            {sections.map(([key, value]) => (
                              <section key={key} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                                <h4 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35 mb-3">
                                  {sectionLabel(app, key)}
                                </h4>
                                <p className="text-white/75 leading-relaxed whitespace-pre-wrap">{value}</p>
                              </section>
                            ))}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          <div className="pitchy-muted-x-scroll order-1 flex gap-4 overflow-x-auto pb-3 -mx-1 px-1">
            {STAGES.map((col) => {
              const cards = apps.filter((a) => a.stage === col.key);
              return (
                <div key={col.key} className="shrink-0 w-72 flex flex-col">
                  <div className="flex items-center justify-between mb-3 px-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                      <span className={`text-sm font-medium ${col.accent}`}>{col.label}</span>
                    </div>
                    <span className="text-xs text-white/30 font-mono">{cards.length}</span>
                  </div>

                  <div className="space-y-3">
                    {cards.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-white/10 py-8 text-center text-white/20 text-xs">
                        —
                      </div>
                    )}
                    {cards.map((app) => {
                      const g = grants[app.grant_id];
                      const match = matchByProject[app.project_id]?.[app.grant_id];
                      const missing = match?.reasons.missing ?? [];
                      const matched = match?.reasons.matched ?? [];
                      const conflict = match?.reasons.conflict ?? false;
                      const reqs = requirementItems(g?.requirements ?? null);
                      const done = new Set(app.content.checklist ?? []);
                      const isOpen = expanded === app.id;
                      return (
                        <div key={app.id} className="lovable-glass rounded-2xl border border-white/10 hover:border-white/20 transition-all p-4">
                        <button
                          onClick={() => setExpanded(isOpen ? null : app.id)}
                          className="w-full text-left"
                        >
                          <p className="font-display text-[15px] text-white leading-snug line-clamp-2">
                            {g?.name || `Грант #${app.grant_id}`}
                          </p>
                          {g?.organization && (
                            <p className="text-white/40 text-xs truncate mt-0.5">{g.organization}</p>
                          )}
                          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                            <span className={`text-[11px] font-mono ${scoreColor(app.match_score)}`}>
                              матч {app.match_score}
                            </span>
                            {missing.length > 0 && (
                              <span className="text-[11px] text-amber-300/80 bg-amber-500/10 px-2 py-0.5 rounded-full">
                                паспорт: −{missing.length}
                              </span>
                            )}
                            {conflict && (
                              <span className="text-[11px] text-red-300/80 bg-red-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <AlertTriangle size={11} /> конфликт
                              </span>
                            )}
                            {reqs.length > 0 && (
                              <span className="text-[11px] text-white/40">
                                {done.size}/{reqs.length} ✓
                              </span>
                            )}
                            <span className="ml-auto text-white/30">
                              {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </span>
                          </div>
                        </button>

                        {isOpen && (
                          <div className="mt-3 pt-3 border-t border-white/10 space-y-4">
                            {/* Gap-анализ vs паспорт */}
                            <div>
                              <p className="text-[11px] uppercase tracking-wide text-white/30 mb-1.5">Паспорт под программу</p>
                              {matched.length === 0 && missing.length === 0 ? (
                                <p className="text-xs text-white/40">Нет данных матча — заполните паспорт.</p>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  {matched.slice(0, 4).map((m, i) => (
                                    <span key={`m${i}`} className="text-[11px] text-emerald-300/80 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                                      {m}
                                    </span>
                                  ))}
                                  {missing.map((m, i) => (
                                    <span key={`x${i}`} className="text-[11px] text-amber-300/80 bg-amber-500/10 px-2 py-0.5 rounded-full">
                                      нет: {m}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Чеклист требований гранта */}
                            {reqs.length > 0 && (
                              <div>
                                <p className="text-[11px] uppercase tracking-wide text-white/30 mb-1.5">Требования</p>
                                <div className="space-y-1">
                                  {reqs.map((item, i) => {
                                    const checked = done.has(item);
                                    return (
                                      <button
                                        key={i}
                                        onClick={() => toggleRequirement(app, item)}
                                        disabled={!canUseGrantActions}
                                        className="w-full flex items-start gap-2 text-left group"
                                      >
                                        {checked
                                          ? <CheckCircle2 size={15} className="text-emerald-400/80 shrink-0 mt-0.5" />
                                          : <Circle size={15} className="text-white/25 shrink-0 mt-0.5 group-hover:text-white/40" />}
                                        <span className={`text-xs leading-snug ${checked ? "text-white/40 line-through" : "text-white/70"}`}>
                                          {item}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Перемещение по воронке + ссылка на грант */}
                            <div className="flex items-center gap-2">
                              {!canUseGrantActions && (
                                <span className="flex items-center gap-1 text-[10px] text-violet-200/60" title="Редактирование доступно после подключения подачи">
                                  <LockKeyhole size={11} /> Только просмотр
                                </span>
                              )}
                              <select
                                value={app.stage}
                                onChange={(e) => moveStage(app, e.target.value as CrmStage)}
                                disabled={busyId === app.id || !canUseGrantActions}
                                className="flex-1 bg-white/5 border border-white/10 rounded-lg text-xs text-white/70 px-2 py-1.5 outline-none focus:border-white/25 disabled:opacity-50"
                              >
                                {STAGES.map((s) => (
                                  <option key={s.key} value={s.key} className="bg-neutral-900 text-white">
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                              <Link
                                href={`/grants/${app.grant_id}?project=${app.project_id}`}
                                className="shrink-0 flex items-center gap-1 text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/25 rounded-lg px-2.5 py-1.5 transition-all"
                              >
                                Грант <ExternalLink size={12} />
                              </Link>
                            </div>
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        </>
      )}
    </div>
  );
}
