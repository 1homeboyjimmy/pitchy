"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Activity, ClipboardCheck, FileText, Loader2, RefreshCw, Trash2, X } from "lucide-react";

import { describeProjectAuditLaunchError } from "@/lib/acceleratorProjectAudit";
import { describeApiError, getAuthJson, patchAuthJson, postAuthJson, putAuthJson } from "@/lib/api";
import { notifySuccess } from "@/lib/ui";

import { ParticipantProfileForm, type ParticipantFields } from "./ParticipantProfile";

const PassportModal = dynamic(() => import("@/components/dashboard/PassportModal").then(module => module.PassportModal));

type Card = {
  membership_id: number;
  access_role: string;
  can_manage: boolean;
  modules?: Record<string, boolean>;
  attendance?: { present: number; total: number; percent: number | null };
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
  program: { completed: number; total: number; percent: number; stages: Array<{ id: number; title: string; state: "locked" | "available" | "in_progress" | "completed" | "overdue" | "waived"; completed_required: number; required_total: number; completion_source?: string | null; waiver_reason?: string | null; blockers: Array<{ kind: string; title: string; reason: string }>; policy: { mode: "auto" | "manual" | "none" } }> };
  risk: { level: string; reasons: string[]; overdue_tasks: number; overdue_homework: number; last_activity_at?: string | null };
  checkins: Array<{ id: number; period_start: string; health: string; summary: string; blockers?: string | null }>;
  feedback: Array<{ id: number; body: string; read_at?: string | null; created_at: string }>;
  tasks?: Array<{ id: number; title: string; description?: string | null; due_at?: string | null }>;
  audit?: { id: number; type: string; status: string; score?: number | null; created_at: string } | null;
  audits?: Array<{ id: number; number: number; type: string; status: string; score?: number | null; created_at: string }>;
  lifecycle: Array<{ id: number; from_status?: string | null; to_status: string; reason?: string | null; created_at: string }>;
  activity?: Array<{ key: string; kind: string; title: string; detail?: string | null; at: string }>;
  last_action: { title: string; at: string };
};

const STATUS: Record<string, string> = { accepted: "Принят", enrolled: "Зачислен", suspended: "Приостановлен", completed: "Завершил", withdrawn: "Выбыл" };

export function ParticipantDrawer({ membershipId, token, onClose, onChanged }: { membershipId: number; token: string; onClose: () => void; onChanged?: () => Promise<void> | void }) {
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [task, setTask] = useState({ title: "", description: "", dueAt: "" });
  const [passportOpen, setPassportOpen] = useState(false);
  const passportButtonRef = useRef<HTMLButtonElement>(null);
  const closePassport = useCallback(() => {
    setPassportOpen(false);
    requestAnimationFrame(() => passportButtonRef.current?.focus());
  }, []);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    setError("");
    try { setCard(await getAuthJson<Card>(`/api/accelerators/memberships/${membershipId}/organizer-card`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить карточку участника")); }
  }, [membershipId, token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (passportOpen) closePassport();
      else onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closePassport, onClose, passportOpen]);

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
    try { await postAuthJson(`/api/accelerators/memberships/${membershipId}/tracking-tasks`, { title: task.title.trim(), description: task.description.trim() || null, due_at: task.dueAt ? new Date(task.dueAt).toISOString() : null }, token); setTask({ title: "", description: "", dueAt: "" }); await load(); notifySuccess("Обязательная задача назначена участнику"); }
    catch (reason) { setError(describeApiError(reason, "Не удалось создать задачу")); }
    finally { setBusy(""); }
  };
  const removeTask = async (taskId: number, title: string) => {
    if (!window.confirm(`Удалить задачу «${title}» из текущих?`)) return;
    setBusy(`remove-task-${taskId}`);
    setError("");
    try {
      await patchAuthJson(`/api/accelerators/tracking-tasks/${taskId}`, { status: "cancelled" }, token);
      await load();
      notifySuccess("Задача удалена из текущих");
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось удалить задачу"));
    } finally {
      setBusy("");
    }
  };
  const launchAudit = async () => {
    setBusy("audit"); setAuditError("");
    try { await postAuthJson(`/api/accelerators/memberships/${membershipId}/project-audits`, { audit_type: "product", focus: null, client_request_id: `participant-card:${membershipId}:${Date.now()}` }, token); await load(); }
    catch (reason) { setAuditError(describeProjectAuditLaunchError(reason)); }
    finally { setBusy(""); }
  };
  const changeProgramStage = async (stageId: number, action: "complete-manually" | "waive") => {
    const reason = window.prompt(action === "waive" ? "Почему требование снимается?" : "Комментарий к ручному подтверждению:");
    if (!reason?.trim()) return;
    setBusy(`stage-${stageId}`); setError("");
    try {
      await postAuthJson(`/api/accelerators/program/stages/${stageId}/${action}`, { membership_id: membershipId, reason: reason.trim() }, token);
      await load();
      notifySuccess(action === "waive" ? "Требование снято" : "Этап подтверждён");
    } catch (reasonValue) { setError(describeApiError(reasonValue, "Не удалось изменить этап")); }
    finally { setBusy(""); }
  };

  const audits = card?.audits ?? (card?.audit ? [{ ...card.audit, number: 1 }] : []);
  const activityRows = card?.activity || card?.lifecycle.map((row) => ({
    key: `lifecycle-${row.id}`,
    kind: "lifecycle",
    title: row.reason || `Статус: ${STATUS[row.to_status] || row.to_status}`,
    detail: null,
    at: row.created_at,
  })) || [];

  return <div className="fixed inset-0 z-50 bg-black/70" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside inert={passportOpen} role="dialog" aria-modal="true" aria-label="Карточка участника" className="ml-auto h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#080808] p-5 text-white shadow-2xl sm:p-7">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.18em] text-white/30">Единая карточка участника</p><h2 className="mt-2 text-2xl">{card?.person?.name || "Участник"}</h2><p className="mt-1 text-sm text-white/40">{card?.person?.email}</p></div><div className="flex gap-2"><button type="button" onClick={() => void load()} aria-label="Обновить карточку" className="rounded-full border border-white/10 p-3 text-white/50"><RefreshCw size={16} /></button><button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Закрыть карточку" className="rounded-full border border-white/10 p-3 text-white/50"><X size={16} /></button></div></div>
      {!card && !error && <div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin text-white/35" /></div>}
      {error && <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
      {card && <div className="mt-6 space-y-4">
        {card.can_manage && <ParticipantProfileForm key={`${membershipId}:${JSON.stringify(card.profile)}`} membershipId={membershipId} token={token} profile={card.profile as ParticipantFields} manager onSaved={async () => { await load(); await onChanged?.(); }} />}
        <section className="rounded-2xl border border-white/10 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-white/35">Статус и активность</p><p className="mt-1">{STATUS[card.membership.status] || card.membership.status}</p><p className="mt-2 text-sm text-white/45">{card.last_action.title} · {formatDate(card.last_action.at)}</p></div>{card.can_manage && <div className="flex flex-wrap gap-2">{card.available_statuses.map((status) => <button type="button" key={status} disabled={Boolean(busy)} onClick={() => void changeStatus(status)} className="rounded-full border border-white/15 px-3 py-2 text-xs">{STATUS[status] || status}</button>)}</div>}</div></section>
        <div className="grid gap-4 sm:grid-cols-2"><Info title="Проект">{card.project ? <><p>{card.project.name}</p><p className="text-sm text-white/40">Паспорт заполнен на {card.project.readiness}%</p><button ref={passportButtonRef} type="button" onClick={() => setPassportOpen(true)} className="overview-secondary mt-3">
          <FileText size={15} /> Открыть паспорт проекта
        </button></> : <p className="text-sm text-white/35">Проект не привязан</p>}</Info><Info title="Команда">{card.team ? <><p>{card.team.name}</p><p className="text-sm text-white/40">Роль: {card.team.role}</p></> : <p className="text-sm text-white/35">Без команды</p>}</Info></div>
        <section className="rounded-2xl border border-white/10 p-4"><p className="text-xs uppercase tracking-wide text-white/35">Трекер</p><p className="mt-2 text-sm">{card.trackers.map((row) => row.name).join(", ") || "Не назначен"}</p>{card.can_manage && !card.team && <select value={card.trackers[0]?.user_id || ""} onChange={(event) => void changeTracker(event.target.value)} disabled={busy === "tracker"} className="workspace-input mt-3"><option value="">Без трекера</option>{card.tracker_options.map((row) => <option key={row.user_id} value={row.user_id}>{row.name}</option>)}</select>}{card.team && <p className="mt-2 text-xs text-white/35">Назначение меняется один раз для всей команды в разделе «Матчмейкинг».</p>}</section>
        {card.modules?.homework !== false && <div className="grid gap-4 sm:grid-cols-3"><Metric label="ДЗ принято" value={`${card.homework.accepted}/${card.homework.published}`} /><Metric label="На проверке" value={String(card.homework.pending)} /><Metric label="Просрочено" value={String(card.homework.overdue + card.risk.overdue_tasks)} warning={card.homework.overdue + card.risk.overdue_tasks > 0} /></div>}
        {card.modules?.attendance && card.attendance && <Metric label="Посещаемость" value={`${card.attendance.present}/${card.attendance.total} · ${card.attendance.percent ?? 0}%`} />}
        {card.modules?.program_progress !== false && <Info title={`Программа · ${card.program.completed}/${card.program.total} · ${card.program.percent}%`}><div className="space-y-2">{card.program.stages.map((stage) => <div key={stage.id} className="rounded-xl border border-white/8 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm">{stage.title}</p><p className="mt-1 text-xs text-white/35">{stage.state === "completed" ? "Завершён" : stage.state === "waived" ? "Требование снято" : stage.state === "overdue" ? "Просрочен" : stage.state === "locked" ? "Закрыт" : "В работе"}{stage.required_total ? ` · ${stage.completed_required}/${stage.required_total}` : ""}</p></div><div className="flex flex-wrap gap-2">{stage.policy.mode === "manual" && stage.state === "in_progress" && <button type="button" disabled={Boolean(busy)} onClick={() => void changeProgramStage(stage.id, "complete-manually")} className="rounded-full border border-emerald-300/20 px-3 py-1.5 text-xs text-emerald-200">Подтвердить</button>}{card.can_manage && !["completed", "waived"].includes(stage.state) && <button type="button" disabled={Boolean(busy)} onClick={() => void changeProgramStage(stage.id, "waive")} className="rounded-full border border-amber-300/20 px-3 py-1.5 text-xs text-amber-200">Снять требование</button>}</div></div>{stage.blockers.slice(0, 3).map((blocker) => <p key={`${blocker.kind}:${blocker.title}`} className="mt-2 text-xs text-white/40">• {blocker.reason}</p>)}{stage.waiver_reason && <p className="mt-2 text-xs text-emerald-200/70">Причина: {stage.waiver_reason}</p>}</div>)}</div></Info>}
        <Info title="Риск"><p className={card.risk.level === "red" ? "text-red-200" : card.risk.level === "yellow" ? "text-amber-200" : "text-emerald-200"}>{card.risk.level === "red" ? "Высокий" : card.risk.level === "yellow" ? "Требует внимания" : "Стабильно"}</p>{card.risk.reasons.map((reason) => <p key={reason} className="mt-1 text-sm text-white/45">• {reason}</p>)}</Info>
        <Info title={card.application ? "Заявка и профиль" : "Профиль участника"}>{card.application && <p className="text-sm text-white/55">Анкета: версия {card.application.form_version}</p>}<KeyValues values={card.application?.answers || {}} /><KeyValues values={card.profile} excludedKeys={["application_data", "import_batch", "source_rows"]} /></Info>
        <Info title="Чек-ины и обратная связь"><div className="space-y-3">{card.checkins.map((row) => <div key={`c-${row.id}`}><p className="text-sm">{row.period_start} · {row.health}</p><p className="text-sm text-white/45">{row.summary}</p></div>)}{card.feedback.map((row) => <div key={`f-${row.id}`}><p className="text-sm text-white/35">Обратная связь · {formatDate(row.created_at)}</p><p className="text-sm text-white/60">{row.body}</p></div>)}{!card.checkins.length && !card.feedback.length && <p className="text-sm text-white/35">Записей пока нет.</p>}</div></Info>
        <Info title="Аудит проекта">
          {card.project && card.membership.status === "enrolled" && card.modules?.project_audit !== false && (
            <button type="button" onClick={() => void launchAudit()} disabled={Boolean(busy)} className="workspace-button">
              {busy === "audit" ? <Loader2 size={15} className="animate-spin" /> : <Activity size={15} />}
              {busy === "audit" ? "Аудит выполняется…" : "Запустить аудит"}
            </button>
          )}
          {auditError && <p role="alert" className="mt-3 text-sm text-red-200">{auditError}</p>}
          {audits.length ? <ul aria-label="История аудитов" className="mt-3 space-y-2">
            {audits.map(audit => <li key={audit.id} className="rounded-xl border border-white/10 px-3 py-2">
              <Link href={`/accelerator/project-audits/${audit.id}`} className="text-sm font-medium underline underline-offset-4">
                Аудит {audit.number}{audit.status === "completed" ? ` · Результат${audit.score != null ? ` ${audit.score}/100` : ""}` : audit.status === "failed" ? " · Ошибка" : " · Выполняется"}
              </Link>
              <p className="mt-1 text-xs text-white/45">{audit.type} · {formatDate(audit.created_at)}</p>
            </li>)}
          </ul> : <p className="mt-3 text-sm text-white/50">Аудит ещё не запускался</p>}
        </Info>
        <Info title="Задачи">
          <h4 className="text-sm font-medium">Текущие задачи</h4>
          {card.tasks?.length ? <ul className="mt-2 space-y-2">
            {card.tasks.map(current => <li key={current.id} className="rounded-xl border border-white/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-sm font-medium">{current.title}</p>
                {card.modules?.progress_tracking !== false && <button
                  type="button"
                  aria-label={`Удалить задачу «${current.title}»`}
                  title="Удалить задачу"
                  disabled={Boolean(busy)}
                  onClick={() => void removeTask(current.id, current.title)}
                  className="shrink-0 rounded-lg p-1 text-white/55 hover:text-red-300 disabled:opacity-40"
                >
                  {busy === `remove-task-${current.id}` ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                </button>}
              </div>
              {current.description && <p className="mt-1 whitespace-pre-wrap text-sm text-white/60">{current.description}</p>}
              {current.due_at && <p className="mt-1 text-xs text-white/45">Срок · {formatDate(current.due_at)}</p>}
            </li>)}
          </ul> : <p className="mt-2 text-sm text-white/50">Текущих задач нет.</p>}
          {card.membership.status === "enrolled" && card.modules?.progress_tracking !== false && (
            <form onSubmit={addTask} className="mt-4 border-t border-white/10 pt-4">
              <h4 className="text-sm font-medium">Создать обязательную задачу</h4>
              <div className="mt-3 grid gap-3">
                <input required minLength={2} value={task.title} onChange={event => setTask({ ...task, title: event.target.value })} aria-label="Название задачи" placeholder="Название" className="workspace-input" />
                <textarea value={task.description} onChange={event => setTask({ ...task, description: event.target.value })} aria-label="Описание задачи" placeholder="Описание" className="workspace-input resize-y" />
                <input type="datetime-local" value={task.dueAt} onChange={event => setTask({ ...task, dueAt: event.target.value })} aria-label="Срок задачи" className="workspace-input" />
                <button disabled={Boolean(busy)} className="workspace-button"><ClipboardCheck size={15} /> Назначить</button>
              </div>
            </form>
          )}
        </Info>
        <Info title="История активности">{activityRows.map((row) => <div key={row.key} className="mb-3 border-l border-white/10 pl-3"><p className="text-sm text-white/65">{row.kind === "status" ? row.title.replace(/: (accepted|enrolled|suspended|completed|withdrawn)$/, (_, status: string) => `: ${STATUS[status] || status}`) : row.title}</p><p className="mt-1 text-xs text-white/30">{formatDate(row.at)}{row.detail ? ` · ${row.detail}` : ""}</p></div>)}{!activityRows.length && <p className="text-sm text-white/35">Событий пока нет.</p>}</Info>
      </div>}
    </aside>
    {passportOpen && card?.project && <PassportModal
      projectId={card.project.id}
      projectName={card.project.name}
      readOnly
      portalContainer={document.querySelector<HTMLElement>(".accelerator-theme") ?? undefined}
      onClose={closePassport}
    />}
  </div>;
}

function Info({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-white/10 p-4"><h3 className="mb-3 text-xs uppercase tracking-wide text-white/35">{title}</h3>{children}</section>; }
function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <div className={`rounded-2xl border p-4 ${warning ? "border-amber-400/20 bg-amber-400/[.05]" : "border-white/10"}`}><p className="text-2xl">{value}</p><p className="mt-1 text-xs text-white/35">{label}</p></div>; }
const profileLabels: Record<string, string> = { name: "Имя", email: "Почта", telegram: "Telegram", institute: "Университет", preferred_role: "Желаемая роль", application_type: "Тип участия" };
function KeyValues({ values, excludedKeys = [] }: { values: Record<string, unknown>; excludedKeys?: string[] }) { const excluded = new Set(excludedKeys); const rows = Object.entries(values).filter(([key, value]) => !excluded.has(key) && value !== null && value !== "" && !Array.isArray(value)); return rows.length ? <dl className="mt-3 space-y-2">{rows.slice(0, 12).map(([key, value]) => <div key={key}><dt className="text-xs text-white/30">{profileLabels[key] || key}</dt><dd className="break-words text-sm text-white/60">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl> : null; }
function formatDate(value?: string | null) { return value ? new Date(value).toLocaleString("ru-RU") : "—"; }
