"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Bell, Clock3, Copy, Loader2, Pencil, Plus, Send, Sparkles, Users } from "lucide-react";

import { describeApiError, getAuthJson, postAuthJson, putAuthJson } from "@/lib/api";

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
  assignment_type: "text_files" | "quiz";
  submission_mode: "individual" | "team";
  quiz_questions: QuizQuestion[];
  passing_score?: number | null;
  max_attempts: number;
  submission_counts: Record<string, number>;
  pitchy_enabled: boolean;
  pitchy_tools: PitchyTool[];
};
type ProgramStage = { id: number; title: string; status: "draft" | "published" };
type QuizOption = { id: string; label: string; correct?: boolean };
type QuizQuestion = { id: string; prompt: string; options: QuizOption[] };
type PitchyTool = "chat" | "research" | "roadmap" | "custdev" | "grants" | "presentation";

const PITCHY_TOOLS: Array<{ id: PitchyTool; label: string }> = [
  { id: "chat", label: "Чат" }, { id: "research", label: "Исследование" },
  { id: "roadmap", label: "Дорожная карта" }, { id: "custdev", label: "CustDev" },
  { id: "grants", label: "Гранты" }, { id: "presentation", label: "Презентация" },
];

const emptyForm = { title: "", description: "", dueAt: "", stageId: "", audience: "cohort" as "cohort" | "selected", targetIds: [] as number[], allowResubmit: true, assignmentType: "text_files" as "text_files" | "quiz", submissionMode: "individual" as "individual" | "team", passingScore: 70, maxAttempts: 1, quizQuestions: [] as QuizQuestion[] };

function newQuestion(index: number): QuizQuestion {
  const id = `q_${Date.now()}_${index}`;
  return { id, prompt: "", options: [1, 2, 3, 4].map((item) => ({ id: `${id}_o${item}`, label: "", correct: item === 1 })) };
}

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function HomeworkManager({ cohortId, token, residents, isAdmin, pitchyEnabled }: { cohortId: number; token: string; residents: Resident[]; isAdmin: boolean; pitchyEnabled: boolean }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [stages, setStages] = useState<ProgramStage[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [featureEnabled, setFeatureEnabled] = useState(pitchyEnabled);
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
  useEffect(() => { setFeatureEnabled(pitchyEnabled); }, [pitchyEnabled, cohortId]);

  const togglePitchy = async () => {
    setBusy("pitchy-feature"); setError("");
    try {
      const result = await putAuthJson<{ enabled: boolean }>(`/api/accelerators/cohorts/${cohortId}/homework-pitchy`, { enabled: !featureEnabled }, token);
      setFeatureEnabled(result.enabled); await loadAssignments();
    } catch (reason) { setError(describeApiError(reason, "Не удалось изменить доступ к инструментам Pitchy")); }
    finally { setBusy(""); }
  };

  const togglePitchyTool = async (assignment: Assignment, tool: PitchyTool) => {
    const tools = assignment.pitchy_tools.includes(tool) ? assignment.pitchy_tools.filter((item) => item !== tool) : [...assignment.pitchy_tools, tool];
    setBusy(`pitchy-${assignment.id}`); setError("");
    try { await putAuthJson(`/api/accelerators/homework/${assignment.id}/pitchy-tools`, { tools }, token); await loadAssignments(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось сохранить инструменты Pitchy")); }
    finally { setBusy(""); }
  };

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
      assignmentType: assignment.assignment_type || "text_files",
      submissionMode: assignment.submission_mode || "individual",
      passingScore: assignment.passing_score ?? 70,
      maxAttempts: assignment.max_attempts || 1,
      quizQuestions: assignment.quiz_questions || [],
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
      assignment_type: form.assignmentType,
      submission_mode: form.submissionMode,
      quiz_questions: form.assignmentType === "quiz" ? form.quizQuestions : [],
      passing_score: form.assignmentType === "quiz" ? form.passingScore : null,
      max_attempts: form.assignmentType === "quiz" ? form.maxAttempts : 1,
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

  return (
    <section className="workspace-card">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl">Домашние задания</h2><p className="mt-1 text-sm text-white/40">Создавайте задания и задавайте аудиторию.</p></div><div className="flex flex-wrap gap-2">{isAdmin && <button type="button" onClick={() => void togglePitchy()} disabled={busy === "pitchy-feature"} className="workspace-button !bg-transparent !text-white"><Sparkles size={15} />{featureEnabled ? "Pitchy включён" : "Включить Pitchy"}</button>}<button onClick={() => { if (showForm) resetForm(); else setShowForm(true); }} className="workspace-button"><Plus size={15} />{showForm ? "Закрыть" : "Новое задание"}</button></div></div>
      {error && <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}

      {showForm && <form onSubmit={save} className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-5"><h3 className="mb-4">{editingId ? "Редактирование черновика" : "Новое задание"}</h3><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-white/60">Название<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} minLength={2} maxLength={300} required className="workspace-input mt-2" /></label><label className="text-sm text-white/60">Дедлайн<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} className="workspace-input mt-2" /></label><label className="text-sm text-white/60">Тип ответа<select value={form.assignmentType} onChange={(event) => setForm({ ...form, assignmentType: event.target.value as "text_files" | "quiz", allowResubmit: event.target.value === "quiz" ? true : form.allowResubmit })} className="workspace-input mt-2"><option value="text_files">Текст или файлы</option><option value="quiz">Тест</option></select></label><label className="text-sm text-white/60">Кто выполняет<select value={form.submissionMode} onChange={(event) => setForm({ ...form, submissionMode: event.target.value as "individual" | "team" })} className="workspace-input mt-2"><option value="individual">Каждый участник</option><option value="team">Один ответ от команды</option></select></label><label className="text-sm text-white/60 sm:col-span-2">Описание и ожидаемый результат<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={6} required className="workspace-input mt-2 resize-y" /></label><label className="text-sm text-white/60">Этап программы<select value={form.stageId} onChange={(event) => setForm({ ...form, stageId: event.target.value })} className="workspace-input mt-2"><option value="">Без привязки</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select></label><label className="text-sm text-white/60">Кому выдать<select value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value as "cohort" | "selected", targetIds: [] })} className="workspace-input mt-2"><option value="cohort">Всему потоку</option><option value="selected">Выбранным резидентам</option></select></label>{form.assignmentType === "quiz" ? <><label className="text-sm text-white/60">Проходной балл, %<input type="number" min={0} max={100} value={form.passingScore} onChange={(event) => setForm({ ...form, passingScore: Number(event.target.value) })} className="workspace-input mt-2" /></label><label className="text-sm text-white/60">Количество попыток<input type="number" min={1} max={20} value={form.maxAttempts} onChange={(event) => setForm({ ...form, maxAttempts: Number(event.target.value) })} className="workspace-input mt-2" /></label></> : <label className="flex items-end gap-3 pb-3 text-sm text-white/60"><input type="checkbox" checked={form.allowResubmit} onChange={(event) => setForm({ ...form, allowResubmit: event.target.checked })} /> Разрешить повторную отправку</label>}</div>
        {form.assignmentType === "quiz" && <div className="mt-5 space-y-4"><div className="flex items-center justify-between"><h4 className="text-sm text-white/65">Вопросы теста</h4><button type="button" onClick={() => setForm({ ...form, quizQuestions: [...form.quizQuestions, newQuestion(form.quizQuestions.length)] })} className="workspace-button !bg-transparent !text-white"><Plus size={14} /> Добавить вопрос</button></div>{form.quizQuestions.map((question, questionIndex) => <div key={question.id} className="rounded-2xl border border-white/8 p-4"><div className="flex gap-3"><input value={question.prompt} required placeholder={`Вопрос ${questionIndex + 1}`} onChange={(event) => setForm({ ...form, quizQuestions: form.quizQuestions.map((row) => row.id === question.id ? { ...row, prompt: event.target.value } : row) })} className="workspace-input" /><button type="button" aria-label="Удалить вопрос" onClick={() => setForm({ ...form, quizQuestions: form.quizQuestions.filter((row) => row.id !== question.id) })} className="px-2 text-white/35 hover:text-red-300">×</button></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{question.options.map((option) => <label key={option.id} className="flex items-center gap-2"><input type="radio" name={`correct-${question.id}`} checked={Boolean(option.correct)} onChange={() => setForm({ ...form, quizQuestions: form.quizQuestions.map((row) => row.id === question.id ? { ...row, options: row.options.map((item) => ({ ...item, correct: item.id === option.id })) } : row) })} /><input value={option.label} required placeholder="Вариант ответа" onChange={(event) => setForm({ ...form, quizQuestions: form.quizQuestions.map((row) => row.id === question.id ? { ...row, options: row.options.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item) } : row) })} className="workspace-input" /></label>)}</div></div>)}</div>}
        {form.audience === "selected" && <div className="mt-4 rounded-2xl border border-white/8 p-4"><p className="mb-3 text-sm text-white/55">Выберите резидентов</p>{!enrolledResidents.length ? <p className="text-sm text-white/30">В потоке пока нет зачисленных резидентов.</p> : <div className="grid gap-2 sm:grid-cols-2">{enrolledResidents.map((resident) => <label key={resident.membership_id} className="flex items-center gap-3 rounded-xl bg-white/[0.025] p-3 text-sm text-white/60"><input type="checkbox" checked={form.targetIds.includes(resident.membership_id)} onChange={(event) => setForm({ ...form, targetIds: event.target.checked ? [...form.targetIds, resident.membership_id] : form.targetIds.filter((id) => id !== resident.membership_id) })} /><span>{resident.name}<span className="block text-xs text-white/30">{resident.email}</span></span></label>)}</div>}</div>}
        <div className="mt-5 flex justify-end"><button disabled={busy === "save"} className="workspace-button">{busy === "save" && <Loader2 size={15} className="animate-spin" />} Сохранить черновик</button></div></form>}

      <div className="mt-6 space-y-3">{!assignments.length ? <p className="py-6 text-center text-sm text-white/35">Заданий пока нет.</p> : assignments.map((assignment) => {
        const counts = assignment.submission_counts || {};
        return <article key={assignment.id} className="rounded-2xl border border-white/9 bg-white/[0.02] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><div className="mb-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs ${assignment.status === "published" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/7 text-white/45"}`}>{assignment.status === "published" ? "Опубликовано" : "Черновик"}</span><span className="rounded-full bg-white/7 px-2 py-1 text-xs text-white/45">{assignment.assignment_type === "quiz" ? `Тест · от ${assignment.passing_score}% · ${assignment.max_attempts} попыток` : "Текст или файлы"}</span>{assignment.submission_mode === "team" && <span className="rounded-full bg-blue-400/10 px-2 py-1 text-xs text-blue-200">Командное</span>}{assignment.pitchy_enabled && <span className="rounded-full bg-violet-400/10 px-2 py-1 text-xs text-violet-200"><Sparkles size={11} className="mr-1 inline" />Можно выполнить в Pitchy</span>}<span className="text-xs text-white/30"><Users size={12} className="mr-1 inline" />{assignment.target_count}</span>{assignment.due_at && <span className="text-xs text-white/30"><Clock3 size={12} className="mr-1 inline" />{new Date(assignment.due_at).toLocaleString("ru-RU")}</span>}</div><h3 className="text-lg">{assignment.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/45">{assignment.description}</p><p className="mt-3 text-xs text-white/30">Отправлено: {Object.values(counts).reduce((sum, value) => sum + value, 0)} · принято: {counts.accepted || 0} · на доработке: {counts.needs_revision || 0}</p>{featureEnabled && <div className="mt-3 flex flex-wrap gap-2">{PITCHY_TOOLS.map((tool) => <button key={tool.id} type="button" disabled={!isAdmin || busy === `pitchy-${assignment.id}`} onClick={() => void togglePitchyTool(assignment, tool.id)} className={`rounded-full border px-2.5 py-1 text-xs ${assignment.pitchy_tools.includes(tool.id) ? "border-violet-300/30 bg-violet-400/10 text-violet-200" : "border-white/8 text-white/30"}`}>{tool.label}</button>)}</div>}</div><div className="flex flex-wrap gap-2">{assignment.status === "draft" ? <><button onClick={() => edit(assignment)} className="workspace-button !bg-transparent !text-white"><Pencil size={14} /> Изменить</button><button onClick={() => void publish(assignment.id)} disabled={busy === `publish-${assignment.id}`} className="workspace-button"><Send size={14} /> Опубликовать</button></> : <button onClick={() => void remind(assignment.id)} disabled={busy === `remind-${assignment.id}`} className="workspace-button !bg-transparent !text-white"><Bell size={14} /> Напомнить</button>}<button type="button" onClick={() => void lifecycle(assignment, "duplicate")} disabled={Boolean(busy)} title="Создать редактируемую копию" className="rounded-full border border-white/10 p-2 text-white/50"><Copy size={15} /></button><button type="button" onClick={() => void lifecycle(assignment, "archive")} disabled={Boolean(busy)} title="Архивировать" className="rounded-full border border-white/10 p-2 text-white/50 hover:text-red-300"><Archive size={15} /></button></div></div>
        </article>;
      })}</div>
    </section>
  );
}
