"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LayoutDashboard, Loader2, LogIn, Menu, X, RefreshCw, Rocket, Settings2 } from "lucide-react";

import { describeApiError, getAuthJson, getMe, patchAuthJson, postAuthJson, type UserResponse } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { AcceleratorSetupWizard } from "@/components/accelerator/AcceleratorSetupWizard";
import { ApplicationFormEditor, type ApplicationFormSchema } from "@/components/accelerator/ApplicationFormEditor";
import { ApplicationManager, type AcceleratorApplication } from "@/components/accelerator/ApplicationManager";
import { AttendanceManager } from "@/components/accelerator/AttendanceManager";
import { AuditLog } from "@/components/accelerator/AuditLog";
import { HomeworkWorkspace } from "@/components/accelerator/HomeworkWorkspace";
import { OrganizerManager } from "@/components/accelerator/OrganizerManager";
import { ProgramBuilder } from "@/components/accelerator/ProgramBuilder";
import { QuotaManager, type Limits } from "@/components/accelerator/QuotaManager";
import { ResidentWorkspace, type ResidentWorkspaceData } from "@/components/accelerator/ResidentWorkspace";
import { ResidentReport } from "@/components/accelerator/ResidentReport";
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
import { TrackingDashboard } from "@/components/accelerator/TrackingDashboard";
import { BulkTrackingTaskForm } from "@/components/accelerator/BulkTrackingTaskForm";
import { participantMemberships, preferredParticipantMembership, staffAccelerators } from "@/lib/acceleratorAccess";

import { OrganizerOverview } from "@/components/accelerator/OrganizerOverview";
import { OrganizerNavigation } from "@/components/accelerator/OrganizerNavigation";
import { PitchyLogo } from "@/components/shared/PitchyLogo";

type Accelerator = { id: number; name: string; description?: string | null; status: string; access_role: "global_admin" | "organizer" | "tracker" | "expert" | "resident" };
type Cohort = { id: number; accelerator_id: number; name: string; status: string; timezone: string; starts_at?: string | null; ends_at?: string | null; default_quota_config?: Limits | null; application_form_schema: ApplicationFormSchema; homework_pitchy_enabled: boolean };
type ProgramConfig = { cohort_id: number; version: number; modules: Record<string, boolean>; locked_modules: Record<string, boolean> };
type Resident = { membership_id: number; user_id: number; name: string; email: string; status: string; status_reason?: string | null; trackers?: Array<{ user_id: number; name: string }> };
type TabKey = "overview" | "operations" | "applications" | "form" | "program" | "homework" | "attendance" | "trackers" | "reports" | "tracking" | "matching" | "project_audit" | "demo_day" | "artifacts" | "closure" | "quotas" | "settings" | "audit";
type SettingsPanelKey = "cohort-general" | "cohort-modules" | "cohort-status" | "accelerator-general" | "cohorts" | "organizers" | "quotas" | "system-health" | "audit-log";

const MODULE_LABELS: Record<string, string> = { applications: "Заявки", program: "Программа", homework: "Домашние задания", attendance: "Посещаемость", progress_tracking: "Трекинг прогресса", matchmaking: "Матчмейкинг", project_audit: "Аудит проекта", demo_day: "Демо-день и экспорт", pitchy_artifacts: "Результаты Pitchy", alumni: "Каталог выпускников" };
const STATUS_LABELS: Record<string, string> = { draft: "Черновик", accepting: "Приём заявок", active: "Идёт", completed: "Завершён", archived: "Архив", accepted: "Принят", enrolled: "Зачислен" };
const STATUS_TRANSITIONS: Record<string, string[]> = { draft: ["accepting", "archived"], accepting: ["draft", "active", "archived"], active: ["archived"], completed: ["archived"], archived: [] };

export default function AcceleratorWorkspacePage() {
  const router = useRouter();
  const { token, isLoaded } = useAuth();
  const [accelerators, setAccelerators] = useState<Accelerator[]>([]); const [profile, setProfile] = useState<UserResponse | null>(null); const [acceleratorId, setAcceleratorId] = useState<number | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[]>([]); const [cohortId, setCohortId] = useState<number | null>(null); const [config, setConfig] = useState<ProgramConfig | null>(null);
  const [applications, setApplications] = useState<AcceleratorApplication[]>([]); const [residents, setResidents] = useState<Resident[]>([]); const [residentWorkspace, setResidentWorkspace] = useState<ResidentWorkspaceData | null>(null);
  const [tab, setTab] = useState<TabKey>("overview"); const [showSetup, setShowSetup] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [copied, setCopied] = useState(false);
  const [selectedMembershipId, setSelectedMembershipId] = useState<number | null>(null); const [reportQuery, setReportQuery] = useState(""); const [reportStatus, setReportStatus] = useState("all"); const [urlReady, setUrlReady] = useState(false);
  const [trackingVersion, setTrackingVersion] = useState(0);
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanelKey>("cohort-general");

  const [refreshKey, setRefreshKey] = useState(0);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [targetId, setTargetId] = useState<number>();
  const detailRequest = useRef(0);
  const navigate = (next: TabKey, target?: number) => {
    const legacyPanels: Partial<Record<TabKey, SettingsPanelKey>> = { operations: "system-health", quotas: "quotas", audit: "audit-log", closure: "cohort-status" };
    if (legacyPanels[next]) { setSettingsPanel(legacyPanels[next]!); setTab("settings"); }
    else setTab(next);
    setTargetId(target); setMobileMenu(false);
  };


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const savedTab = params.get("section") as TabKey | null;
    if (savedTab) {
      const legacyPanels: Partial<Record<TabKey, SettingsPanelKey>> = { operations: "system-health", quotas: "quotas", audit: "audit-log", closure: "cohort-status" };
      if (legacyPanels[savedTab]) { setTab("settings"); setSettingsPanel(legacyPanels[savedTab]!); }
      else setTab(savedTab === "trackers" ? "matching" : savedTab);
    }
    const requestedPanel = params.get("panel") as SettingsPanelKey | null;
    if (requestedPanel) setSettingsPanel(requestedPanel);
    const savedAccelerator = Number(params.get("accelerator")); if (savedAccelerator > 0) setAcceleratorId(savedAccelerator);
    const savedCohort = Number(params.get("cohort")); if (savedCohort > 0) setCohortId(savedCohort);
    const savedResident = Number(params.get("resident")); if (savedResident > 0) setSelectedMembershipId(savedResident);
    setReportQuery(params.get("q") || ""); setReportStatus(params.get("status") || "all"); setUrlReady(true);
  }, []);
  useEffect(() => {
    if (!urlReady || loading) return;
    if (window.location.pathname !== "/accelerator") return;
    const params = new URLSearchParams(window.location.search);
    params.set("section", tab);
    if (tab === "settings") params.set("panel", settingsPanel); else params.delete("panel");
    if (acceleratorId) params.set("accelerator", String(acceleratorId)); else params.delete("accelerator");
    if (cohortId) params.set("cohort", String(cohortId)); else params.delete("cohort");
    if (selectedMembershipId) params.set("resident", String(selectedMembershipId)); else params.delete("resident");
    if (tab === "reports" && reportQuery) params.set("q", reportQuery); else params.delete("q");
    if (tab === "reports" && reportStatus !== "all") params.set("status", reportStatus); else params.delete("status");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
  }, [acceleratorId, cohortId, loading, reportQuery, reportStatus, selectedMembershipId, settingsPanel, tab, urlReady]);

  const selectedAccelerator = accelerators.find((row) => row.id === acceleratorId) || null;
  const selectedCohort = cohorts.find((row) => row.id === cohortId) || null;
  const selectedResidentMembership = residentWorkspace?.memberships.find((membership) => membership.accelerator.id === acceleratorId) || null;
  const isResident = selectedAccelerator?.access_role === "resident";
  const isAdmin = Boolean(profile?.is_admin); const isTracker = !isResident && selectedAccelerator?.access_role === "tracker"; const isExpert = !isResident && selectedAccelerator?.access_role === "expert"; const canManage = !isResident && (selectedAccelerator?.access_role === "global_admin" || selectedAccelerator?.access_role === "organizer"); const canReadCohort = canManage || isTracker || isExpert;

  const loadAccelerators = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    let redirecting = false;
    try {
      const [rows, user, workspace] = await Promise.all([getAuthJson<Accelerator[]>("/api/accelerators", token), getMe(token), getAuthJson<ResidentWorkspaceData>("/api/accelerators/me/memberships", token)]);
      const participantMembership = preferredParticipantMembership(workspace.memberships);
      const participantRows = participantMemberships(workspace.memberships);
      const requestedStaffContext = new URLSearchParams(window.location.search).get("context") === "staff";
      const serviceRows = staffAccelerators(rows);
      const canOpenStaffContext = Boolean(user.is_admin || serviceRows.length);
      if (participantMembership && participantRows.length === 1 && (!requestedStaffContext || !canOpenStaffContext)) {
        redirecting = true;
        router.replace(`/accelerator/my/${participantMembership.membership_id}`);
        return;
      }
      const visibleRows = requestedStaffContext ? serviceRows : rows;
      setAccelerators(visibleRows); setProfile(user); setResidentWorkspace(workspace); setShowSetup(Boolean(user.is_admin && !visibleRows.length));
      setAcceleratorId((current) => {
        if (current && visibleRows.some((row) => row.id === current)) return current;
        const needsChoice = requestedStaffContext ? visibleRows.length > 1 : participantRows.length > 1 || visibleRows.length > 1;
        return needsChoice ? null : visibleRows[0]?.id || null;
      });
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить акселераторы")); }
    finally { if (!redirecting) setLoading(false); }
  }, [router, token]);
  useEffect(() => { void loadAccelerators(); }, [loadAccelerators]);

  useEffect(() => {
    let active = true;
    if (!token || !acceleratorId || isResident) { setCohorts([]); setCohortId(null); return () => { active = false; }; }
    setCohorts([]);
    getAuthJson<Cohort[]>(`/api/accelerators/${acceleratorId}/cohorts`, token).then((rows) => {
      if (!active) return;
      setCohorts(rows); setCohortId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || null);
    }).catch((reason) => { if (active) setError(describeApiError(reason, "Не удалось загрузить потоки")); });
    return () => { active = false; };
  }, [acceleratorId, isResident, token]);

  const loadCohortDetails = useCallback(async () => {
    const request = ++detailRequest.current;
    if (!token || !cohortId || !canReadCohort) { setConfig(null); setApplications([]); setResidents([]); return; }
    try {
      const [program, applicationRows, residentRows] = await Promise.all([
        getAuthJson<ProgramConfig>(`/api/accelerators/cohorts/${cohortId}/program-config`, token),
        canManage ? getAuthJson<AcceleratorApplication[]>(`/api/accelerators/cohorts/${cohortId}/applications`, token) : Promise.resolve([]),
        isExpert ? Promise.resolve([]) : getAuthJson<Resident[]>(`/api/accelerators/cohorts/${cohortId}/residents`, token),
      ]);
      if (request !== detailRequest.current) return;
      setConfig(program); setApplications(applicationRows); setResidents(residentRows); setError("");
    } catch (reason) { if (request === detailRequest.current) setError(describeApiError(reason, "Не удалось загрузить данные потока")); }
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
    const rows: Array<{ key: TabKey; label: string }> = [{ key: "overview", label: "Обзор" }, { key: "applications", label: "Заявки" }, { key: "form", label: "Анкета" }, { key: "program", label: "Программа" }];
    if (config?.modules.homework) rows.push({ key: "homework", label: "Домашние задания" });
    if (config?.modules.attendance) rows.push({ key: "attendance", label: "Посещаемость" });
    if (config?.modules.progress_tracking) rows.push({ key: "tracking", label: "Трекинг" });
    if (config?.modules.matchmaking) rows.push({ key: "matching", label: "Матчмейкинг" });
    if (config?.modules.project_audit) rows.push({ key: "project_audit", label: "Аудит проекта" });
    if (config?.modules.demo_day) rows.push({ key: "demo_day", label: "Демо-день" });
    if (config?.modules.pitchy_artifacts) rows.push({ key: "artifacts", label: "Результаты Pitchy" });
    rows.push({ key: "reports", label: "Отчётность" });
    rows.push({ key: "settings", label: "Настройки" }); return rows;
  }, [config, isExpert, isTracker]);
  useEffect(() => { if (!tabs.some((item) => item.key === tab)) setTab(tabs[0]?.key || "overview"); }, [tab, tabs]);

  const copyApplicationLink = async () => { if (!cohortId) return; try { await navigator.clipboard.writeText(`${window.location.origin}/accelerators/apply/${cohortId}`); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setError("Не удалось скопировать ссылку. Откройте её в разделе «Анкета»."); } };

  if (!isLoaded || (token && loading)) return <main className="min-h-[100dvh] grid place-items-center bg-black text-white"><Loader2 className="animate-spin text-white/40" /></main>;
  if (!token) return <Empty icon={LogIn} title="Нужно войти" text="Пространство акселератора доступно после авторизации."><Link href="/login?next=/accelerator" className="workspace-button">Войти</Link></Empty>;

  return <main className={`min-h-[100dvh] text-white ${canManage ? "organizer-shell" : "bg-black px-4 py-7 sm:px-8 sm:py-10"}`}><div className={canManage ? "" : "mx-auto max-w-7xl"}>
    <header className={canManage ? "organizer-header" : "mb-7 flex flex-wrap items-center justify-between gap-4"}>
      <div className="flex items-center gap-3">{canManage && <button type="button" onClick={() => setMobileMenu(value => !value)} className="p-2 lg:hidden" aria-label={mobileMenu ? "Закрыть меню" : "Открыть меню"} aria-expanded={mobileMenu}>{mobileMenu ? <X size={20} /> : <Menu size={20} />}</button>}<Link href="/dashboard" aria-label="В дашборд Pitchy"><PitchyLogo size="2xl" /></Link><span className="hidden text-white/25 sm:inline">/</span><span className="hidden text-sm text-white/55 sm:inline">Акселератор</span></div>
      {canManage && <div className="organizer-context"><label><span className="sr-only">Акселератор</span><select aria-label="Акселератор" value={acceleratorId || ""} onChange={event => { setAcceleratorId(Number(event.target.value)); setCohorts([]); setCohortId(null); setConfig(null); setApplications([]); setResidents([]); navigate("overview"); }} className="workspace-input">{accelerators.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label><span className="sr-only">Поток</span><select aria-label="Поток" value={cohortId || ""} onChange={event => { setCohortId(Number(event.target.value)); setConfig(null); setApplications([]); setResidents([]); navigate("overview"); }} disabled={!cohorts.length} className="workspace-input">{cohorts.length ? cohorts.map(row => <option key={row.id} value={row.id}>{row.name}</option>) : <option value="">Нет потоков</option>}</select></label></div>}
      <div className="flex items-center gap-2">{canManage && <span className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/65 xl:inline">{isAdmin ? "Главный администратор" : "Организатор"}</span>}{isAdmin && <button type="button" onClick={() => setShowSetup(value => !value)} className="overview-secondary !py-2">{showSetup ? "Закрыть мастер" : "Новый акселератор"}</button>}{selectedResidentMembership && <Link href={`/accelerator/my/${selectedResidentMembership.membership_id}`} className="overview-secondary">Моё участие</Link>}<NotificationCenter token={token} /><button type="button" onClick={() => { setRefreshKey(value => value + 1); void (isResident ? loadAccelerators() : loadCohortDetails()); }} className="rounded-full border border-white/10 p-3 text-white/55" aria-label="Обновить"><RefreshCw size={17} /></button></div>
    </header>
    {canManage && <aside className={`organizer-sidebar ${mobileMenu ? "is-mobile-open" : ""}`}><OrganizerNavigation tabs={tabs} active={tab} onNavigate={navigate} /><Link href="/accelerators" className="mt-6 block px-4 text-xs text-white/40 hover:text-white">← Все акселераторы</Link></aside>}
    <div className={canManage ? "organizer-content" : ""}>
    {error && <div role="alert" className="mb-6 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</div>}
    {showSetup && isAdmin && <div className="mb-7"><AcceleratorSetupWizard token={token} onCancel={accelerators.length ? () => setShowSetup(false) : undefined} onCreated={async (result) => { await loadAccelerators(); setAcceleratorId(result.accelerator.id); setCohortId(result.cohort.id); setShowSetup(false); setTab("overview"); }} /></div>}
    {!accelerators.length && !showSetup ? <EmptyState isAdmin={isAdmin} onCreate={() => setShowSetup(true)} /> : accelerators.length > 0 && !acceleratorId ? <AcceleratorPortfolio accelerators={accelerators} memberships={participantMemberships(residentWorkspace?.memberships || [])} staffContext={urlReady && new URLSearchParams(window.location.search).get("context") === "staff"} onOpenStaff={(id) => setAcceleratorId(id)} /> : accelerators.length > 0 && <>
      {!canManage && <div className={`mb-6 grid gap-3 ${isResident ? "" : "md:grid-cols-2"}`}><SelectCard label="Акселератор"><select value={acceleratorId || ""} onChange={(event) => { setAcceleratorId(Number(event.target.value)); setTab("overview"); }} className="workspace-input">{accelerators.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><p className="mt-2 text-xs text-white/35">Роль: {selectedAccelerator?.access_role === "tracker" ? "трекер" : selectedAccelerator?.access_role === "expert" ? "эксперт" : "резидент"}</p></SelectCard>{!isResident && <SelectCard label="Поток"><select value={cohortId || ""} onChange={(event) => { setCohortId(Number(event.target.value)); setTab("overview"); }} className="workspace-input" disabled={!cohorts.length}>{cohorts.length ? cohorts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>) : <option value="">Нет назначенных потоков</option>}</select>{selectedCohort && <p className="mt-2 text-xs text-white/35">{STATUS_LABELS[selectedCohort.status] || selectedCohort.status}</p>}</SelectCard>}</div>}
      {isResident && acceleratorId && <ResidentWorkspace acceleratorId={acceleratorId} data={residentWorkspace} onChanged={loadAccelerators} />}
      {!isResident && canReadCohort && selectedCohort && <>
        {!canManage && <nav className="mb-6 flex gap-2 overflow-x-auto pb-2" aria-label="Разделы акселератора">{tabs.map((item) => <button type="button" key={item.key} onClick={() => setTab(item.key)} className={`shrink-0 rounded-full border px-4 py-2 text-sm ${tab === item.key ? "border-white bg-white text-black" : "border-white/10 text-white/50 hover:text-white"}`}>{item.label}</button>)}</nav>}
        {canManage && tab !== "overview" && <div className="mb-5 flex flex-wrap items-center gap-3"><button type="button" onClick={() => navigate("overview")} className="text-xs text-white/50 hover:text-white">← Обзор потока</button><span className="text-white/20">/</span><span className="text-sm text-white/70">{tabs.find(item => item.key === tab)?.label}</span><span className="ml-auto text-xs text-white/35">{selectedCohort.name}</span></div>}
        {tab === "overview" && canManage && (config ? <OrganizerOverview key={selectedCohort.id} token={token} cohort={selectedCohort} config={config} applications={applications} residents={residents} onCopy={copyApplicationLink} copied={copied} onNavigate={navigate} onOpenParticipant={setSelectedMembershipId} refreshKey={refreshKey} /> : <section className="workspace-card grid min-h-56 place-items-center"><Loader2 className="animate-spin text-white/40" /></section>)}
        {tab === "applications" && <ApplicationManager token={token} applications={applications} schema={selectedCohort.application_form_schema || {}} cohortName={selectedCohort.name} publicUrl={"/accelerators/apply/" + selectedCohort.id} onChanged={loadCohortDetails} />}
        {tab === "form" && <ApplicationFormEditor key={selectedCohort.id} schema={selectedCohort.application_form_schema || {}} cohortId={selectedCohort.id} token={token} publicUrl={`/accelerators/apply/${selectedCohort.id}`} cohortStatus={selectedCohort.status} onSettings={() => navigate("settings")} onApplications={() => navigate("applications")} onPublished={loadCohortDetails} />}
        {tab === "program" && <ProgramBuilder focusId={targetId} cohortId={selectedCohort.id} token={token} />}
        {tab === "homework" && config?.modules.homework && <HomeworkWorkspace focusId={targetId} cohortId={selectedCohort.id} token={token} residents={residents} isAdmin={isAdmin} pitchyEnabled={selectedCohort.homework_pitchy_enabled} />}
        {tab === "attendance" && config?.modules.attendance && (canManage ? <AttendanceManager focusId={tab === "attendance" ? targetId : undefined} cohortId={selectedCohort.id} token={token} /> : <TrackerAttendance cohortId={selectedCohort.id} token={token} />)}
        {tab === "matching" && config?.modules.matchmaking && (canManage ? <MatchmakingManager cohortId={selectedCohort.id} token={token} residents={residents} /> : <MatchmakingWorkspace cohortId={selectedCohort.id} />)}
        {tab === "project_audit" && config?.modules.project_audit && <ProjectAuditWorkspace cohortId={selectedCohort.id} residents={residents} token={token} canCreateTasks taskIntegrationEnabled={Boolean(config.modules.progress_tracking)} />}
        {tab === "demo_day" && config?.modules.demo_day && <DemoDayWorkspace cohortId={selectedCohort.id} residents={residents} token={token} canManage={canManage} />}
        {tab === "artifacts" && config?.modules.pitchy_artifacts && <ArtifactWorkspace cohortId={selectedCohort.id} token={token} />}
        {tab === "reports" && <ResidentReport token={token} cohortId={selectedCohort.id} canManage={canManage} onChanged={loadCohortDetails} onOpenParticipant={setSelectedMembershipId} initialQuery={reportQuery} initialStatus={reportStatus} onFiltersChange={(query, status) => { setReportQuery(query); setReportStatus(status); }} />}
        {tab === "tracking" && config?.modules.progress_tracking && <TrackingDashboard key={trackingVersion} cohortId={selectedCohort.id} token={token} onOpenParticipant={setSelectedMembershipId} headerAction={<BulkTrackingTaskForm cohortId={selectedCohort.id} token={token} onCreated={() => setTrackingVersion((value) => value + 1)} />} />}
        {tab === "settings" && <SettingsPanel token={token} isAdmin={isAdmin} accelerator={selectedAccelerator} cohort={selectedCohort} cohorts={cohorts} residents={residents} config={config} panel={settingsPanel} onPanel={setSettingsPanel} onConfig={setConfig} onCohort={(updated) => setCohorts((rows) => rows.map((row) => row.id === updated.id ? updated : row))} onSelectCohort={(id) => setCohortId(id)} onAccelerator={(updated) => setAccelerators((rows) => rows.map((row) => row.id === updated.id ? { ...row, ...updated } : row))} onCohortCreated={async (created) => { const rows = await getAuthJson<Cohort[]>(`/api/accelerators/${selectedAccelerator.id}/cohorts`, token); setCohorts(rows); setCohortId(created.id); setSettingsPanel("cohort-general"); }} onCompleted={async () => { await loadAccelerators(); await loadCohortDetails(); }} />}
        {selectedMembershipId && <ParticipantDrawer membershipId={selectedMembershipId} token={token} onClose={() => setSelectedMembershipId(null)} onChanged={loadCohortDetails} />}
      </>}
      {!isResident && canManage && !selectedCohort && selectedAccelerator && <FirstCohortSetup token={token} accelerator={selectedAccelerator} onCreated={async (created) => { const rows = await getAuthJson<Cohort[]>(`/api/accelerators/${selectedAccelerator.id}/cohorts`, token); setCohorts(rows); setCohortId(created.id); setTab("overview"); }} />}
    </>}
  </div></div><style jsx global>{`.workspace-card{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.025);border-radius:1.5rem;padding:1.25rem}.workspace-input{width:100%;border-radius:1rem;border:1px solid rgba(255,255,255,.12);background:#111;padding:.75rem 1rem;color:#fff;outline:none}.workspace-input option{color:#fff;background:#111}.workspace-button{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border-radius:999px;background:#fff;padding:.7rem 1rem;color:#000;font-size:.875rem;font-weight:600}.workspace-button:disabled{opacity:.45}.organizer-shell{background:#141313;color:#e5e2e1}.organizer-header{display:flex;align-items:center;flex-wrap:wrap;gap:20px;padding:16px 24px;min-height:80px;border-bottom:1px solid rgba(255,255,255,.08);background:#141313;position:relative;z-index:30}.organizer-header>div:last-child{margin-left:auto}.organizer-context{display:flex;gap:12px;flex:1;min-width:0}.organizer-context label{min-width:0;max-width:240px;flex:1}.organizer-context select{border-radius:10px;font-size:13px;background:#1c1b1b;padding:10px 12px}.organizer-sidebar{position:absolute;top:80px;bottom:0;left:0;width:236px;padding:24px 12px;border-right:1px solid rgba(255,255,255,.08);background:#141313;min-height:calc(100dvh - 80px)}.organizer-shell{position:relative}.organizer-navigation{display:flex;flex-direction:column;gap:8px}.organizer-nav-item{display:flex;align-items:center;gap:12px;width:100%;padding:14px 12px;border-radius:10px;text-align:left;font-size:13px;color:#aaa7a6}.organizer-nav-item:hover,.organizer-subnav button:hover{background:rgba(255,255,255,.04);color:white}.organizer-nav-item.is-active{background:#2a2a2a;color:white}.organizer-subnav{margin:8px 0 8px 21px;border-left:1px solid rgba(255,255,255,.1);padding-left:12px;display:flex;flex-direction:column;gap:3px}.organizer-subnav button{text-align:left;padding:9px 10px;border-radius:8px;font-size:12px;color:#aaa7a6}.organizer-subnav button.is-active{color:white;background:rgba(255,255,255,.06)}.organizer-settings-group{margin-top:40px}.organizer-content{margin-left:236px;padding:32px;min-width:0;max-width:1700px}.organizer-shell .workspace-button{border-radius:12px}.organizer-shell button:focus-visible,.organizer-shell a:focus-visible,.organizer-shell select:focus-visible{outline:2px solid white;outline-offset:3px}.organizer-shell .dashboard-focus{outline:1px solid rgba(255,255,255,.6);scroll-margin-top:24px}.organizer-shell .overview-secondary{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:11px 14px;font-size:13px}@media(max-width:1023px){.organizer-sidebar{display:none}.organizer-sidebar.is-mobile-open{display:block;position:relative;top:0;width:100%;border-bottom:1px solid rgba(255,255,255,.1);min-height:0}.organizer-content{margin-left:0;padding:24px}.organizer-settings-group{margin-top:12px}}@media(max-width:640px){.organizer-header{padding:12px;gap:12px}.organizer-context{order:3;flex-basis:100%}.organizer-content{padding:20px 14px}.organizer-header .overview-secondary{font-size:11px;padding:8px}.organizer-header>div:last-child{gap:4px}}`}</style></main>;
}

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


function SettingsPanel({ token, isAdmin, accelerator, cohort, cohorts, residents, config, panel, onPanel, onConfig, onCohort, onSelectCohort, onAccelerator, onCohortCreated, onCompleted }: { token: string; isAdmin: boolean; accelerator: Accelerator; cohort: Cohort; cohorts: Cohort[]; residents: Resident[]; config: ProgramConfig | null; panel: SettingsPanelKey; onPanel: (panel: SettingsPanelKey) => void; onConfig: (row: ProgramConfig) => void; onCohort: (row: Cohort) => void; onSelectCohort: (id: number) => void; onAccelerator: (row: Partial<Accelerator> & { id: number }) => void; onCohortCreated: (row: Cohort) => Promise<void>; onCompleted: () => Promise<void> }) {
  const [acceleratorName, setAcceleratorName] = useState(accelerator.name); const [description, setDescription] = useState(accelerator.description || ""); const [cohortName, setCohortName] = useState(cohort.name); const [timezone, setTimezone] = useState(cohort.timezone || "Europe/Moscow"); const [startsAt, setStartsAt] = useState(toLocal(cohort.starts_at)); const [endsAt, setEndsAt] = useState(toLocal(cohort.ends_at)); const [newCohortName, setNewCohortName] = useState(""); const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  useEffect(() => { setAcceleratorName(accelerator.name); setDescription(accelerator.description || ""); }, [accelerator]);
  useEffect(() => { setCohortName(cohort.name); setTimezone(cohort.timezone || "Europe/Moscow"); setStartsAt(toLocal(cohort.starts_at)); setEndsAt(toLocal(cohort.ends_at)); }, [cohort]);
  const updateModule = async (key: string, value: boolean) => { if (!config || !isAdmin) return; if (!value && !window.confirm("Раздел будет скрыт у организаторов и участников. Существующие данные сохранятся. Продолжить?")) return; setBusy(`module-${key}`); setError(""); try { onConfig(await patchAuthJson<ProgramConfig>(`/api/accelerators/cohorts/${cohort.id}/program-config`, { version: config.version, modules: { [key]: value } }, token)); } catch (reason) { setError(describeApiError(reason, "Не удалось изменить раздел")); } finally { setBusy(""); } };
  const saveAccelerator = async () => { setBusy("accelerator"); setError(""); try { onAccelerator(await patchAuthJson<Partial<Accelerator> & { id: number }>(`/api/accelerators/${accelerator.id}`, { name: acceleratorName, description }, token)); } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить акселератор")); } finally { setBusy(""); } };
  const saveCohort = async () => { setBusy("cohort"); setError(""); try { onCohort(await patchAuthJson<Cohort>(`/api/accelerators/cohorts/${cohort.id}`, { name: cohortName, timezone, starts_at: startsAt || null, ends_at: endsAt || null }, token)); } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить поток")); } finally { setBusy(""); } };
  const statusChange = async (next: string) => { if (!window.confirm(`Изменить статус потока на «${STATUS_LABELS[next]}»?`)) return; setBusy("status"); try { onCohort(await patchAuthJson<Cohort>(`/api/accelerators/cohorts/${cohort.id}/status`, { status: next }, token)); } catch (reason) { setError(describeApiError(reason, "Не удалось изменить статус")); } finally { setBusy(""); } };
  const createCohort = async (event: FormEvent) => { event.preventDefault(); setBusy("new-cohort"); try { const created = await postAuthJson<Cohort>(`/api/accelerators/${accelerator.id}/cohorts`, { name: newCohortName, timezone: "Europe/Moscow", application_form_schema: defaultApplicationSchema(newCohortName) }, token); setNewCohortName(""); await onCohortCreated(created); } catch (reason) { setError(describeApiError(reason, "Не удалось создать поток")); } finally { setBusy(""); } };
  const dirtyCohort = cohortName !== cohort.name || timezone !== (cohort.timezone || "Europe/Moscow") || startsAt !== toLocal(cohort.starts_at) || endsAt !== toLocal(cohort.ends_at);
  const dirtyAccelerator = acceleratorName !== accelerator.name || description !== (accelerator.description || "");
  const dirty = panel === "cohort-general" ? dirtyCohort : panel === "accelerator-general" ? dirtyAccelerator : false;
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const switchPanel = (next: SettingsPanelKey) => { if (dirty && !window.confirm("Есть несохранённые изменения. Перейти без сохранения?")) return; onPanel(next); setError(""); };
  const groups: Array<{ label: string; items: Array<{ key: SettingsPanelKey; label: string }> }> = [
    { label: "Текущий поток", items: [{ key: "cohort-general", label: "Основное" }, ...(isAdmin ? [{ key: "cohort-modules" as const, label: "Разделы платформы" }] : []), { key: "cohort-status", label: "Статус потока" }] },
    { label: "Акселератор", items: [{ key: "accelerator-general", label: "Общие сведения" }, { key: "cohorts", label: "Потоки" }, ...(isAdmin ? [{ key: "organizers" as const, label: "Организаторы" }] : [])] },
    { label: "Администрирование", items: [...(isAdmin ? [{ key: "quotas" as const, label: "Лимиты" }] : []), { key: "system-health", label: "Состояние системы" }, { key: "audit-log", label: "Журнал действий" }] },
  ];
  const scope = panel.startsWith("cohort-") || panel === "quotas" || panel === "system-health" ? `Изменения относятся к потоку «${cohort.name}»` : panel === "audit-log" ? `Журнал акселератора «${accelerator.name}»` : `Изменения повлияют на все потоки акселератора «${accelerator.name}»`;
  const transitionLabel: Record<string, string> = { draft: "Вернуть в черновик", accepting: "Открыть приём заявок", active: "Запустить программу", archived: "Переместить в архив" };
  return <div>
    <div className="mb-6"><h1 className="text-3xl">Настройки</h1><p className="mt-2 text-sm text-white/45">{scope}</p></div>
    <div className="grid min-w-0 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="space-y-5" aria-label="Разделы настроек">{groups.map((group) => <div key={group.label}><p className="mb-2 px-3 text-[10px] uppercase tracking-[.18em] text-white/30">{group.label}</p><div className="space-y-1">{group.items.map((item) => <button key={item.key} type="button" aria-current={panel === item.key ? "page" : undefined} onClick={() => switchPanel(item.key)} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm ${panel === item.key ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/5 hover:text-white"}`}>{item.label}</button>)}</div></div>)}</aside>
      <div className="min-w-0">
        {error && <p role="alert" className="mb-4 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
        {panel === "cohort-general" && <section className="workspace-card"><h2 className="text-xl">Основное</h2><p className="mt-1 text-sm text-white/40">Только выбранный поток: название, период и часовой пояс.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><Label text="Поток"><input value={cohortName} onChange={(event) => setCohortName(event.target.value)} className="workspace-input mt-2" /></Label><Label text="Часовой пояс"><input list="accelerator-timezones" value={timezone} onChange={(event) => setTimezone(event.target.value)} className="workspace-input mt-2" /><datalist id="accelerator-timezones"><option value="Europe/Moscow" /><option value="Asia/Yekaterinburg" /><option value="Asia/Novosibirsk" /><option value="Asia/Vladivostok" /><option value="Europe/London" /><option value="UTC" /></datalist></Label><Label text="Начало"><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="workspace-input mt-2" /></Label><Label text="Окончание"><input type="datetime-local" value={endsAt} min={startsAt || undefined} onChange={(event) => setEndsAt(event.target.value)} className="workspace-input mt-2" /></Label></div><button type="button" onClick={() => void saveCohort()} disabled={Boolean(busy) || !dirtyCohort || !cohortName.trim() || Boolean(startsAt && endsAt && endsAt < startsAt)} className="workspace-button mt-5">Сохранить изменения</button></section>}
        {panel === "cohort-modules" && isAdmin && <section className="workspace-card"><div className="mb-5 flex items-start gap-3"><Settings2 className="mt-1 text-white/45" /><div><h2 className="text-xl">Разделы платформы</h2><p className="text-sm text-white/40">Доступно только владельцам Pitchy. Организаторы не видят эту панель и не могут изменить конфигурацию через API.</p></div></div><div className="divide-y divide-white/8">{config && Object.entries(config.modules).map(([key, enabled]) => { const locked = key in config.locked_modules; return <div key={key} className="flex items-center gap-4 py-4"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{MODULE_LABELS[key] || key}</p><p className="mt-1 text-xs text-white/35">{locked ? "Обязательный раздел потока" : enabled ? "Доступен организаторам и участникам" : "Скрыт, сохранённые данные не удалены"}</p></div><span className={`text-xs ${enabled ? "text-emerald-300" : "text-white/35"}`}>{locked ? "Обязательный" : enabled ? "Включён" : "Выключен"}</span>{!locked && <button type="button" role="switch" aria-label={`${MODULE_LABELS[key] || key}: ${enabled ? "включён" : "выключен"}`} aria-checked={enabled} disabled={Boolean(busy)} onClick={() => void updateModule(key, !enabled)} className={`relative h-7 w-12 rounded-full border ${enabled ? "border-emerald-300/40 bg-emerald-400/25" : "border-white/15 bg-white/5"}`}><span className={`absolute top-1 size-5 rounded-full bg-white transition ${enabled ? "left-6" : "left-1"}`} /></button>}</div>; })}</div></section>}
        {panel === "cohort-status" && <div className="space-y-5"><section className="workspace-card"><h2 className="text-xl">Статус потока</h2><p className="mt-1 text-sm text-white/40">Текущий статус: <span className="text-white">{STATUS_LABELS[cohort.status] || cohort.status}</span>. Недоступные переходы скрыты.</p><div className="mt-5 flex flex-wrap gap-3">{(STATUS_TRANSITIONS[cohort.status] || []).map((next) => <button type="button" key={next} onClick={() => void statusChange(next)} disabled={Boolean(busy)} className="overview-secondary">{transitionLabel[next] || STATUS_LABELS[next]}</button>)}</div></section>{cohort.status === "active" && <CohortClosure cohortId={cohort.id} token={token} onCompleted={onCompleted} />}</div>}
        {panel === "accelerator-general" && <section className="workspace-card"><h2 className="text-xl">Общие сведения</h2><p className="mt-1 text-sm text-white/40">Название и описание видны во всех потоках акселератора.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><Label text="Название"><input value={acceleratorName} onChange={(event) => setAcceleratorName(event.target.value)} className="workspace-input mt-2" /></Label><Label text="Описание"><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="workspace-input mt-2 resize-y" /></Label></div><button type="button" onClick={() => void saveAccelerator()} disabled={Boolean(busy) || !dirtyAccelerator || !acceleratorName.trim()} className="workspace-button mt-5">Сохранить изменения</button></section>}
        {panel === "cohorts" && <section className="workspace-card"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl">Потоки</h2><p className="mt-1 text-sm text-white/40">Создание и выбор потоков вынесены из формы текущего потока.</p></div></div><div className="mt-5 divide-y divide-white/8">{cohorts.map((row) => <div key={row.id} className="flex items-center gap-4 py-4"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{row.name}</p><p className="mt-1 text-xs text-white/35">{STATUS_LABELS[row.status] || row.status}{row.starts_at ? ` · ${new Date(row.starts_at).toLocaleDateString("ru-RU")}` : ""}</p></div><button type="button" onClick={() => { onSelectCohort(row.id); onPanel("cohort-general"); }} className="overview-secondary">Открыть</button></div>)}</div><form onSubmit={createCohort} className="mt-5 flex flex-col gap-3 border-t border-white/8 pt-5 sm:flex-row"><input value={newCohortName} onChange={(event) => setNewCohortName(event.target.value)} required minLength={2} placeholder="Название нового потока" className="workspace-input" /><button disabled={Boolean(busy)} className="workspace-button shrink-0">Новый поток</button></form><p className="mt-2 text-xs text-white/30">Будут созданы обязательные разделы и базовая анкета. Участники и рабочие данные не копируются.</p></section>}
        {panel === "organizers" && isAdmin && <OrganizerManager token={token} acceleratorId={accelerator.id} />}
        {panel === "quotas" && isAdmin && <QuotaManager token={token} cohortId={cohort.id} initialTemplate={cohort.default_quota_config} residents={residents} />}
        {panel === "system-health" && <AcceleratorOperations cohortId={cohort.id} acceleratorId={accelerator.id} token={token} isAdmin={isAdmin} />}
        {panel === "audit-log" && <AuditLog token={token} acceleratorId={accelerator.id} />}
      </div>
    </div>
  </div>;
}

function defaultApplicationSchema(name: string): ApplicationFormSchema { return { title: `Заявка в поток «${name}»`, required: ["motivation", "project_name", "problem"], fields: [{ key: "motivation", label: "Мотивация и опыт", type: "textarea", required: true, application_types: ["project", "participant"] }, { key: "project_name", label: "Название проекта", required: true, application_types: ["project"] }, { key: "problem", label: "Какую проблему решает проект?", type: "textarea", required: true, application_types: ["project"] }] }; }
function toLocal(value?: string | null) { if (!value) return ""; const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
function SelectCard({ label, children }: { label: string; children: React.ReactNode }) { return <section className="workspace-card"><p className="mb-2 text-xs uppercase tracking-[.18em] text-white/35">{label}</p>{children}</section>; }
function AcceleratorPortfolio({ accelerators, memberships, staffContext, onOpenStaff }: { accelerators: Accelerator[]; memberships: ResidentWorkspaceData["memberships"]; staffContext: boolean; onOpenStaff: (id: number) => void }) {
  return <section className="workspace-card"><div><p className="text-xs uppercase tracking-[.18em] text-white/30">Доступные пространства</p><h2 className="mt-2 text-3xl">Все акселераторы</h2><p className="mt-2 text-sm text-white/40">Выберите акселератор или поток, с которым хотите работать.</p></div>
    {!!memberships.length && <div className="mt-6 grid gap-3 md:grid-cols-2">{memberships.map((membership) => <Link key={membership.membership_id} href={`/accelerator/my/${membership.membership_id}`} className="group rounded-2xl border border-white/10 p-5 hover:border-white/25"><div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-wide text-white/35">{membership.accelerator.name}</p><h3 className="mt-2 text-xl">{membership.cohort.name}</h3><p className="mt-2 text-sm text-white/40">{STATUS_LABELS[membership.status] || membership.status}</p></div><ArrowRight size={18} className="mt-1 text-white/30 transition group-hover:translate-x-1 group-hover:text-white" /></div></Link>)}</div>}
    {(staffContext || !memberships.length) && <div className="mt-6 grid gap-3 md:grid-cols-2">{accelerators.map((accelerator) => <button type="button" key={accelerator.id} onClick={() => onOpenStaff(accelerator.id)} className="group rounded-2xl border border-white/10 p-5 text-left hover:border-white/25"><div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-wide text-white/35">{accelerator.access_role === "global_admin" ? "Главный администратор" : accelerator.access_role === "organizer" ? "Организатор" : accelerator.access_role === "tracker" ? "Трекер" : accelerator.access_role === "expert" ? "Эксперт" : "Участник"}</p><h3 className="mt-2 text-xl">{accelerator.name}</h3><p className="mt-2 text-sm text-white/40">{accelerator.description || "Открыть доступные потоки"}</p></div><ArrowRight size={18} className="mt-1 text-white/30 transition group-hover:translate-x-1 group-hover:text-white" /></div></button>)}</div>}
  </section>;
}
function Label({ text, children }: { text: string; children: React.ReactNode }) { return <label className="text-sm text-white/60">{text}{children}</label>; }
function EmptyState({ isAdmin, onCreate }: { isAdmin: boolean; onCreate: () => void }) { return <section className="workspace-card py-12 text-center"><LayoutDashboard className="mx-auto mb-4 text-white/25" size={38} /><h2 className="text-2xl">Нет доступных акселераторов</h2><p className="mx-auto mt-3 max-w-lg text-white/40">{isAdmin ? "Создайте первый акселератор — мастер сразу подготовит организацию, поток, анкету, функции и лимиты." : "Главный администратор должен назначить вас организатором или зачислить резидентом."}</p>{isAdmin && <button type="button" onClick={onCreate} className="workspace-button mt-6">Начать настройку</button>}</section>; }
function Empty({ icon: Icon, title, text, children }: { icon: typeof Rocket; title: string; text: string; children?: React.ReactNode }) { return <main className="min-h-[100dvh] grid place-items-center bg-black px-5 text-white"><section className="max-w-lg text-center"><Icon className="mx-auto mb-5 text-white/35" size={42} /><h1 className="mb-4 text-3xl">{title}</h1><p className="mb-8 text-white/45">{text}</p>{children}</section></main>; }
