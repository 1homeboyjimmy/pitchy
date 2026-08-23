"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Archive, ArrowDown, ArrowUp, BookOpen, Check, Copy, ExternalLink, Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";

import { describeApiError, getAuthJson, postAuthJson, putAuthJson } from "@/lib/api";

type Material = { id?: number; title: string; kind: "link" | "video" | "text"; url?: string | null; content?: string | null; required: boolean; completed?: boolean };
export type ProgramStage = { id: number; title: string; description?: string | null; position: number; unlock_at?: string | null; required: boolean; status: "draft" | "published"; materials: Material[]; homework_assignment_ids: number[] };

const emptyForm = { title: "", description: "", unlockAt: "", required: true, materials: [] as Material[] };
const localDate = (value: string) => new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function ProgramBuilder({ cohortId, token }: { cohortId: number; token: string }) {
  const [stages, setStages] = useState<ProgramStage[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try { setStages(await getAuthJson<ProgramStage[]>(`/api/accelerators/cohorts/${cohortId}/program-stages`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить этапы программы")); }
  }, [cohortId, token]);
  useEffect(() => { void load(); }, [load]);

  const reset = () => { setForm(emptyForm); setEditingId(null); setShowForm(false); };
  const edit = (stage: ProgramStage) => {
    setForm({ title: stage.title, description: stage.description || "", unlockAt: stage.unlock_at ? localDate(stage.unlock_at) : "", required: stage.required, materials: stage.materials.map(({ title, kind, url, content, required }) => ({ title, kind, url, content, required })) });
    setEditingId(stage.id); setShowForm(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy("save"); setError("");
    const payload = { title: form.title, description: form.description || null, unlock_at: form.unlockAt ? new Date(form.unlockAt).toISOString() : null, required: form.required, materials: form.materials };
    try {
      if (editingId) await putAuthJson(`/api/accelerators/program-stages/${editingId}`, payload, token);
      else await postAuthJson(`/api/accelerators/cohorts/${cohortId}/program-stages`, payload, token);
      reset(); await load();
    } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить этап")); }
    finally { setBusy(""); }
  };
  const publish = async (id: number) => {
    setBusy(`publish-${id}`); setError("");
    try { await postAuthJson(`/api/accelerators/program-stages/${id}/publish`, {}, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось опубликовать этап")); }
    finally { setBusy(""); }
  };
  const lifecycle = async (stage: ProgramStage, action: "duplicate" | "archive") => {
    if (action === "archive" && !window.confirm(`Архивировать этап «${stage.title}»?`)) return;
    setBusy(`${action}-${stage.id}`); setError("");
    try { await postAuthJson(`/api/accelerators/program-stages/${stage.id}/${action}`, {}, token); await load(); }
    catch (reason) { setError(describeApiError(reason, action === "archive" ? "Не удалось архивировать этап" : "Не удалось создать копию этапа")); }
    finally { setBusy(""); }
  };
  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction; if (target < 0 || target >= stages.length) return;
    const reordered = [...stages]; [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setBusy("reorder"); setError("");
    try { setStages(await putAuthJson<ProgramStage[]>(`/api/accelerators/cohorts/${cohortId}/program-stages/reorder`, { stage_ids: reordered.map((row) => row.id) }, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось изменить порядок этапов")); await load(); }
    finally { setBusy(""); }
  };
  const addMaterial = () => setForm({ ...form, materials: [...form.materials, { title: "", kind: "link", url: "", content: "", required: true }] });
  const patchMaterial = (index: number, patch: Partial<Material>) => setForm({ ...form, materials: form.materials.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });

  return <section className="workspace-card">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl">Этапы программы</h2><p className="mt-1 text-sm text-white/40">Резидент проходит опубликованные обязательные этапы по порядку.</p></div><button onClick={() => showForm ? reset() : setShowForm(true)} className="workspace-button"><Plus size={15} />{showForm ? "Закрыть" : "Добавить этап"}</button></div>
    {error && <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
    {showForm && <form onSubmit={save} className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-5"><h3>{editingId ? "Редактирование этапа" : "Новый этап"}</h3><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm text-white/60">Название<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} minLength={2} required className="workspace-input mt-2" /></label><label className="text-sm text-white/60">Открыть не раньше<input type="datetime-local" value={form.unlockAt} onChange={(event) => setForm({ ...form, unlockAt: event.target.value })} className="workspace-input mt-2" /></label><label className="text-sm text-white/60 sm:col-span-2">Описание<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} className="workspace-input mt-2 resize-y" /></label><label className="flex items-center gap-3 text-sm text-white/60"><input type="checkbox" checked={form.required} onChange={(event) => setForm({ ...form, required: event.target.checked })} /> Обязательный этап</label></div>
      <div className="mt-6 flex items-center justify-between"><h4>Материалы</h4><button type="button" onClick={addMaterial} className="workspace-button !bg-transparent !text-white"><Plus size={14} /> Материал</button></div><div className="mt-3 space-y-3">{form.materials.map((material, index) => <div key={index} className="grid gap-3 rounded-2xl border border-white/8 p-4 sm:grid-cols-[1fr_150px_auto]"><input value={material.title} onChange={(event) => patchMaterial(index, { title: event.target.value })} required placeholder="Название материала" className="workspace-input" /><select value={material.kind} onChange={(event) => patchMaterial(index, { kind: event.target.value as Material["kind"] })} className="workspace-input"><option value="link">Ссылка</option><option value="video">Видео</option><option value="text">Текст</option></select><button type="button" onClick={() => setForm({ ...form, materials: form.materials.filter((_, itemIndex) => itemIndex !== index) })} className="rounded-full p-3 text-white/35 hover:text-red-300" aria-label="Удалить материал"><Trash2 size={17} /></button>{material.kind === "text" ? <textarea value={material.content || ""} onChange={(event) => patchMaterial(index, { content: event.target.value })} required rows={3} placeholder="Содержание" className="workspace-input resize-y sm:col-span-3" /> : <input value={material.url || ""} onChange={(event) => patchMaterial(index, { url: event.target.value })} required type="url" placeholder="https://…" className="workspace-input sm:col-span-3" />}<label className="flex items-center gap-2 text-xs text-white/45 sm:col-span-3"><input type="checkbox" checked={material.required} onChange={(event) => patchMaterial(index, { required: event.target.checked })} /> Обязательный материал</label></div>)}</div><div className="mt-5 flex justify-end"><button disabled={busy === "save"} className="workspace-button">{busy === "save" && <Loader2 size={15} className="animate-spin" />} Сохранить черновик</button></div></form>}
    <div className="mt-6 space-y-3">{!stages.length ? <p className="py-6 text-center text-sm text-white/35">Этапов пока нет.</p> : stages.map((stage, index) => <article key={stage.id} className="rounded-2xl border border-white/9 bg-white/[0.02] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/8 text-sm">{index + 1}</span><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg">{stage.title}</h3><span className={`rounded-full px-2 py-1 text-xs ${stage.status === "published" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/7 text-white/40"}`}>{stage.status === "published" ? "Опубликован" : "Черновик"}</span>{!stage.required && <span className="text-xs text-white/30">необязательный</span>}</div>{stage.description && <p className="mt-2 text-sm text-white/45">{stage.description}</p>}<p className="mt-3 text-xs text-white/30">Материалов: {stage.materials.length} · домашних заданий: {stage.homework_assignment_ids.length}{stage.unlock_at ? ` · откроется ${new Date(stage.unlock_at).toLocaleString("ru-RU")}` : ""}</p></div></div><div className="flex flex-wrap gap-2"><button onClick={() => void move(index, -1)} disabled={index === 0 || busy === "reorder"} className="rounded-full border border-white/10 p-2 text-white/50"><ArrowUp size={15} /></button><button onClick={() => void move(index, 1)} disabled={index === stages.length - 1 || busy === "reorder"} className="rounded-full border border-white/10 p-2 text-white/50"><ArrowDown size={15} /></button>{stage.status === "draft" && <><button onClick={() => edit(stage)} className="workspace-button !bg-transparent !text-white"><Pencil size={14} /> Изменить</button><button onClick={() => void publish(stage.id)} disabled={busy === `publish-${stage.id}`} className="workspace-button"><Send size={14} /> Опубликовать</button></>}<button onClick={() => void lifecycle(stage, "duplicate")} disabled={Boolean(busy)} title="Создать редактируемую копию" className="rounded-full border border-white/10 p-2 text-white/50"><Copy size={15} /></button><button onClick={() => void lifecycle(stage, "archive")} disabled={Boolean(busy)} title="Архивировать" className="rounded-full border border-white/10 p-2 text-white/50 hover:text-red-300"><Archive size={15} /></button></div></div>{stage.materials.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{stage.materials.map((material) => <div key={material.id || material.title} className="flex items-center gap-3 rounded-xl bg-black/25 p-3 text-sm text-white/55">{material.kind === "text" ? <BookOpen size={15} /> : <ExternalLink size={15} />}<span className="truncate">{material.title}</span>{material.required && <Check size={13} className="ml-auto text-emerald-400" />}</div>)}</div>}</article>)}</div>
  </section>;
}
