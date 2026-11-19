"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, RefreshCw, UserRound } from "lucide-react";
import { describeApiError, getAuthJson } from "@/lib/api";

import { ParticipantBadges, type ParticipantFields } from "./ParticipantProfile";

type Row = { participant_profile?: ParticipantFields; membership_id: number; name: string; email: string; status: string; trackers: Array<{ name: string }>; teams?: Array<{ id: number; name: string }>; program: { percent: number }; homework: { accepted: number; overdue: number; total: number }; attendance: { present: number; total: number; percent?: number | null }; last_activity_at?: string | null };
type Report = { modules?: Record<string, boolean>; summary: { residents: number; enrolled: number; suspended: number; completed: number; overdue_homework: number }; rows: Row[] };
const LABELS: Record<string, string> = { accepted: "Принят", enrolled: "Зачислен", suspended: "Приостановлен", completed: "Завершил", withdrawn: "Выбыл" };

function formatStudyLabel(profile: ParticipantFields) {
  const course = profile.education_course?.trim();
  const match = course?.match(/^(БАК|МАГ|СПЕЦ|АСП)-([1-9][0-9]?)$/);
  const direction = profile.education_direction?.trim() || match?.[1];
  const courseLabel = match ? `${match[2]} курс` : course;
  return [profile.study_group?.trim(), direction, courseLabel].filter(Boolean).join(" ");
}

export function ResidentReport({ token, cohortId, onOpenParticipant, initialQuery = "", initialStatus = "all", onFiltersChange }: { token: string; cohortId: number; canManage: boolean; onChanged: () => Promise<void>; onOpenParticipant: (id: number) => void; initialQuery?: string; initialStatus?: string; onFiltersChange?: (query: string, status: string) => void }) {
  const [report, setReport] = useState<Report | null>(null); const [query, setQuery] = useState(initialQuery); const [status, setStatus] = useState(initialStatus); const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const load = useCallback(async () => { setBusy("load"); setError(""); try { setReport(await getAuthJson<Report>(`/api/accelerators/cohorts/${cohortId}/report`, token)); } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить отчёт")); } finally { setBusy(""); } }, [cohortId, token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onFiltersChange?.(query, status); }, [onFiltersChange, query, status]);
  const rows = useMemo(() => (report?.rows || []).filter((row) => (status === "all" || row.status === status) && [row.name, row.email, ...(row.teams || []).map(team => team.name)].join(" ").toLowerCase().includes(query.trim().toLowerCase())), [query, report, status]);
  const trackProgress = report?.modules?.program_progress !== false;
  const showTrackers = report?.modules?.trackers !== false;
  const showHomework = report?.modules?.homework !== false;
  const download = async () => { setBusy("csv"); setError(""); try { const headers: Record<string, string> = { "x-pitchy-api": "1" }; if (token !== "cookie-session") headers.Authorization = `Bearer ${token}`; const response = await fetch(`/api/accelerators/cohorts/${cohortId}/report?format=csv`, { headers, credentials: "include" }); if (!response.ok) throw new Error("download_failed"); const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `cohort-${cohortId}-report.csv`; anchor.click(); URL.revokeObjectURL(url); } catch (reason) { setError(describeApiError(reason, "Не удалось скачать отчёт")); } finally { setBusy(""); } };
  if (!report && busy === "load") return <div className="workspace-card grid place-items-center py-16"><Loader2 className="animate-spin text-white/40" /></div>;
  return <div className="min-w-0 space-y-5">
    {report && <div className={`grid gap-3 sm:grid-cols-2 ${showHomework ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}><Metric label="Всего" value={report.summary.residents} /><Metric label="Активны" value={report.summary.enrolled} /><Metric label="На паузе" value={report.summary.suspended} /><Metric label="Завершили" value={report.summary.completed} />{showHomework && <Metric label="Просрочено ДЗ" value={report.summary.overdue_homework} warning={report.summary.overdue_homework > 0} />}</div>}
    <section className="workspace-card min-w-0"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl">Участники</h2><p className="mt-1 text-sm text-white/35">Статус, трекер, задачи, рекомендации и аудит собраны в карточке участника.</p></div><div className="flex gap-2"><button type="button" onClick={() => void load()} aria-label="Обновить список" className="rounded-full border border-white/10 p-3 text-white/45"><RefreshCw size={16} /></button><button type="button" onClick={() => void download()} className="workspace-button" disabled={busy === "csv"}><Download size={15} /> CSV</button></div></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_220px]"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени, email или команде" className="workspace-input" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="workspace-input"><option value="all">Все статусы</option>{Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="mt-5 max-w-full overflow-x-auto" role="region" aria-label="Таблица участников" tabIndex={0}>
        <table className="w-full table-fixed text-left text-sm [&_th]:px-3 [&_th]:align-top [&_td]:px-3 [&_td]:[overflow-wrap:anywhere]" style={{ minWidth: 960 + (showTrackers ? 160 : 0) + (trackProgress ? 112 : 0) + (showHomework ? 112 : 0) }}>
          <colgroup>
            <col style={{ width: 320 }} /><col style={{ width: 240 }} /><col style={{ width: 128 }} />{showTrackers && <col style={{ width: 160 }} />}
            {trackProgress && <col style={{ width: 112 }} />}{showHomework && <col style={{ width: 112 }} />}
            <col style={{ width: 144 }} /><col style={{ width: 128 }} />
          </colgroup><thead className="text-xs uppercase tracking-wide text-white/30"><tr><th className="pb-3">Участник</th><th className="pb-3">Команды</th><th className="pb-3">Статус</th>{showTrackers && <th className="pb-3">Трекер</th>}{trackProgress && <th className="pb-3">Программа</th>}{showHomework && <th className="pb-3">Домашки</th>}<th className="pb-3">Посещение</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.membership_id} className="border-t border-white/7"><td className="py-4"><p>{row.name}</p><p className="text-xs text-white/35">{row.email}</p>{row.participant_profile && <><p className="text-xs text-white/60">{row.participant_profile.institute?.trim() || "Университет не указан"}</p><p className="text-xs text-white/50">{formatStudyLabel(row.participant_profile)}</p><ParticipantBadges profile={row.participant_profile} /></>}</td><td className="max-w-56 py-4 pr-4 text-white/65">{row.teams?.map(team => <p key={team.id}>{team.name}</p>) || "—"}{row.teams?.length === 0 && "—"}</td><td className="py-4">{LABELS[row.status] || row.status}</td>{showTrackers && <td className="py-4 text-white/55">{row.trackers.map((tracker) => tracker.name).join(", ") || "Не назначен"}</td>}{trackProgress && <td className="py-4">{row.program.percent}%</td>}{showHomework && <td className="py-4">{row.homework.accepted}/{row.homework.total}{row.homework.overdue > 0 && <span className="ml-2 text-amber-200">−{row.homework.overdue}</span>}</td>}<td className="py-4">{row.attendance.present}/{row.attendance.total}{row.attendance.percent != null && <span className="text-white/45"> · {row.attendance.percent}%</span>}</td><td className="py-4 text-right"><button type="button" onClick={() => onOpenParticipant(row.membership_id)} className="whitespace-nowrap rounded-full border border-white/12 px-3 py-2 text-xs hover:border-white/30"><UserRound size={13} className="mr-1 inline" /> Карточка</button></td></tr>)}</tbody></table>{!rows.length && <p className="py-8 text-center text-sm text-white/35">По выбранным фильтрам участников нет.</p>}</div>
    </section>{error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}
function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) { return <div className={`workspace-card ${warning ? "!border-amber-400/20" : ""}`}><p className="text-2xl">{value}</p><p className="mt-1 text-xs text-white/35">{label}</p></div>; }
