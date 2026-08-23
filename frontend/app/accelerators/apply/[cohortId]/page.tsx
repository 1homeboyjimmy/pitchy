"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Send } from "lucide-react";

import { describeApiError, getJson, postJson } from "@/lib/api";

type FormField = {
  key: string;
  label?: string;
  description?: string;
  placeholder?: string;
  type?: "text" | "email" | "number" | "textarea" | "select";
  required?: boolean;
  application_types?: Array<"project" | "participant">;
  options?: Array<string | { value: string; label: string }>;
};

type PublicForm = {
  accelerator: { id: number; name: string; description?: string | null };
  cohort: { id: number; name: string; starts_at?: string | null; ends_at?: string | null };
  form_schema: { title?: string; description?: string; fields?: FormField[]; required?: string[] };
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
  const [applicationType, setApplicationType] = useState<"project" | "participant">("project");
  const [values, setValues] = useState<Record<string, string>>({});
  const [privacy, setPrivacy] = useState(false);
  const [rules, setRules] = useState(false);

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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await postJson(`/api/accelerators/public/cohorts/${cohortId}/applications`, {
        applicant_name: name,
        applicant_email: email,
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

        <form onSubmit={submit} className="mt-10 space-y-6 rounded-3xl border border-white/10 bg-white/[0.025] p-5 sm:p-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Имя и фамилия" required><input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} className="form-input" autoComplete="name" /></Field>
            <Field label="Email" required><input value={email} onChange={(e) => setEmail(e.target.value)} required type="email" className="form-input" autoComplete="email" /></Field>
          </div>
          <Field label="Тип заявки" required>
            <select value={applicationType} onChange={(e) => setApplicationType(e.target.value as "project" | "participant")} className="form-input">
              <option value="project">Проект / стартап</option><option value="participant">Участник без проекта</option>
            </select>
          </Field>

          {fields.map((field) => (
            <Field key={field.key} label={field.label || field.key} description={field.description} required={required.has(field.key)}>
              {field.type === "textarea" ? (
                <textarea rows={5} value={values[field.key] || ""} onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))} required={required.has(field.key)} placeholder={field.placeholder} className="form-input resize-y" />
              ) : field.type === "select" ? (
                <select value={values[field.key] || ""} onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))} required={required.has(field.key)} className="form-input">
                  <option value="">Выберите вариант</option>
                  {(field.options || []).map((option) => { const item = typeof option === "string" ? { value: option, label: option } : option; return <option key={item.value} value={item.value}>{item.label}</option>; })}
                </select>
              ) : (
                <input type={field.type === "number" ? "number" : field.type === "email" ? "email" : "text"} value={values[field.key] || ""} onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))} required={required.has(field.key)} placeholder={field.placeholder} className="form-input" />
              )}
            </Field>
          ))}

          <label className="flex cursor-pointer gap-3 text-sm text-white/60"><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} required className="mt-1" /><span>Согласен на обработку персональных данных согласно <Link href="/privacy" target="_blank" className="text-white underline">политике конфиденциальности</Link>.</span></label>
          <label className="flex cursor-pointer gap-3 text-sm text-white/60"><input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} required className="mt-1" /><span>Принимаю правила программы акселератора и подтверждаю достоверность данных.</span></label>
          {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
          <button disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-4 font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50">{submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} Отправить заявку</button>
        </form>
      </div>
      <style jsx global>{`.form-input { width: 100%; border-radius: 1rem; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.04); padding: .85rem 1rem; color: white; outline: none; } .form-input:focus { border-color: rgba(255,255,255,.4); } .form-input option { color: black; }`}</style>
    </main>
  );
}

function Field({ label, description, required, children }: { label: string; description?: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm text-white/75">{label}{required && <span className="text-red-300"> *</span>}</span>{children}{description && <span className="mt-2 block text-xs text-white/35">{description}</span>}</label>;
}
