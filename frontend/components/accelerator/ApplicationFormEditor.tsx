"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, Plus, Save, Trash2 } from "lucide-react";

export type ApplicationFormField = {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
  type?: "text" | "email" | "number" | "textarea" | "select";
  required?: boolean;
  application_types?: Array<"project" | "participant">;
  options?: Array<string | { value: string; label: string }>;
};

export type ApplicationFormSchema = {
  title?: string;
  description?: string;
  fields?: ApplicationFormField[];
  required?: string[];
};

type EditableField = Omit<ApplicationFormField, "options"> & { options: string[] };

const FIELD_TYPES: Array<{ value: NonNullable<ApplicationFormField["type"]>; label: string }> = [
  { value: "text", label: "Короткий текст" },
  { value: "textarea", label: "Развёрнутый текст" },
  { value: "number", label: "Число" },
  { value: "email", label: "Email" },
  { value: "select", label: "Выбор из списка" },
];

function normalize(schema: ApplicationFormSchema): { title: string; description: string; fields: EditableField[] } {
  const required = new Set(schema.required || []);
  return {
    title: schema.title || "",
    description: schema.description || "",
    fields: (schema.fields || []).map((field) => ({
      ...field,
      label: field.label || field.key,
      type: field.type || "text",
      required: Boolean(field.required || required.has(field.key)),
      application_types: field.application_types || ["project", "participant"],
      options: (field.options || []).map((option) => typeof option === "string" ? option : option.label),
    })),
  };
}

function makeField(existing: EditableField[]): EditableField {
  let index = existing.length + 1;
  let key = `question_${index}`;
  const keys = new Set(existing.map((field) => field.key));
  while (keys.has(key)) { index += 1; key = `question_${index}`; }
  return { key, label: `Новый вопрос ${index}`, type: "text", required: false, application_types: ["project", "participant"], options: [] };
}

export function ApplicationFormEditor({
  schema,
  publicUrl,
  saving,
  onSave,
}: {
  schema: ApplicationFormSchema;
  publicUrl: string;
  saving: boolean;
  onSave: (schema: ApplicationFormSchema) => Promise<boolean>;
}) {
  const [initial] = useState(() => normalize(schema));
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [fields, setFields] = useState<EditableField[]>(initial.fields);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const patchField = (index: number, patch: Partial<EditableField>) => {
    setSaved(false);
    setFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= fields.length) return;
    setSaved(false);
    setFields((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const submit = async () => {
    const keys = fields.map((field) => field.key.trim());
    if (keys.some((key) => !/^[a-z][a-z0-9_]{0,63}$/.test(key))) {
      setError("Системный ключ должен начинаться с латинской буквы и содержать только a–z, 0–9 и _.");
      return;
    }
    if (new Set(keys).size !== keys.length) {
      setError("Системные ключи вопросов не должны повторяться.");
      return;
    }
    if (fields.some((field) => !field.label.trim())) {
      setError("У каждого вопроса должно быть название.");
      return;
    }
    if (fields.some((field) => field.type === "select" && field.options.filter(Boolean).length < 2)) {
      setError("Для поля с выбором укажите минимум два варианта.");
      return;
    }
    if (fields.some((field) => !field.application_types?.length)) {
      setError("Укажите, для какого типа заявки показывать каждый вопрос.");
      return;
    }
    setError("");
    const cleanedFields: ApplicationFormField[] = fields.map((field) => ({
      key: field.key.trim(),
      label: field.label.trim(),
      type: field.type || "text",
      required: Boolean(field.required),
      application_types: field.application_types,
      ...(field.description?.trim() ? { description: field.description.trim() } : {}),
      ...(field.placeholder?.trim() ? { placeholder: field.placeholder.trim() } : {}),
      ...(field.type === "select" ? { options: field.options.map((option) => option.trim()).filter(Boolean) } : {}),
    }));
    const wasSaved = await onSave({
      title: title.trim(),
      description: description.trim(),
      fields: cleanedFields,
      required: cleanedFields.filter((field) => field.required).map((field) => field.key),
    });
    setSaved(wasSaved);
  };

  return (
    <section className="workspace-card">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl">Анкета кандидата</h2>
          <p className="mt-1 text-sm text-white/40">Настройте вопросы в том порядке, в котором их увидит кандидат.</p>
        </div>
        <a href={publicUrl} target="_blank" rel="noreferrer" className="workspace-button !bg-transparent !text-white"><Eye size={15} /> Предпросмотр</a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-white/60">Заголовок формы<input value={title} onChange={(event) => { setSaved(false); setTitle(event.target.value); }} maxLength={300} placeholder="Заявка в акселератор" className="workspace-input mt-2" /></label>
        <label className="text-sm text-white/60">Краткое описание<textarea value={description} onChange={(event) => { setSaved(false); setDescription(event.target.value); }} maxLength={4000} rows={3} placeholder="Что важно знать кандидату перед заполнением" className="workspace-input mt-2 resize-y" /></label>
      </div>

      <div className="mt-6 space-y-4">
        {fields.map((field, index) => (
          <article key={`${field.key}-${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-[.16em] text-white/30">Вопрос {index + 1}</span>
              <div className="flex gap-1">
                <IconButton label="Поднять" disabled={index === 0} onClick={() => moveField(index, -1)}><ArrowUp size={15} /></IconButton>
                <IconButton label="Опустить" disabled={index === fields.length - 1} onClick={() => moveField(index, 1)}><ArrowDown size={15} /></IconButton>
                <IconButton label="Удалить" onClick={() => { setSaved(false); setFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index)); }}><Trash2 size={15} /></IconButton>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-white/60">Название вопроса<input value={field.label} onChange={(event) => patchField(index, { label: event.target.value })} maxLength={300} className="workspace-input mt-2" /></label>
              <label className="text-sm text-white/60">Тип ответа<select value={field.type || "text"} onChange={(event) => patchField(index, { type: event.target.value as EditableField["type"] })} className="workspace-input mt-2">{FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
              <label className="text-sm text-white/60">Подсказка<input value={field.placeholder || ""} onChange={(event) => patchField(index, { placeholder: event.target.value })} maxLength={500} placeholder="Текст внутри поля" className="workspace-input mt-2" /></label>
              <label className="text-sm text-white/60">Системный ключ<input value={field.key} onChange={(event) => patchField(index, { key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} maxLength={64} className="workspace-input mt-2 font-mono" /></label>
              <label className="text-sm text-white/60 sm:col-span-2">Пояснение<input value={field.description || ""} onChange={(event) => patchField(index, { description: event.target.value })} maxLength={1000} placeholder="Необязательный комментарий под полем" className="workspace-input mt-2" /></label>
              {field.type === "select" && <label className="text-sm text-white/60 sm:col-span-2">Варианты ответа<textarea value={field.options.join("\n")} onChange={(event) => patchField(index, { options: event.target.value.split("\n") })} rows={4} placeholder={"Один вариант на строку\nВторой вариант"} className="workspace-input mt-2 resize-y" /></label>}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/60">
              <label className="flex items-center gap-3"><input type="checkbox" checked={Boolean(field.required)} onChange={(event) => patchField(index, { required: event.target.checked })} /> Обязательный вопрос</label>
              <span className="text-white/35">Показывать для:</span>
              {(["project", "participant"] as const).map((applicationType) => (
                <label key={applicationType} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={field.application_types?.includes(applicationType) ?? true}
                    onChange={(event) => {
                      const current = field.application_types || ["project", "participant"];
                      patchField(index, {
                        application_types: event.target.checked
                          ? Array.from(new Set([...current, applicationType]))
                          : current.filter((item) => item !== applicationType),
                      });
                    }}
                  />
                  {applicationType === "project" ? "проекта" : "участника без проекта"}
                </label>
              ))}
            </div>
          </article>
        ))}
      </div>

      <button type="button" onClick={() => { setSaved(false); setFields((current) => [...current, makeField(current)]); }} className="mt-4 flex items-center gap-2 rounded-full border border-dashed border-white/20 px-4 py-2 text-sm text-white/60 hover:border-white/40 hover:text-white"><Plus size={15} /> Добавить вопрос</button>
      {error && <p role="alert" className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">{saved && <span className="text-sm text-emerald-300">Анкета сохранена</span>}<button type="button" onClick={() => void submit()} disabled={saving} className="workspace-button"><Save size={15} /> {saving ? "Сохраняем…" : "Сохранить анкету"}</button></div>
    </section>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="rounded-xl border border-white/10 p-2 text-white/45 hover:text-white disabled:opacity-20">{children}</button>;
}
