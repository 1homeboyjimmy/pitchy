"use client";

import { useDashboardFocus } from "./useDashboardFocus";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Banknote,
  Copy,
  FileSearch,
  GitBranch,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Presentation,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { describeApiError, getAuthJson, postAuthJson, putAuthJson } from "@/lib/api";

type Material = {
  id?: number;
  title: string;
  kind: "link" | "video" | "text" | "file";
  url?: string | null;
  content?: string | null;
  required: boolean;
  completed?: boolean;
};

export type ProgramActionType = "chat" | "roadmap" | "research" | "custdev" | "grants" | "presentation";

export type ProgramAction = {
  id?: number;
  action_type: ProgramActionType;
  title: string;
  description?: string | null;
  required: boolean;
  config: Record<string, unknown>;
};

export type ProgramStage = {
  id: number;
  title: string;
  description?: string | null;
  position: number;
  unlock_at?: string | null;
  due_at?: string | null;
  required: boolean;
  completion_policy: {
    mode: "auto" | "manual" | "none";
    materials: "all_required" | "none";
    homework: "all_required" | "none";
    pitchy_actions: "all_required" | "none";
    attendance: "all_required" | "none";
    manual_confirmation: boolean;
  };
  status: "draft" | "published";
  materials: Material[];
  actions: ProgramAction[];
  homework_assignment_ids: number[];
  timeline: Array<{
    key: string;
    kind: "material" | "homework" | "event";
    id: number;
    title: string;
    sort_at?: string | null;
    required: boolean;
    status?: string | null;
    event_format?: "online" | "offline" | "hybrid";
  }>;
};

const ACTION_META: Record<ProgramActionType, { label: string; defaultTitle: string; icon: typeof MessageSquare }> = {
  chat: { label: "Чат с аналитиком", defaultTitle: "Разобрать задачу в чате", icon: MessageSquare },
  roadmap: { label: "Дорожная карта", defaultTitle: "Обновить дорожную карту", icon: GitBranch },
  research: { label: "Исследование", defaultTitle: "Провести исследование", icon: FileSearch },
  custdev: { label: "CustDev", defaultTitle: "Провести CustDev", icon: Users },
  grants: { label: "Гранты", defaultTitle: "Подготовить грантовую заявку", icon: Banknote },
  presentation: { label: "Презентация", defaultTitle: "Собрать презентацию", icon: Presentation },
};

const makeEmptyForm = () => ({
  title: "",
  description: "",
  unlockAt: "",
  dueAt: "",
  required: true,
  completionMode: "auto" as "auto" | "manual" | "none",
  attendanceRequired: false,
  materials: [] as Material[],
  actions: [] as ProgramAction[],
});

const localDate = (value: string) => new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function ProgramBuilder({ cohortId, token, focusId }: { cohortId: number; token: string; focusId?: number }) {
  const [stages, setStages] = useState<ProgramStage[]>([]);
  useDashboardFocus("stage", focusId, stages.length);
  const [form, setForm] = useState(makeEmptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formTab, setFormTab] = useState<"main" | "content" | "completion">("main");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setStages(await getAuthJson<ProgramStage[]>(`/api/accelerators/cohorts/${cohortId}/program-stages`, token));
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось загрузить этапы программы"));
    }
  }, [cohortId, token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setForm(makeEmptyForm()); setEditingId(null); setShowForm(false); } }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, []);

  const reset = () => {
    setForm(makeEmptyForm());
    setEditingId(null);
    setShowForm(false);
    setFormTab("main");
  };

  const edit = (stage: ProgramStage) => {
    setForm({
      title: stage.title,
      description: stage.description || "",
      unlockAt: stage.unlock_at ? localDate(stage.unlock_at) : "",
      dueAt: stage.due_at ? localDate(stage.due_at) : "",
      required: stage.required,
      completionMode: stage.completion_policy?.mode || "auto",
      attendanceRequired: stage.completion_policy?.attendance === "all_required",
      materials: stage.materials.map(({ title, kind, url, content, required }) => ({ title, kind, url, content, required })),
      actions: (stage.actions || []).map(({ action_type, title, description, required, config }) => ({
        action_type,
        title,
        description: description || "",
        required,
        config: config || {},
      })),
    });
    setEditingId(stage.id);
    setFormTab("main");
    setShowForm(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("save");
    setError("");
    const payload = {
      title: form.title,
      description: form.description || null,
      unlock_at: form.unlockAt ? new Date(form.unlockAt).toISOString() : null,
      due_at: form.dueAt ? new Date(form.dueAt).toISOString() : null,
      required: form.required,
      completion_policy: {
        mode: form.completionMode,
        materials: "all_required",
        homework: "all_required",
        pitchy_actions: "all_required",
        attendance: form.attendanceRequired ? "all_required" : "none",
        manual_confirmation: form.completionMode === "manual",
      },
      materials: form.materials,
      actions: form.actions.map((action) => ({ ...action, description: action.description || null })),
    };
    try {
      if (editingId) await putAuthJson(`/api/accelerators/program-stages/${editingId}`, payload, token);
      else await postAuthJson(`/api/accelerators/cohorts/${cohortId}/program-stages`, payload, token);
      reset();
      await load();
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось сохранить этап"));
    } finally {
      setBusy("");
    }
  };

  const publish = async (id: number) => {
    setBusy(`publish-${id}`);
    setError("");
    try {
      await postAuthJson(`/api/accelerators/program-stages/${id}/publish`, {}, token);
      await load();
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось опубликовать этап"));
    } finally {
      setBusy("");
    }
  };

  const lifecycle = async (stage: ProgramStage, action: "duplicate" | "archive") => {
    if (action === "archive" && !window.confirm(`Архивировать этап «${stage.title}»?`)) return;
    setBusy(`${action}-${stage.id}`);
    setError("");
    try {
      await postAuthJson(`/api/accelerators/program-stages/${stage.id}/${action}`, {}, token);
      await load();
    } catch (reason) {
      setError(describeApiError(reason, action === "archive" ? "Не удалось архивировать этап" : "Не удалось создать копию этапа"));
    } finally {
      setBusy("");
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const reordered = [...stages];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setBusy("reorder");
    setError("");
    try {
      setStages(await putAuthJson<ProgramStage[]>(`/api/accelerators/cohorts/${cohortId}/program-stages/reorder`, { stage_ids: reordered.map((row) => row.id) }, token));
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось изменить порядок этапов"));
      await load();
    } finally {
      setBusy("");
    }
  };

  const addMaterial = () => setForm((current) => ({
    ...current,
    materials: [...current.materials, { title: "", kind: "link", url: "", content: "", required: true }],
  }));

  const patchMaterial = (index: number, patch: Partial<Material>) => setForm((current) => ({
    ...current,
    materials: current.materials.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
  }));

  const uploadMaterialFile = async (index: number, file: File | undefined) => {
    if (!file) return;
    setBusy(`material-upload-${index}`);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const headers: Record<string, string> = { "x-pitchy-api": "1" };
      if (token !== "cookie-session") headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`/api/accelerators/cohorts/${cohortId}/program-files`, {
        method: "POST",
        headers,
        body,
        credentials: "include",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `Не удалось загрузить ${file.name}`);
      }
      const result = await response.json() as { name: string; url: string };
      setForm((current) => ({
        ...current,
        materials: current.materials.map((item, itemIndex) => itemIndex === index ? {
          ...item,
          title: item.title.trim() ? item.title : result.name,
          url: result.url,
          content: "",
        } : item),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить файл материала");
    } finally {
      setBusy("");
    }
  };

  const addAction = () => setForm((current) => ({
    ...current,
    actions: [...current.actions, {
      action_type: "chat",
      title: ACTION_META.chat.defaultTitle,
      description: "",
      required: false,
      config: {},
    }],
  }));

  const patchAction = (index: number, patch: Partial<ProgramAction>) => setForm((current) => ({
    ...current,
    actions: current.actions.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
  }));

  return <section>
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/8 pb-6">
      <div>
        <p className="text-xs text-white/35">Обзор потока&nbsp; / &nbsp;Программа</p>
        <h1 className="mt-3 text-3xl font-semibold">Этапы программы</h1>
        <p className="mt-2 text-sm text-white/40">{stages.length} этапов&nbsp; · &nbsp;{stages.filter((stage) => stage.status === "published").length} опубликовано&nbsp; · &nbsp;{stages.filter((stage) => stage.status === "draft").length} черновика</p>
      </div>
      <button type="button" onClick={() => showForm ? reset() : (setFormTab("main"), setShowForm(true))} className="workspace-button">
        <Plus size={15} />{showForm ? "Закрыть" : "Добавить этап"}
      </button>
    </div>

    {error && <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}

    {showForm && <div className="fixed inset-0 z-[80] flex justify-end bg-black/65" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) reset(); }}><form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="stage-form-title" className="flex h-full w-full max-w-3xl flex-col border-l border-white/10 bg-[#1c1b1b] shadow-2xl">
      <div className="flex items-start justify-between px-5 pb-4 pt-5 sm:px-6"><div><div className="flex flex-wrap items-center gap-3"><h3 id="stage-form-title" className="text-2xl">{editingId ? "Редактирование этапа" : "Новый этап"}</h3><span className="rounded-full border border-violet-300/25 bg-violet-400/10 px-2.5 py-1 text-xs text-violet-200">Черновик</span></div><p className="mt-1 text-sm text-white/40">{form.title || "Настройте этап программы"}</p></div><button type="button" onClick={reset} aria-label="Закрыть" className="rounded-full p-2 text-white/45 hover:bg-white/5"><X /></button></div>
      <div className="grid grid-cols-3 border-b border-white/10 px-5 sm:px-6">{([['main','Основное'],['content','Состав этапа'],['completion','Завершение']] as const).map(([key,label])=><button key={key} type="button" onClick={()=>setFormTab(key)} className={`border-b-2 px-2 py-4 text-sm ${formTab===key?'border-white text-white':'border-transparent text-white/45'}`}>{label}</button>)}</div>
      <div className="flex-1 overflow-y-auto p-5 sm:p-6">{formTab === "main" && <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-white/60">Название<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} minLength={2} required className="workspace-input mt-2" /></label>
        <label className="text-sm text-white/60">Открыть не раньше<input type="datetime-local" value={form.unlockAt} onChange={(event) => setForm({ ...form, unlockAt: event.target.value })} className="workspace-input mt-2" /></label>
        <label className="text-sm text-white/60">Срок этапа<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} className="workspace-input mt-2" /></label>
        <label className="text-sm text-white/60 sm:col-span-2">Описание<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} className="workspace-input mt-2 resize-y" /></label>
        <label className="flex items-center gap-3 text-sm text-white/60"><input type="checkbox" checked={form.required} onChange={(event) => setForm({ ...form, required: event.target.checked })} /> Обязательный этап</label>
      </div>}

      {formTab === "content" && <><div className="flex flex-wrap items-center justify-between gap-3">
        <div><h4>Действия Pitchy</h4><p className="mt-1 text-xs text-white/35">Проект и контекст этапа подставятся автоматически.</p></div>
        <button type="button" onClick={addAction} className="workspace-button !bg-transparent !text-white"><Plus size={14} /> Действие</button>
      </div>
      <div className="mt-3 space-y-3">
        {form.actions.map((action, index) => {
          const meta = ACTION_META[action.action_type];
          const Icon = meta.icon;
          return <div key={index} className="grid gap-3 rounded-2xl border border-violet-300/15 bg-violet-300/[0.035] p-4 sm:grid-cols-[170px_1fr_auto]">
            <label className="relative">
              <Icon size={15} className="pointer-events-none absolute left-3 top-3.5 text-white/35" />
              <select value={action.action_type} onChange={(event) => { const actionType = event.target.value as ProgramActionType; patchAction(index, { action_type: actionType, title: ACTION_META[actionType].defaultTitle }); }} className="workspace-input !pl-9">
                {(Object.entries(ACTION_META) as Array<[ProgramActionType, { label: string; defaultTitle: string; icon: typeof MessageSquare }]>).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
              </select>
            </label>
            <input value={action.title} onChange={(event) => patchAction(index, { title: event.target.value })} required minLength={2} placeholder="Название действия" className="workspace-input" />
            <button type="button" onClick={() => setForm((current) => ({ ...current, actions: current.actions.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-full p-3 text-white/35 hover:text-red-300" aria-label="Удалить действие"><Trash2 size={17} /></button>
            <textarea value={action.description || ""} onChange={(event) => patchAction(index, { description: event.target.value })} rows={2} placeholder="Что именно должен получить резидент" className="workspace-input resize-y sm:col-span-2" />
            <label className="flex items-center gap-2 text-xs text-white/50"><input type="checkbox" checked={action.required} onChange={(event) => patchAction(index, { required: event.target.checked })} /> Обязательный результат</label>
          </div>;
        })}
        {!form.actions.length && <p className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-white/30">Действий Pitchy на этом этапе пока нет.</p>}
      </div>

      <div className="mt-7 flex items-center justify-between">
        <h4>Материалы</h4>
        <button type="button" onClick={addMaterial} className="workspace-button !bg-transparent !text-white"><Plus size={14} /> Материал</button>
      </div>
      <div className="mt-3 space-y-3">{form.materials.map((material, index) => <div key={index} className="grid gap-3 rounded-2xl border border-white/8 p-4 sm:grid-cols-[1fr_150px_auto]">
        <input value={material.title} onChange={(event) => patchMaterial(index, { title: event.target.value })} required placeholder="Название материала" className="workspace-input" />
        <select value={material.kind} onChange={(event) => patchMaterial(index, { kind: event.target.value as Material["kind"], url: "", content: "" })} className="workspace-input"><option value="link">Ссылка</option><option value="video">Видео</option><option value="text">Текст</option><option value="file">Файл</option></select>
        <button type="button" onClick={() => setForm((current) => ({ ...current, materials: current.materials.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-full p-3 text-white/35 hover:text-red-300" aria-label="Удалить материал"><Trash2 size={17} /></button>
        {material.kind === "text" ? <textarea value={material.content || ""} onChange={(event) => patchMaterial(index, { content: event.target.value })} required rows={3} placeholder="Содержание" className="workspace-input resize-y sm:col-span-3" /> : material.kind === "file" ? <div className="rounded-xl border border-dashed border-white/15 p-4 sm:col-span-3">
          <label className={`inline-flex items-center gap-2 text-sm ${busy === `material-upload-${index}` ? "cursor-wait text-white/35" : "cursor-pointer text-white/65"}`}>
            {busy === `material-upload-${index}` ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
            {busy === `material-upload-${index}` ? "Загрузка…" : material.url ? "Заменить файл" : "Прикрепить файл"}
            <input type="file" disabled={busy === `material-upload-${index}`} accept=".pdf,.doc,.docx,.txt,.md,.xls,.xlsx,.csv,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.mp3,.wav,.m4a,.mp4,.mov,.webm" className="sr-only" onChange={(event) => { void uploadMaterialFile(index, event.target.files?.[0]); event.target.value = ""; }} />
          </label>
          {material.url ? <a href={material.url} target="_blank" rel="noreferrer" className="ml-3 text-xs text-blue-300 underline">Файл загружен</a> : <p className="mt-2 text-xs text-white/30">PDF, DOC/DOCX, TXT, MD, таблицы, презентации, изображения, аудио и видео</p>}
        </div> : <input value={material.url || ""} onChange={(event) => patchMaterial(index, { url: event.target.value })} required type="url" placeholder="https://…" className="workspace-input sm:col-span-3" />}
        <label className="flex items-center gap-2 text-xs text-white/45 sm:col-span-3"><input type="checkbox" checked={material.required} onChange={(event) => patchMaterial(index, { required: event.target.checked })} /> Обязательный материал</label>
      </div>)}</div></>}

      {formTab === "completion" && <div className="space-y-5"><div><h4 className="text-lg">Правила завершения</h4><p className="mt-1 text-sm text-white/40">Определите, когда участнику засчитывается этап.</p></div><label className="block text-sm text-white/60">Как завершается этап<select value={form.completionMode} onChange={(event) => setForm({ ...form, completionMode: event.target.value as "auto" | "manual" | "none" })} className="workspace-input mt-2"><option value="auto">Автоматически по требованиям</option><option value="manual">После подтверждения трекера</option><option value="none">Информационный, не влияет на процент</option></select></label><label className="flex items-center justify-between gap-4 rounded-xl border border-white/9 p-4 text-sm text-white/60"><span><b className="block font-medium text-white">Посещение мероприятий</b><small className="mt-1 block text-white/35">Все связанные мероприятия должны быть посещены.</small></span><input type="checkbox" checked={form.attendanceRequired} onChange={(event) => setForm({ ...form, attendanceRequired: event.target.checked })} /></label><div className="rounded-xl border border-white/8 p-4 text-sm text-white/45"><p>Материалы: {form.materials.filter(item=>item.required).length} обязательных</p><p className="mt-2">Действия Pitchy: {form.actions.filter(item=>item.required).length} обязательных</p><p className="mt-2">Домашние задания и мероприятия учитываются автоматически после привязки.</p></div></div>}</div>
      <div className="flex items-center justify-between gap-2 border-t border-white/8 bg-[#1c1b1b] px-5 py-4 sm:px-6"><button type="button" onClick={()=>formTab==='main'?reset():setFormTab(formTab==='completion'?'content':'main')} className="overview-secondary">{formTab==='main'?'Отмена':'Назад'}</button><div className="flex gap-2"><button disabled={Boolean(busy)} className="overview-secondary">{busy === "save" && <Loader2 size={15} className="animate-spin" />} Сохранить черновик</button>{formTab!=='completion'&&<button type="button" onClick={()=>setFormTab(formTab==='main'?'content':'completion')} className="workspace-button">Продолжить</button>}</div></div>
    </form></div>}

    <div className="mt-6">
      {!stages.length ? <div className="grid min-h-[420px] place-items-center rounded-2xl border border-white/8"><div className="max-w-md text-center"><GitBranch className="mx-auto text-white/25" size={44} /><h2 className="mt-5 text-2xl">Программа пока не собрана</h2><p className="mt-2 text-sm text-white/40">Создайте первый этап и добавьте в него материалы, действия, мероприятия и задания.</p><button type="button" onClick={() => setShowForm(true)} className="workspace-button mt-6"><Plus size={15} /> Создать первый этап</button></div></div> : <div className="relative before:absolute before:bottom-8 before:left-5 before:top-8 before:w-px before:bg-white/12">{stages.map((stage, index) => <article id={`dashboard-stage-${stage.id}`} key={stage.id} className="relative border-b border-white/8 py-6 pl-16 last:border-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <span className="absolute left-0 z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/20 bg-[#1c1b1b] text-sm">{index + 1}</span>
            <div>
              <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg">{stage.title}</h3><span className={`rounded-full px-2 py-1 text-xs ${stage.status === "published" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/7 text-white/40"}`}>{stage.status === "published" ? "Опубликован" : "Черновик"}</span>{!stage.required && <span className="text-xs text-white/30">необязательный</span>}</div>
              {stage.description && <p className="mt-2 text-sm text-white/45">{stage.description}</p>}
              <p className="mt-3 text-xs text-white/30">Действий: {(stage.actions || []).length} · материалов: {stage.materials.length} · домашних заданий: {stage.homework_assignment_ids.length} · {stage.completion_policy?.mode === "manual" ? "подтверждает трекер" : stage.completion_policy?.mode === "none" ? "информационный" : "автозавершение"}{stage.unlock_at ? ` · откроется ${new Date(stage.unlock_at).toLocaleString("ru-RU")}` : ""}{stage.due_at ? ` · срок ${new Date(stage.due_at).toLocaleString("ru-RU")}` : ""}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void move(index, -1)} disabled={index === 0 || busy === "reorder"} className="rounded-full border border-white/10 p-2 text-white/50"><ArrowUp size={15} /></button>
            <button type="button" onClick={() => void move(index, 1)} disabled={index === stages.length - 1 || busy === "reorder"} className="rounded-full border border-white/10 p-2 text-white/50"><ArrowDown size={15} /></button>
            {stage.status === "draft" && <><button type="button" onClick={() => edit(stage)} className="workspace-button !bg-transparent !text-white"><Pencil size={14} /> Изменить</button><button type="button" onClick={() => void publish(stage.id)} disabled={busy === `publish-${stage.id}`} className="workspace-button"><Send size={14} /> Опубликовать</button></>}
            <button type="button" onClick={() => void lifecycle(stage, "duplicate")} disabled={Boolean(busy)} title="Создать редактируемую копию" className="rounded-full border border-white/10 p-2 text-white/50"><Copy size={15} /></button>
            <button type="button" onClick={() => void lifecycle(stage, "archive")} disabled={Boolean(busy)} title="Архивировать" className="rounded-full border border-white/10 p-2 text-white/50 hover:text-red-300"><Archive size={15} /></button>
          </div>
        </div>
      </article>)}</div>}
    </div>
  </section>;
}
