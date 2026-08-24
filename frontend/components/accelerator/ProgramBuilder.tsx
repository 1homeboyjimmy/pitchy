"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Banknote,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  FileSearch,
  GitBranch,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Presentation,
  Send,
  Trash2,
  Users,
} from "lucide-react";

import { describeApiError, getAuthJson, postAuthJson, putAuthJson } from "@/lib/api";

type Material = {
  id?: number;
  title: string;
  kind: "link" | "video" | "text";
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
  required: boolean;
  status: "draft" | "published";
  materials: Material[];
  actions: ProgramAction[];
  homework_assignment_ids: number[];
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
  required: true,
  materials: [] as Material[],
  actions: [] as ProgramAction[],
});

const localDate = (value: string) => new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function ProgramBuilder({ cohortId, token }: { cohortId: number; token: string }) {
  const [stages, setStages] = useState<ProgramStage[]>([]);
  const [form, setForm] = useState(makeEmptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
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

  const reset = () => {
    setForm(makeEmptyForm());
    setEditingId(null);
    setShowForm(false);
  };

  const edit = (stage: ProgramStage) => {
    setForm({
      title: stage.title,
      description: stage.description || "",
      unlockAt: stage.unlock_at ? localDate(stage.unlock_at) : "",
      required: stage.required,
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
      required: form.required,
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

  return <section className="workspace-card">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-xl">Этапы программы</h2>
        <p className="mt-1 text-sm text-white/40">Соберите путь из материалов и действий Pitchy. Обязательные результаты блокируют завершение этапа.</p>
      </div>
      <button type="button" onClick={() => showForm ? reset() : setShowForm(true)} className="workspace-button">
        <Plus size={15} />{showForm ? "Закрыть" : "Добавить этап"}
      </button>
    </div>

    {error && <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}

    {showForm && <form onSubmit={save} className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-5">
      <h3>{editingId ? "Редактирование этапа" : "Новый этап"}</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-white/60">Название<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} minLength={2} required className="workspace-input mt-2" /></label>
        <label className="text-sm text-white/60">Открыть не раньше<input type="datetime-local" value={form.unlockAt} onChange={(event) => setForm({ ...form, unlockAt: event.target.value })} className="workspace-input mt-2" /></label>
        <label className="text-sm text-white/60 sm:col-span-2">Описание<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} className="workspace-input mt-2 resize-y" /></label>
        <label className="flex items-center gap-3 text-sm text-white/60"><input type="checkbox" checked={form.required} onChange={(event) => setForm({ ...form, required: event.target.checked })} /> Обязательный этап</label>
      </div>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
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
        <select value={material.kind} onChange={(event) => patchMaterial(index, { kind: event.target.value as Material["kind"] })} className="workspace-input"><option value="link">Ссылка</option><option value="video">Видео</option><option value="text">Текст</option></select>
        <button type="button" onClick={() => setForm((current) => ({ ...current, materials: current.materials.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-full p-3 text-white/35 hover:text-red-300" aria-label="Удалить материал"><Trash2 size={17} /></button>
        {material.kind === "text" ? <textarea value={material.content || ""} onChange={(event) => patchMaterial(index, { content: event.target.value })} required rows={3} placeholder="Содержание" className="workspace-input resize-y sm:col-span-3" /> : <input value={material.url || ""} onChange={(event) => patchMaterial(index, { url: event.target.value })} required type="url" placeholder="https://…" className="workspace-input sm:col-span-3" />}
        <label className="flex items-center gap-2 text-xs text-white/45 sm:col-span-3"><input type="checkbox" checked={material.required} onChange={(event) => patchMaterial(index, { required: event.target.checked })} /> Обязательный материал</label>
      </div>)}</div>

      <div className="mt-5 flex justify-end"><button disabled={busy === "save"} className="workspace-button">{busy === "save" && <Loader2 size={15} className="animate-spin" />} Сохранить черновик</button></div>
    </form>}

    <div className="mt-6 space-y-3">
      {!stages.length ? <p className="py-6 text-center text-sm text-white/35">Этапов пока нет.</p> : stages.map((stage, index) => <article key={stage.id} className="rounded-2xl border border-white/9 bg-white/[0.02] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/8 text-sm">{index + 1}</span>
            <div>
              <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg">{stage.title}</h3><span className={`rounded-full px-2 py-1 text-xs ${stage.status === "published" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/7 text-white/40"}`}>{stage.status === "published" ? "Опубликован" : "Черновик"}</span>{!stage.required && <span className="text-xs text-white/30">необязательный</span>}</div>
              {stage.description && <p className="mt-2 text-sm text-white/45">{stage.description}</p>}
              <p className="mt-3 text-xs text-white/30">Действий: {(stage.actions || []).length} · материалов: {stage.materials.length} · домашних заданий: {stage.homework_assignment_ids.length}{stage.unlock_at ? ` · откроется ${new Date(stage.unlock_at).toLocaleString("ru-RU")}` : ""}</p>
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
        {(stage.actions || []).length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{stage.actions.map((action, actionIndex) => { const meta = ACTION_META[action.action_type]; const Icon = meta.icon; return <div key={action.id || `${action.action_type}-${actionIndex}`} className="flex items-center gap-3 rounded-xl border border-violet-300/10 bg-violet-300/[0.03] p-3 text-sm text-white/60"><Icon size={15} className="text-violet-200/60" /><span className="truncate">{action.title}</span>{action.required && <Check size={13} className="ml-auto text-emerald-400" />}</div>; })}</div>}
        {stage.materials.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{stage.materials.map((material) => <div key={material.id || material.title} className="flex items-center gap-3 rounded-xl bg-black/25 p-3 text-sm text-white/55">{material.kind === "text" ? <BookOpen size={15} /> : <ExternalLink size={15} />}<span className="truncate">{material.title}</span>{material.required && <Check size={13} className="ml-auto text-emerald-400" />}</div>)}</div>}
      </article>)}
    </div>
  </section>;
}
