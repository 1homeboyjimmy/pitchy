"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";

import { describeApiError, getAuthJson, patchAuthJson } from "@/lib/api";

type ReportRow = {
  membership_id: number; name: string; email: string; status: string; status_reason?: string | null;
  trackers: Array<{ user_id: number; name: string }>;
  program: { completed: number; total: number; percent: number };
  homework: { accepted: number; waiting_review: number; overdue: number; total: number };
  attendance: { present: number; marked: number; total: number };
  quota: Record<string, { limit: number; used: number; remaining?: number | null }>;
  last_activity_at?: string | null;
};
type Report = { access_role: "global_admin" | "organizer" | "tracker"; summary: { residents: number; enrolled: number; suspended: number; completed: number; overdue_homework: number }; rows: ReportRow[] };
type LifecycleEvent = { id: number; from_status?: string | null; to_status: string; actor_user_id?: number | null; reason?: string | null; created_at: string };

const STATUS_LABELS: Record<string, string> = { accepted: "Принят", enrolled: "Зачислен", suspended: "Приостановлен", completed: "Завершил", withdrawn: "Выбыл" };
const TRANSITIONS: Record<string, Array<{ status: string; label: string }>> = {
  accepted: [{ status: "enrolled", label: "Зачислить" }, { status: "withdrawn", label: "Отметить выбытие" }],
  enrolled: [{ status: "suspended", label: "Приостановить" }, { status: "completed", label: "Завершил программу" }, { status: "withdrawn", label: "Отметить выбытие" }],
  suspended: [{ status: "enrolled", label: "Возобновить" }, { status: "withdrawn", label: "Отметить выбытие" }],
};

export function ResidentReport({ token, cohortId, canManage, onChanged }: { token: string; cohortId: number; canManage: boolean; onChanged: () => Promise<void> }) {
  const [report, setReport] = useState<Report | null>(null); const [query, setQuery] = useState(""); const [status, setStatus] = useState("all"); const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [history, setHistory] = useState<Record<number, LifecycleEvent[]>>({}); const [openHistoryId, setOpenHistoryId] = useState<number | null>(null);
  const load = useCallback(async () => { setBusy("load"); try { setReport(await getAuthJson<Report>(`/api/accelerators/cohorts/${cohortId}/report`, token)); } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить отчёт")); } finally { setBusy(""); } }, [cohortId, token]);
  useEffect(() => { void load(); }, [load]);
  const rows = useMemo(() => (report?.rows || []).filter((row) => (status === "all" || row.status === status) && `${row.name} ${row.email}`.toLowerCase().includes(query.trim().toLowerCase())), [query, report, status]);
  const lifecycle = async (row: ReportRow, next: string) => {
    const reason = window.prompt(`Причина изменения статуса «${STATUS_LABELS[next]}» для ${row.name}:`);
    if (!reason?.trim()) return;
    setBusy(`status-${row.membership_id}`); setError("");
    try { await patchAuthJson(`/api/accelerators/memberships/${row.membership_id}/status`, { status: next, reason: reason.trim() }, token); await Promise.all([load(), onChanged()]); }
    catch (reasonValue) { setError(describeApiError(reasonValue, "Не удалось изменить статус резидента")); }
    finally { setBusy(""); }
  };
  const download = async () => {
    setBusy("csv"); setError("");
    try {
      const headers: Record<string, string> = { "x-pitchy-api": "1" }; if (token !== "cookie-session") headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`/api/accelerators/cohorts/${cohortId}/report?format=csv`, { headers, credentials: "include" });
      if (!response.ok) throw new Error("download_failed");
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `cohort-${cohortId}-report.csv`; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(describeApiError(reason, "Не удалось скачать отчёт")); }
    finally { setBusy(""); }
  };
  const toggleHistory = async (membershipId: number) => {
    if (openHistoryId === membershipId) { setOpenHistoryId(null); return; }
    setOpenHistoryId(membershipId);
    if (history[membershipId]) return;
    setBusy(`history-${membershipId}`); setError("");
    try {
      const events = await getAuthJson<LifecycleEvent[]>(`/api/accelerators/memberships/${membershipId}/lifecycle-events`, token);
      setHistory((current) => ({ ...current, [membershipId]: events }));
    }
    catch (reason) { setOpenHistoryId(null); setError(describeApiError(reason, "Не удалось загрузить историю резидента")); }
    finally { setBusy(""); }
  };
  if (!report && busy === "load") return <div className="workspace-card grid place-items-center py-16"><Loader2 className="animate-spin text-white/40" /></div>;
  return <div className="space-y-5">
    {report && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Всего" value={report.summary.residents} /><Metric label="Активны" value={report.summary.enrolled} /><Metric label="На паузе" value={report.summary.suspended} /><Metric label="Завершили" value={report.summary.completed} /><Metric label="Просрочено ДЗ" value={report.summary.overdue_homework} warning={report.summary.overdue_homework > 0} /></div>}
    <section className="workspace-card"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl">Отчёт по резидентам</h2><p className="mt-1 text-sm text-white/35">Программа, домашние задания, посещаемость и назначенные лимиты.</p></div><div className="flex gap-2"><button type="button" onClick={() => void load()} className="rounded-full border border-white/10 p-3 text-white/45"><RefreshCw size={16} /></button><button type="button" onClick={() => void download()} className="workspace-button" disabled={busy === "csv"}><Download size={15} /> CSV</button></div></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_220px]"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени или email" className="workspace-input" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="workspace-input"><option value="all">Все статусы</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="mt-5 overflow-x-auto"><table className="min-w-[1220px] w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-white/30"><tr><th className="pb-3">Резидент</th><th className="pb-3">Статус</th><th className="pb-3">Трекер</th><th className="pb-3">Программа</th><th className="pb-3">Домашки</th><th className="pb-3">Посещение</th><th className="pb-3">Активные лимиты</th><th className="pb-3">Последняя активность</th><th className="pb-3">Жизненный цикл</th></tr></thead><tbody>{rows.map((row) => <RowWithHistory key={row.membership_id} row={row} canManage={canManage} busy={busy} events={history[row.membership_id]} historyOpen={openHistoryId === row.membership_id} onLifecycle={lifecycle} onToggleHistory={toggleHistory} />)}</tbody></table>{!rows.length && <p className="py-10 text-center text-sm text-white/35">По выбранным условиям резиденты не найдены.</p>}</div>
    </section>{error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}

function RowWithHistory({ row, canManage, busy, events, historyOpen, onLifecycle, onToggleHistory }: { row: ReportRow; canManage: boolean; busy: string; events?: LifecycleEvent[]; historyOpen: boolean; onLifecycle: (row: ReportRow, next: string) => Promise<void>; onToggleHistory: (membershipId: number) => Promise<void> }) {
  return <><tr className="border-t border-white/[.07] align-top"><td className="py-4 pr-4"><p>{row.name}</p><p className="text-xs text-white/35">{row.email}</p></td><td className="py-4 pr-4"><span className="rounded-full bg-white/7 px-2 py-1 text-xs">{STATUS_LABELS[row.status] || row.status}</span>{row.status_reason && <p className="mt-2 max-w-40 text-xs text-white/30">{row.status_reason}</p>}</td><td className="py-4 pr-4 text-white/55">{row.trackers.map((tracker) => tracker.name).join(", ") || "—"}</td><td className="py-4 pr-4"><p>{row.program.percent}%</p><p className="text-xs text-white/35">{row.program.completed} из {row.program.total}</p></td><td className="py-4 pr-4"><p>{row.homework.accepted} из {row.homework.total}</p>{row.homework.overdue > 0 && <p className="text-xs text-amber-300">Просрочено: {row.homework.overdue}</p>}</td><td className="py-4 pr-4"><p>{row.attendance.present} из {row.attendance.total}</p></td><td className="py-4 pr-4"><QuotaSummary quota={row.quota} /></td><td className="py-4 pr-4 text-xs text-white/40">{row.last_activity_at ? new Date(row.last_activity_at).toLocaleString("ru-RU") : "—"}</td><td className="py-4"><div className="flex max-w-52 flex-wrap gap-2">{canManage && (TRANSITIONS[row.status] || []).map((action) => <button type="button" key={action.status} onClick={() => void onLifecycle(row, action.status)} disabled={Boolean(busy)} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:text-white">{action.label}</button>)}<button type="button" onClick={() => void onToggleHistory(row.membership_id)} disabled={busy === `history-${row.membership_id}`} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:text-white">{historyOpen ? "Скрыть историю" : "История"}</button></div></td></tr>{historyOpen && <tr className="border-t border-white/[.04]"><td colSpan={9} className="pb-5 pt-1"><div className="rounded-2xl bg-white/[.025] p-4"><p className="text-xs uppercase tracking-wide text-white/30">История статусов</p><div className="mt-3 grid gap-2">{!events ? <p className="text-sm text-white/35">Загрузка…</p> : events.map((event) => <div key={event.id} className="flex flex-wrap items-start justify-between gap-3 border-l border-white/15 pl-3 text-sm"><div><p>{event.from_status ? `${STATUS_LABELS[event.from_status] || event.from_status} → ` : ""}{STATUS_LABELS[event.to_status] || event.to_status}</p><p className="mt-1 text-xs text-white/35">{event.reason || "Без комментария"}</p></div><time className="text-xs text-white/30">{new Date(event.created_at).toLocaleString("ru-RU")}</time></div>)}</div></div></td></tr>}</>;
}

function QuotaSummary({ quota }: { quota: ReportRow["quota"] }) {
  const labels: Record<string, string> = { messages: "Сообщ.", roadmaps: "Карты", custdev: "Кастдев", grants: "Гранты" };
  const entries = Object.entries(labels).map(([resource, label]) => ({ resource, label, value: quota[resource] })).filter((item) => item.value);
  if (!entries.length) return <span className="text-xs text-white/30">Нет активных</span>;
  return <div className="space-y-1 text-xs">{entries.map((item) => <p key={item.resource}><span className="text-white/35">{item.label}:</span> {item.value.used}/{item.value.limit === -1 ? "∞" : item.value.limit}</p>)}</div>;
}

function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) { return <div className={`workspace-card ${warning ? "!border-amber-300/25" : ""}`}><p className="text-xs uppercase tracking-wide text-white/30">{label}</p><p className={`mt-2 text-3xl ${warning ? "text-amber-200" : ""}`}>{value}</p></div>; }
