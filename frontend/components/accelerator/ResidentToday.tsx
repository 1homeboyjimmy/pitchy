"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, BookOpenCheck, CalendarClock, CheckCircle2, Clock3, Compass, FilePenLine, Gauge, LifeBuoy, Loader2, MessageCircle, RotateCcw, Sparkles, Target, X } from "lucide-react";

import { deleteAuth, describeApiError, getAuthJson, postAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";

type ResidentSection = "program" | "homework" | "tracking" | "matching" | "project_audit";
type TodayMembership = { membership_id: number; cohort: { id: number; name: string; timezone: string }; project?: { id: number; name: string; readiness_index: number } | null; modules: Record<string, boolean> };
type TodayAction = { key: string; title: string; description?: string | null; due_at?: string | null; section: ResidentSection; kind: "task" | "homework" | "material"; overdue: boolean };
type UpcomingItem = { key: string; kind: "event" | "deadline"; title: string; starts_at: string; description?: string | null; section: ResidentSection };
type Feedback = { id: number; body: string; created_at: string; author: { name: string } };
type Recommendation = { key: string; title: string; description: string; source: string; source_type: "manual" | "system" | "ai"; section?: ResidentSection | null; href?: string | null; priority: number; reason_fingerprint: string };
type TodayData = {
  membership_id: number; generated_at: string; timezone: string; required_actions: TodayAction[]; upcoming: UpcomingItem[]; unread_feedback: Feedback[];
  progress: { percent: number; completed_stages: number; total_stages: number; current_stage?: { id: number; title: string } | null; project_readiness?: number | null };
  support: { enabled: boolean; trackers: Array<{ id: number; name: string; email: string }>; risk?: { level: "green" | "yellow" | "red"; reasons: string[] } | null };
  recommendations: Recommendation[]; dismissed_recommendations: Recommendation[]; unavailable_sections: string[];
};

const unavailableLabels: Record<string, string> = { program: "программа", homework: "домашние задания", events: "мероприятия", tracking: "обратная связь" };

function safeDate(value?: string | null) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function formatDateTime(value: string | null | undefined, timezone: string) {
  const date = safeDate(value); if (!date) return "Без срока";
  try { return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(date); }
  catch { return date.toLocaleString("ru-RU"); }
}
function formatToday(timezone: string) {
  try { return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: timezone }).format(new Date()); }
  catch { return new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }); }
}

export function ResidentToday({ membership, onNavigate }: { membership: TodayMembership; onNavigate: (section: ResidentSection) => void }) {
  const { token } = useAuth(); const [data, setData] = useState<TodayData | null>(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!token) return; setLoading(true); setError("");
    try { setData(await getAuthJson<TodayData>(`/api/accelerators/memberships/${membership.membership_id}/today`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить страницу «Сегодня»")); }
    finally { setLoading(false); }
  }, [membership.membership_id, token]);
  useEffect(() => { void load(); }, [load]);

  const openFeedback = async (feedbackId: number) => {
    if (!token || !data) return; setBusy(`feedback:${feedbackId}`); setData({ ...data, unread_feedback: data.unread_feedback.filter((row) => row.id !== feedbackId) });
    try { await postAuthJson(`/api/accelerators/memberships/${membership.membership_id}/feedback/read`, { feedback_ids: [feedbackId] }, token); onNavigate("tracking"); }
    catch (reason) { setError(describeApiError(reason, "Не удалось отметить обратную связь прочитанной")); await load(); }
    finally { setBusy(""); }
  };
  const dismissRecommendation = async (row: Recommendation) => {
    if (!token) return; setBusy(`dismiss:${row.key}`);
    try { await postAuthJson(`/api/accelerators/memberships/${membership.membership_id}/recommendations/${encodeURIComponent(row.key)}/dismiss`, {}, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось скрыть рекомендацию")); }
    finally { setBusy(""); }
  };
  const restoreRecommendation = async (row: Recommendation) => {
    if (!token) return; setBusy(`restore:${row.key}`);
    try { await deleteAuth(`/api/accelerators/memberships/${membership.membership_id}/recommendations/${encodeURIComponent(row.key)}/dismissal`, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось восстановить рекомендацию")); }
    finally { setBusy(""); }
  };

  if (loading && !data) return <section className="workspace-card grid min-h-64 place-items-center" aria-label="Загрузка страницы Сегодня"><Loader2 className="animate-spin text-white/35" /></section>;
  if (!data) return <section className="workspace-card text-center"><AlertCircle className="mx-auto text-red-200" /><p role="alert" className="mt-3 text-red-100/80">{error}</p><button type="button" onClick={() => void load()} className="workspace-button mt-5">Повторить</button></section>;
  const timezone = data.timezone || membership.cohort.timezone; const trackerNames = data.support.trackers.map((row) => row.name).join(", ");

  return <div className="space-y-5" data-testid="resident-today">
    <section className="workspace-card overflow-hidden !p-0"><div className="grid gap-5 bg-gradient-to-br from-white/[0.075] via-white/[0.025] to-transparent p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end"><div><p className="text-xs uppercase tracking-[.18em] text-white/35">{formatToday(timezone)}</p><h2 className="mt-3 text-3xl sm:text-4xl">Сегодня</h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/45">Главное по потоку «{membership.cohort.name}»: обязательные действия, ближайшие события и следующий шаг проекта.</p></div><div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3"><Target size={19} className="text-white/40" /><div><p className="text-xs text-white/35">Обязательных действий</p><p className="text-2xl">{data.required_actions.length}</p></div></div></div></section>
    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">{error}</p>}
    {data.unavailable_sections.length > 0 && <div role="status" className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] px-4 py-3 text-sm text-amber-100/70"><AlertCircle size={15} className="mr-2 inline" />Часть данных временно недоступна: {data.unavailable_sections.map((row) => unavailableLabels[row] || row).join(", ")}. Остальные блоки продолжают работать.</div>}
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.75fr)]"><div className="space-y-5">
      <DashboardPanel icon={BookOpenCheck} title="Нужно сделать" subtitle="Только обязательные действия и ближайшие сроки" count={data.required_actions.length}><div className="space-y-3">{data.required_actions.length ? data.required_actions.map((card) => <TodayActionCard key={card.key} card={card} timezone={timezone} onOpen={onNavigate} />) : <EmptyState icon={CheckCircle2} title="Обязательных действий нет" text="Можно перейти к рекомендациям или посмотреть программу." />}</div></DashboardPanel>
      <DashboardPanel icon={CalendarClock} title="Ближайшее" subtitle="Мероприятия и сроки в часовом поясе потока"><div className="grid gap-3 sm:grid-cols-2">{data.upcoming.length ? data.upcoming.map((row) => <button key={row.key} type="button" onClick={() => onNavigate(row.section)} className="rounded-2xl border border-white/8 bg-black/20 p-4 text-left transition hover:border-white/20"><p className="text-xs uppercase tracking-wide text-white/30">{row.kind === "event" ? "Мероприятие" : "Срок задания"}</p><p className="mt-2">{row.title}</p><p className="mt-2 flex items-center gap-2 text-sm text-white/45"><Clock3 size={14} />{formatDateTime(row.starts_at, timezone)}</p>{row.description && <p className="mt-2 text-xs text-white/30">{row.description}</p>}</button>) : <div className="sm:col-span-2"><EmptyState icon={CalendarClock} title="В ближайшее время событий нет" text="Новые встречи и сроки появятся здесь." /></div>}</div></DashboardPanel>
      {data.unread_feedback.length > 0 && <DashboardPanel icon={MessageCircle} title="Новая обратная связь" subtitle="Откройте комментарий, чтобы отметить его прочитанным" count={data.unread_feedback.length}><div className="space-y-3">{data.unread_feedback.map((row) => <button key={row.id} type="button" disabled={busy === `feedback:${row.id}`} onClick={() => void openFeedback(row.id)} className="flex w-full items-start justify-between gap-4 rounded-2xl border border-white/8 bg-black/20 p-4 text-left transition hover:border-white/20"><div><p className="text-sm leading-relaxed">{row.body}</p><p className="mt-3 text-xs text-white/30">{row.author.name} · {formatDateTime(row.created_at, timezone)}</p></div><ArrowRight size={15} className="mt-1 shrink-0 text-white/30" /></button>)}</div></DashboardPanel>}
    </div><div className="space-y-5">
      <DashboardPanel icon={Gauge} title="Прогресс"><div className="flex items-end justify-between"><p className="text-4xl">{data.progress.percent}%</p><p className="text-xs text-white/35">{data.progress.completed_stages} из {data.progress.total_stages} этапов</p></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/7"><div className="h-full rounded-full bg-emerald-300/70" style={{ width: `${data.progress.percent}%` }} /></div>{data.progress.current_stage && <p className="mt-4 text-sm text-white/45">Сейчас: {data.progress.current_stage.title}</p>}{typeof data.progress.project_readiness === "number" && <p className="mt-2 text-sm text-white/35">Паспорт проекта: {data.progress.project_readiness}%</p>}</DashboardPanel>
      <DashboardPanel icon={LifeBuoy} title="Поддержка">{data.support.enabled ? <><p className="text-sm text-white/45">{trackerNames ? `Ваш трекер: ${trackerNames}` : "Трекер ещё не назначен. Организатор видит это в рабочей очереди."}</p>{data.support.risk?.reasons?.[0] && <p className="mt-3 rounded-xl bg-amber-300/[0.06] p-3 text-xs text-amber-100/70">{data.support.risk.reasons[0]}</p>}<button type="button" onClick={() => onNavigate("tracking")} className="mt-4 inline-flex items-center gap-2 text-sm text-white/60">Открыть трекинг <ArrowRight size={14} /></button></> : <p className="text-sm text-white/35">Трекинг не включён в этом потоке.</p>}</DashboardPanel>
    </div></div>
    {data.recommendations.length > 0 && <DashboardPanel icon={Sparkles} title="Можно улучшить" subtitle="До трёх необязательных советов на текущем шаге"><div className="grid gap-3 md:grid-cols-3">{data.recommendations.map((row) => <article key={row.key} className="relative flex min-h-48 flex-col rounded-2xl border border-white/8 bg-gradient-to-br from-white/[0.05] to-transparent p-5"><button type="button" disabled={busy === `dismiss:${row.key}`} onClick={() => void dismissRecommendation(row)} className="absolute right-3 top-3 rounded-full p-2 text-white/25 transition hover:bg-white/5 hover:text-white" aria-label={`Скрыть рекомендацию «${row.title}»`}><X size={15} /></button><p className="pr-8 text-lg">{row.title}</p><p className="mt-3 flex-1 text-sm leading-relaxed text-white/40">{row.description}</p><p className="mt-4 text-[11px] uppercase tracking-[.12em] text-white/25">{row.source}</p>{row.href ? <Link href={row.href} className="mt-4 inline-flex items-center gap-2 text-sm text-white/65 hover:text-white">Открыть <ArrowRight size={14} /></Link> : row.section ? <button type="button" onClick={() => onNavigate(row.section!)} className="mt-4 inline-flex items-center gap-2 self-start text-sm text-white/65 hover:text-white">Открыть <ArrowRight size={14} /></button> : null}</article>)}</div></DashboardPanel>}
    {data.dismissed_recommendations.length > 0 && <details className="workspace-card group"><summary className="cursor-pointer list-none text-sm text-white/45">Скрытые рекомендации · {data.dismissed_recommendations.length}</summary><div className="mt-4 space-y-2">{data.dismissed_recommendations.map((row) => <div key={row.key} className="flex items-center justify-between gap-4 rounded-xl border border-white/7 bg-black/15 p-3"><div><p className="text-sm">{row.title}</p><p className="mt-1 text-xs text-white/30">{row.source}</p></div><button type="button" disabled={busy === `restore:${row.key}`} onClick={() => void restoreRecommendation(row)} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-white/55 hover:text-white"><RotateCcw size={13} /> Вернуть</button></div>)}</div></details>}
  </div>;
}

function DashboardPanel({ icon: Icon, title, subtitle, count, children }: { icon: typeof BookOpenCheck; title: string; subtitle?: string; count?: number; children: React.ReactNode }) { return <section className="workspace-card"><div className="mb-5 flex items-start justify-between gap-4"><div><h3 className="flex items-center gap-2 text-xl"><Icon size={18} className="text-white/40" />{title}</h3>{subtitle && <p className="mt-2 text-sm text-white/35">{subtitle}</p>}</div>{typeof count === "number" && <span className="rounded-full border border-white/8 px-2.5 py-1 text-xs text-white/40">{count}</span>}</div>{children}</section>; }
function TodayActionCard({ card, timezone, onOpen }: { card: TodayAction; timezone: string; onOpen: (section: ResidentSection) => void }) { const tone = card.overdue ? "border-red-400/20 bg-red-400/[0.045]" : card.kind === "homework" ? "border-amber-300/20 bg-amber-300/[0.045]" : "border-white/9 bg-black/20"; const Icon = card.section === "homework" ? FilePenLine : card.section === "program" ? BookOpenCheck : Target; return <button type="button" onClick={() => onOpen(card.section)} className={`group flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition hover:border-white/25 ${tone}`}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06]"><Icon size={17} className="text-white/55" /></span><span className="min-w-0 flex-1"><span className="block">{card.title}</span>{card.description && <span className="mt-1 block text-sm leading-relaxed text-white/40">{card.description}</span>}<span className={`mt-3 block text-xs ${card.overdue ? "text-red-200" : "text-white/30"}`}>{card.overdue ? "Просрочено" : formatDateTime(card.due_at, timezone)}</span></span><ArrowRight size={15} className="mt-2 shrink-0 text-white/25 transition group-hover:translate-x-0.5 group-hover:text-white/70" /></button>; }
function EmptyState({ icon: Icon, title, text }: { icon: typeof Compass; title: string; text: string }) { return <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center"><Icon size={22} className="mx-auto text-white/25" /><p className="mt-3">{title}</p><p className="mt-2 text-sm text-white/35">{text}</p></div>; }
