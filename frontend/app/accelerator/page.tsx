"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clipboard, LayoutDashboard, Loader2, LogIn, RefreshCw, Rocket, Settings2 } from "lucide-react";

import { describeApiError, getAuthJson, getMe, patchAuthJson, postAuthJson, type UserResponse } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { AcceleratorSetupWizard } from "@/components/accelerator/AcceleratorSetupWizard";
import { ApplicationFormEditor, type ApplicationFormSchema } from "@/components/accelerator/ApplicationFormEditor";
import { ApplicationManager, type AcceleratorApplication } from "@/components/accelerator/ApplicationManager";
import { AttendanceManager } from "@/components/accelerator/AttendanceManager";
import { AuditLog } from "@/components/accelerator/AuditLog";
import { HomeworkManager } from "@/components/accelerator/HomeworkManager";
import { OrganizerManager } from "@/components/accelerator/OrganizerManager";
import { ProgramBuilder } from "@/components/accelerator/ProgramBuilder";
import { QuotaManager, type Limits } from "@/components/accelerator/QuotaManager";
import { ResidentWorkspace, type ResidentWorkspaceData } from "@/components/accelerator/ResidentWorkspace";
import { ResidentReport } from "@/components/accelerator/ResidentReport";
import { TrackerManager } from "@/components/accelerator/TrackerManager";
import { TrackingDashboard } from "@/components/accelerator/TrackingDashboard";
import { TrackerAttendance } from "@/components/accelerator/TrackerAttendance";
import { TrackerHomework } from "@/components/accelerator/TrackerHomework";
import { MatchmakingManager } from "@/components/accelerator/MatchmakingManager";
import { MatchmakingWorkspace } from "@/components/accelerator/MatchmakingWorkspace";
import { ProjectAuditWorkspace } from "@/components/accelerator/ProjectAuditWorkspace";
import { DemoDayWorkspace } from "@/components/accelerator/DemoDayWorkspace";
import { ArtifactWorkspace } from "@/components/accelerator/ArtifactWorkspace";
import { NotificationCenter } from "@/components/accelerator/NotificationCenter";
import { CohortClosure } from "@/components/accelerator/CohortClosure";
import { AcceleratorOperations } from "@/components/accelerator/AcceleratorOperations";

type Accelerator = { id: number; name: string; description?: string | null; status: string; access_role: "global_admin" | "organizer" | "tracker" | "expert" | "resident" };
type Cohort = { id: number; accelerator_id: number; name: string; status: string; timezone: string; starts_at?: string | null; ends_at?: string | null; default_quota_config?: Limits | null; application_form_schema: ApplicationFormSchema };
type ProgramConfig = { cohort_id: number; version: number; modules: Record<string, boolean>; locked_modules: Record<string, boolean> };
type Resident = { membership_id: number; user_id: number; name: string; email: string; status: string; status_reason?: string | null; trackers?: Array<{ user_id: number; name: string }> };
type TabKey = "overview" | "operations" | "applications" | "form" | "program" | "homework" | "attendance" | "trackers" | "reports" | "tracking" | "matching" | "project_audit" | "demo_day" | "artifacts" | "closure" | "quotas" | "settings" | "audit";

const MODULE_LABELS: Record<string, string> = { applications: "Заявки", program: "Программа", homework: "Домашние задания", attendance: "Посещаемость", progress_tracking: "Трекинг прогресса", matchmaking: "Матчмейкинг", project_audit: "Аудит проекта", demo_day: "Демо-день и экспорт", pitchy_artifacts: "Результаты Pitchy", alumni: "Каталог выпускников" };
const STATUS_LABELS: Record<string, string> = { draft: "Черновик", accepting: "Приём заявок", active: "Идёт", completed: "Завершён", archived: "Архив", accepted: "Принят", enrolled: "Зачислен" };
const STATUS_TRANSITIONS: Record<string, string[]> = { draft: ["accepting", "archived"], accepting: ["draft", "active", "archived"], active: ["archived"], completed: ["archived"], archived: [] };

export default function AcceleratorWorkspacePage() {
  const { token, isLoaded } = useAuth();
  const [accelerators, setAccelerators] = useState<Accelerator[]>([]); const [profile, setProfile] = useState<UserResponse | null>(null); const [acceleratorId, setAcceleratorId] = useState<number | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[]>([]); const [cohortId, setCohortId] = useState<number | null>(null); const [config, setConfig] = useState<ProgramConfig | null>(null);
  const [applications, setApplications] = useState<AcceleratorApplication[]>([]); const [residents, setResidents] = useState<Resident[]>([]); const [residentWorkspace, setResidentWorkspace] = useState<ResidentWorkspaceData | null>(null);
  const [tab, setTab] = useState<TabKey>("overview"); const [showSetup, setShowSetup] = useState(false); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [copied, setCopied] = useState(false);

  const selectedAccelerator = accelerators.find((row) => row.id === acceleratorId) || null;
  const selectedCohort = cohorts.find((row) => row.id === cohortId) || null;
  const isAdmin = Boolean(profile?.is_admin); const isResident = selectedAccelerator?.access_role === "resident"; const isTracker = selectedAccelerator?.access_role === "tracker"; const isExpert = selectedAccelerator?.access_role === "expert"; const canManage = selectedAccelerator?.access_role === "global_admin" || selectedAccelerator?.access_role === "organizer"; const canReadCohort = canManage || isTracker || isExpert;

  const loadAccelerators = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    try {
      const [rows, user, workspace] = await Promise.all([getAuthJson<Accelerator[]>("/api/accelerators", token), getMe(token), getAuthJson<ResidentWorkspaceData>("/api/accelerators/me/memberships", token)]);
      setAccelerators(rows); setProfile(user); setResidentWorkspace(workspace); setShowSetup(Boolean(user.is_admin && !rows.length));
      setAcceleratorId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || null);
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить акселераторы")); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void loadAccelerators(); }, [loadAccelerators]);

  useEffect(() => {
    if (!token || !acceleratorId || isResident) { setCohorts([]); setCohortId(null); return; }
    getAuthJson<Cohort[]>(`/api/accelerators/${acceleratorId}/cohorts`, token).then((rows) => { setCohorts(rows); setCohortId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || null); }).catch((reason) => setError(describeApiError(reason, "Не удалось загрузить потоки")));
  }, [acceleratorId, isResident, token]);

  const loadCohortDetails = useCallback(async () => {
    if (!token || !cohortId || !canReadCohort) { setConfig(null); setApplications([]); setResidents([]); return; }
    try {
      const [program, applicationRows, residentRows] = await Promise.all([
        getAuthJson<ProgramConfig>(`/api/accelerators/cohorts/${cohortId}/program-config`, token),
        canManage ? getAuthJson<AcceleratorApplication[]>(`/api/accelerators/cohorts/${cohortId}/applications`, token) : Promise.resolve([]),
        isExpert ? Promise.resolve([]) : getAuthJson<Resident[]>(`/api/accelerators/cohorts/${cohortId}/residents`, token),
      ]);
      setConfig(program); setApplications(applicationRows); setResidents(residentRows);
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить данные потока")); }
  }, [canManage, canReadCohort, cohortId, isExpert, token]);
  useEffect(() => { void loadCohortDetails(); }, [loadCohortDetails]);

  const tabs = useMemo(() => {
    if (isTracker) {
      const rows: Array<{ key: TabKey; label: string }> = [{ key: "reports", label: "Мои резиденты" }];
      if (config?.modules.progress_tracking) rows.push({ key: "tracking", label: "Трекинг" });
      if (config?.modules.homework) rows.push({ key: "homework", label: "Домашние задания" });
      if (config?.modules.attendance) rows.push({ key: "attendance", label: "Посещаемость" });
      if (config?.modules.matchmaking) rows.push({ key: "matching", label: "Матчмейкинг" });
      if (config?.modules.project_audit) rows.push({ key: "project_audit", label: "Аудит проекта" });
      if (config?.modules.pitchy_artifacts) rows.push({ key: "artifacts", label: "Результаты Pitchy" });
      return rows;
    }
    if (isExpert) { const rows: Array<{ key: TabKey; label: string }> = []; if (config?.modules.matchmaking) rows.push({ key: "matching", label: "Мои связки" }); if (config?.modules.demo_day) rows.push({ key: "demo_day", label: "Демо-день" }); return rows; }
    const rows: Array<{ key: TabKey; label: string }> = [{ key: "overview", label: "Обзор" }, { key: "operations", label: "Состояние" }, { key: "applications", label: "Заявки" }, { key: "form", label: "Анкета" }, { key: "program", label: "Программа" }];
    if (config?.modules.homework) rows.push({ key: "homework", label: "Домашние задания" });
    if (config?.modules.attendance) rows.push({ key: "attendance", label: "Посещаемость" });
    if (config?.modules.progress_tracking) rows.push({ key: "tracking", label: "Трекинг" });
    if (config?.modules.matchmaking) rows.push({ key: "matching", label: "Матчмейкинг" });
    if (config?.modules.project_audit) rows.push({ key: "project_audit", label: "Аудит проекта" });
    if (config?.modules.demo_day) rows.push({ key: "demo_day", label: "Демо-день" });
    if (config?.modules.pitchy_artifacts) rows.push({ key: "artifacts", label: "Результаты Pitchy" });
    rows.push({ key: "trackers", label: "Трекеры" }, { key: "reports", label: "Отчётность" });
    rows.push({ key: "closure", label: "Завершение потока" });
    if (isAdmin) rows.push({ key: "quotas", label: "Лимиты" });
    rows.push({ key: "settings", label: "Настройки" }, { key: "audit", label: "Журнал" }); return rows;
  }, [config, isAdmin, isExpert, isTracker]);
  useEffect(() => { if (!tabs.some((item) => item.key === tab)) setTab(tabs[0]?.key || "overview"); }, [tab, tabs]);

  const saveApplicationForm = async (applicationFormSchema: ApplicationFormSchema) => {
    if (!token || !cohortId) return false; setBusy("form"); setError("");
    try { const updated = await patchAuthJson<Cohort>(`/api/accelerators/cohorts/${cohortId}`, { application_form_schema: applicationFormSchema }, token); setCohorts((rows) => rows.map((row) => row.id === updated.id ? updated : row)); return true; }
    catch (reason) { setError(describeApiError(reason, "Не удалось сохранить анкету")); return false; }
    finally { setBusy(""); }
  };
  const copyApplicationLink = async () => { if (!cohortId) return; await navigator.clipboard.writeText(`${window.location.origin}/accelerators/apply/${cohortId}`); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };

  if (!isLoaded || loading) return <main className="min-h-[100dvh] grid place-items-center bg-black text-white"><Loader2 className="animate-spin text-white/40" /></main>;
  if (!token) return <Empty icon={LogIn} title="Нужно войти" text="Пространство акселератора доступно после авторизации."><Link href="/login?next=/accelerator" className="workspace-button">Войти</Link></Empty>;

  return <main className="min-h-[100dvh] bg-black px-4 py-7 text-white sm:px-8 sm:py-10"><div className="mx-auto max-w-7xl">
    <header className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><Link href="/dashboard" className="text-sm text-white/40 hover:text-white">← В дашборд</Link><div className="mt-4 flex items-center gap-3"><Rocket className="text-white/45" /><h1 className="text-3xl tracking-tight sm:text-5xl">Акселератор</h1></div></div><div className="flex items-center gap-2">{isAdmin && <button type="button" onClick={() => setShowSetup((value) => !value)} className="workspace-button">{showSetup ? "Закрыть мастер" : "Новый акселератор"}</button>}<NotificationCenter token={token} /><button type="button" onClick={() => void (isResident ? loadAccelerators() : loadCohortDetails())} className="rounded-full border border-white/10 p-3 text-white/45" aria-label="Обновить"><RefreshCw size={17} /></button></div></header>
    {error && <div role="alert" className="mb-6 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</div>}
    {showSetup && isAdmin && <div className="mb-7"><AcceleratorSetupWizard token={token} onCancel={accelerators.length ? () => setShowSetup(false) : undefined} onCreated={async (result) => { await loadAccelerators(); setAcceleratorId(result.accelerator.id); setCohortId(result.cohort.id); setShowSetup(false); setTab("overview"); }} /></div>}
    {!accelerators.length && !showSetup ? <EmptyState isAdmin={isAdmin} onCreate={() => setShowSetup(true)} /> : accelerators.length > 0 && <>
      <div className={`mb-6 grid gap-3 ${isResident ? "" : "md:grid-cols-2"}`}><SelectCard label="Акселератор"><select value={acceleratorId || ""} onChange={(event) => { setAcceleratorId(Number(event.target.value)); setTab("overview"); }} className="workspace-input">{accelerators.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><p className="mt-2 text-xs text-white/35">Роль: {selectedAccelerator?.access_role === "global_admin" ? "главный администратор" : selectedAccelerator?.access_role === "organizer" ? "организатор" : selectedAccelerator?.access_role === "tracker" ? "трекер" : selectedAccelerator?.access_role === "expert" ? "эксперт" : "резидент"}</p></SelectCard>{!isResident && <SelectCard label="Поток"><select value={cohortId || ""} onChange={(event) => { setCohortId(Number(event.target.value)); setTab("overview"); }} className="workspace-input" disabled={!cohorts.length}>{cohorts.length ? cohorts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>) : <option value="">Нет назначенных потоков</option>}</select>{selectedCohort && <p className="mt-2 text-xs text-white/35">{STATUS_LABELS[selectedCohort.status] || selectedCohort.status}</p>}</SelectCard>}</div>
      {isResident && acceleratorId && <ResidentWorkspace acceleratorId={acceleratorId} data={residentWorkspace} />}
      {!isResident && canReadCohort && selectedCohort && <>
        <nav className="mb-6 flex gap-2 overflow-x-auto pb-2" aria-label="Разделы акселератора">{tabs.map((item) => <button type="button" key={item.key} onClick={() => setTab(item.key)} className={`shrink-0 rounded-full border px-4 py-2 text-sm ${tab === item.key ? "border-white bg-white text-black" : "border-white/10 text-white/50 hover:text-white"}`}>{item.label}</button>)}</nav>
        {tab === "overview" && <Overview accelerator={selectedAccelerator} cohort={selectedCohort} config={config} applications={applications} residents={residents} onCopy={copyApplicationLink} copied={copied} onNavigate={setTab} />}
        {tab === "operations" && canManage && <AcceleratorOperations cohortId={selectedCohort.id} acceleratorId={selectedAccelerator.id} token={token} isAdmin={isAdmin} />}
        {tab === "applications" && <ApplicationManager token={token} applications={applications} schema={selectedCohort.application_form_schema || {}} onChanged={loadCohortDetails} />}
        {tab === "form" && <ApplicationFormEditor key={selectedCohort.id} schema={selectedCohort.application_form_schema || {}} publicUrl={`/accelerators/apply/${selectedCohort.id}`} saving={busy === "form"} onSave={saveApplicationForm} />}
        {tab === "program" && <ProgramBuilder cohortId={selectedCohort.id} token={token} />}
        {tab === "homework" && config?.modules.homework && (canManage ? <HomeworkManager cohortId={selectedCohort.id} token={token} residents={residents} /> : <TrackerHomework cohortId={selectedCohort.id} token={token} />)}
        {tab === "attendance" && config?.modules.attendance && (canManage ? <AttendanceManager cohortId={selectedCohort.id} token={token} /> : <TrackerAttendance cohortId={selectedCohort.id} token={token} />)}
        {tab === "tracking" && config?.modules.progress_tracking && <TrackingDashboard cohortId={selectedCohort.id} token={token} />}
        {tab === "matching" && config?.modules.matchmaking && (canManage ? <MatchmakingManager cohortId={selectedCohort.id} token={token} /> : <MatchmakingWorkspace cohortId={selectedCohort.id} />)}
        {tab === "project_audit" && config?.modules.project_audit && <ProjectAuditWorkspace cohortId={selectedCohort.id} residents={residents} token={token} canCreateTasks taskIntegrationEnabled={Boolean(config.modules.progress_tracking)} />}
        {tab === "demo_day" && config?.modules.demo_day && <DemoDayWorkspace cohortId={selectedCohort.id} residents={residents} token={token} canManage={canManage} />}
        {tab === "artifacts" && config?.modules.pitchy_artifacts && <ArtifactWorkspace cohortId={selectedCohort.id} token={token} />}
        {tab === "trackers" && canManage && <TrackerManager token={token} cohortId={selectedCohort.id} residents={residents} />}
        {tab === "reports" && <ResidentReport token={token} cohortId={selectedCohort.id} canManage={canManage} onChanged={loadCohortDetails} />}
        {tab === "closure" && canManage && <CohortClosure cohortId={selectedCohort.id} token={token} onCompleted={async () => { await loadAccelerators(); await loadCohortDetails(); }} />}
        {tab === "quotas" && isAdmin && <QuotaManager token={token} cohortId={selectedCohort.id} initialTemplate={selectedCohort.default_quota_config} residents={residents} />}
        {tab === "settings" && <SettingsPanel token={token} isAdmin={isAdmin} accelerator={selectedAccelerator} cohort={selectedCohort} config={config} onConfig={setConfig} onCohort={(updated) => setCohorts((rows) => rows.map((row) => row.id === updated.id ? updated : row))} onAccelerator={(updated) => setAccelerators((rows) => rows.map((row) => row.id === updated.id ? { ...row, ...updated } : row))} onCohortCreated={async (created) => { const rows = await getAuthJson<Cohort[]>(`/api/accelerators/${selectedAccelerator.id}/cohorts`, token); setCohorts(rows); setCohortId(created.id); }} />}
        {tab === "audit" && <AuditLog token={token} acceleratorId={selectedAccelerator.id} />}
      </>}
      {!isResident && canManage && !selectedCohort && <section className="workspace-card text-center"><h2 className="text-2xl">Создайте первый поток</h2><p className="mt-2 text-white/40">Откройте мастер нового акселератора или добавьте поток в настройках существующего.</p>{isAdmin && <button type="button" onClick={() => setShowSetup(true)} className="workspace-button mt-5">Открыть мастер</button>}</section>}
    </>}
  </div><style jsx global>{`.workspace-card{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.025);border-radius:1.5rem;padding:1.25rem}.workspace-input{width:100%;border-radius:1rem;border:1px solid rgba(255,255,255,.12);background:#111;padding:.75rem 1rem;color:#fff;outline:none}.workspace-input option{color:#fff;background:#111}.workspace-button{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border-radius:999px;background:#fff;padding:.7rem 1rem;color:#000;font-size:.875rem;font-weight:600}.workspace-button:disabled{opacity:.45}`}</style></main>;
}

function Overview({ accelerator, cohort, config, applications, residents, onCopy, copied, onNavigate }: { accelerator: Accelerator; cohort: Cohort; config: ProgramConfig | null; applications: AcceleratorApplication[]; residents: Resident[]; onCopy: () => Promise<void>; copied: boolean; onNavigate: (tab: TabKey) => void }) {
  const newApplications = applications.filter((row) => ["submitted", "under_review", "needs_info", "waitlisted"].includes(row.status)).length;
  return <div className="space-y-6"><section className="workspace-card"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.17em] text-white/30">{STATUS_LABELS[cohort.status] || cohort.status}</p><h2 className="mt-2 text-3xl">{cohort.name}</h2><p className="mt-2 max-w-2xl text-sm text-white/45">{accelerator.description || "Добавьте описание акселератора в настройках."}</p></div><button type="button" onClick={() => void onCopy()} className="workspace-button"><Clipboard size={15} /> {copied ? "Скопировано" : "Ссылка на заявку"}</button></div></section>
    <div className="grid gap-4 sm:grid-cols-3"><Stat label="Заявки в работе" value={newApplications} onClick={() => onNavigate("applications")} /><Stat label="Резиденты" value={residents.length} /><Stat label="Модули" value={Object.values(config?.modules || {}).filter(Boolean).length} onClick={() => onNavigate("settings")} /></div>
    <section className="workspace-card"><h3 className="text-lg">Что делать дальше</h3><div className="mt-4 grid gap-3 md:grid-cols-3"><Quick title="Настройте анкету" text="Разделите вопросы для проектов и участников." onClick={() => onNavigate("form")} /><Quick title="Соберите программу" text="Добавьте этапы и материалы, затем опубликуйте." onClick={() => onNavigate("program")} /><Quick title="Откройте набор" text="Проверьте настройки и переведите поток в приём заявок." onClick={() => onNavigate("settings")} /></div></section>
  </div>;
}

function SettingsPanel({ token, isAdmin, accelerator, cohort, config, onConfig, onCohort, onAccelerator, onCohortCreated }: { token: string; isAdmin: boolean; accelerator: Accelerator; cohort: Cohort; config: ProgramConfig | null; onConfig: (row: ProgramConfig) => void; onCohort: (row: Cohort) => void; onAccelerator: (row: Partial<Accelerator> & { id: number }) => void; onCohortCreated: (row: Cohort) => Promise<void> }) {
  const [acceleratorName, setAcceleratorName] = useState(accelerator.name); const [description, setDescription] = useState(accelerator.description || ""); const [cohortName, setCohortName] = useState(cohort.name); const [timezone, setTimezone] = useState(cohort.timezone || "Europe/Moscow"); const [startsAt, setStartsAt] = useState(toLocal(cohort.starts_at)); const [endsAt, setEndsAt] = useState(toLocal(cohort.ends_at)); const [newCohortName, setNewCohortName] = useState(""); const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  useEffect(() => { setAcceleratorName(accelerator.name); setDescription(accelerator.description || ""); }, [accelerator]);
  useEffect(() => { setCohortName(cohort.name); setTimezone(cohort.timezone || "Europe/Moscow"); setStartsAt(toLocal(cohort.starts_at)); setEndsAt(toLocal(cohort.ends_at)); }, [cohort]);
  const updateModule = async (key: string, value: boolean) => { if (!config) return; setBusy(`module-${key}`); try { onConfig(await patchAuthJson<ProgramConfig>(`/api/accelerators/cohorts/${cohort.id}/program-config`, { version: config.version, modules: { [key]: value } }, token)); } catch (reason) { setError(describeApiError(reason, "Не удалось изменить модуль")); } finally { setBusy(""); } };
  const save = async () => { setBusy("save"); setError(""); try { const [updatedAccelerator, updatedCohort] = await Promise.all([patchAuthJson<Partial<Accelerator> & { id: number }>(`/api/accelerators/${accelerator.id}`, { name: acceleratorName, description }, token), patchAuthJson<Cohort>(`/api/accelerators/cohorts/${cohort.id}`, { name: cohortName, timezone, starts_at: startsAt || null, ends_at: endsAt || null }, token)]); onAccelerator(updatedAccelerator); onCohort(updatedCohort); } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить настройки")); } finally { setBusy(""); } };
  const statusChange = async (next: string) => { if (!window.confirm(`Изменить статус потока на «${STATUS_LABELS[next]}»?`)) return; setBusy("status"); try { onCohort(await patchAuthJson<Cohort>(`/api/accelerators/cohorts/${cohort.id}/status`, { status: next }, token)); } catch (reason) { setError(describeApiError(reason, "Не удалось изменить статус")); } finally { setBusy(""); } };
  const createCohort = async (event: FormEvent) => { event.preventDefault(); setBusy("new-cohort"); try { const created = await postAuthJson<Cohort>(`/api/accelerators/${accelerator.id}/cohorts`, { name: newCohortName, timezone: "Europe/Moscow", application_form_schema: defaultApplicationSchema(newCohortName) }, token); setNewCohortName(""); await onCohortCreated(created); } catch (reason) { setError(describeApiError(reason, "Не удалось создать поток")); } finally { setBusy(""); } };
  return <div className="space-y-6"><section className="workspace-card"><h2 className="text-xl">Основные настройки</h2><div className="mt-5 grid gap-4 sm:grid-cols-2"><Label text="Акселератор"><input value={acceleratorName} onChange={(event) => setAcceleratorName(event.target.value)} className="workspace-input mt-2" /></Label><Label text="Поток"><input value={cohortName} onChange={(event) => setCohortName(event.target.value)} className="workspace-input mt-2" /></Label><Label text="Часовой пояс"><input value={timezone} onChange={(event) => setTimezone(event.target.value)} className="workspace-input mt-2" /></Label><Label text="Описание"><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="workspace-input mt-2 resize-y" /></Label><Label text="Начало"><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="workspace-input mt-2" /></Label><Label text="Окончание"><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className="workspace-input mt-2" /></Label></div><button type="button" onClick={() => void save()} disabled={Boolean(busy)} className="workspace-button mt-5">Сохранить настройки</button></section>
    <section className="workspace-card"><h2 className="text-xl">Статус потока</h2><p className="mt-1 text-sm text-white/40">Открытие и архивирование выполняются здесь. Активный поток завершается только через итоговое решение по каждому резиденту.</p><div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full border border-white/15 px-4 py-2 text-sm">Сейчас: {STATUS_LABELS[cohort.status] || cohort.status}</span>{(STATUS_TRANSITIONS[cohort.status] || []).map((next) => <button type="button" key={next} onClick={() => void statusChange(next)} disabled={Boolean(busy)} className="workspace-button !bg-transparent !text-white">Перевести: {STATUS_LABELS[next]}</button>)}</div></section>
    <section className="workspace-card"><div className="mb-5 flex items-start gap-3"><Settings2 className="mt-1 text-white/45" /><div><h2 className="text-xl">Конструктор функций</h2><p className="text-sm text-white/40">Здесь только готовые модули. Заявки и программа обязательны.</p></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{config && Object.entries(config.modules).map(([key, enabled]) => { const locked = key in config.locked_modules; return <button type="button" key={key} disabled={locked || Boolean(busy)} onClick={() => void updateModule(key, !enabled)} className={`rounded-2xl border p-4 text-left ${enabled ? "border-emerald-400/25 bg-emerald-400/[.07]" : "border-white/10"}`}><span className="flex justify-between gap-3 text-sm">{MODULE_LABELS[key] || key}{enabled && <Check size={16} className="text-emerald-400" />}</span><span className="mt-2 block text-xs text-white/30">{locked ? "Обязательный" : enabled ? "Включён" : "Выключен"}</span></button>; })}</div></section>
    <section className="workspace-card"><h2 className="text-xl">Добавить поток</h2><form onSubmit={createCohort} className="mt-4 flex flex-col gap-3 sm:flex-row"><input value={newCohortName} onChange={(event) => setNewCohortName(event.target.value)} required minLength={2} placeholder="Название нового потока" className="workspace-input" /><button disabled={Boolean(busy)} className="workspace-button shrink-0">Создать с базовой анкетой</button></form></section>
    {isAdmin && <OrganizerManager token={token} acceleratorId={accelerator.id} />}{error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}

function defaultApplicationSchema(name: string): ApplicationFormSchema { return { title: `Заявка в поток «${name}»`, required: ["motivation", "project_name", "problem"], fields: [{ key: "motivation", label: "Мотивация и опыт", type: "textarea", required: true, application_types: ["project", "participant"] }, { key: "project_name", label: "Название проекта", required: true, application_types: ["project"] }, { key: "problem", label: "Какую проблему решает проект?", type: "textarea", required: true, application_types: ["project"] }] }; }
function toLocal(value?: string | null) { if (!value) return ""; const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
function SelectCard({ label, children }: { label: string; children: React.ReactNode }) { return <section className="workspace-card"><p className="mb-2 text-xs uppercase tracking-[.18em] text-white/35">{label}</p>{children}</section>; }
function Label({ text, children }: { text: string; children: React.ReactNode }) { return <label className="text-sm text-white/60">{text}{children}</label>; }
function Stat({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) { const Tag = onClick ? "button" : "div"; return <Tag type={onClick ? "button" : undefined} onClick={onClick} className="workspace-card w-full text-left"><p className="text-3xl">{value}</p><p className="mt-2 text-sm text-white/40">{label}</p></Tag>; }
function Quick({ title, text, onClick }: { title: string; text: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="rounded-2xl border border-white/10 p-4 text-left hover:border-white/25"><span>{title}</span><span className="mt-2 block text-sm text-white/35">{text}</span></button>; }
function EmptyState({ isAdmin, onCreate }: { isAdmin: boolean; onCreate: () => void }) { return <section className="workspace-card py-12 text-center"><LayoutDashboard className="mx-auto mb-4 text-white/25" size={38} /><h2 className="text-2xl">Нет доступных акселераторов</h2><p className="mx-auto mt-3 max-w-lg text-white/40">{isAdmin ? "Создайте первый акселератор — мастер сразу подготовит организацию, поток, анкету, функции и лимиты." : "Главный администратор должен назначить вас организатором или зачислить резидентом."}</p>{isAdmin && <button type="button" onClick={onCreate} className="workspace-button mt-6">Начать настройку</button>}</section>; }
function Empty({ icon: Icon, title, text, children }: { icon: typeof Rocket; title: string; text: string; children?: React.ReactNode }) { return <main className="min-h-[100dvh] grid place-items-center bg-black px-5 text-white"><section className="max-w-lg text-center"><Icon className="mx-auto mb-5 text-white/35" size={42} /><h1 className="mb-4 text-3xl">{title}</h1><p className="mb-8 text-white/45">{text}</p>{children}</section></main>; }
