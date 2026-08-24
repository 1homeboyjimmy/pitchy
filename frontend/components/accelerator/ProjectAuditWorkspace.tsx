"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardPlus, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { ApiError, describeApiError, getAuthJson, postAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";

type ResidentOption = { membership_id: number; name: string; email?: string; status: string };
type Finding = { title: string; description: string; severity: "low" | "medium" | "high"; evidence?: string | null };
type Recommendation = { title: string; description: string; priority: "low" | "medium" | "high"; expected_result: string };
type AuditResult = { summary: string; overall_score: number; strengths: string[]; findings: Finding[]; recommendations: Recommendation[]; data_gaps: string[] };
type AuditRow = {
  id: number; membership_id: number; audit_type: string; audit_type_label: string; focus?: string | null;
  status: "running" | "completed" | "failed"; overall_score?: number | null; result?: AuditResult | null;
  error_message?: string | null; quota: { resource: string; consumed: boolean };
  resident?: { id: number; name: string } | null; requested_by?: { id: number; name: string } | null;
  project?: { id: number; name: string } | null; linked_tasks: Array<{ recommendation_index: number; task: { id: number; title: string; status: string } }>;
  comparison?: { previous_audit_id: number; score_delta: number; new_findings: string[]; resolved_findings: string[] } | null;
  created_at: string;
};
type AuditList = { access_role: string; audits: AuditRow[] };

const auditTypes = [
  ["product", "Продукт"], ["market", "Рынок"], ["custdev", "CustDev"],
  ["business_model", "Бизнес-модель"], ["grant", "Грантовая готовность"],
] as const;
const priorityClass = { low: "text-sky-200", medium: "text-amber-200", high: "text-red-200" };
const severityLabel = { low: "Низкий", medium: "Средний", high: "Высокий" };

export function ProjectAuditWorkspace({
  cohortId,
  membershipId,
  residents = [],
  token: providedToken,
  canCreateTasks = false,
  taskIntegrationEnabled = false,
}: {
  cohortId: number;
  membershipId?: number;
  residents?: ResidentOption[];
  token?: string;
  canCreateTasks?: boolean;
  taskIntegrationEnabled?: boolean;
}) {
  const auth = useAuth(); const token = providedToken || auth.token;
  const [selectedMembershipId, setSelectedMembershipId] = useState(membershipId ? String(membershipId) : "");
  const [data, setData] = useState<AuditList | null>(null);
  const [auditType, setAuditType] = useState<(typeof auditTypes)[number][0]>("product");
  const [focus, setFocus] = useState(""); const [busy, setBusy] = useState(""); const [error, setError] = useState("");

  useEffect(() => { if (membershipId) setSelectedMembershipId(String(membershipId)); }, [membershipId]);
  const load = useCallback(async () => {
    if (!token) return; setBusy("load"); setError("");
    try {
      const path = membershipId
        ? `/api/accelerators/memberships/${membershipId}/project-audits`
        : `/api/accelerators/cohorts/${cohortId}/project-audits`;
      setData(await getAuthJson<AuditList>(path, token));
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить историю аудитов")); }
    finally { setBusy(""); }
  }, [cohortId, membershipId, token]);
  useEffect(() => { void load(); }, [load]);

  const visibleAudits = useMemo(() => {
    const rows = data?.audits || [];
    return !selectedMembershipId || membershipId ? rows : rows.filter((row) => row.membership_id === Number(selectedMembershipId));
  }, [data, membershipId, selectedMembershipId]);

  const createAudit = async (event: FormEvent) => {
    event.preventDefault(); if (!token || !selectedMembershipId) return;
    setBusy("create"); setError("");
    try {
      await postAuthJson(`/api/accelerators/memberships/${selectedMembershipId}/project-audits`, {
        audit_type: auditType, focus: focus.trim() || null,
        client_request_id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-project-audit`,
      }, token);
      setFocus(""); await load();
    } catch (reason) { setError(reason instanceof ApiError && reason.status === 402 ? "Лимит генераций CustDev для этого резидента исчерпан." : describeApiError(reason, "Не удалось выполнить аудит проекта")); }
    finally { setBusy(""); }
  };

  const createTask = async (audit: AuditRow, recommendationIndex: number) => {
    if (!token) return; setBusy(`task-${audit.id}-${recommendationIndex}`); setError("");
    try {
      await postAuthJson(`/api/accelerators/project-audits/${audit.id}/tasks`, { recommendation_index: recommendationIndex, due_at: null }, token);
      await load();
    } catch (reason) { setError(describeApiError(reason, "Не удалось создать задачу из рекомендации")); }
    finally { setBusy(""); }
  };

  return <div className="space-y-5">
    <form onSubmit={createAudit} className="workspace-card">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl">Аудит проекта</h2><p className="mt-1 max-w-2xl text-sm text-white/40">ИИ анализирует паспорт и недавние чек-ины, отмечает пробелы и предлагает проверяемые действия. При назначенной квоте расходуется одна генерация CustDev.</p></div><button type="button" onClick={() => void load()} className="rounded-full border border-white/10 p-3 text-white/40" aria-label="Обновить"><RefreshCw size={16} /></button></div>
      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_240px]">
        {!membershipId && <label className="text-sm text-white/55">Резидент<select value={selectedMembershipId} onChange={(event) => setSelectedMembershipId(event.target.value)} required className="workspace-input mt-2"><option value="">Выберите резидента</option>{residents.filter((row) => row.status === "enrolled").map((row) => <option key={row.membership_id} value={row.membership_id}>{row.name}{row.email ? ` · ${row.email}` : ""}</option>)}</select></label>}
        <label className={`text-sm text-white/55 ${membershipId ? "lg:col-span-2" : ""}`}>Тип анализа<select value={auditType} onChange={(event) => setAuditType(event.target.value as typeof auditType)} className="workspace-input mt-2">{auditTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm text-white/55 lg:col-span-2">Дополнительный фокус<textarea value={focus} onChange={(event) => setFocus(event.target.value)} maxLength={5000} rows={3} className="workspace-input mt-2 resize-y" placeholder="Например: проверьте доказательства спроса и план следующих интервью" /></label>
      </div>
      <button disabled={!selectedMembershipId || busy === "create"} className="workspace-button mt-4">{busy === "create" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Запустить аудит</button>
    </form>

    <section className="workspace-card"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl">История и результаты</h2><p className="mt-1 text-sm text-white/40">Повторный аудит того же типа показывает изменение оценки и списка проблем.</p></div>{!membershipId && <button type="button" onClick={() => setSelectedMembershipId("")} className="text-sm text-white/40">Показать весь поток</button>}</div>
      {busy === "load" && !data ? <Loader2 className="mx-auto my-12 animate-spin text-white/35" /> : <div className="mt-5 space-y-4">{visibleAudits.map((audit) => <AuditCard key={audit.id} audit={audit} canCreateTasks={canCreateTasks} taskIntegrationEnabled={taskIntegrationEnabled} busy={busy} onCreateTask={createTask} />)}{!visibleAudits.length && <p className="py-8 text-center text-sm text-white/35">Аудитов пока нет.</p>}</div>}
    </section>
    {canCreateTasks && !taskIntegrationEnabled && <p className="rounded-2xl border border-amber-400/15 bg-amber-400/[.06] p-4 text-sm text-amber-100">Чтобы превращать рекомендации в задачи, включите модуль «Трекинг прогресса».</p>}
    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200"><AlertTriangle size={15} className="mr-2 inline" />{error}</p>}
  </div>;
}

function AuditCard({ audit, canCreateTasks, taskIntegrationEnabled, busy, onCreateTask }: { audit: AuditRow; canCreateTasks: boolean; taskIntegrationEnabled: boolean; busy: string; onCreateTask: (audit: AuditRow, index: number) => Promise<void> }) {
  const linked = new Map(audit.linked_tasks.map((row) => [row.recommendation_index, row.task]));
  return <article className="rounded-2xl border border-white/9 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-wide text-white/30">{audit.resident?.name ? `${audit.resident.name} · ` : ""}{audit.audit_type_label}</p><h3 className="mt-1 text-lg">{audit.project?.name || "Проект"}</h3><p className="mt-1 text-xs text-white/30">Запросил: {audit.requested_by?.name || "—"} · {new Date(audit.created_at).toLocaleString("ru-RU")}</p></div>{audit.status === "completed" ? <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-sm text-emerald-300">{audit.overall_score}/100</span> : <span className={`rounded-full px-3 py-1 text-sm ${audit.status === "failed" ? "bg-red-400/10 text-red-200" : "bg-white/5 text-white/45"}`}>{audit.status === "failed" ? "Ошибка" : "Выполняется"}</span>}</div>
    {audit.focus && <p className="mt-4 rounded-xl bg-white/[.03] p-3 text-sm text-white/45">Фокус: {audit.focus}</p>}
    {audit.error_message && <p className="mt-4 text-sm text-red-200">{audit.error_message}</p>}
    {audit.result && <div className="mt-5 space-y-5"><p className="text-sm leading-6 text-white/65">{audit.result.summary}</p>
      {audit.comparison && <div className="rounded-xl bg-white/[.03] p-3 text-sm"><p className={audit.comparison.score_delta >= 0 ? "text-emerald-300" : "text-red-200"}>Изменение оценки: {audit.comparison.score_delta > 0 ? "+" : ""}{audit.comparison.score_delta}</p>{audit.comparison.resolved_findings.length > 0 && <p className="mt-1 text-white/45">Устранено: {audit.comparison.resolved_findings.join(", ")}</p>}{audit.comparison.new_findings.length > 0 && <p className="mt-1 text-white/45">Новые проблемы: {audit.comparison.new_findings.join(", ")}</p>}</div>}
      <div className="grid gap-4 lg:grid-cols-2"><ResultPanel title="Сильные стороны">{audit.result.strengths.length ? audit.result.strengths.map((row) => <p key={row} className="text-sm text-white/60">✓ {row}</p>) : <EmptyText />}</ResultPanel><ResultPanel title="Пробелы в данных">{audit.result.data_gaps.length ? audit.result.data_gaps.map((row) => <p key={row} className="text-sm text-white/50">• {row}</p>) : <EmptyText />}</ResultPanel></div>
      <ResultPanel title="Риски и проблемы">{audit.result.findings.map((row) => <div key={`${row.title}-${row.severity}`} className="rounded-xl bg-black/20 p-3"><div className="flex justify-between gap-3"><p>{row.title}</p><span className={`text-xs ${priorityClass[row.severity]}`}>{severityLabel[row.severity]} риск</span></div><p className="mt-2 text-sm text-white/50">{row.description}</p>{row.evidence && <p className="mt-2 text-xs text-white/30">Основание: {row.evidence}</p>}</div>)}</ResultPanel>
      <ResultPanel title="Рекомендации">{audit.result.recommendations.map((row, index) => { const task = linked.get(index); return <div key={`${row.title}-${index}`} className="rounded-xl border border-white/8 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p>{row.title}</p><p className={`mt-1 text-xs ${priorityClass[row.priority]}`}>Приоритет: {severityLabel[row.priority].toLowerCase()}</p></div>{task ? <span className="flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 size={14} /> Задача создана</span> : canCreateTasks && taskIntegrationEnabled && <button type="button" onClick={() => void onCreateTask(audit, index)} disabled={Boolean(busy)} className="flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/55"><ClipboardPlus size={13} /> В задачи</button>}</div><p className="mt-2 text-sm text-white/50">{row.description}</p><p className="mt-2 text-xs text-white/30">Результат: {row.expected_result}</p></div>; })}</ResultPanel>
      <p className="text-xs text-white/30">Квота CustDev: {audit.quota.consumed ? "списана 1 генерация" : "персональная квота потока не назначена"}</p>
    </div>}
  </article>;
}

function ResultPanel({ title, children }: { title: string; children: React.ReactNode }) { return <div><h4 className="mb-3 text-xs uppercase tracking-wide text-white/30">{title}</h4><div className="space-y-2">{children}</div></div>; }
function EmptyText() { return <p className="text-sm text-white/30">Не отмечено.</p>; }
