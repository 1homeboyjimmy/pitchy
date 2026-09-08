"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Paperclip, Send, X } from "lucide-react";

import { describeApiError, getJson, postJson } from "@/lib/api";

type FormField = {
  key: string;
  label?: string;
  description?: string;
  placeholder?: string;
  type?: "text" | "email" | "number" | "textarea" | "select" | "multiselect" | "scale" | "date" | "url" | "telegram" | "file";
  required?: boolean;
  application_types?: Array<"project" | "participant">;
  options?: Array<string | { value: string; label: string }>;
  section?: string;
};

type FormSection = { key: string; title: string; description?: string };

type PublicForm = {
  accelerator: { id: number; name: string; description?: string | null };
  cohort: { id: number; name: string; starts_at?: string | null; ends_at?: string | null };
  form_schema: { title?: string; description?: string; fields?: FormField[]; required?: string[]; sections?: FormSection[] };
  published_version: number;
};

export default function AcceleratorApplicationPage() {
  const params = useParams<{ cohortId: string }>();
  const cohortId = params.cohortId;
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [telegram, setTelegram] = useState("");
  const [competencies, setCompetencies] = useState("");
  const [applicationType, setApplicationType] = useState<"project" | "participant">("project");
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [uploadingField, setUploadingField] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [rules, setRules] = useState(false);
  const [step, setStep] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getJson<PublicForm>(`/api/accelerators/public/cohorts/${cohortId}/application-form`)
      .then((data) => { if (!cancelled) setForm(data); })
      .catch((reason) => { if (!cancelled) setError(describeApiError(reason, "Не удалось открыть форму")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cohortId]);

  const fields = useMemo(
    () => (form?.form_schema.fields || []).filter(
      (field) => !field.application_types?.length || field.application_types.includes(applicationType),
    ),
    [applicationType, form],
  );
  const required = useMemo(
    () => new Set([...(form?.form_schema.required || []), ...fields.filter((field) => field.required).map((field) => field.key)]),
    [fields, form],
  );
  const steps = useMemo(() => {
    const configured = form?.form_schema.sections || [];
    const configuredKeys = new Set(configured.map((section) => section.key));
    const hasOther = fields.some((field) => !field.section || !configuredKeys.has(field.section));
    return [
      { key: "__common", title: "О вас", description: "Контакты и формат участия" },
      ...configured,
      ...(hasOther ? [{ key: "__questions", title: configured.length ? "Дополнительно" : "Анкета", description: "Вопросы программы" }] : []),
    ];
  }, [fields, form]);
  const activeStep = Math.min(step, Math.max(steps.length - 1, 0));
  const activeSection = steps[activeStep]?.key || "__common";
  const visibleFields = useMemo(() => {
    if (activeSection === "__common") return [];
    const configuredKeys = new Set((form?.form_schema.sections || []).map((section) => section.key));
    return fields.filter((field) => activeSection === "__questions"
      ? !field.section || !configuredKeys.has(field.section)
      : field.section === activeSection);
  }, [activeSection, fields, form]);

  useEffect(() => { setStep(0); }, [applicationType]);

  const nextStep = () => {
    if (!formRef.current?.reportValidity()) return;
    setStep((current) => Math.min(current + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await postJson(`/api/accelerators/public/cohorts/${cohortId}/applications`, {
        applicant_name: name,
        applicant_email: email,
        telegram,
        competencies: competencies.split(",").map((item) => item.trim()).filter(Boolean),
        application_type: applicationType,
        form_payload: values,
        accept_privacy: privacy,
        accept_program_rules: rules,
        website: "",
      });
      setSubmitted(true);
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось отправить заявку"));
    } finally {
      setSubmitting(false);
    }
  };

  const uploadFiles = async (fieldKey: string, files: FileList | null) => {
    if (!files?.length) return;
    const existing = Array.isArray(values[fieldKey]) ? values[fieldKey] as string[] : [];
    if (existing.length + files.length > 5) { setError("К одному вопросу можно прикрепить не более пяти файлов."); return; }
    setUploadingField(fieldKey); setError("");
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const body = new FormData(); body.append("file", file);
        const response = await fetch(`/api/accelerators/public/cohorts/${cohortId}/application-files`, { method: "POST", body });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Не удалось загрузить файл");
        uploaded.push(data.url);
      }
      setValues((current) => ({ ...current, [fieldKey]: [...existing, ...uploaded] }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить файл"); }
    finally { setUploadingField(""); }
  };

  if (loading) {
    return <main className="min-h-[100dvh] bg-black text-white grid place-items-center"><Loader2 className="animate-spin text-white/50" /></main>;
  }

  if (!form) {
    return (
      <main className="min-h-[100dvh] bg-black text-white grid place-items-center px-6">
        <div className="max-w-md text-center"><h1 className="text-3xl mb-4">Форма недоступна</h1><p className="text-white/50 mb-8">{error || "Приём заявок завершён или поток не найден."}</p><Link href="/accelerators" className="underline">Об акселераторах Pitchy</Link></div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="min-h-[100dvh] bg-black text-white grid place-items-center px-6">
        <section className="max-w-xl text-center rounded-3xl border border-white/10 bg-white/[0.03] p-8 sm:p-12">
          <CheckCircle2 className="mx-auto mb-6 h-12 w-12 text-emerald-400" />
          <h1 className="text-3xl sm:text-5xl tracking-tight mb-5">Заявка отправлена</h1>
          <p className="text-white/55 leading-relaxed">Организаторы потока «{form.cohort.name}» рассмотрят её. Решение и дальнейшие инструкции придут на {email}.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-black text-white px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <Link href="/accelerators" className="mb-10 inline-flex items-center gap-2 text-sm text-white/45 hover:text-white"><ArrowLeft size={16} /> Назад</Link>
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.22em] text-white/35">{form.accelerator.name}</p>
        <h1 className="text-4xl sm:text-6xl tracking-tight">{form.form_schema.title || `Заявка в поток «${form.cohort.name}»`}</h1>
        <p className="mt-5 max-w-2xl text-white/50 leading-relaxed">{form.form_schema.description || form.accelerator.description || "Расскажите о себе и проекте. Аккаунт Pitchy будет создан только после одобрения заявки."}</p>

        <div className="mt-10"><div className="mb-3 flex items-center justify-between text-xs text-white/40"><span>Шаг {activeStep + 1} из {steps.length}</span><span>{Math.round(((activeStep + 1) / steps.length) * 100)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${((activeStep + 1) / steps.length) * 100}%` }} /></div><h2 className="mt-6 text-2xl">{steps[activeStep]?.title}</h2>{steps[activeStep]?.description && <p className="mt-2 text-sm text-white/40">{steps[activeStep].description}</p>}</div>

        <form ref={formRef} onSubmit={submit} className="mt-5 space-y-6 rounded-3xl border border-white/10 bg-white/[0.025] p-5 sm:p-8">
          {activeSection === "__common" && <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Имя и фамилия" required><input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} className="form-input" autoComplete="name" /></Field>
            <Field label="Email" required><input value={email} onChange={(e) => setEmail(e.target.value)} required type="email" className="form-input" autoComplete="email" /></Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Telegram" description="Например, @username" required><input value={telegram} onChange={(e) => setTelegram(e.target.value)} required pattern="(?:https?://t\.me/|@)?[A-Za-z0-9_]{5,32}" className="form-input" autoComplete="off" /></Field>
            <Field label="Компетенции" description="Перечислите через запятую: маркетинг, продажи, разработка" required><input value={competencies} onChange={(e) => setCompetencies(e.target.value)} required minLength={2} className="form-input" /></Field>
          </div>
          <Field label="Тип заявки" required>
            <select value={applicationType} onChange={(e) => setApplicationType(e.target.value as "project" | "participant")} className="form-input">
              <option value="project">Проект / стартап</option><option value="participant">Участник без проекта</option>
            </select>
          </Field>
          </>}

          {visibleFields.map((field) => (
            <Field key={field.key} label={field.label || field.key} description={field.description} required={required.has(field.key)}>
              {field.type === "textarea" ? (
                <textarea rows={5} value={String(values[field.key] || "")} onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))} required={required.has(field.key)} placeholder={field.placeholder} className="form-input resize-y" />
              ) : field.type === "select" ? (
                <select value={String(values[field.key] || "")} onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))} required={required.has(field.key)} className="form-input">
                  <option value="">Выберите вариант</option>
                  {(field.options || []).map((option) => { const item = typeof option === "string" ? { value: option, label: option } : option; return <option key={item.value} value={item.value}>{item.label}</option>; })}
                </select>
              ) : field.type === "multiselect" ? (
                <select multiple value={Array.isArray(values[field.key]) ? values[field.key] as string[] : []} onChange={(e) => setValues((current) => ({ ...current, [field.key]: Array.from(e.target.selectedOptions, (option) => option.value) }))} required={required.has(field.key)} className="form-input min-h-32">
                  {(field.options || []).map((option) => { const item = typeof option === "string" ? { value: option, label: option } : option; return <option key={item.value} value={item.value}>{item.label}</option>; })}
                </select>
              ) : field.type === "file" ? (
                <div className="rounded-2xl border border-dashed border-white/15 p-4"><label className="inline-flex cursor-pointer items-center gap-2 text-sm text-white/70"><Paperclip size={16} />{uploadingField === field.key ? "Загружаем…" : "Прикрепить файлы"}<input type="file" multiple className="sr-only" disabled={uploadingField === field.key} accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md,.mp3,.wav,.m4a,.mp4,.mov,.webm" onChange={(e) => void uploadFiles(field.key, e.target.files)} /></label>{Array.isArray(values[field.key]) && <div className="mt-3 space-y-2">{(values[field.key] as string[]).map((url, index) => <div key={url} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-white/55"><span>Файл {index + 1}</span><button type="button" onClick={() => setValues((current) => ({ ...current, [field.key]: (current[field.key] as string[]).filter((item) => item !== url) }))} aria-label="Убрать файл"><X size={14} /></button></div>)}</div>}</div>
              ) : (
                <input type={field.type === "number" || field.type === "scale" ? "number" : field.type === "email" ? "email" : field.type === "date" ? "date" : field.type === "url" ? "url" : "text"} min={field.type === "scale" ? 1 : undefined} max={field.type === "scale" ? 10 : undefined} value={String(values[field.key] || "")} onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))} required={required.has(field.key)} placeholder={field.placeholder} className="form-input" />
              )}
            </Field>
          ))}

          {activeStep === steps.length - 1 && <><label className="flex cursor-pointer gap-3 text-sm text-white/60"><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} required className="mt-1" /><span>Согласен на обработку персональных данных согласно <Link href="/privacy" target="_blank" className="text-white underline">политике конфиденциальности</Link>.</span></label>
          <label className="flex cursor-pointer gap-3 text-sm text-white/60"><input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} required className="mt-1" /><span>Принимаю правила программы акселератора и подтверждаю достоверность данных.</span></label></>}
          {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">{activeStep > 0 ? <button type="button" onClick={() => setStep((current) => current - 1)} className="rounded-full border border-white/15 px-6 py-3 text-sm text-white/65">Назад</button> : <span />}{activeStep < steps.length - 1 ? <button type="button" onClick={nextStep} className="rounded-full bg-white px-7 py-3 font-semibold text-black">Продолжить</button> : <button disabled={submitting} className="flex items-center justify-center gap-2 rounded-full bg-white px-7 py-3 font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50">{submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} Отправить заявку</button>}</div>
        </form>
      </div>
      <style jsx global>{`.form-input { width: 100%; border-radius: 1rem; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.04); padding: .85rem 1rem; color: white; outline: none; } .form-input:focus { border-color: rgba(255,255,255,.4); } .form-input option { color: black; }`}</style>
    </main>
  );
}

function Field({ label, description, required, children }: { label: string; description?: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm text-white/75">{label}{required && <span className="text-red-300"> *</span>}</span>{children}{description && <span className="mt-2 block text-xs text-white/35">{description}</span>}</label>;
}
