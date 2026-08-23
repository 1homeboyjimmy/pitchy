"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Rocket } from "lucide-react";

import { describeApiError, getAuthJson, postAuthJson } from "@/lib/api";

type Organization = { id: number; name: string };
type SetupResult = { accelerator: { id: number }; cohort: { id: number } };
type Limits = { messages: number; roadmaps: number; custdev: number; grants: number };

const MODULES = [
  { key: "homework", label: "Домашние задания", text: "Задания, ответы и проверка" },
  { key: "attendance", label: "Посещаемость", text: "События, QR и отметки" },
  { key: "progress_tracking", label: "Трекинг прогресса", text: "Чек-ины, риски и задачи трекера" },
  { key: "matchmaking", label: "Матчмейкинг", text: "Подбор резидентов, трекеров и экспертов" },
] as const;

export function AcceleratorSetupWizard({ token, onCreated, onCancel }: { token: string; onCreated: (result: SetupResult) => Promise<void> | void; onCancel?: () => void }) {
  const [step, setStep] = useState(1);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationMode, setOrganizationMode] = useState<"new" | "existing">("new");
  const [organizationId, setOrganizationId] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [acceleratorName, setAcceleratorName] = useState("");
  const [description, setDescription] = useState("");
  const [cohortName, setCohortName] = useState("");
  const [timezone, setTimezone] = useState("Europe/Moscow");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [modules, setModules] = useState({ homework: true, attendance: true, progress_tracking: true, matchmaking: true });
  const [limits, setLimits] = useState<Limits>({ messages: 70, roadmaps: 4, custdev: 2, grants: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getAuthJson<Organization[]>("/api/accelerators/organizations", token).then(setOrganizations).catch(() => undefined);
  }, [token]);

  const canContinue = step === 1
    ? Boolean(acceleratorName.trim().length >= 2 && (organizationMode === "new" ? organizationName.trim().length >= 2 : organizationId))
    : Boolean(cohortName.trim().length >= 2 && (!startsAt || !endsAt || new Date(endsAt) > new Date(startsAt)));

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await postAuthJson<SetupResult>("/api/accelerators/setup", {
        ...(organizationMode === "existing" ? { organization_id: Number(organizationId) } : { organization_name: organizationName }),
        accelerator_name: acceleratorName,
        accelerator_description: description || null,
        cohort_name: cohortName,
        timezone,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        modules,
        default_quota_config: limits,
        application_form_schema: {
          title: `Заявка в поток «${cohortName}»`,
          description: "Выберите тип заявки — форма покажет только подходящие вопросы.",
          required: ["motivation", "experience", "project_name", "problem", "solution"],
          fields: [
            { key: "motivation", label: "Почему вы хотите участвовать?", type: "textarea", required: true, application_types: ["project", "participant"] },
            { key: "experience", label: "Опыт и компетенции", type: "textarea", required: true, application_types: ["project", "participant"] },
            { key: "project_name", label: "Название проекта", required: true, application_types: ["project"] },
            { key: "problem", label: "Какую проблему решает проект?", type: "textarea", required: true, application_types: ["project"] },
            { key: "solution", label: "Как устроено решение?", type: "textarea", required: true, application_types: ["project"] },
            { key: "target_audience", label: "Целевая аудитория", type: "textarea", application_types: ["project"] },
            { key: "stage", label: "Стадия проекта", application_types: ["project"] },
            { key: "team", label: "Команда", type: "textarea", application_types: ["project"] },
          ],
        },
      }, token);
      await onCreated(result);
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось создать акселератор"));
    } finally { setBusy(false); }
  };

  return <section className="workspace-card">
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs uppercase tracking-[.18em] text-white/35">Шаг {step} из 3</p><h2 className="mt-2 text-2xl">{step === 1 ? "Основа акселератора" : step === 2 ? "Первый поток" : "Функции и лимиты"}</h2></div>
      {onCancel && <button type="button" onClick={onCancel} className="text-sm text-white/45 hover:text-white">Закрыть</button>}
    </div>
    <div className="mb-7 grid grid-cols-3 gap-2">{[1, 2, 3].map((item) => <div key={item} className={`h-1 rounded-full ${item <= step ? "bg-white" : "bg-white/10"}`} />)}</div>

    {step === 1 && <div className="space-y-5">
      {organizations.length > 0 && <div className="flex gap-2"><button type="button" onClick={() => setOrganizationMode("new")} className={`setup-choice ${organizationMode === "new" ? "setup-choice-active" : ""}`}>Новая организация</button><button type="button" onClick={() => setOrganizationMode("existing")} className={`setup-choice ${organizationMode === "existing" ? "setup-choice-active" : ""}`}>Существующая</button></div>}
      {organizationMode === "new" ? <Label text="Название организации"><input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} className="workspace-input mt-2" placeholder="Фонд развития проектов" /></Label> : <Label text="Организация"><select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="workspace-input mt-2"><option value="">Выберите организацию</option>{organizations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Label>}
      <Label text="Название акселератора"><input value={acceleratorName} onChange={(event) => setAcceleratorName(event.target.value)} className="workspace-input mt-2" placeholder="Весенний акселератор" /></Label>
      <Label text="Описание"><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="workspace-input mt-2 resize-y" placeholder="Кому подходит программа и какой результат она даёт" /></Label>
    </div>}

    {step === 2 && <div className="grid gap-5 sm:grid-cols-2">
      <Label text="Название потока" wide><input value={cohortName} onChange={(event) => setCohortName(event.target.value)} className="workspace-input mt-2" placeholder="Поток 2026" /></Label>
      <Label text="Часовой пояс" wide><select value={timezone} onChange={(event) => setTimezone(event.target.value)} className="workspace-input mt-2"><option value="Europe/Moscow">Москва (UTC+3)</option><option value="Asia/Almaty">Алматы (UTC+5)</option><option value="Asia/Yekaterinburg">Екатеринбург (UTC+5)</option><option value="UTC">UTC</option></select></Label>
      <Label text="Начало программы"><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="workspace-input mt-2" /></Label>
      <Label text="Окончание программы"><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className="workspace-input mt-2" /></Label>
      <p className="text-sm text-white/40 sm:col-span-2">Форма заявки будет создана автоматически. Вопросы о проекте не увидят участники без проекта.</p>
    </div>}

    {step === 3 && <div className="space-y-7">
      <div><h3 className="mb-3 text-sm text-white/65">Дополнительные модули</h3><div className="grid gap-3 sm:grid-cols-2">{MODULES.map((module) => <button type="button" key={module.key} onClick={() => setModules((current) => ({ ...current, [module.key]: !current[module.key] }))} className={`rounded-2xl border p-4 text-left ${modules[module.key] ? "border-emerald-400/25 bg-emerald-400/[.07]" : "border-white/10"}`}><span className="flex justify-between gap-3">{module.label}{modules[module.key] && <Check size={17} className="text-emerald-400" />}</span><span className="mt-1 block text-xs text-white/35">{module.text}</span></button>)}</div></div>
      <div><h3 className="mb-1 text-sm text-white/65">Лимиты каждого резидента</h3><p className="mb-3 text-xs text-white/35">−1 означает безлимит. Значения можно изменить для всего потока или одного человека позже.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([['messages','Сообщения'],['roadmaps','Дорожные карты'],['custdev','Кастдевы'],['grants','Гранты']] as Array<[keyof Limits,string]>).map(([key, label]) => <Label key={key} text={label}><input type="number" min={-1} value={limits[key]} onChange={(event) => setLimits({ ...limits, [key]: Number(event.target.value) })} className="workspace-input mt-2" /></Label>)}</div></div>
    </div>}

    {error && <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
    <div className="mt-8 flex items-center justify-between gap-3">
      <button type="button" onClick={() => setStep((current) => Math.max(1, current - 1))} disabled={step === 1 || busy} className="workspace-button !bg-transparent !text-white"><ArrowLeft size={16} /> Назад</button>
      {step < 3 ? <button type="button" onClick={() => setStep((current) => current + 1)} disabled={!canContinue} className="workspace-button">Продолжить <ArrowRight size={16} /></button> : <button type="button" onClick={() => void submit()} disabled={busy} className="workspace-button">{busy ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />} Создать акселератор</button>}
    </div>
    <style jsx>{`.setup-choice{border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:.55rem .9rem;font-size:.8rem;color:rgba(255,255,255,.5)}.setup-choice-active{background:white;color:black}`}</style>
  </section>;
}

function Label({ text, wide, children }: { text: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`text-sm text-white/60 ${wide ? "sm:col-span-2" : ""}`}>{text}{children}</label>;
}
