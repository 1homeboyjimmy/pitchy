"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Clipboard, Loader2, LogIn, RefreshCw, Rocket, Settings2, Users } from "lucide-react";

import { describeApiError, getAuthJson, getMe, patchAuthJson, postAuthJson, putAuthJson, type UserResponse } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { ApplicationFormEditor, type ApplicationFormSchema } from "@/components/accelerator/ApplicationFormEditor";
import { ResidentWorkspace, type ResidentWorkspaceData } from "@/components/accelerator/ResidentWorkspace";
import { HomeworkManager } from "@/components/accelerator/HomeworkManager";
import { ProgramBuilder } from "@/components/accelerator/ProgramBuilder";
import { AttendanceManager } from "@/components/accelerator/AttendanceManager";

type Accelerator = { id: number; name: string; description?: string | null; status: string; access_role: "global_admin" | "organizer" | "resident" };
type Cohort = { id: number; accelerator_id: number; name: string; status: string; starts_at?: string | null; ends_at?: string | null; default_quota_config?: Limits | null; application_form_schema: ApplicationFormSchema };
type ProgramConfig = { cohort_id: number; version: number; modules: Record<string, boolean>; locked_modules: Record<string, boolean> };
type Application = { id: number; applicant_name?: string | null; applicant_email?: string | null; application_type: string; status: string; form_payload: Record<string, unknown>; submitted_at: string; review_comment?: string | null };
type Resident = { membership_id: number; user_id: number; name: string; email: string; status: string };
type Limits = { messages: number; roadmaps: number; custdev: number; grants: number };

const MODULE_LABELS: Record<string, string> = {
  applications: "Заявки",
  program: "Программа",
  homework: "Домашние задания",
  attendance: "Посещаемость",
  matchmaking: "Матчмейкинг",
  progress_tracking: "Трекинг прогресса",
  project_audit: "Аудит проектов",
  demo_day: "Демо-день",
};
const STATUS_LABELS: Record<string, string> = { draft: "Черновик", accepting: "Приём заявок", active: "Идёт", completed: "Завершён", archived: "Архив", submitted: "Новая", under_review: "На рассмотрении", needs_info: "Нужны данные", waitlisted: "Лист ожидания", approved: "Одобрена", rejected: "Отклонена", enrolled: "Зачислен", accepted: "Принят" };
const DEFAULT_LIMITS: Limits = { messages: 70, roadmaps: 4, custdev: 2, grants: 1 };

export default function AcceleratorWorkspacePage() {
  const { token, isLoaded } = useAuth();
  const [accelerators, setAccelerators] = useState<Accelerator[]>([]);
  const [userProfile, setUserProfile] = useState<UserResponse | null>(null);
  const [acceleratorId, setAcceleratorId] = useState<number | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [cohortId, setCohortId] = useState<number | null>(null);
  const [config, setConfig] = useState<ProgramConfig | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [residentWorkspace, setResidentWorkspace] = useState<ResidentWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const [organizationName, setOrganizationName] = useState("");
  const [acceleratorName, setAcceleratorName] = useState("");
  const [cohortName, setCohortName] = useState("");
  const [organizerUserId, setOrganizerUserId] = useState("");
  const [applicationComments, setApplicationComments] = useState<Record<number, string>>({});

  const selectedAccelerator = accelerators.find((item) => item.id === acceleratorId) || null;
  const selectedCohort = cohorts.find((item) => item.id === cohortId) || null;
  const canManage = selectedAccelerator?.access_role === "global_admin" || selectedAccelerator?.access_role === "organizer";
  const isResidentView = selectedAccelerator?.access_role === "resident";
  const isAdmin = Boolean(userProfile?.is_admin);

  const loadAccelerators = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setError("");
    try {
      const [rows, profile, workspace] = await Promise.all([
        getAuthJson<Accelerator[]>("/api/accelerators", token),
        getMe(token),
        getAuthJson<ResidentWorkspaceData>("/api/accelerators/me/memberships", token),
      ]);
      setAccelerators(rows);
      setUserProfile(profile);
      setResidentWorkspace(workspace);
      setAcceleratorId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || null);
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить акселераторы")); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void loadAccelerators(); }, [loadAccelerators]);

  useEffect(() => {
    if (!token || !acceleratorId) { setCohorts([]); setCohortId(null); return; }
    if (isResidentView) { setCohorts([]); setCohortId(null); return; }
    getAuthJson<Cohort[]>(`/api/accelerators/${acceleratorId}/cohorts`, token)
      .then((rows) => { setCohorts(rows); setCohortId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || null); })
      .catch((reason) => setError(describeApiError(reason, "Не удалось загрузить потоки")));
  }, [acceleratorId, isResidentView, token]);

  const loadCohortDetails = useCallback(async () => {
    if (!token || !cohortId || isResidentView) { setConfig(null); setApplications([]); setResidents([]); return; }
    setError("");
    try {
      const configRequest = getAuthJson<ProgramConfig>(`/api/accelerators/cohorts/${cohortId}/program-config`, token);
      if (canManage) {
        const [program, applicationRows, residentRows] = await Promise.all([
          configRequest,
          getAuthJson<Application[]>(`/api/accelerators/cohorts/${cohortId}/applications`, token),
          getAuthJson<Resident[]>(`/api/accelerators/cohorts/${cohortId}/residents`, token),
        ]);
        setConfig(program); setApplications(applicationRows); setResidents(residentRows);
      } else {
        setConfig(await configRequest); setApplications([]); setResidents([]);
      }
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить данные потока")); }
  }, [canManage, cohortId, isResidentView, token]);

  useEffect(() => { void loadCohortDetails(); }, [loadCohortDetails]);

  const updateModule = async (key: string, value: boolean) => {
    if (!token || !cohortId || !config) return;
    setBusy(`module-${key}`); setError("");
    try {
      const next = await patchAuthJson<ProgramConfig>(`/api/accelerators/cohorts/${cohortId}/program-config`, { version: config.version, modules: { [key]: value } }, token);
      setConfig(next);
    } catch (reason) { setError(describeApiError(reason, "Не удалось изменить модуль")); }
    finally { setBusy(""); }
  };

  const updateCohortStatus = async (status: string) => {
    if (!token || !cohortId) return;
    setBusy("cohort-status");
    try { const updated = await patchAuthJson<Cohort>(`/api/accelerators/cohorts/${cohortId}/status`, { status }, token); setCohorts((rows) => rows.map((row) => row.id === updated.id ? updated : row)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось изменить статус")); }
    finally { setBusy(""); }
  };

  const actOnApplication = async (application: Application, action: "accept" | "enroll" | "status", status?: string) => {
    if (!token) return;
    setBusy(`application-${application.id}`); setError("");
    try {
      if (action === "accept") await postAuthJson(`/api/accelerators/applications/${application.id}/accept`, { comment: null }, token);
      else if (action === "enroll") await postAuthJson(`/api/accelerators/applications/${application.id}/enroll`, {}, token);
      else await patchAuthJson(`/api/accelerators/applications/${application.id}/status`, { status, comment: applicationComments[application.id] || null }, token);
      await loadCohortDetails();
    } catch (reason) { setError(describeApiError(reason, "Не удалось обработать заявку")); }
    finally { setBusy(""); }
  };

  const saveCohortLimits = async () => {
    if (!token || !cohortId) return;
    setBusy("cohort-limits");
    try { await putAuthJson(`/api/accelerators/cohorts/${cohortId}/quota-template`, { limits, apply_to_existing: true, overwrite_personal: false }, token); await loadCohortDetails(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось установить лимиты потока")); }
    finally { setBusy(""); }
  };

  const saveResidentLimits = async (membershipId: number) => {
    if (!token) return;
    setBusy(`resident-${membershipId}`);
    try { await putAuthJson(`/api/accelerators/memberships/${membershipId}/quota`, { limits, reason: "Индивидуальная настройка администратора" }, token); }
    catch (reason) { setError(describeApiError(reason, "Не удалось установить индивидуальные лимиты")); }
    finally { setBusy(""); }
  };

  const copyApplicationLink = async () => {
    if (!cohortId) return;
    await navigator.clipboard.writeText(`${window.location.origin}/accelerators/apply/${cohortId}`);
    setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  };

  const saveApplicationForm = async (applicationFormSchema: ApplicationFormSchema) => {
    if (!token || !cohortId) return false;
    setBusy("application-form"); setError("");
    try {
      const updated = await patchAuthJson<Cohort>(
        `/api/accelerators/cohorts/${cohortId}`,
        { application_form_schema: applicationFormSchema },
        token,
      );
      setCohorts((rows) => rows.map((row) => row.id === updated.id ? updated : row));
      return true;
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось сохранить анкету"));
      return false;
    } finally {
      setBusy("");
    }
  };

  const createAcceleratorFoundation = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setBusy("create-accelerator"); setError("");
    try {
      const slugBase = organizationName.trim().toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-|-$/g, "");
      const slug = `${slugBase.replace(/[а-яё]/gi, "org") || "org"}-${Date.now().toString(36)}`.slice(0, 120);
      const organization = await postAuthJson<{ id: number }>("/api/accelerators/organizations", { name: organizationName, slug }, token);
      const accelerator = await postAuthJson<Accelerator>("/api/accelerators", { name: acceleratorName, organization_id: organization.id }, token);
      setOrganizationName(""); setAcceleratorName("");
      await loadAccelerators(); setAcceleratorId(accelerator.id);
    } catch (reason) { setError(describeApiError(reason, "Не удалось создать акселератор")); }
    finally { setBusy(""); }
  };

  const createCohort = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !acceleratorId) return;
    setBusy("create-cohort"); setError("");
    try {
      const cohort = await postAuthJson<Cohort>(`/api/accelerators/${acceleratorId}/cohorts`, {
        name: cohortName,
        timezone: "Europe/Moscow",
        application_form_schema: {
          title: `Заявка в поток «${cohortName}»`,
          required: ["project_name", "problem", "solution"],
          fields: [
            { key: "project_name", label: "Название проекта", required: true },
            { key: "problem", label: "Какую проблему решает проект?", type: "textarea", required: true },
            { key: "solution", label: "Как устроено решение?", type: "textarea", required: true },
            { key: "target_audience", label: "Целевая аудитория", type: "textarea" },
            { key: "stage", label: "Стадия проекта" },
            { key: "team", label: "Команда", type: "textarea" },
          ],
        },
      }, token);
      setCohortName("");
      const rows = await getAuthJson<Cohort[]>(`/api/accelerators/${acceleratorId}/cohorts`, token);
      setCohorts(rows); setCohortId(cohort.id);
    } catch (reason) { setError(describeApiError(reason, "Не удалось создать поток")); }
    finally { setBusy(""); }
  };

  const assignOrganizer = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !acceleratorId) return;
    setBusy("assign-organizer"); setError("");
    try { await postAuthJson(`/api/accelerators/${acceleratorId}/organizers`, { user_id: Number(organizerUserId) }, token); setOrganizerUserId(""); }
    catch (reason) { setError(describeApiError(reason, "Не удалось назначить организатора")); }
    finally { setBusy(""); }
  };

  if (!isLoaded || loading) return <main className="min-h-[100dvh] bg-black text-white grid place-items-center"><Loader2 className="animate-spin text-white/50" /></main>;
  if (!token) return <Empty icon={LogIn} title="Нужно войти" text="Пространство акселератора доступно после авторизации."><Link href="/login?next=/accelerator" className="rounded-full bg-white px-6 py-3 font-semibold text-black">Войти</Link></Empty>;

  return (
    <main className="min-h-[100dvh] bg-black text-white px-4 py-7 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><Link href="/dashboard" className="text-sm text-white/40 hover:text-white">← В дашборд</Link><div className="mt-4 flex items-center gap-3"><Rocket className="text-white/50" /><h1 className="text-3xl sm:text-5xl tracking-tight">Акселератор</h1></div></div><button onClick={() => void (isResidentView ? loadAccelerators() : loadCohortDetails())} className="rounded-full border border-white/10 p-3 text-white/50 hover:text-white" aria-label="Обновить"><RefreshCw size={17} /></button></header>
        {error && <div role="alert" className="mb-6 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {isAdmin && <section className="workspace-card mb-7"><details open={!accelerators.length}><summary className="cursor-pointer text-xl">Первичная настройка</summary><div className="mt-5 grid gap-5 lg:grid-cols-3">
          <form onSubmit={createAcceleratorFoundation} className="rounded-2xl border border-white/8 p-4"><h3 className="mb-3">Новый акселератор</h3><input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required minLength={2} placeholder="Организация" className="workspace-input mb-3" /><input value={acceleratorName} onChange={(event) => setAcceleratorName(event.target.value)} required minLength={2} placeholder="Название акселератора" className="workspace-input mb-3" /><button disabled={busy === "create-accelerator"} className="workspace-button">Создать</button></form>
          <form onSubmit={createCohort} className="rounded-2xl border border-white/8 p-4"><h3 className="mb-3">Новый поток</h3><input value={cohortName} onChange={(event) => setCohortName(event.target.value)} required minLength={2} placeholder="Название потока" disabled={!acceleratorId} className="workspace-input mb-3" /><button disabled={!acceleratorId || busy === "create-cohort"} className="workspace-button">Создать с базовой анкетой</button></form>
          <form onSubmit={assignOrganizer} className="rounded-2xl border border-white/8 p-4"><h3 className="mb-3">Назначить организатора</h3><input type="number" min={1} value={organizerUserId} onChange={(event) => setOrganizerUserId(event.target.value)} required placeholder="ID пользователя Pitchy" disabled={!acceleratorId} className="workspace-input mb-3" /><button disabled={!acceleratorId || busy === "assign-organizer"} className="workspace-button">Назначить</button><p className="mt-3 text-xs text-white/35">Пользователь сначала должен иметь аккаунт Pitchy.</p></form>
        </div></details></section>}
        {!accelerators.length ? <section className="workspace-card py-12 text-center"><Rocket className="mx-auto mb-4 text-white/30" /><h2 className="text-2xl">Нет доступных акселераторов</h2><p className="mt-3 text-white/40">{isAdmin ? "Создайте первый акселератор в блоке выше." : "Главный администратор должен назначить вас организатором или зачислить резидентом."}</p></section> : (
          <>
            <div className={`mb-7 grid gap-4 ${isResidentView ? "md:grid-cols-1" : "md:grid-cols-2"}`}>
              <SelectCard label="Акселератор"><select value={acceleratorId || ""} onChange={(event) => setAcceleratorId(Number(event.target.value))} className="workspace-input">{accelerators.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><p className="mt-2 text-xs text-white/35">Роль: {selectedAccelerator?.access_role === "global_admin" ? "главный администратор" : selectedAccelerator?.access_role === "organizer" ? "организатор" : "резидент"}</p></SelectCard>
              {!isResidentView && <SelectCard label="Поток"><select value={cohortId || ""} onChange={(event) => setCohortId(Number(event.target.value))} className="workspace-input" disabled={!cohorts.length}>{cohorts.length ? cohorts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>) : <option>Потоки ещё не созданы</option>}</select>{selectedCohort && <p className="mt-2 text-xs text-white/35">Статус: {STATUS_LABELS[selectedCohort.status] || selectedCohort.status}</p>}</SelectCard>}
            </div>
            {isResidentView && acceleratorId && <ResidentWorkspace acceleratorId={acceleratorId} data={residentWorkspace} />}
            {!isResidentView && selectedCohort && <div className="space-y-7">
              {canManage && <section className="workspace-card flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl">Управление набором</h2><p className="mt-1 text-sm text-white/40">Ссылка работает только пока статус потока «Приём заявок».</p></div><div className="flex flex-wrap gap-2"><button onClick={() => void copyApplicationLink()} className="workspace-button"><Clipboard size={15} />{copied ? "Скопировано" : "Скопировать ссылку"}</button><select value={selectedCohort.status} onChange={(event) => void updateCohortStatus(event.target.value)} disabled={busy === "cohort-status"} className="workspace-input !w-auto"><option value="draft">Черновик</option><option value="accepting">Приём заявок</option><option value="active">Идёт</option><option value="completed">Завершён</option><option value="archived">Архив</option></select></div></section>}

              {canManage && <ApplicationFormEditor key={selectedCohort.id} schema={selectedCohort.application_form_schema || {}} publicUrl={`/accelerators/apply/${selectedCohort.id}`} saving={busy === "application-form"} onSave={saveApplicationForm} />}

              <section className="workspace-card"><div className="mb-5 flex items-center gap-3"><Settings2 className="text-white/45" /><div><h2 className="text-xl">Конструктор программы</h2><p className="text-sm text-white/40">Включённый модуль появляется у потока; базовые модули отключить нельзя.</p></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{config && Object.entries(config.modules).map(([key, enabled]) => { const locked = key in config.locked_modules; return <button key={key} type="button" disabled={!canManage || locked || busy === `module-${key}`} onClick={() => void updateModule(key, !enabled)} className={`rounded-2xl border p-4 text-left transition ${enabled ? "border-emerald-400/25 bg-emerald-400/[0.08]" : "border-white/10 bg-white/[0.02]"} disabled:cursor-default`}><span className="flex items-center justify-between"><span className="text-sm">{MODULE_LABELS[key] || key}</span>{enabled && <Check size={16} className="text-emerald-400" />}</span><span className="mt-2 block text-xs text-white/30">{locked ? "Обязательный" : enabled ? "Включён" : "Выключен"}</span></button>; })}</div></section>

              {canManage && <ProgramBuilder cohortId={selectedCohort.id} token={token} />}

              {canManage && config?.modules.homework && <HomeworkManager cohortId={selectedCohort.id} token={token} residents={residents} />}

              {canManage && config?.modules.attendance && <AttendanceManager cohortId={selectedCohort.id} token={token} />}

              {isAdmin && <section className="workspace-card"><div className="mb-5 flex items-center gap-3"><Users className="text-white/45" /><div><h2 className="text-xl">Лимиты Pitchy</h2><p className="text-sm text-white/40">Шаблон применяется ко всему потоку. Ниже эти значения можно переопределить для одного резидента.</p></div></div><LimitsEditor value={limits} onChange={setLimits} /><button onClick={() => void saveCohortLimits()} disabled={busy === "cohort-limits"} className="workspace-button mt-4">Сохранить для потока</button></section>}

              {canManage && <section className="workspace-card"><h2 className="mb-5 text-xl">Заявки <span className="text-white/30">{applications.length}</span></h2>{!applications.length ? <p className="text-sm text-white/35">Заявок пока нет.</p> : <div className="space-y-3">{applications.map((application) => <article key={application.id} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3>{application.applicant_name || "Без имени"}</h3><p className="text-sm text-white/40">{application.applicant_email} · {application.application_type === "project" ? "проект" : "участник"}</p><span className="mt-2 inline-block rounded-full bg-white/[0.06] px-2 py-1 text-xs text-white/50">{STATUS_LABELS[application.status] || application.status}</span>{application.review_comment && <p className="mt-2 max-w-xl text-sm text-amber-200/60">Комментарий: {application.review_comment}</p>}</div><div className="flex flex-wrap gap-2">{["submitted", "under_review", "needs_info", "waitlisted"].includes(application.status) && <button onClick={() => void actOnApplication(application, "accept")} disabled={busy === `application-${application.id}`} className="workspace-button">Одобрить</button>}{application.status === "approved" && <button onClick={() => void actOnApplication(application, "enroll")} disabled={busy === `application-${application.id}`} className="workspace-button">Зачислить</button>}{["submitted", "under_review", "needs_info", "waitlisted"].includes(application.status) && <button onClick={() => void actOnApplication(application, "status", "rejected")} disabled={busy === `application-${application.id}`} className="workspace-button !bg-transparent !text-white">Отклонить</button>}</div></div><details className="mt-3 text-sm text-white/40"><summary className="cursor-pointer">Данные заявки</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-xl bg-black/40 p-3 text-xs">{JSON.stringify(application.form_payload, null, 2)}</pre></details>{["submitted", "under_review", "waitlisted"].includes(application.status) && <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-300/10 bg-amber-300/[0.03] p-3 sm:flex-row"><input value={applicationComments[application.id] || ""} onChange={(event) => setApplicationComments({ ...applicationComments, [application.id]: event.target.value })} placeholder="Что кандидату нужно исправить или дополнить" className="workspace-input" /><button onClick={() => void actOnApplication(application, "status", "needs_info")} disabled={busy === `application-${application.id}` || !(applicationComments[application.id] || "").trim()} className="workspace-button shrink-0 !bg-amber-200">Вернуть на доработку</button></div>}</article>)}</div>}</section>}

              {canManage && <section className="workspace-card"><h2 className="mb-5 text-xl">Резиденты <span className="text-white/30">{residents.length}</span></h2>{!residents.length ? <p className="text-sm text-white/35">Зачисленных и принятых резидентов пока нет.</p> : <div className="space-y-3">{residents.map((resident) => <article key={resident.membership_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 p-4"><div><h3>{resident.name}</h3><p className="text-sm text-white/40">{resident.email} · {STATUS_LABELS[resident.status] || resident.status}</p></div>{isAdmin && <button onClick={() => void saveResidentLimits(resident.membership_id)} disabled={busy === `resident-${resident.membership_id}`} className="workspace-button">Назначить текущие лимиты</button>}</article>)}</div>}</section>}
            </div>}
          </>
        )}
      </div>
      <style jsx global>{`.workspace-card{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.025);border-radius:1.5rem;padding:1.25rem}.workspace-input{width:100%;border-radius:1rem;border:1px solid rgba(255,255,255,.12);background:#111;padding:.75rem 1rem;color:#fff;outline:none}.workspace-button{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border-radius:999px;background:#fff;padding:.7rem 1rem;color:#000;font-size:.875rem;font-weight:600}.workspace-button:disabled{opacity:.45}`}</style>
    </main>
  );
}

function SelectCard({ label, children }: { label: string; children: React.ReactNode }) { return <section className="workspace-card"><p className="mb-2 text-xs uppercase tracking-[.18em] text-white/35">{label}</p>{children}</section>; }

function LimitsEditor({ value, onChange }: { value: Limits; onChange: (value: Limits) => void }) {
  const items: Array<[keyof Limits, string]> = [["messages", "Сообщения"], ["roadmaps", "Дорожные карты"], ["custdev", "Кастдевы"], ["grants", "Заявки на гранты"]];
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{items.map(([key, label]) => <label key={key} className="text-sm text-white/60">{label}<input type="number" min={-1} value={value[key]} onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })} className="workspace-input mt-2" /></label>)}</div>;
}

function Empty({ icon: Icon, title, text, children }: { icon: typeof Rocket; title: string; text: string; children?: React.ReactNode }) { return <main className="min-h-[100dvh] bg-black text-white grid place-items-center px-5"><section className="max-w-lg text-center"><Icon className="mx-auto mb-5 text-white/35" size={42} /><h1 className="text-3xl mb-4">{title}</h1><p className="mb-8 text-white/45">{text}</p>{children}</section></main>; }
