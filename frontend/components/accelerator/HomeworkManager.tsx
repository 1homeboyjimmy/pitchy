"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Bell, CheckCircle2, ChevronDown, Clock3, Copy, Loader2, Pencil, Plus, RotateCcw, Send, Users } from "lucide-react";

import { describeApiError, getAuthJson, patchAuthJson, postAuthJson, putAuthJson } from "@/lib/api";

type Resident = { membership_id: number; name: string; email: string; status: string };
type Assignment = {
  id: number;
  stage_id?: number | null;
  title: string;
  description: string;
  due_at?: string | null;
  status: "draft" | "published" | "archived";
  audience: "cohort" | "selected";
  target_membership_ids: number[];
  target_count: number;
  allow_resubmit: boolean;
  submission_counts: Record<string, number>;
};
type ProgramStage = { id: number; title: string; status: "draft" | "published" };
type Submission = {
  id: number;
  resident: { id: number; name: string; email: string };
  answer_text?: string | null;
  attachments: string[];
  status: "submitted" | "needs_revision" | "accepted";
  attempt_count: number;
  submitted_at: string;
  review_comment?: string | null;
  is_late: boolean;
};

const emptyForm = { title: "", description: "", dueAt: "", stageId: "", audience: "cohort" as "cohort" | "selected", targetIds: [] as number[], allowResubmit: true };

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function HomeworkManager({ cohortId, token, residents }: { cohortId: number; token: string; residents: Resident[] }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [stages, setStages] = useState<ProgramStage[]>([]);
  const [submissions, setSubmissions] = useState<Record<number, Submission[]>>({});
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [openAssignmentId, setOpenAssignmentId] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const enrolledResidents = useMemo(() => residents.filter((resident) => resident.status === "enrolled"), [residents]);

  const loadAssignments = useCallback(async () => {
    setError("");
    try {
      const [assignmentRows, stageRows] = await Promise.all([
        getAuthJson<Assignment[]>(`/api/accelerators/cohorts/${cohortId}/homework`, token),
        getAuthJson<ProgramStage[]>(`/api/accelerators/cohorts/${cohortId}/program-stages`, token),
      ]);
      setAssignments(assignmentRows); setStages(stageRows);
    }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить задания")); }
  }, [cohortId, token]);

  useEffect(() => { void loadAssignments(); }, [loadAssignments]);

  const resetForm = () => { setForm(emptyForm); setEditingId(null); setShowForm(false); };
  const edit = (assignment: Assignment) => {
    setForm({
      title: assignment.title,
      description: assignment.description,
      dueAt: assignment.due_at ? toLocalDateTimeInput(assignment.due_at) : "",
      stageId: assignment.stage_id ? String(assignment.stage_id) : "",
      audience: assignment.audience,
      targetIds: assignment.target_membership_ids,
      allowResubmit: assignment.allow_resubmit,
    });
    setEditingId(assignment.id); setShowForm(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("save"); setError("");
    const payload = {
      title: form.title,
      description: form.description,
      due_at: form.dueAt ? new Date(form.dueAt).toISOString() : null,
      audience: form.audience,
      target_membership_ids: form.audience === "selected" ? form.targetIds : [],
      allow_resubmit: form.allowResubmit,
      stage_id: form.stageId ? Number(form.stageId) : null,
    };
    try {
      if (editingId) await putAuthJson(`/api/accelerators/homework/${editingId}`, payload, token);
      else await postAuthJson(`/api/accelerators/cohorts/${cohortId}/homework`, payload, token);
      resetForm(); await loadAssignments();
    } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить задание")); }
    finally { setBusy(""); }
  };

  const publish = async (assignmentId: number) => {
    setBusy(`publish-${assignmentId}`); setError("");
    try { await postAuthJson(`/api/accelerators/homework/${assignmentId}/publish`, {}, token); await loadAssignments(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось опубликовать задание")); }
    finally { setBusy(""); }
  };

  const remind = async (assignmentId: number) => {
    setBusy(`remind-${assignmentId}`); setError("");
    try { await postAuthJson(`/api/accelerators/homework/${assignmentId}/remind`, {}, token); }
    catch (reason) { setError(describeApiError(reason, "Не удалось отправить напоминания")); }
    finally { setBusy(""); }
  };
  const lifecycle = async (assignment: Assignment, action: "duplicate" | "archive") => {
    if (action === "archive" && !window.confirm(`Архивировать задание «${assignment.title}»?`)) return;
    setBusy(`${action}-${assignment.id}`); setError("");
    try { await postAuthJson(`/api/accelerators/homework/${assignment.id}/${action}`, {}, token); await loadAssignments(); }
    catch (reason) { setError(describeApiError(reason, action === "archive" ? "Не удалось архивировать задание" : "Не удалось создать копию задания")); }
    finally { setBusy(""); }
  };

  const openSubmissions = async (assignmentId: number) => {
    if (openAssignmentId === assignmentId) { setOpenAssignmentId(null); return; }
    setOpenAssignmentId(assignmentId); setBusy(`submissions-${assignmentId}`);
    try {
      const rows = await getAuthJson<Submission[]>(`/api/accelerators/homework/${assignmentId}/submissions`, token);
      setSubmissions((current) => ({ ...current, [assignmentId]: rows }));
    }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить ответы")); }
    finally { setBusy(""); }
  };

  const review = async (assignmentId: number, submission: Submission, status: "accepted" | "needs_revision") => {
    setBusy(`review-${submission.id}`); setError("");
    try {
      await patchAuthJson(`/api/accelerators/homework/submissions/${submission.id}/review`, { status, comment: comments[submission.id] || null }, token);
      const rows = await getAuthJson<Submission[]>(`/api/accelerators/homework/${assignmentId}/submissions`, token);
      setSubmissions((current) => ({ ...current, [assignmentId]: rows }));
      await loadAssignments();
    } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить решение")); }
    finally { setBusy(""); }
  };

  return (
    <section className="workspace-card">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl">Домашние задания</h2><p className="mt-1 text-sm text-white/40">Создавайте задания, задавайте аудиторию и проверяйте ответы.</p></div><button onClick={() => { if (showForm) resetForm(); else setShowForm(true); }} className="workspace-button"><Plus size={15} />{showForm ? "Закрыть" : "Новое задание"}</button></div>
      {error && <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}

      {showForm && <form onSubmit={save} className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-5"><h3 className="mb-4">{editingId ? "Редактирование черновика" : "Новое задание"}</h3><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-white/60">Название<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} minLength={2} maxLength={300} required className="workspace-input mt-2" /></label><label className="text-sm text-white/60">Дедлайн<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} className="workspace-input mt-2" /></label><label className="text-sm text-white/60 sm:col-span-2">Описание и ожидаемый результат<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={6} required className="workspace-input mt-2 resize-y" /></label><label className="text-sm text-white/60">Этап программы<select value={form.stageId} onChange={(event) => setForm({ ...form, stageId: event.target.value })} className="workspace-input mt-2"><option value="">Без привязки</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select></label><label className="text-sm text-white/60">Кому выдать<select value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value as "cohort" | "selected", targetIds: [] })} className="workspace-input mt-2"><option value="cohort">Всему потоку</option><option value="selected">Выбранным резидентам</option></select></label><label className="flex items-end gap-3 pb-3 text-sm text-white/60"><input type="checkbox" checked={form.allowResubmit} onChange={(event) => setForm({ ...form, allowResubmit: event.target.checked })} /> Разрешить повторную отправку</label></div>
        {form.audience === "selected" && <div className="mt-4 rounded-2xl border border-white/8 p-4"><p className="mb-3 text-sm text-white/55">Выберите резидентов</p>{!enrolledResidents.length ? <p className="text-sm text-white/30">В потоке пока нет зачисленных резидентов.</p> : <div className="grid gap-2 sm:grid-cols-2">{enrolledResidents.map((resident) => <label key={resident.membership_id} className="flex items-center gap-3 rounded-xl bg-white/[0.025] p-3 text-sm text-white/60"><input type="checkbox" checked={form.targetIds.includes(resident.membership_id)} onChange={(event) => setForm({ ...form, targetIds: event.target.checked ? [...form.targetIds, resident.membership_id] : form.targetIds.filter((id) => id !== resident.membership_id) })} /><span>{resident.name}<span className="block text-xs text-white/30">{resident.email}</span></span></label>)}</div>}</div>}
        <div className="mt-5 flex justify-end"><button disabled={busy === "save"} className="workspace-button">{busy === "save" && <Loader2 size={15} className="animate-spin" />} Сохранить черновик</button></div></form>}

      <div className="mt-6 space-y-3">{!assignments.length ? <p className="py-6 text-center text-sm text-white/35">Заданий пока нет.</p> : assignments.map((assignment) => {
        const counts = assignment.submission_counts || {};
        const assignmentSubmissions = submissions[assignment.id] || [];
        return <article key={assignment.id} className="rounded-2xl border border-white/9 bg-white/[0.02] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><div className="mb-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs ${assignment.status === "published" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/7 text-white/45"}`}>{assignment.status === "published" ? "Опубликовано" : "Черновик"}</span><span className="text-xs text-white/30"><Users size={12} className="mr-1 inline" />{assignment.target_count}</span>{assignment.due_at && <span className="text-xs text-white/30"><Clock3 size={12} className="mr-1 inline" />{new Date(assignment.due_at).toLocaleString("ru-RU")}</span>}</div><h3 className="text-lg">{assignment.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/45">{assignment.description}</p><p className="mt-3 text-xs text-white/30">Отправлено: {Object.values(counts).reduce((sum, value) => sum + value, 0)} · принято: {counts.accepted || 0} · на доработке: {counts.needs_revision || 0}</p></div><div className="flex flex-wrap gap-2">{assignment.status === "draft" ? <><button onClick={() => edit(assignment)} className="workspace-button !bg-transparent !text-white"><Pencil size={14} /> Изменить</button><button onClick={() => void publish(assignment.id)} disabled={busy === `publish-${assignment.id}`} className="workspace-button"><Send size={14} /> Опубликовать</button></> : <><button onClick={() => void remind(assignment.id)} disabled={busy === `remind-${assignment.id}`} className="workspace-button !bg-transparent !text-white"><Bell size={14} /> Напомнить</button><button onClick={() => void openSubmissions(assignment.id)} className="workspace-button">Ответы <ChevronDown size={14} /></button></>}<button type="button" onClick={() => void lifecycle(assignment, "duplicate")} disabled={Boolean(busy)} title="Создать редактируемую копию" className="rounded-full border border-white/10 p-2 text-white/50"><Copy size={15} /></button><button type="button" onClick={() => void lifecycle(assignment, "archive")} disabled={Boolean(busy)} title="Архивировать" className="rounded-full border border-white/10 p-2 text-white/50 hover:text-red-300"><Archive size={15} /></button></div></div>
          {openAssignmentId === assignment.id && <div className="mt-5 border-t border-white/8 pt-5">{busy === `submissions-${assignment.id}` ? <Loader2 className="mx-auto animate-spin text-white/40" /> : !assignmentSubmissions.length ? <p className="text-sm text-white/35">Ответов пока нет.</p> : <div className="space-y-3">{assignmentSubmissions.map((submission) => <div key={submission.id} className="rounded-2xl bg-black/30 p-4"><div className="flex flex-wrap justify-between gap-2"><div><h4>{submission.resident.name}</h4><p className="text-xs text-white/35">{submission.resident.email} · попытка {submission.attempt_count}{submission.is_late ? " · после дедлайна" : ""}</p></div><span className="text-xs text-white/45">{submission.status === "accepted" ? "Принято" : submission.status === "needs_revision" ? "На доработке" : "Ожидает проверки"}</span></div>{submission.answer_text && <p className="mt-4 whitespace-pre-wrap text-sm text-white/60">{submission.answer_text}</p>}{submission.attachments.length > 0 && <div className="mt-3 space-y-1">{submission.attachments.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="block truncate text-sm text-blue-300 underline">{url}</a>)}</div>}{submission.review_comment && <p className="mt-3 rounded-xl bg-white/[0.04] p-3 text-sm text-white/45">Комментарий: {submission.review_comment}</p>}{submission.status !== "accepted" && <div className="mt-4"><textarea value={comments[submission.id] || ""} onChange={(event) => setComments({ ...comments, [submission.id]: event.target.value })} rows={2} placeholder="Комментарий к проверке" className="workspace-input resize-y" /><div className="mt-3 flex flex-wrap justify-end gap-2"><button onClick={() => void review(assignment.id, submission, "needs_revision")} disabled={busy === `review-${submission.id}`} className="workspace-button !bg-transparent !text-white"><RotateCcw size={14} /> На доработку</button><button onClick={() => void review(assignment.id, submission, "accepted")} disabled={busy === `review-${submission.id}`} className="workspace-button"><CheckCircle2 size={14} /> Принять</button></div></div>}</div>)}</div>}</div>}
        </article>;
      })}</div>
    </section>
  );
}
