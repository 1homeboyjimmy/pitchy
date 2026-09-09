"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Activity, ClipboardCheck, Loader2, RefreshCw, UserRound, X } from "lucide-react";

import { describeApiError, getAuthJson, patchAuthJson, postAuthJson, putAuthJson } from "@/lib/api";

type Card = {
  membership_id: number;
  access_role: string;
  can_manage: boolean;
  available_statuses: string[];
  person?: { name: string; email: string } | null;
  membership: { status: string; status_reason?: string | null; accepted_at?: string | null; enrolled_at?: string | null };
  application?: { id: number; type: string; status: string; form_version: number; answers: Record<string, unknown>; submitted_at: string } | null;
  profile: Record<string, unknown>;
  project?: { id: number; name: string; readiness: number; status: string } | null;
  team?: { id: number; name: string; role: string } | null;
  trackers: Array<{ user_id: number; name: string; email: string }>;
  tracker_options: Array<{ user_id: number; name: string; email: string }>;
  homework: { published: number; accepted: number; pending: number; overdue: number; submissions: Array<{ id: number; title: string; status: string; submitted_at: string }> };
  risk: { level: string; reasons: string[]; overdue_tasks: number; overdue_homework: number; last_activity_at?: string | null };
  checkins: Array<{ id: number; period_start: string; health: string; summary: string; blockers?: string | null }>;
  feedback: Array<{ id: number; body: string; read_at?: string | null; created_at: string }>;
  audit?: { id: number; type: string; status: string; score?: number | null; created_at: string } | null;
  lifecycle: Array<{ id: number; from_status?: string | null; to_status: string; reason?: string | null; created_at: string }>;
  last_action: { title: string; at: string };
};

const STATUS: Record<string, string> = { accepted: "Принят", enrolled: "Зачислен", suspended: "Приостановлен", completed: "Завершил", withdrawn: "Выбыл" };

export function ParticipantDrawer({ membershipId, token, onClose, onChanged }: { membershipId: number; token: string; onClose: () => void; onChanged?: () => Promise<void> | void }) {
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [task, setTask] = useState({ title: "", description: "", dueAt: "" });
  const [recommendation, setRecommendation] = useState({ title: "", description: "" });
  const load = useCallback(async () => {
    setError("");
    try { setCard(await getAuthJson<Card>(`/api/accelerators/memberships/${membershipId}/organizer-card`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить карточку участника")); }
  }, [membershipId, token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const changeStatus = async (status: string) => {
    const reason = window.prompt(`Причина перехода в статус «${STATUS[status] || status}»:`);
    if (!reason?.trim()) return;
    setBusy("status"); setError("");
    try { await patchAuthJson(`/api/accelerators/memberships/${membershipId}/status`, { status, reason: reason.trim() }, token); await load(); await onChanged?.(); }
    catch (reasonValue) { setError(describeApiError(reasonValue, "Не удалось изменить статус")); }
    finally { setBusy(""); }
  };
  const changeTracker = async (value: string) => {
    setBusy("tracker"); setError("");
    try { await putAuthJson(`/api/accelerators/memberships/${membershipId}/tracker`, { tracker_user_id: value ? Number(value) : null }, token); await load(); await onChanged?.(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось назначить трекера")); }
    finally { setBusy(""); }
  };
  const addTask = async (event: FormEvent) => {
    event.preventDefault(); setBusy("task"); setError("");
    try { await postAuthJson(`/api/accelerators/memberships/${membershipId}/tracking-tasks`, { title: task.title.trim(), description: task.description.trim() || null, due_at: task.dueAt ? new Date(task.dueAt).toISOString() : null }, token); setTask({ title: "", description: "", dueAt: "" }); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось создать задачу")); }
    finally { setBusy(""); }
  };
  const addRecommendation = async (event: FormEvent) => {
    event.preventDefault(); setBusy("recommendation"); setError("");
    try { await postAuthJson(`/api/accelerators/memberships/${membershipId}/recommendations`, { title: recommendation.title.trim(), description: recommendation.description.trim(), section: "tracking", href: `/accelerator/my/${membershipId}?section=today` }, token); setRecommendation({ title: "", description: "" }); }
    catch (reason) { setError(describeApiError(reason, "Не удалось добавить рекомендацию")); }
    finally { setBusy(""); }
  };
  const launchAudit = async () => {
    setBusy("audit"); setError("");
    try { await postAuthJson(`/api/accelerators/memberships/${membershipId}/project-audits`, { audit_type: "product", focus: null, client_request_id: `participant-card:${membershipId}:${Date.now()}` }, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось запустить аудит")); }
    finally { setBusy(""); }
  };

  return <div className="fixed inset-0 z-50 bg-black/70" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside role="dialog" aria-modal="true" aria-label="Карточка участника" className="ml-auto h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#080808] p-5 text-white shadow-2xl sm:p-7">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.18em] text-white/30">Единая карточка участника</p><h2 className="mt-2 text-2xl">{card?.person?.name || "Участник"}</h2><p className="mt-1 text-sm text-white/40">{card?.person?.email}</p></div><div className="flex gap-2"><button type="button" onClick={() => void load()} aria-label="Обновить карточку" className="rounded-full border border-white/10 p-3 text-white/50"><RefreshCw size={16} /></button><button type="button" onClick={onClose} aria-label="Закрыть карточку" className="rounded-full border border-white/10 p-3 text-white/50"><X size={16} /></button></div></div>
      {!card && !error && <div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin text-white/35" /></div>}
      {error && <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
      {card && <div className="mt-6 space-y-4">
        <section className="rounded-2xl border border-white/10 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-white/35">Статус и последнее действие</p><p className="mt-1">{STATUS[card.membership.status] || card.membership.status}</p><p className="mt-2 text-sm text-white/45">{card.last_action.title} · {formatDate(card.last_action.at)}</p></div>{card.can_manage && <div className="flex flex-wrap gap-2">{card.available_statuses.map((status) => <button type="button" key={status} disabled={Boolean(busy)} onClick={() => void changeStatus(status)} className="rounded-full border border-white/15 px-3 py-2 text-xs">{STATUS[status] || status}</button>)}</div>}</div></section>
        <div className="grid gap-4 sm:grid-cols-2"><Info title="Проект">{card.project ? <><p>{card.project.name}</p><p className="text-sm text-white/40">Паспорт заполнен на {card.project.readiness}%</p></> : <p className="text-sm text-white/35">Проект не привязан</p>}</Info><Info title="Команда">{card.team ? <><p>{card.team.name}</p><p className="text-sm text-white/40">Роль: {card.team.role}</p></> : <p className="text-sm text-white/35">Без команды</p>}</Info></div>
        <section className="rounded-2xl border border-white/10 p-4"><p className="text-xs uppercase tracking-wide text-white/35">Трекер</p><p className="mt-2 text-sm">{card.trackers.map((row) => row.name).join(", ") || "Не назначен"}</p>{card.can_manage && !card.team && <select value={card.trackers[0]?.user_id || ""} onChange={(event) => void changeTracker(event.target.value)} disabled={busy === "tracker"} className="workspace-input mt-3"><option value="">Без трекера</option>{card.tracker_options.map((row) => <option key={row.user_id} value={row.user_id}>{row.name}</option>)}</select>}{card.team && <p className="mt-2 text-xs text-white/35">Назначение меняется один раз для всей команды в разделе «Матчмейкинг».</p>}</section>
        <div className="grid gap-4 sm:grid-cols-3"><Metric label="ДЗ принято" value={`${card.homework.accepted}/${card.homework.published}`} /><Metric label="На проверке" value={String(card.homework.pending)} /><Metric label="Просрочено" value={String(card.homework.overdue + card.risk.overdue_tasks)} warning={card.homework.overdue + card.risk.overdue_tasks > 0} /></div>
        <Info title="Риск"><p className={card.risk.level === "red" ? "text-red-200" : card.risk.level === "yellow" ? "text-amber-200" : "text-emerald-200"}>{card.risk.level === "red" ? "Высокий" : card.risk.level === "yellow" ? "Требует внимания" : "Стабильно"}</p>{card.risk.reasons.map((reason) => <p key={reason} className="mt-1 text-sm text-white/45">• {reason}</p>)}</Info>
        <Info title="Заявка и профиль"><p className="text-sm text-white/55">Анкета: {card.application ? `версия ${card.application.form_version}, ${card.application.type}` : "нет данных"}</p><KeyValues values={card.application?.answers || {}} /><KeyValues values={card.profile} /></Info>
        <Info title="Чек-ины и обратная связь"><div className="space-y-3">{card.checkins.map((row) => <div key={`c-${row.id}`}><p className="text-sm">{row.period_start} · {row.health}</p><p className="text-sm text-white/45">{row.summary}</p></div>)}{card.feedback.map((row) => <div key={`f-${row.id}`}><p className="text-sm text-white/35">Обратная связь · {formatDate(row.created_at)}</p><p className="text-sm text-white/60">{row.body}</p></div>)}{!card.checkins.length && !card.feedback.length && <p className="text-sm text-white/35">Записей пока нет.</p>}</div></Info>
        <Info title="Аудит проекта"><p className="text-sm text-white/50">{card.audit ? `${card.audit.type} · ${card.audit.status}${card.audit.score != null ? ` · ${card.audit.score}/100` : ""}` : "Аудит ещё не запускался"}</p>{card.project && <button type="button" onClick={() => void launchAudit()} disabled={Boolean(busy)} className="workspace-button mt-3"><Activity size={15} /> Запустить аудит</button>}</Info>
        <form onSubmit={addTask} className="rounded-2xl border border-white/10 p-4"><h3>Создать обязательную задачу</h3><div className="mt-3 grid gap-3"><input required minLength={2} value={task.title} onChange={(event) => setTask({ ...task, title: event.target.value })} placeholder="Название" className="workspace-input" /><textarea value={task.description} onChange={(event) => setTask({ ...task, description: event.target.value })} placeholder="Описание" className="workspace-input resize-y" /><input type="datetime-local" value={task.dueAt} onChange={(event) => setTask({ ...task, dueAt: event.target.value })} className="workspace-input" /><button disabled={Boolean(busy)} className="workspace-button"><ClipboardCheck size={15} /> Назначить</button></div></form>
        <form onSubmit={addRecommendation} className="rounded-2xl border border-white/10 p-4"><h3>Добавить добровольную рекомендацию</h3><div className="mt-3 grid gap-3"><input required minLength={2} value={recommendation.title} onChange={(event) => setRecommendation({ ...recommendation, title: event.target.value })} placeholder="Заголовок" className="workspace-input" /><textarea required minLength={2} value={recommendation.description} onChange={(event) => setRecommendation({ ...recommendation, description: event.target.value })} placeholder="Почему это полезно" className="workspace-input resize-y" /><button disabled={Boolean(busy)} className="workspace-button"><UserRound size={15} /> Добавить рекомендацию</button></div></form>
        <Info title="История статусов">{card.lifecycle.map((row) => <p key={row.id} className="mb-2 text-sm text-white/50">{formatDate(row.created_at)} · {STATUS[row.to_status] || row.to_status}{row.reason ? ` — ${row.reason}` : ""}</p>)}</Info>
      </div>}
    </aside>
  </div>;
}

function Info({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-white/10 p-4"><h3 className="mb-3 text-xs uppercase tracking-wide text-white/35">{title}</h3>{children}</section>; }
function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <div className={`rounded-2xl border p-4 ${warning ? "border-amber-400/20 bg-amber-400/[.05]" : "border-white/10"}`}><p className="text-2xl">{value}</p><p className="mt-1 text-xs text-white/35">{label}</p></div>; }
function KeyValues({ values }: { values: Record<string, unknown> }) { const rows = Object.entries(values).filter(([, value]) => value !== null && value !== "" && !Array.isArray(value)); return rows.length ? <dl className="mt-3 space-y-2">{rows.slice(0, 12).map(([key, value]) => <div key={key}><dt className="text-xs text-white/30">{key}</dt><dd className="break-words text-sm text-white/60">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl> : null; }
function formatDate(value?: string | null) { return value ? new Date(value).toLocaleString("ru-RU") : "—"; }
