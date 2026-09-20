"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, BarChart3, BookOpen, CalendarDays, CheckCircle2, Clipboard, ClipboardCheck, FileText, Loader2, Users, UserRoundCheck, type LucideIcon } from "lucide-react";
import { getAuthJson } from "@/lib/api";

export type OrganizerTab = "overview" | "operations" | "applications" | "form" | "program" | "homework" | "attendance" | "trackers" | "reports" | "tracking" | "matching" | "project_audit" | "demo_day" | "artifacts" | "closure" | "quotas" | "settings" | "audit";
type Analytics = {
  program: { published_stages: number; completion_percent: number; participating_residents?: number; current_stage?: { id: number; title: string; completed: number; total: number } | null };
  attendance: { past_events?: number; attendance_percent: number };
  runtime_disabled_modules?: Record<string, unknown>;
};
type Issue = { code: string; severity: "error" | "warning" | "info"; count: number; message: string; recommended_action: string };
type Event = { id: number; title: string; starts_at: string; ends_at: string; status: string; event_format: string };
type Assignment = { id: number; title: string; due_at?: string | null; status: string; submission_counts: Record<string, number> };
type Tracking = { rows: Array<{ status: string; risk: { level: string } }> };
type Resident = { membership_id: number; status: string; trackers?: Array<{ user_id: number }> };
type OverviewData = { analytics?: Analytics; health?: { issues: Issue[] }; events?: Event[]; homework?: Assignment[]; tracking?: Tracking; trackers?: Array<{ user_id: number }> };

export function OrganizerOverview({ token, cohort, config, applications, residents, onNavigate, onCopy, copied, refreshKey, onOpenParticipant }: {
  token: string; cohort: { id: number; name: string; status: string; timezone: string }; config: { modules: Record<string, boolean> };
  onOpenParticipant: (id: number) => void; applications: Array<{ status: string }>; residents: Resident[]; onNavigate: (tab: OrganizerTab, targetId?: number) => void;
  onCopy: () => Promise<void>; copied: boolean; refreshKey: number;
}) {
  const [data, setData] = useState<OverviewData>({});
  const [loading, setLoading] = useState(true);
  const [failures, setFailures] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(0);
  const modules = config.modules;
  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset the request state before loading a different cohort or retrying.
    setLoading(true);
    setData({});
    setFailures([]);
    const root = `/api/accelerators/cohorts/${cohort.id}`;
    async function load() {
      const next: OverviewData = {};
      const failed: string[] = [];
      async function request<K extends keyof OverviewData>(key: K, path: string, label: string) {
        try { next[key] = await getAuthJson<OverviewData[K]>(`${root}/${path}`, token); }
        catch { failed.push(label); }
      }
      // Core telemetry also tells us which configured modules are temporarily unavailable.
      await Promise.all([request("analytics", "analytics", "показатели"), request("health", "operations-health", "состояние потока"), request("trackers", "trackers", "трекеры")]);
      const available = (key: string) => modules[key] && !next.analytics?.runtime_disabled_modules?.[key];
      await Promise.all([
        available("attendance") ? request("events", "events", "события") : Promise.resolve(),
        available("homework") ? request("homework", "homework", "задания") : Promise.resolve(),
        available("progress_tracking") ? request("tracking", "tracking-dashboard", "риски участников") : Promise.resolve(),
      ]);
      if (active) { setData(next); setFailures(failed); setNow(Date.now()); setLoading(false); }
    }
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [cohort.id, token, modules, refreshKey, retry]);

  const enrolled = residents.filter(row => row.status === "enrolled");
  const participants = residents.filter(row => ["enrolled", "completed"].includes(row.status));
  const applicationsToReview = applications.filter(row => ["submitted", "under_review"].includes(row.status)).length;
  const applicationsToEnroll = applications.filter(row => row.status === "approved").length;
  const waiting = data.homework?.filter(row => row.status === "published").reduce((sum, row) => sum + (row.submission_counts?.review_pending ?? row.submission_counts?.submitted ?? 0), 0);
  const riskCount = data.tracking?.rows.filter(row => row.status === "enrolled" && ["yellow", "red"].includes(row.risk.level)).length;
  const withoutTracker = enrolled.filter(row => !row.trackers?.length).length;
  const available = (key: string) => Boolean(modules[key] && !data.analytics?.runtime_disabled_modules?.[key]);
  const stage = data.analytics?.program.current_stage;
  const programPercent = data.analytics && participants.length && data.analytics.program.published_stages ? `${Math.round(data.analytics.program.completion_percent)}%` : "—";
  const attendancePercent = data.analytics?.attendance.past_events && participants.length ? `${Math.round(data.analytics.attendance.attendance_percent)}%` : "—";
  const upcoming = [
    ...(data.events || []).filter(row => row.status === "published" && utcDate(row.ends_at).getTime() >= now).map(row => ({ id: row.id, title: row.title, at: row.starts_at, tab: "attendance" as const, detail: row.event_format === "online" ? "Онлайн" : row.event_format === "hybrid" ? "Гибридный формат" : "Очно", action: "Открыть событие" })),
    ...(data.homework || []).filter(row => row.status === "published" && row.due_at && utcDate(row.due_at).getTime() >= now).map(row => ({ id: row.id, title: row.title, at: row.due_at!, tab: "homework" as const, detail: "Срок сдачи задания", action: "Открыть задание" })),
  ].sort((a, b) => utcDate(a.at).getTime() - utcDate(b.at).getTime()).slice(0, 3);
  const actions: Array<{ key: string; count: number; title: string; detail: string; button: string; tab: OrganizerTab; icon: LucideIcon; warning?: boolean; targetId?: number }> = [];
  if (applicationsToReview) actions.push({ key: "applications", count: applicationsToReview, title: countLabel(applicationsToReview, ["заявка ждёт решения", "заявки ждут решения", "заявок ждут решения"]), detail: "Новые и на рассмотрении", button: "Разобрать", tab: "applications", icon: FileText });
  if (applicationsToEnroll) actions.push({ key: "enroll", count: applicationsToEnroll, title: countLabel(applicationsToEnroll, ["заявка готова к зачислению", "заявки готовы к зачислению", "заявок готово к зачислению"]), detail: "Кандидаты уже одобрены", button: "Зачислить", tab: "applications", icon: UserRoundCheck });
  if (available("homework") && waiting) actions.push({ key: "homework", count: waiting, title: countLabel(waiting, ["работа на проверке", "работы на проверке", "работ на проверке"]), detail: "Ответы участников ждут обратной связи", button: "Проверить", tab: "homework", icon: ClipboardCheck, targetId: data.homework?.find(row => row.status === "published" && (row.submission_counts?.review_pending ?? row.submission_counts?.submitted))?.id });
  if (available("progress_tracking") && withoutTracker) actions.push({ key: "trackers", count: withoutTracker, title: countLabel(withoutTracker, ["участник без трекера", "участника без трекера", "участников без трекера"]), detail: "Назначьте ответственного за сопровождение", button: "Назначить", tab: "reports", icon: Users });
  if (available("progress_tracking") && riskCount) actions.push({ key: "risks", count: riskCount, title: countLabel(riskCount, ["участник в зоне риска", "участника в зоне риска", "участников в зоне риска"]), detail: "Посмотрите причины и последние чек-ины", button: "Открыть", tab: "tracking", icon: AlertTriangle, warning: true });
  const status = { draft: "Черновик", accepting: "Приём заявок", active: "Программа идёт", completed: "Завершён", archived: "Архив" }[cohort.status] || cohort.status;
  const systemIssues = (data.health?.issues || []).filter(issue => !["stale_applications", "accepted_not_enrolled", "unassigned_trackers", "stale_checkins"].includes(issue.code));

  return <div className="space-y-5" aria-busy={loading}>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">Обзор потока</h1><span className={`rounded-full px-3 py-1.5 text-xs ${cohort.status === "active" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/8 text-white/70"}`}>{status}</span></div><p className="mt-2 text-sm text-white/55">{cohort.name} · Главное на сегодня</p></div>
      <div className="flex flex-wrap gap-2"><button onClick={() => void onCopy()} className="overview-secondary"><Clipboard size={15} />{copied ? "Скопировано" : "Ссылка на заявку"}</button><button onClick={() => onNavigate("program")} className="workspace-button"><BookOpen size={16} />Открыть программу</button></div>
    </header>
    {failures.length > 0 && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm text-amber-100"><span>Не удалось загрузить: {failures.join(", ")}. Остальные разделы доступны.</span><button onClick={() => setRetry(value => value + 1)} className="underline underline-offset-4">Повторить загрузку</button></div>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Metric icon={Users} label="Участники" value={participants.length} onClick={() => onNavigate("reports")} />
      <Metric icon={BookOpen} label="Пройдено программы" value={loading ? "…" : programPercent} onClick={() => onNavigate("program")} />
      {modules.attendance ? <Metric icon={BarChart3} label="Посещаемость" value={loading ? "…" : attendancePercent} onClick={() => onNavigate("attendance")} disabled={!available("attendance")} /> : <Metric icon={FileText} label="Заявки в работе" value={applications.filter(row => ["submitted", "under_review", "needs_info", "waitlisted"].includes(row.status)).length} onClick={() => onNavigate("applications")} />}
      <Metric icon={UserRoundCheck} label="Трекеры" value={loading ? "…" : data.trackers ? new Set(data.trackers.map(row => row.user_id)).size : "—"} onClick={() => onNavigate("matching")} />
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
      <Panel title="Требует внимания">
        {loading ? <Loading /> : actions.length ? <div className="divide-y divide-white/8">{actions.map(action => <div key={action.key} className="overview-action flex flex-wrap items-center gap-3 py-4 first:pt-1 last:pb-0"><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${action.warning ? "bg-amber-300/10 text-amber-300" : "bg-white/7 text-white/75"}`}><action.icon size={21} /></span><div className="min-w-0 flex-1 basis-40"><p className="text-sm font-medium"><strong className="mr-2 text-xl">{action.count}</strong>{action.title}</p><p className="mt-1 text-xs leading-relaxed text-white/50">{action.detail}</p></div><button className="workspace-button !rounded-xl !px-4 !py-2 !text-xs" onClick={() => { onNavigate(action.tab, action.targetId); if (action.key === "trackers") { const resident = enrolled.find(row => !row.trackers?.length); if (resident) onOpenParticipant(resident.membership_id); } }}>{action.button}</button></div>)}</div> : <div className="py-6"><CheckCircle2 size={28} className="mb-3 text-emerald-300" /><p className="font-medium">{failures.length ? "Задач в загруженных разделах нет" : "Срочных задач нет"}</p><p className="mt-2 text-sm text-white/50">{cohort.status === "draft" ? "Подготовьте анкету и программу, затем откройте набор." : "Проверьте программу или откройте список участников."}</p><div className="mt-4 flex flex-wrap gap-3"><TextAction onClick={() => onNavigate(cohort.status === "draft" ? "form" : "reports")}>{cohort.status === "draft" ? "Настроить анкету" : "Все участники"}</TextAction>{cohort.status === "draft" && <TextAction onClick={() => onNavigate("settings")}>Настроить поток</TextAction>}</div></div>}
      </Panel>
      <Panel title="Ближайшее">
        {loading ? <Loading /> : upcoming.length ? <div className="divide-y divide-white/8">{upcoming.map(item => <div key={`${item.tab}-${item.id}`} className="flex gap-4 py-4 first:pt-1 last:pb-0"><div className="w-24 shrink-0 border-r border-white/10 pr-3"><p className="text-xs text-white/50">{utcDate(item.at).toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: cohort.timezone })}</p><p className="mt-2 text-lg font-medium">{utcDate(item.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: cohort.timezone })}</p></div><div className="min-w-0"><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-white/50">{item.detail}</p><TextAction onClick={() => onNavigate(item.tab, item.id)}>{item.action}</TextAction></div></div>)}</div> : <div className="py-6"><CalendarDays size={28} className="mb-3 text-white/40" /><p className="text-sm text-white/55">Ближайших событий и сроков сдачи пока нет.</p>{modules.attendance && available("attendance") && <TextAction onClick={() => onNavigate("attendance")}>Открыть мероприятия</TextAction>}</div>}
        <p className="mt-5 text-xs text-white/35">Время потока: {cohort.timezone}</p>
      </Panel>
    </div>
    <section className="overview-panel"><div className="flex flex-wrap items-center justify-between gap-5"><div className="min-w-0 flex-1"><h2 className="text-lg font-semibold">{stage ? `Текущий этап · ${stage.title}` : "Программа потока"}</h2><p className="mt-2 text-sm text-white/55">{loading ? "Загружаем прогресс…" : stage ? stage.total ? `${stage.completed} из ${stage.total} участников завершили этап` : "Пока нет зачисленных участников" : "Нет доступного опубликованного этапа"}</p>{stage && stage.total > 0 && <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8" role="progressbar" aria-label="Прогресс текущего этапа" aria-valuemin={0} aria-valuemax={stage.total} aria-valuenow={stage.completed}><div className="h-full rounded-full bg-white/85" style={{ width: `${Math.min(100, stage.completed * 100 / stage.total)}%` }} /></div>}</div><TextAction onClick={() => onNavigate("program", stage?.id)}>{stage ? "Перейти к этапу" : "Открыть программу"}</TextAction></div></section>
    {systemIssues.map(issue => <div key={issue.code} className={`flex flex-wrap items-center gap-4 rounded-xl border px-5 py-4 ${issue.severity === "error" ? "border-red-300/20 bg-red-300/5 text-red-200" : "border-amber-300/20 bg-amber-300/5 text-amber-200"}`}><AlertTriangle size={22} className="shrink-0" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{issue.message} · {issue.count}</p><p className="mt-1 text-xs text-white/55">{issue.recommended_action}</p></div><TextAction onClick={() => onNavigate("operations")}>Подробнее</TextAction></div>)}
    <style jsx global>{`.overview-panel{border:1px solid rgba(255,255,255,.09);border-radius:16px;background:#1c1b1b;padding:24px}.overview-secondary{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:11px 14px;color:#e5e2e1;font-size:13px}.overview-secondary:hover{background:rgba(255,255,255,.06)}.overview-link{display:inline-flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;color:#e5e2e1}.overview-link:hover{text-decoration:underline;text-underline-offset:4px}@media(max-width:640px){.overview-panel{padding:18px}}@media(max-width:480px){.overview-action{display:grid;grid-template-columns:44px minmax(0,1fr)}.overview-action>button{grid-column:2;justify-self:start}}`}</style>
  </div>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="overview-panel"><h2 className="mb-5 border-b border-white/8 pb-4 text-lg font-semibold">{title}</h2>{children}</section>; }
function Loading() { return <div className="grid min-h-40 place-items-center" role="status" aria-label="Загрузка обзора"><Loader2 className="animate-spin text-white/45" /></div>; }
function TextAction({ onClick, children }: { onClick: () => void; children: ReactNode }) { return <button type="button" onClick={onClick} className="overview-link">{children}<ArrowRight size={15} /></button>; }
function Metric({ icon: Icon, label, value, onClick, disabled = false }: { icon: LucideIcon; label: string; value: string | number; onClick: () => void; disabled?: boolean }) { return <button type="button" onClick={onClick} disabled={disabled} className="overview-panel flex flex-col items-start gap-3 text-left sm:flex-row sm:items-center sm:gap-4 transition-colors hover:!border-white/25 disabled:opacity-50" aria-label={`${label}: ${value}`}><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/6 text-white/70"><Icon size={23} /></span><span><strong className="block text-3xl font-semibold tracking-tight">{value}</strong><span className="mt-1 block text-xs text-white/55">{label}</span></span></button>; }

function countLabel(count: number, forms: [string, string, string]) { const value = count % 100; return forms[value >= 11 && value <= 14 ? 2 : count % 10 === 1 ? 0 : count % 10 >= 2 && count % 10 <= 4 ? 1 : 2]; }

// Accelerator timestamps are stored as UTC and may arrive without a zone suffix.
function utcDate(value: string) { return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`); }
