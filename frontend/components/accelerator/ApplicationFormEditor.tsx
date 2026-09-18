"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Eye, Loader2, Plus, Send, Trash2, X } from "lucide-react";

import { describeApiError, getAuthJson, postAuthJson, putAuthJson } from "@/lib/api";
import { ApplicationImportWizard } from "./ApplicationImportWizard";

export type ApplicationFormField = {
  key: string; label: string; description?: string; placeholder?: string;
  type?: "text" | "email" | "number" | "textarea" | "select" | "multiselect" | "scale" | "date" | "url" | "telegram" | "file";
  required?: boolean; application_types?: Array<"project" | "participant">;
  options?: Array<string | { value: string; label: string }>; section?: string;
};
export type ApplicationFormSection = { key: string; title: string; description?: string };
export type ApplicationFormSchema = { title?: string; description?: string; fields?: ApplicationFormField[]; required?: string[]; sections?: ApplicationFormSection[] };
type EditableField = Omit<ApplicationFormField, "options"> & { options: string[] };
type Draft = { title: string; description: string; fields: EditableField[]; sections: ApplicationFormSection[] };
type SaveState = "loading" | "saved" | "dirty" | "saving" | "error";
type DraftResponse = { published_version: number; draft_revision?: number; draft_schema: ApplicationFormSchema; has_unpublished_changes: boolean };
const FIELD_TYPES: Array<{ value: NonNullable<ApplicationFormField["type"]>; label: string }> = [
  { value: "text", label: "Короткий текст" }, { value: "textarea", label: "Развёрнутый текст" },
  { value: "number", label: "Число" }, { value: "email", label: "Email" },
  { value: "select", label: "Выбор из списка" }, { value: "multiselect", label: "Несколько вариантов" },
  { value: "scale", label: "Шкала 1–10" }, { value: "date", label: "Дата" },
  { value: "url", label: "Ссылка" }, { value: "telegram", label: "Telegram" }, { value: "file", label: "Файлы" },
];
function normalize(schema: ApplicationFormSchema): Draft {
  const required = new Set(schema.required || []);
  return {
    title: schema.title || "", description: schema.description || "", sections: schema.sections || [],
    fields: (schema.fields || []).map((field) => ({
      ...field, label: field.label || field.key, type: field.type || "text",
      required: Boolean(field.required || required.has(field.key)),
      application_types: field.application_types || ["project", "participant"],
      options: (field.options || []).map((option) => typeof option === "string" ? option : option.label),
    })),
  };
}
function newKey(fields: EditableField[]) {
  let id = fields.length + 1;
  while (fields.some((field) => field.key === "question_" + id)) id += 1;
  return "question_" + id;
}
function payload(draft: Draft): ApplicationFormSchema {
  const fields: ApplicationFormField[] = draft.fields.map((field) => ({
    key: field.key, label: field.label.trim(), type: field.type || "text", required: Boolean(field.required),
    application_types: field.application_types || ["project", "participant"],
    ...(field.section ? { section: field.section } : {}),
    ...(field.placeholder?.trim() ? { placeholder: field.placeholder.trim() } : {}),
    ...(field.description?.trim() ? { description: field.description.trim() } : {}),
    ...(field.type === "select" || field.type === "multiselect" ? { options: field.options.map((option) => option.trim()).filter(Boolean) } : {}),
  }));
  return { title: draft.title.trim(), description: draft.description.trim(), sections: draft.sections, fields, required: fields.filter((field) => field.required).map((field) => field.key) };
}
function validate(draft: Draft) {
  if (!draft.title.trim()) return "Укажите заголовок формы.";
  const keys = draft.fields.map((field) => field.key);
  if (keys.some((key) => !/^[a-z][a-z0-9_]{0,63}$/.test(key)) || new Set(keys).size !== keys.length) return "У вопросов должны быть уникальные системные ключи.";
  const sectionKeys = draft.sections.map((section) => section.key);
  if (sectionKeys.some((key) => !/^[a-z][a-z0-9_]{0,63}$/.test(key)) || new Set(sectionKeys).size !== sectionKeys.length) return "У разделов должны быть уникальные системные ключи.";
  if (draft.sections.some((section) => !section.title.trim())) return "Укажите название каждого раздела.";
  if (draft.fields.some((field) => !field.label.trim())) return "Укажите название каждого вопроса.";
  if (draft.fields.some((field) => !field.application_types?.length)) return "Выберите тип заявки для каждого вопроса.";
  if (draft.fields.some((field) => (field.type === "select" || field.type === "multiselect") && field.options.filter((option) => option.trim()).length < 2)) return "Для вопроса с выбором нужно не меньше двух вариантов.";
  return "";
}
function fieldType(field: EditableField) { return FIELD_TYPES.find((item) => item.value === field.type)?.label || "Короткий текст"; }

export function ApplicationFormEditor({ schema, cohortId, token, publicUrl, cohortStatus, onSettings, onApplications, onPublished }: {
  schema: ApplicationFormSchema; cohortId: number; token: string; publicUrl: string; cohortStatus?: string;
  onSettings?: () => void; onApplications?: () => void; onPublished: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => normalize(schema));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [hasUnpublished, setHasUnpublished] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState(1);
  const [publishing, setPublishing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewType, setPreviewType] = useState<"project" | "participant">("project");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");
  const draftRef = useRef(draft);
  const savedSnapshot = useRef("");
  const revision = useRef(0);
  const savePromise = useRef<Promise<boolean> | null>(null);
  const request = useRef(0);
  const loaded = useRef(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const edit = (updater: (current: Draft) => Draft) => {
    setDraft((current) => { const next = updater(current); draftRef.current = next; return next; });
    setSaveState("dirty"); setError("");
  };
  useEffect(() => {
    const current = ++request.current;
    loaded.current = false;
    setSaveState("loading");
    getAuthJson<DraftResponse>("/api/accelerators/cohorts/" + cohortId + "/application-form/draft", token)
      .then((response) => {
        if (request.current !== current) return;
        const next = normalize(response.draft_schema || schema);
        draftRef.current = next; setDraft(next); savedSnapshot.current = JSON.stringify(next);
        revision.current = response.draft_revision || 0;
        setPublishedVersion(response.published_version);
        setHasUnpublished(response.has_unpublished_changes);
        setSelectedKey(next.fields[0]?.key || null);
        setSaveState("saved"); loaded.current = true;
      })
      .catch((reason) => { if (request.current === current) { setError(describeApiError(reason, "Не удалось загрузить черновик анкеты")); setSaveState("error"); } });
    return () => { request.current += 1; };
  }, [cohortId, schema, token]);

  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!loaded.current) return false;
    if (savePromise.current) await savePromise.current;
    const snapshot = draftRef.current;
    const serialized = JSON.stringify(snapshot);
    if (serialized === savedSnapshot.current) return true;
    const validation = validate(snapshot);
    if (validation) { setError(validation); setSaveState("error"); return false; }
    setSaveState("saving"); setError("");
    const operation = (async () => {
      try {
        const response = await putAuthJson<DraftResponse>("/api/accelerators/cohorts/" + cohortId + "/application-form/draft", { schema: payload(snapshot), expected_revision: revision.current }, token);
        revision.current = response.draft_revision ?? revision.current + 1;
        savedSnapshot.current = serialized;
        setHasUnpublished(true);
        setSaveState(JSON.stringify(draftRef.current) === serialized ? "saved" : "dirty");
        return true;
      } catch (reason) {
        setError(describeApiError(reason, "Не удалось сохранить черновик"));
        setSaveState("error");
        return false;
      }
    })();
    savePromise.current = operation;
    try { return await operation; } finally { if (savePromise.current === operation) savePromise.current = null; }
  }, [cohortId, token]);
  useEffect(() => {
    if (saveState !== "dirty" || !loaded.current || publishing) return;
    const timer = window.setTimeout(() => { void saveDraft(); }, 800);
    return () => window.clearTimeout(timer);
  }, [draft, saveState, publishing, saveDraft]);
  const publish = async () => {
    if (publishing || !loaded.current) return;
    const pendingPublication = hasUnpublished || JSON.stringify(draftRef.current) !== savedSnapshot.current;
    if (!pendingPublication) return;
    setPublishing(true); setError("");
    try {
      if (savePromise.current && !(await savePromise.current)) return;
      if (JSON.stringify(draftRef.current) !== savedSnapshot.current && !(await saveDraft())) return;
      const response = await postAuthJson<{ application_form_version: number; application_form_draft_revision?: number }>("/api/accelerators/cohorts/" + cohortId + "/application-form/publish", {}, token);
      revision.current = response.application_form_draft_revision ?? revision.current + 1;
      setPublishedVersion(response.application_form_version);
      setHasUnpublished(false); setSaveState("saved");
      await onPublished();
    } catch (reason) { setError(describeApiError(reason, "Не удалось опубликовать анкету")); }
    finally { setPublishing(false); }
  };
  const addField = (section?: string) => {
    const key = newKey(draftRef.current.fields);
    edit((current) => ({ ...current, fields: [...current.fields, { key, label: "Новый вопрос", type: "text", options: [], required: false, application_types: ["project", "participant"], section }] }));
    setSelectedKey(key);
  };
  const patchField = (key: string, patch: Partial<EditableField>) => edit((current) => ({ ...current, fields: current.fields.map((field) => field.key === key ? { ...field, ...patch } : field) }));
  const move = (key: string, direction: -1 | 1) => edit((current) => {
    const index = current.fields.findIndex((field) => field.key === key), next = index + direction;
    if (next < 0 || next >= current.fields.length) return current;
    const fields = [...current.fields]; [fields[index], fields[next]] = [fields[next], fields[index]];
    return { ...current, fields };
  });
  const duplicate = (key: string) => {
    const nextKey = newKey(draftRef.current.fields);
    edit((current) => {
      const index = current.fields.findIndex((field) => field.key === key);
      const fields = [...current.fields];
      fields.splice(index + 1, 0, { ...fields[index], key: nextKey, label: fields[index].label + " — копия", options: [...fields[index].options] });
      return { ...current, fields };
    });
    setSelectedKey(nextKey);
  };
  const addSection = () => {
    let index = draftRef.current.sections.length + 1;
    while (draftRef.current.sections.some((section) => section.key === "section_" + index)) index += 1;
    const key = "section_" + index;
    edit((current) => ({ ...current, sections: [...current.sections, { key, title: "Новый раздел" }] }));
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(new URL(publicUrl, window.location.origin).href); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setError("Не удалось скопировать ссылку. Выделите адрес в поле справа."); }
  };
  const publicAddress = origin ? new URL(publicUrl, origin).href : publicUrl;
  const sections = [{ key: "", title: "О себе" }, ...draft.sections];
  const saveLabel = saveState === "loading" ? "Загружаем черновик…" : saveState === "dirty" ? "Есть несохранённые изменения" : saveState === "saving" ? "Сохраняем…" : saveState === "error" ? "Не удалось сохранить" : hasUnpublished ? "Черновик сохранён · есть неопубликованные изменения" : "Все изменения сохранены";

  return <div className="space-y-4">
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-white/15 bg-[#141313] py-4">
      <div><h1 className="text-3xl font-semibold tracking-tight">Анкета и ссылка</h1><p className="mt-1 text-sm text-white/55">Подготовьте форму и начните собирать заявки</p></div>
      <div className="flex flex-wrap items-center gap-2"><span role="status" className="mr-2 text-xs text-white/60">{saveState === "saving" && <Loader2 size={13} className="mr-1 inline animate-spin" />}{saveLabel}</span><button type="button" onClick={() => setPreview(true)} disabled={saveState === "loading"} className="rounded-lg border border-white/35 px-4 py-2 text-sm"><Eye size={15} className="mr-2 inline" />Предпросмотр</button><button type="button" onClick={() => void publish()} disabled={publishing || saveState === "loading" || (!hasUnpublished && saveState !== "dirty" && saveState !== "error")} className="workspace-button !rounded-lg"><Send size={15} />{publishing ? "Публикуем…" : "Опубликовать изменения"}</button></div>
    </header>
    {error && <p role="alert" className="rounded-lg border border-amber-300/25 p-3 text-sm text-amber-100">{error} <button type="button" onClick={() => void saveDraft()} className="ml-2 underline">Повторить сохранение</button></p>}
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <main className="order-1 min-w-0 rounded-xl border border-white/15 bg-[#1c1b1b] p-5 lg:p-6">
        <fieldset disabled={publishing || saveState === "loading"} className="space-y-6">
          <div><label className="text-xs uppercase tracking-widest text-white/55">Заголовок формы<input value={draft.title} onChange={(event) => edit((current) => ({ ...current, title: event.target.value }))} maxLength={300} className="mt-2 block w-full border-b border-white/25 bg-transparent py-2 text-2xl font-semibold normal-case tracking-normal outline-none focus:border-white" /></label><label className="mt-3 block text-sm text-white/55">Описание<textarea value={draft.description} onChange={(event) => edit((current) => ({ ...current, description: event.target.value }))} rows={2} maxLength={4000} placeholder="Расскажите кандидатам о заявке" className="mt-2 block w-full resize-y border-b border-white/20 bg-transparent py-2 text-base text-white outline-none focus:border-white" /></label></div>
          <div className="flex items-center gap-3 text-sm text-white/75"><span className="grid h-7 w-7 place-items-center rounded-full bg-white/15"><Check size={14} /></span>Контакты <span className="text-white/45">Имя и email · обязательные поля</span></div>
          {sections.map((section) => <section key={section.key || "about"} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-5">
              {section.key ? <input aria-label="Название раздела" value={section.title} onChange={(event) => edit((current) => ({ ...current, sections: current.sections.map((row) => row.key === section.key ? { ...row, title: event.target.value } : row) }))} className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none focus:underline" /> : <h2 className="text-xl font-semibold">{section.title}</h2>}
              <div className="flex gap-3"><button type="button" onClick={() => addField(section.key || undefined)} className="text-sm text-white/70"><Plus size={16} className="mr-1 inline" />Добавить вопрос</button>{section.key && <button type="button" aria-label={"Удалить раздел " + section.title} onClick={() => edit((current) => ({ ...current, sections: current.sections.filter((row) => row.key !== section.key), fields: current.fields.map((field) => field.section === section.key ? { ...field, section: undefined } : field) }))} className="text-white/45"><Trash2 size={16} /></button>}</div>
            </div>
            {draft.fields.filter((field) => (field.section || "") === section.key).map((field) => {
              const index = draft.fields.findIndex((row) => row.key === field.key);
              const active = selectedKey === field.key;
              return <article key={field.key} className={"rounded-lg border " + (active ? "border-white bg-white/[0.035]" : "border-white/15")}>
                {active ? <div className="space-y-4 p-4">
                  <div className="flex items-center justify-between gap-2"><span className="text-xs uppercase tracking-wide text-white/55">Вопрос {index + 1}</span><div className="flex gap-1"><IconButton label="Поднять" disabled={index === 0} onClick={() => move(field.key, -1)}><ArrowUp size={15} /></IconButton><IconButton label="Опустить" disabled={index === draft.fields.length - 1} onClick={() => move(field.key, 1)}><ArrowDown size={15} /></IconButton><IconButton label="Дублировать" onClick={() => duplicate(field.key)}><Copy size={15} /></IconButton><IconButton label="Удалить" onClick={() => { edit((current) => ({ ...current, fields: current.fields.filter((row) => row.key !== field.key) })); setSelectedKey(null); }}><Trash2 size={15} /></IconButton></div></div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_210px]"><label className="text-xs text-white/55">Вопрос<input aria-label="Название вопроса" value={field.label} onChange={(event) => patchField(field.key, { label: event.target.value })} maxLength={300} className="workspace-input mt-1 !rounded-lg" /></label><label className="text-xs text-white/55">Тип ответа<select value={field.type || "text"} onChange={(event) => patchField(field.key, { type: event.target.value as EditableField["type"] })} className="workspace-input mt-1 !rounded-lg">{FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label></div>
                  <div className="min-h-16 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/45">{field.placeholder || "Текст ответа"}</div>
                  {(field.type === "select" || field.type === "multiselect") && <label className="block text-xs text-white/55">Варианты ответа, один на строку<textarea value={field.options.join("\n")} onChange={(event) => patchField(field.key, { options: event.target.value.split("\n") })} rows={4} className="workspace-input mt-1 !rounded-lg" /></label>}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(field.required)} onChange={(event) => patchField(field.key, { required: event.target.checked })} />Обязательный</label><label className="flex items-center gap-2">Показывать<select value={field.application_types?.length === 1 ? field.application_types[0] : "all"} onChange={(event) => patchField(field.key, { application_types: event.target.value === "all" ? ["project", "participant"] : [event.target.value as "project" | "participant"] })} className="rounded-lg border border-white/20 bg-[#242323] px-2 py-2"><option value="all">всем</option><option value="project">с проектом</option><option value="participant">без проекта</option></select></label></div>
                  <details className="border-t border-white/15 pt-3 text-sm text-white/60"><summary className="cursor-pointer">Дополнительные настройки</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label>Подсказка<input value={field.placeholder || ""} onChange={(event) => patchField(field.key, { placeholder: event.target.value })} maxLength={500} className="workspace-input mt-1 !rounded-lg" /></label><label>Пояснение<input value={field.description || ""} onChange={(event) => patchField(field.key, { description: event.target.value })} maxLength={1000} className="workspace-input mt-1 !rounded-lg" /></label><label>Раздел<select value={field.section || ""} onChange={(event) => patchField(field.key, { section: event.target.value || undefined })} className="workspace-input mt-1 !rounded-lg"><option value="">О себе</option>{draft.sections.map((row) => <option key={row.key} value={row.key}>{row.title}</option>)}</select></label><p className="self-end text-xs">Системный ключ: {field.key}</p></div></details>
                </div> : <button type="button" onClick={() => setSelectedKey(field.key)} aria-label={"Редактировать вопрос " + field.label} className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left"><span><span className="mr-3 text-xs text-white/45">ВОПРОС {index + 1}</span><span className="font-medium">{field.label}</span></span><span className="text-xs text-white/55">{fieldType(field)}{field.required ? " · Обязательный" : ""}</span></button>}
              </article>;
            })}
          </section>)}
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => addField()} className="rounded-lg border border-white/40 px-4 py-2 text-sm"><Plus size={16} className="mr-2 inline" />Добавить вопрос</button><button type="button" onClick={addSection} className="rounded-lg border border-white/40 px-4 py-2 text-sm"><Plus size={16} className="mr-2 inline" />Добавить раздел</button></div>
        </fieldset>
      </main>
      <aside className="order-2 space-y-4">
        <section className="rounded-xl border border-white/15 bg-[#1c1b1b] p-5"><h2 className="text-lg font-semibold">Сбор заявок</h2><p className="mt-3 text-sm text-white/70">{cohortStatus === "accepting" ? "● Приём заявок открыт" : "Приём заявок сейчас закрыт"}</p><label className="mt-4 block text-xs text-white/55">Ссылка для кандидатов<input readOnly value={publicAddress} onFocus={(event) => event.target.select()} className="workspace-input mt-2 !rounded-lg !text-xs" /></label><button type="button" onClick={() => void copyLink()} className="workspace-button mt-3 w-full !rounded-lg">{copied ? "Скопировано" : "Копировать ссылку"}</button><a href={publicUrl} target="_blank" rel="noreferrer" className="mt-3 block text-sm text-white/70 underline">Открыть опубликованную форму</a><div className="mt-5 border-t border-white/15 pt-4 text-sm text-white/55"><p>Опубликована версия {publishedVersion}</p><p className="mt-2">{hasUnpublished ? "Есть неопубликованный черновик" : "Черновик совпадает с опубликованной формой"}</p></div>{onSettings && <button type="button" onClick={onSettings} className="mt-5 w-full rounded-lg border border-white/40 px-4 py-2 text-sm">Настроить приём заявок</button>}</section>
        <ApplicationImportWizard token={token} cohortId={cohortId} onImported={onPublished} onApplications={onApplications || (() => undefined)} />
      </aside>
    </div>
    {preview && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="Предпросмотр черновика"><div className="mx-auto max-w-2xl rounded-xl border border-white/20 bg-[#1c1b1b] p-5 sm:p-8"><div className="flex justify-between"><div><p className="text-xs text-amber-200">Предпросмотр черновика · данные не отправляются</p><h2 className="mt-2 text-2xl font-semibold">{draft.title || "Без названия"}</h2><p className="mt-2 text-sm text-white/55">{draft.description}</p></div><button type="button" onClick={() => setPreview(false)} aria-label="Закрыть предпросмотр"><X size={18} /></button></div><div className="mt-6 flex gap-2"><button type="button" onClick={() => setPreviewType("project")} className={previewType === "project" ? "workspace-button !rounded-lg" : "rounded-lg border border-white/25 px-4 py-2 text-sm"}>С проектом</button><button type="button" onClick={() => setPreviewType("participant")} className={previewType === "participant" ? "workspace-button !rounded-lg" : "rounded-lg border border-white/25 px-4 py-2 text-sm"}>Без проекта</button></div><div className="mt-6 space-y-5"><h3 className="text-lg font-semibold">Контакты</h3><p className="text-sm text-white/55">Имя и email кандидата</p>{sections.map((section) => { const fields = draft.fields.filter((field) => (field.section || "") === section.key && field.application_types?.includes(previewType)); return fields.length ? <section key={section.key || "about"}><h3 className="mb-4 text-lg font-semibold">{section.title}</h3><div className="space-y-4">{fields.map((field) => <label key={field.key} className="block text-sm">{field.label}{field.required ? " *" : ""}{field.type === "textarea" ? <textarea disabled placeholder={field.placeholder || "Текст ответа"} className="workspace-input mt-2 !rounded-lg" /> : field.type === "select" || field.type === "multiselect" ? <select disabled className="workspace-input mt-2 !rounded-lg"><option>Выберите вариант</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select> : <input disabled type={field.type === "email" || field.type === "number" || field.type === "date" || field.type === "url" ? field.type : "text"} placeholder={field.placeholder || "Текст ответа"} className="workspace-input mt-2 !rounded-lg" />}{field.description && <span className="mt-1 block text-xs text-white/50">{field.description}</span>}</label>)}</div></section> : null; })}</div></div></div>}
  </div>;
}
function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="rounded-lg p-2 text-white/55 hover:bg-white/10 disabled:opacity-30">{children}</button>;
}
