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
import { HomeworkReviewQueue } from "@/components/accelerator/HomeworkReviewQueue";
import { OrganizerManager } from "@/components/accelerator/OrganizerManager";
import { ProgramBuilder } from "@/components/accelerator/ProgramBuilder";
import { QuotaManager, type Limits } from "@/components/accelerator/QuotaManager";
import { ResidentWorkspace, type ResidentWorkspaceData } from "@/components/accelerator/ResidentWorkspace";
import { ResidentReport } from "@/components/accelerator/ResidentReport";
import { TrackerManager } from "@/components/accelerator/TrackerManager";
import { TrackingDashboard } from "@/components/accelerator/TrackingDashboard";
import { TrackerAttendance } from "@/components/accelerator/TrackerAttendance";
import { MatchmakingManager } from "@/components/accelerator/MatchmakingManager";
import { MatchmakingWorkspace } from "@/components/accelerator/MatchmakingWorkspace";
import { ProjectAuditWorkspace } from "@/components/accelerator/ProjectAuditWorkspace";
import { DemoDayWorkspace } from "@/components/accelerator/DemoDayWorkspace";
import { ArtifactWorkspace } from "@/components/accelerator/ArtifactWorkspace";
import { NotificationCenter } from "@/components/accelerator/NotificationCenter";
import { CohortClosure } from "@/components/accelerator/CohortClosure";
import { AcceleratorOperations } from "@/components/accelerator/AcceleratorOperations";
import { ParticipantDrawer } from "@/components/accelerator/ParticipantDrawer";

type Accelerator = { id: number; name: string; description?: string | null; status: string; access_role: "global_admin" | "organizer" | "tracker" | "expert" | "resident" };
type Cohort = { id: number; accelerator_id: number; name: string; status: string; timezone: string; starts_at?: string | null; ends_at?: string | null; default_quota_config?: Limits | null; application_form_schema: ApplicationFormSchema; homework_pitchy_enabled: boolean };
type ProgramConfig = { cohort_id: number; version: number; modules: Record<string, boolean>; locked_modules: Record<string, boolean> };
type Resident = { membership_id: number; user_id: number; name: string; email: string; status: string; status_reason?: string | null; trackers?: Array<{ user_id: number; name: string }> };
type TabKey = "overview" | "applications" | "form" | "program" | "homework" | "attendance" | "trackers" | "reports" | "tracking" | "matching" | "project_audit" | "demo_day" | "artifacts" | "closure" | "quotas" | "settings" | "audit";
type NavigationGroup = { key: string; label: string; items: Array<{ key: TabKey; label: string }> };

const MODULE_LABELS: Record<string, string> = { applications: "Заявки", program: "Программа", homework: "Домашние задания", attendance: "Посещаемость", progress_tracking: "Трекинг прогресса", matchmaking: "Матчмейкинг", project_audit: "Аудит проекта", demo_day: "Демо-день и экспорт", pitchy_artifacts: "Результаты Pitchy", alumni: "Каталог выпускников" };
const STATUS_LABELS: Record<string, string> = { draft: "Черновик", accepting: "Приём заявок", active: "Идёт", completed: "Завершён", archived: "Архив", accepted: "Принят", enrolled: "Зачислен" };
const STATUS_TRANSITIONS: Record<string, string[]> = { draft: ["accepting", "archived"], accepting: ["draft", "active", "archived"], active: ["archived"], completed: ["archived"], archived: [] };

export default function AcceleratorWorkspacePage() {
  const { token, isLoaded } = useAuth();
  const [accelerators, setAccelerators] = useState<Accelerator[]>([]); const [profile, setProfile] = useState<UserResponse | null>(null); const [acceleratorId, setAcceleratorId] = useState<number | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[]>([]); const [cohortId, setCohortId] = useState<number | null>(null); const [config, setConfig] = useState<ProgramConfig | null>(null);
  const [applications, setApplications] = useState<AcceleratorApplication[]>([]); const [residents, setResidents] = useState<Resident[]>([]); const [residentWorkspace, setResidentWorkspace] = useState<ResidentWorkspaceData | null>(null);
  const [tab, setTab] = useState<TabKey>("overview"); const [showSetup, setShowSetup] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [copied, setCopied] = useState(false);
  const [selectedMembershipId, setSelectedMembershipId] = useState<number | null>(null); const [reportQuery, setReportQuery] = useState(""); const [reportStatus, setReportStatus] = useState("all"); const [urlReady, setUrlReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const savedTab = params.get("section") as TabKey | null;
    if (savedTab) setTab(savedTab);
    const savedAccelerator = Number(params.get("accelerator")); if (savedAccelerator > 0) setAcceleratorId(savedAccelerator);
    const savedCohort = Number(params.get("cohort")); if (savedCohort > 0) setCohortId(savedCohort);
    const savedResident = Number(params.get("resident")); if (savedResident > 0) setSelectedMembershipId(savedResident);
    setReportQuery(params.get("q") || ""); setReportStatus(params.get("status") || "all"); setUrlReady(true);
  }, []);
  useEffect(() => {
    if (!urlReady) return;
    if (window.location.pathname !== "/accelerator") return;
    const params = new URLSearchParams(window.location.search);
    params.set("section", tab);
    if (acceleratorId) params.set("accelerator", String(acceleratorId)); else params.delete("accelerator");
    if (cohortId) params.set("cohort", String(cohortId)); else params.delete("cohort");
    if (selectedMembershipId) params.set("resident", String(selectedMembershipId)); else params.delete("resident");
    if (tab === "reports" && reportQuery) params.set("q", reportQuery); else params.delete("q");
    if (tab === "reports" && reportStatus !== "all") params.set("status", reportStatus); else params.delete("status");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [acceleratorId, cohortId, reportQuery, reportStatus, selectedMembershipId, tab, urlReady]);

  const selectedAccelerator = accelerators.find((row) => row.id === acceleratorId) || null;
  const selectedCohort = cohorts.find((row) => row.id === cohortId) || null;
  const selectedResidentMembership = residentWorkspace?.memberships.find((membership) => membership.accelerator.id === acceleratorId) || null;
  const hasResidentMembership = Boolean(selectedResidentMembership);
  const isResident = selectedAccelerator?.access_role === "resident";
  const isAdmin = Boolean(profile?.is_admin); const isTracker = !isResident && selectedAccelerator?.access_role === "tracker"; const isExpert = !isResident && selectedAccelerator?.access_role === "expert"; const canManage = !isResident && (selectedAccelerator?.access_role === "global_admin" || selectedAccelerator?.access_role === "organizer"); const canReadCohort = canManage || isTracker || isExpert;

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

  const managerGroups = useMemo<NavigationGroup[]>(() => {
    if (!canManage) return [];
    const participants: NavigationGroup["items"] = [{ key: "reports", label: "Список участников" }];
    if (config?.modules.progress_tracking) participants.push({ key: "tracking", label: "Трекинг" });
    if (config?.modules.matchmaking) participants.push({ key: "matching", label: "Подбор и команды" });
    if (config?.modules.project_audit) participants.push({ key: "project_audit", label: "Аудит проектов" });
    const program: NavigationGroup["items"] = [{ key: "program", label: "Программа" }];
    const results: NavigationGroup["items"] = [];
    if (config?.modules.pitchy_artifacts) results.push({ key: "artifacts", label: "Результаты Pitchy" });
    if (config?.modules.demo_day) results.push({ key: "demo_day", label: "Демо-день" });
    results.push({ key: "closure", label: "Завершение потока" });
    const settings: NavigationGroup["items"] = [{ key: "settings", label: "Поток и функции" }];
    settings.push({ key: "trackers", label: "Команда трекеров" });
    if (isAdmin) settings.push({ key: "quotas", label: "Лимиты" });
    settings.push({ key: "audit", label: "Журнал изменений" });
    return [
      { key: "overview", label: "Обзор", items: [{ key: "overview", label: "Рабочая сводка" }] },
      { key: "applications", label: "Заявки", items: [{ key: "applications", label: "Отбор кандидатов" }, { key: "form", label: "Анкета и ссылка" }] },
      { key: "participants", label: "Участники", items: participants },
      { key: "program", label: "Программа", items: program },
      { key: "results", label: "Результаты", items: results },
      { key: "settings", label: "Настройки", items: settings },
    ];
  }, [canManage, config, isAdmin]);

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
    return managerGroups.flatMap((group) => group.items);
  }, [config, isExpert, isTracker, managerGroups]);
  useEffect(() => { if (!tabs.some((item) => item.key === tab)) setTab(tabs[0]?.key || "overview"); }, [tab, tabs]);
  const activeManagerGroup = managerGroups.find((group) => group.items.some((item) => item.key === tab)) || managerGroups[0];

  const copyApplicationLink = async () => { if (!cohortId) return; await navigator.clipboard.writeText(`${window.location.origin}/accelerators/apply/${cohortId}`); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };

  if (!isLoaded || loading) return <main className="min-h-[100dvh] grid place-items-center bg-black text-white"><Loader2 className="animate-spin text-white/40" /></main>;
  if (!token) return <Empty icon={LogIn} title="Нужно войти" text="Пространство акселератора доступно после авторизации."><Link href="/login?next=/accelerator" className="workspace-button">Войти</Link></Empty>;

  return <main className="min-h-[100dvh] bg-black px-4 py-7 text-white sm:px-8 sm:py-10"><div className="mx-auto max-w-7xl">
    <header className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><Link href="/dashboard" className="text-sm text-white/40 hover:text-white">← В дашборд</Link><div className="mt-4 flex items-center gap-3"><Rocket className="text-white/45" /><h1 className="text-3xl tracking-tight sm:text-5xl">Акселератор</h1></div></div><div className="flex items-center gap-2">{isAdmin && <button type="button" onClick={() => setShowSetup((value) => !value)} className="workspace-button">{showSetup ? "Закрыть мастер" : "Новый акселератор"}</button>}<NotificationCenter token={token} /><button type="button" onClick={() => void (isResident ? loadAccelerators() : loadCohortDetails())} className="rounded-full border border-white/10 p-3 text-white/45" aria-label="Обновить"><RefreshCw size={17} /></button></div></header>
    {error && <div role="alert" className="mb-6 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</div>}
    {showSetup && isAdmin && <div className="mb-7"><AcceleratorSetupWizard token={token} onCancel={accelerators.length ? () => setShowSetup(false) : undefined} onCreated={async (result) => { await loadAccelerators(); setAcceleratorId(result.accelerator.id); setCohortId(result.cohort.id); setShowSetup(false); setTab("overview"); }} /></div>}
    {!accelerators.length && !showSetup ? <EmptyState isAdmin={isAdmin} onCreate={() => setShowSetup(true)} /> : accelerators.length > 0 && <>
      <div className={`mb-6 grid gap-3 ${isResident ? "" : "md:grid-cols-2"}`}><SelectCard label="Акселератор"><select value={acceleratorId || ""} onChange={(event) => { setAcceleratorId(Number(event.target.value)); setTab("overview"); }} className="workspace-input">{accelerators.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><p className="mt-2 text-xs text-white/35">Роль: {isResident ? "участник" : selectedAccelerator?.access_role === "global_admin" ? "главный администратор" : selectedAccelerator?.access_role === "organizer" ? "организатор" : selectedAccelerator?.access_role === "tracker" ? "трекер" : selectedAccelerator?.access_role === "expert" ? "эксперт" : "участник"}</p>{hasResidentMembership && selectedAccelerator?.access_role !== "resident" && selectedResidentMembership && <div className="mt-3 flex flex-wrap gap-2" aria-label="Контекст работы"><Link href={`/accelerator/my/${selectedResidentMembership.membership_id}`} className="rounded-full border border-white/10 px-3 py-2 text-xs text-white/45 hover:text-white">Моё участие</Link><span className="rounded-full border border-white bg-white px-3 py-2 text-xs text-black">{selectedAccelerator?.access_role === "organizer" || selectedAccelerator?.access_role === "global_admin" ? "Я организатор" : selectedAccelerator?.access_role === "tracker" ? "Я трекер" : "Я эксперт"}</span></div>}</SelectCard>{!isResident && <SelectCard label="Поток"><select value={cohortId || ""} onChange={(event) => { setCohortId(Number(event.target.value)); setTab("overview"); }} className="workspace-input" disabled={!cohorts.length}>{cohorts.length ? cohorts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>) : <option value="">Нет назначенных потоков</option>}</select>{selectedCohort && <p className="mt-2 text-xs text-white/35">{STATUS_LABELS[selectedCohort.status] || selectedCohort.status}</p>}</SelectCard>}</div>
      {isResident && acceleratorId && <ResidentWorkspace acceleratorId={acceleratorId} data={residentWorkspace} onChanged={loadAccelerators} />}
      {!isResident && canReadCohort && selectedCohort && <>
        {canManage ? <div className="mb-6 space-y-3"><nav className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Основные разделы акселератора">{managerGroups.map((group) => <button type="button" key={group.key} onClick={() => setTab(group.items[0].key)} className={`rounded-2xl border px-4 py-3 text-sm transition ${activeManagerGroup?.key === group.key ? "border-white bg-white text-black" : "border-white/10 text-white/50 hover:border-white/20 hover:text-white"}`}>{group.label}</button>)}</nav>{activeManagerGroup && activeManagerGroup.items.length > 1 && <nav className="flex gap-2 overflow-x-auto pb-1" aria-label={`Подразделы: ${activeManagerGroup.label}`}>{activeManagerGroup.items.map((item) => <button type="button" key={item.key} onClick={() => setTab(item.key)} className={`shrink-0 rounded-full border px-3.5 py-2 text-sm ${tab === item.key ? "border-white/35 bg-white/10 text-white" : "border-white/8 text-white/40 hover:text-white"}`}>{item.label}</button>)}</nav>}</div> : <nav className="mb-6 flex gap-2 overflow-x-auto pb-2" aria-label="Разделы акселератора">{tabs.map((item) => <button type="button" key={item.key} onClick={() => setTab(item.key)} className={`shrink-0 rounded-full border px-4 py-2 text-sm ${tab === item.key ? "border-white bg-white text-black" : "border-white/10 text-white/50 hover:text-white"}`}>{item.label}</button>)}</nav>}
        {tab === "overview" && <Overview accelerator={selectedAccelerator} cohort={selectedCohort} config={config} token={token} isAdmin={isAdmin} onCopy={copyApplicationLink} copied={copied} onNavigate={setTab} onOpenParticipant={setSelectedMembershipId} />}
        {tab === "applications" && <ApplicationManager token={token} applications={applications} schema={selectedCohort.application_form_schema || {}} onChanged={loadCohortDetails} />}
        {tab === "form" && <ApplicationFormEditor key={selectedCohort.id} schema={selectedCohort.application_form_schema || {}} cohortId={selectedCohort.id} token={token} publicUrl={`/accelerators/apply/${selectedCohort.id}`} onPublished={loadCohortDetails} />}
        {tab === "program" && <div className="space-y-6">
          <ProgramBuilder cohortId={selectedCohort.id} token={token} />
          {config?.modules.attendance && <AttendanceManager cohortId={selectedCohort.id} token={token} />}
          {config?.modules.homework && <><HomeworkReviewQueue cohortId={selectedCohort.id} token={token} /><HomeworkManager cohortId={selectedCohort.id} token={token} residents={residents} isAdmin={isAdmin} pitchyEnabled={selectedCohort.homework_pitchy_enabled} /></>}
        </div>}
        {tab === "homework" && config?.modules.homework && <div className="space-y-6"><HomeworkReviewQueue cohortId={selectedCohort.id} token={token} />{canManage && <HomeworkManager cohortId={selectedCohort.id} token={token} residents={residents} isAdmin={isAdmin} pitchyEnabled={selectedCohort.homework_pitchy_enabled} />}</div>}
        {tab === "attendance" && config?.modules.attendance && (canManage ? <AttendanceManager cohortId={selectedCohort.id} token={token} /> : <TrackerAttendance cohortId={selectedCohort.id} token={token} />)}
        {tab === "tracking" && config?.modules.progress_tracking && <TrackingDashboard cohortId={selectedCohort.id} token={token} onOpenParticipant={setSelectedMembershipId} />}
        {tab === "matching" && config?.modules.matchmaking && (canManage ? <MatchmakingManager cohortId={selectedCohort.id} token={token} /> : <MatchmakingWorkspace cohortId={selectedCohort.id} />)}
        {tab === "project_audit" && config?.modules.project_audit && <ProjectAuditWorkspace cohortId={selectedCohort.id} residents={residents} token={token} canCreateTasks taskIntegrationEnabled={Boolean(config.modules.progress_tracking)} />}
        {tab === "demo_day" && config?.modules.demo_day && <DemoDayWorkspace cohortId={selectedCohort.id} residents={residents} token={token} canManage={canManage} />}
        {tab === "artifacts" && config?.modules.pitchy_artifacts && <ArtifactWorkspace cohortId={selectedCohort.id} token={token} />}
        {tab === "trackers" && canManage && <TrackerManager token={token} cohortId={selectedCohort.id} residents={residents} />}
        {tab === "reports" && <ResidentReport token={token} cohortId={selectedCohort.id} canManage={canManage} onChanged={loadCohortDetails} onOpenParticipant={setSelectedMembershipId} initialQuery={reportQuery} initialStatus={reportStatus} onFiltersChange={(query, status) => { setReportQuery(query); setReportStatus(status); }} />}
        {tab === "closure" && canManage && <CohortClosure cohortId={selectedCohort.id} token={token} onCompleted={async () => { await loadAccelerators(); await loadCohortDetails(); }} />}
        {tab === "quotas" && isAdmin && <QuotaManager token={token} cohortId={selectedCohort.id} initialTemplate={selectedCohort.default_quota_config} residents={residents} />}
        {tab === "settings" && <SettingsPanel token={token} isAdmin={isAdmin} accelerator={selectedAccelerator} cohort={selectedCohort} config={config} onConfig={setConfig} onCohort={(updated) => setCohorts((rows) => rows.map((row) => row.id === updated.id ? updated : row))} onAccelerator={(updated) => setAccelerators((rows) => rows.map((row) => row.id === updated.id ? { ...row, ...updated } : row))} onCohortCreated={async (created) => { const rows = await getAuthJson<Cohort[]>(`/api/accelerators/${selectedAccelerator.id}/cohorts`, token); setCohorts(rows); setCohortId(created.id); }} />}
        {tab === "audit" && <AuditLog token={token} acceleratorId={selectedAccelerator.id} />}
        {selectedMembershipId && <ParticipantDrawer membershipId={selectedMembershipId} token={token} onClose={() => setSelectedMembershipId(null)} onChanged={loadCohortDetails} />}
      </>}
      {!isResident && canManage && !selectedCohort && selectedAccelerator && <FirstCohortSetup token={token} accelerator={selectedAccelerator} onCreated={async (created) => { const rows = await getAuthJson<Cohort[]>(`/api/accelerators/${selectedAccelerator.id}/cohorts`, token); setCohorts(rows); setCohortId(created.id); setTab("overview"); }} />}
    </>}
  </div></main>;
}

type WorkSummary = { counts: { new_applications: number; pending_homework: number; teams_without_tracker: number; participants_without_tracker: number; risks: number; today_events: number }; participants_without_tracker: Array<{ membership_id: number; name: string }>; risks: Array<{ membership_id: number; name: string; level: string; reasons: string[] }>; today_events: Array<{ id: number; title: string; starts_at: string; format: string }> };
function Overview({ accelerator, cohort, token, isAdmin, onCopy, copied, onNavigate, onOpenParticipant }: { accelerator: Accelerator; cohort: Cohort; config: ProgramConfig | null; token: string; isAdmin: boolean; onCopy: () => Promise<void>; copied: boolean; onNavigate: (tab: TabKey) => void; onOpenParticipant: (id: number) => void }) {
  const [summary, setSummary] = useState<WorkSummary | null>(null); const [summaryError, setSummaryError] = useState("");
  const load = useCallback(async () => { try { setSummary(await getAuthJson<WorkSummary>(`/api/accelerators/cohorts/${cohort.id}/work-summary`, token)); setSummaryError(""); } catch (reason) { setSummaryError(describeApiError(reason, "Не удалось загрузить рабочую сводку")); } }, [cohort.id, token]);
  useEffect(() => { let active = true; getAuthJson<WorkSummary>(`/api/accelerators/cohorts/${cohort.id}/work-summary`, token).then((row) => { if (active) { setSummary(row); setSummaryError(""); } }).catch((reason) => { if (active) setSummaryError(describeApiError(reason, "Не удалось загрузить рабочую сводку")); }); return () => { active = false; }; }, [cohort.id, token]);
  const counts = summary?.counts;
  return <div className="space-y-6"><section className="workspace-card"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.17em] text-white/30">{STATUS_LABELS[cohort.status] || cohort.status}</p><h2 className="mt-2 text-3xl">{cohort.name}</h2><p className="mt-2 max-w-2xl text-sm text-white/45">{accelerator.description || "Добавьте описание акселератора в настройках."}</p></div><button type="button" onClick={() => void onCopy()} className="workspace-button"><Clipboard size={15} /> {copied ? "Скопировано" : "Ссылка на заявку"}</button></div></section>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Stat label="Новые заявки" value={counts?.new_applications || 0} onClick={() => onNavigate("applications")} /><Stat label="ДЗ на проверке" value={counts?.pending_homework || 0} onClick={() => onNavigate("program")} /><Stat label="Без трекера" value={(counts?.teams_without_tracker || 0) + (counts?.participants_without_tracker || 0)} onClick={() => onNavigate("matching")} /><Stat label="Риски" value={counts?.risks || 0} onClick={() => onNavigate("reports")} /><Stat label="События сегодня" value={counts?.today_events || 0} onClick={() => onNavigate("program")} /><Stat label="Очередь команд" value={counts?.teams_without_tracker || 0} onClick={() => onNavigate("matching")} /></div>
    <section className="workspace-card"><div className="flex items-center justify-between"><div><h3 className="text-lg">Что требует внимания</h3><p className="mt-1 text-sm text-white/35">Сводка рассчитана сервером по текущему состоянию потока.</p></div><button type="button" onClick={() => void load()} aria-label="Обновить рабочую сводку" className="rounded-full border border-white/10 p-3 text-white/45"><RefreshCw size={15} /></button></div><div className="mt-5 grid gap-4 lg:grid-cols-3"><Queue title="Участники без трекера">{summary?.participants_without_tracker.map((row) => <button type="button" key={row.membership_id} onClick={() => onOpenParticipant(row.membership_id)} className="block w-full rounded-xl border border-white/8 p-3 text-left text-sm hover:border-white/20">{row.name}</button>)}</Queue><Queue title="Риски">{summary?.risks.map((row) => <button type="button" key={row.membership_id} onClick={() => onOpenParticipant(row.membership_id)} className="block w-full rounded-xl border border-white/8 p-3 text-left text-sm hover:border-white/20"><span>{row.name}</span><span className="mt-1 block text-xs text-white/35">{row.reasons[0] || "Требует внимания"}</span></button>)}</Queue><Queue title="Сегодня">{summary?.today_events.map((row) => <button type="button" key={row.id} onClick={() => onNavigate("program")} className="block w-full rounded-xl border border-white/8 p-3 text-left text-sm hover:border-white/20">{new Date(row.starts_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} · {row.title}</button>)}</Queue></div>{summaryError && <p role="alert" className="mt-4 text-sm text-red-200">{summaryError}</p>}</section>
    <AcceleratorOperations cohortId={cohort.id} acceleratorId={accelerator.id} token={token} isAdmin={isAdmin} />
  </div>;
}

function Queue({ title, children }: { title: string; children: React.ReactNode }) { return <div><h4 className="mb-3 text-sm text-white/50">{title}</h4><div className="space-y-2">{children || <p className="text-sm text-white/30">Очередь пуста</p>}</div></div>; }

function FirstCohortSetup({ token, accelerator, onCreated }: { token: string; accelerator: Accelerator; onCreated: (cohort: Cohort) => Promise<void> }) {
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Europe/Moscow");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const cohort = await postAuthJson<Cohort>(`/api/accelerators/${accelerator.id}/cohorts`, { name: name.trim(), timezone, application_form_schema: defaultApplicationSchema(name.trim()) }, token);
      await onCreated(cohort);
    } catch (reason) { setError(describeApiError(reason, "Не удалось создать поток")); }
    finally { setBusy(false); }
  };
  return <section className="workspace-card mx-auto max-w-2xl"><p className="text-xs uppercase tracking-[.18em] text-white/30">{accelerator.name}</p><h2 className="mt-2 text-2xl">Создайте первый поток</h2><p className="mt-2 text-sm text-white/40">Базовая анкета и обязательные разделы будут подготовлены автоматически. Остальные функции можно включить после создания.</p><form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2"><Label text="Название потока"><input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} placeholder="Например, Осень 2026" className="workspace-input mt-2" /></Label><Label text="Часовой пояс"><input value={timezone} onChange={(event) => setTimezone(event.target.value)} required placeholder="Europe/Moscow" className="workspace-input mt-2" /></Label><button disabled={busy || name.trim().length < 2} className="workspace-button sm:col-span-2 sm:justify-self-start">{busy && <Loader2 size={15} className="animate-spin" />} Создать поток</button></form>{error && <p role="alert" className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}</section>;
}

function SettingsPanel({ token, isAdmin, accelerator, cohort, config, onConfig, onCohort, onAccelerator, onCohortCreated }: { token: string; isAdmin: boolean; accelerator: Accelerator; cohort: Cohort; config: ProgramConfig | null; onConfig: (row: ProgramConfig) => void; onCohort: (row: Cohort) => void; onAccelerator: (row: Partial<Accelerator> & { id: number }) => void; onCohortCreated: (row: Cohort) => Promise<void> }) {
  const [acceleratorName, setAcceleratorName] = useState(accelerator.name); const [description, setDescription] = useState(accelerator.description || ""); const [cohortName, setCohortName] = useState(cohort.name); const [timezone, setTimezone] = useState(cohort.timezone || "Europe/Moscow"); const [startsAt, setStartsAt] = useState(toLocal(cohort.starts_at)); const [endsAt, setEndsAt] = useState(toLocal(cohort.ends_at)); const [newCohortName, setNewCohortName] = useState(""); const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  useEffect(() => { setAcceleratorName(accelerator.name); setDescription(accelerator.description || ""); }, [accelerator]);
  useEffect(() => { setCohortName(cohort.name); setTimezone(cohort.timezone || "Europe/Moscow"); setStartsAt(toLocal(cohort.starts_at)); setEndsAt(toLocal(cohort.ends_at)); }, [cohort]);
  const updateModule = async (key: string, value: boolean) => { if (!config) return; setBusy(`module-${key}`); try { onConfig(await patchAuthJson<ProgramConfig>(`/api/accelerators/cohorts/${cohort.id}/program-config`, { version: config.version, modules: { [key]: value } }, token)); } catch (reason) { setError(describeApiError(reason, "Не удалось изменить модуль")); } finally { setBusy(""); } };
  const saveAccelerator = async () => { setBusy("accelerator"); setError(""); try { onAccelerator(await patchAuthJson<Partial<Accelerator> & { id: number }>(`/api/accelerators/${accelerator.id}`, { name: acceleratorName, description }, token)); } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить акселератор")); } finally { setBusy(""); } };
  const saveCohort = async () => { setBusy("cohort"); setError(""); try { onCohort(await patchAuthJson<Cohort>(`/api/accelerators/cohorts/${cohort.id}`, { name: cohortName, timezone, starts_at: startsAt || null, ends_at: endsAt || null }, token)); } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить поток")); } finally { setBusy(""); } };
  const statusChange = async (next: string) => { if (!window.confirm(`Изменить статус потока на «${STATUS_LABELS[next]}»?`)) return; setBusy("status"); try { onCohort(await patchAuthJson<Cohort>(`/api/accelerators/cohorts/${cohort.id}/status`, { status: next }, token)); } catch (reason) { setError(describeApiError(reason, "Не удалось изменить статус")); } finally { setBusy(""); } };
  const createCohort = async (event: FormEvent) => { event.preventDefault(); setBusy("new-cohort"); try { const created = await postAuthJson<Cohort>(`/api/accelerators/${accelerator.id}/cohorts`, { name: newCohortName, timezone: "Europe/Moscow", application_form_schema: defaultApplicationSchema(newCohortName) }, token); setNewCohortName(""); await onCohortCreated(created); } catch (reason) { setError(describeApiError(reason, "Не удалось создать поток")); } finally { setBusy(""); } };
  return <div className="space-y-6"><section className="workspace-card"><h2 className="text-xl">Настройки акселератора</h2><p className="mt-1 text-sm text-white/40">Название и описание относятся ко всем потокам.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><Label text="Название"><input value={acceleratorName} onChange={(event) => setAcceleratorName(event.target.value)} className="workspace-input mt-2" /></Label><Label text="Описание"><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="workspace-input mt-2 resize-y" /></Label></div><button type="button" onClick={() => void saveAccelerator()} disabled={Boolean(busy)} className="workspace-button mt-5">Сохранить акселератор</button></section>
    <section className="workspace-card"><h2 className="text-xl">Настройки текущего потока</h2><p className="mt-1 text-sm text-white/40">Название, расписание и часовой пояс действуют только для выбранного потока.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><Label text="Поток"><input value={cohortName} onChange={(event) => setCohortName(event.target.value)} className="workspace-input mt-2" /></Label><Label text="Часовой пояс"><input list="accelerator-timezones" value={timezone} onChange={(event) => setTimezone(event.target.value)} className="workspace-input mt-2" /><datalist id="accelerator-timezones"><option value="Europe/Moscow" /><option value="Asia/Yekaterinburg" /><option value="Asia/Novosibirsk" /><option value="Asia/Vladivostok" /><option value="Europe/London" /><option value="UTC" /></datalist></Label><Label text="Начало"><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="workspace-input mt-2" /></Label><Label text="Окончание"><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className="workspace-input mt-2" /></Label></div><button type="button" onClick={() => void saveCohort()} disabled={Boolean(busy)} className="workspace-button mt-5">Сохранить поток</button></section>
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
function EmptyState({ isAdmin, onCreate }: { isAdmin: boolean; onCreate: () => void }) { return <section className="workspace-card py-12 text-center"><LayoutDashboard className="mx-auto mb-4 text-white/25" size={38} /><h2 className="text-2xl">Нет доступных акселераторов</h2><p className="mx-auto mt-3 max-w-lg text-white/40">{isAdmin ? "Создайте первый акселератор — мастер сразу подготовит организацию, поток, анкету, функции и лимиты." : "Главный администратор должен назначить вас организатором или зачислить резидентом."}</p>{isAdmin && <button type="button" onClick={onCreate} className="workspace-button mt-6">Начать настройку</button>}</section>; }
function Empty({ icon: Icon, title, text, children }: { icon: typeof Rocket; title: string; text: string; children?: React.ReactNode }) { return <main className="min-h-[100dvh] grid place-items-center bg-black px-5 text-white"><section className="max-w-lg text-center"><Icon className="mx-auto mb-5 text-white/35" size={42} /><h1 className="mb-4 text-3xl">{title}</h1><p className="mb-8 text-white/45">{text}</p>{children}</section></main>; }
