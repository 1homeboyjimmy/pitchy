"use client";

import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Check,
  ChevronDown,
  Crown,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { ApiError, createProject, deleteAuth, describeApiError, getAuthJson, getProjects, patchAuthJson, postAuthJson, putAuthJson, type ProjectListItem } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { CandidateDirectory, OpenTeamDirectory, type PoolCandidate, type PoolContact, type PoolTeam } from "./TeamDirectory";

const PassportModal = dynamic(() => import("@/components/dashboard/PassportModal").then(module => module.PassportModal));

export type TeamMember = {
  id: number;
  membership_id: number;
  role: "owner" | "member" | "cofounder";
  title?: string | null;
  status: string;
  share_contact: boolean;
  person: { name: string; email?: string };
};

export type TeamInvitation = {
  id: number;
  status?: string;
  message?: string | null;
  created_at?: string | null;
  counterpart_profile_id?: number | null;
  team_name?: string | null;
  team?: { id: number; name: string } | null;
  person?: { name: string; email?: string } | null;
  profile?: { id?: number; name: string } | null;
  invitee?: { membership_id: number; name: string } | null;
  invited_by?: { name: string } | null;
  can_respond?: boolean;
  can_cancel?: boolean;
};

export type ResidentTeam = {
  id: number;
  name: string;
  status: string;
  max_members: number;
  attendance_percent?: number | null;
  attendance_team_id?: number | null;
  recruiting_open: boolean;
  project: { id: number; name: string } | null;
  project_attached?: boolean;
  project_state?: "project_pending" | "active";
  tracker?: { id: number; name: string } | null;
  owner_membership_id: number;
  can_manage: boolean;
  can_attach_project?: boolean;
  members: TeamMember[];
  pending_invitations: TeamInvitation[];
};

type TransferState = { team_id: number; team_name: string; action: "archive" | "leave"; allowed: boolean; reason?: string | null };
type TeamData = { team: ResidentTeam | null; additional_teams?: ResidentTeam[]; invitations: TeamInvitation[]; can_create?: boolean; transfer?: TransferState | null };
type TeamApplication = { transfer_context?: { team_name: string; action: string } | null; id: number; team_id: number; team_name: string; membership_id: number; applicant?: PoolContact | null; message?: string | null; desired_role?: string | null; status: string; can_respond: boolean; can_cancel: boolean };
type TeamPool = { teams: PoolTeam[]; candidates: PoolCandidate[]; applications: TeamApplication[] };

export function TeamWorkspace({ membershipId, project, onChanged }: { membershipId: number; project?: { id: number; name: string } | null; onChanged?: () => Promise<void> }) {
  const { token } = useAuth();
  const [team, setTeam] = useState<ResidentTeam | null>(null);
  const [additionalTeams, setAdditionalTeams] = useState<ResidentTeam[]>([]);
  const [passportTeam, setPassportTeam] = useState<ResidentTeam | null>(null);
  const currentTeamId = useRef<number | null | undefined>(undefined);
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const [transferConfirmed, setTransferConfirmed] = useState(false);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [pool, setPool] = useState<TeamPool>({ teams: [], candidates: [], applications: [] });
  const [createForm, setCreateForm] = useState({ name: project ? `Команда ${project.name}` : "Новая команда", maxMembers: 5 });
  const [settings, setSettings] = useState({ name: "", maxMembers: 5 });
  const [ownedProjects, setOwnedProjects] = useState<ProjectListItem[]>([]);
  const [projectToAttach, setProjectToAttach] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"find" | "create" | "applications">("create");

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const [response, poolData, projects] = await Promise.all([
        getAuthJson<TeamData>(`/api/accelerators/memberships/${membershipId}/team`, token),
        getAuthJson<TeamPool>(`/api/accelerators/memberships/${membershipId}/team-pool`, token),
        getProjects(token).catch(() => [] as ProjectListItem[]),
      ]);
      const nextTeamId = response.team?.id ?? null;
      if (currentTeamId.current !== undefined && currentTeamId.current !== nextTeamId) {
        setMode("create");
        setSettingsOpen(false);
      }
      currentTeamId.current = nextTeamId;
      setTeam(response.team);
      setAdditionalTeams(response.additional_teams || []);
      setTransfer(response.transfer || null);
      setTransferConfirmed(false);
      setPool(poolData);
      setInvitations(response.invitations || []);
      setOwnedProjects(projects);
      if (projects.length) setProjectToAttach((current) => current || String(projects[0].id));
      if (response.team) setSettings({ name: response.team.name, maxMembers: response.team.max_members });
    } catch (reason) {
      setError(teamError(reason, "Не удалось загрузить команду"));
    } finally {
      setLoading(false);
    }
  }, [membershipId, token]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    await load();
    await onChanged?.();
  };

  const createTeam = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setBusy("create"); setError("");
    try {
      await postAuthJson(`/api/accelerators/memberships/${membershipId}/team`, { name: createForm.name.trim(), max_members: createForm.maxMembers }, token);
      await refresh();
    } catch (reason) { setError(teamError(reason, "Не удалось создать команду")); }
    finally { setBusy(""); }
  };

  const saveTeam = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !team?.can_manage || team.status !== "active") return;
    setBusy("settings"); setError("");
    try {
      await patchAuthJson(`/api/accelerators/teams/${team.id}`, { name: settings.name.trim(), max_members: settings.maxMembers }, token);
      await load();
    } catch (reason) { setError(teamError(reason, "Не удалось сохранить команду")); }
    finally { setBusy(""); }
  };

  const answerInvitation = async (invitationId: number, status: "accepted" | "declined") => {
    if (!token) return;
    if (status === "accepted" && team) {
      if (!transfer?.allowed) { setError(transfer?.reason || "Обновите команду перед переходом."); return; }
      if (!window.confirm(transferDescription(transfer))) return;
    }
    setBusy(`invitation-${invitationId}`); setError("");
    try {
      await patchAuthJson(`/api/accelerators/team-invitations/${invitationId}`, { status, ...(status === "accepted" && team ? { leave_current_team: true, expected_current_team_id: team.id } : {}) }, token);
      if (status === "accepted") { setMode("create"); await refresh(); }
      else await load();
    } catch (reason) { setError(teamError(reason, status === "accepted" ? "Не удалось принять приглашение" : "Не удалось отклонить приглашение")); }
    finally { setBusy(""); }
  };

  const applyToTeam = async (teamId: number) => {
    if (!token) return;
    if (team && (!transfer?.allowed || !transferConfirmed)) { setError(transfer?.reason || "Подтвердите переход из текущей команды."); return; }
    setBusy(`apply-${teamId}`); setError("");
    try { await postAuthJson(`/api/accelerators/teams/${teamId}/applications`, { message: messages[teamId] || null,
      ...(team ? { leave_current_team: true, expected_current_team_id: team.id } : {}),
    }, token); await load(); }
    catch (reason) { setError(teamError(reason, "Не удалось отправить заявку")); }
    finally { setBusy(""); }
  };

  const attachProject = async (projectId: number) => {
    if (!token || !team?.can_manage || team.project) return;
    setBusy("project"); setError("");
    try {
      await putAuthJson(`/api/accelerators/teams/${team.id}/project`, { project_id: projectId }, token);
      await refresh();
    } catch (reason) { setError(teamError(reason, "Не удалось привязать проект")); }
    finally { setBusy(""); }
  };

  const createAndAttachProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !team || !newProjectName.trim()) return;
    setBusy("new-project"); setError("");
    try {
      const created = await createProject({ name: newProjectName.trim() }, token);
      await putAuthJson(`/api/accelerators/teams/${team.id}/project`, { project_id: created.id }, token);
      setNewProjectName("");
      await refresh();
    } catch (reason) { setError(teamError(reason, "Не удалось создать и привязать проект")); }
    finally { setBusy(""); }
  };

  const respondApplication = async (applicationId: number, status: "accepted" | "declined" | "cancelled") => {
    if (!token) return; setBusy(`application-${applicationId}`); setError("");
    try { await patchAuthJson(`/api/accelerators/team-applications/${applicationId}`, { status }, token); await load(); }
    catch (reason) { setError(teamError(reason, "Не удалось обработать заявку")); }
    finally { setBusy(""); }
  };

  const inviteCandidate = async (candidate: PoolCandidate, message: string) => {
    if (!token || !team?.can_manage) return; setBusy(`invite-${candidate.membership_id}`); setError("");
    try {
      await postAuthJson(`/api/accelerators/teams/${team.id}/invitations`, {
        counterpart_profile_id: candidate.profile_id || undefined,
        membership_id: candidate.membership_id,
        message: message.trim() || null,
      }, token);
      await load();
    } catch (reason) { setError(teamError(reason, "Не удалось отправить приглашение")); }
    finally { setBusy(""); }
  };

  const toggleRecruiting = async () => {
    if (!token || !team?.can_manage) return; setBusy("recruiting");
    try { await patchAuthJson(`/api/accelerators/teams/${team.id}`, { recruiting_open: !team.recruiting_open }, token); await load(); }
    catch (reason) { setError(teamError(reason, "Не удалось изменить набор")); }
    finally { setBusy(""); }
  };

  const transferCaptain = async (member: TeamMember) => {
    if (!token || !team?.can_manage || !window.confirm(`Назначить ${member.person.name} капитаном команды?`)) return;
    setBusy(`captain-${member.id}`);
    try { await patchAuthJson(`/api/accelerators/teams/${team.id}/captain`, { membership_id: member.membership_id }, token); await load(); }
    catch (reason) { setError(teamError(reason, "Не удалось передать капитанство")); }
    finally { setBusy(""); }
  };

  const updateMember = async (member: TeamMember, payload: { role: "member" | "cofounder"; title: string | null }) => {
    if (!token || !team?.can_manage || team.status !== "active") return;
    setBusy(`member-${member.id}`); setError("");
    try { await patchAuthJson(`/api/accelerators/team-members/${member.id}`, payload, token); await load(); }
    catch (reason) { setError(teamError(reason, "Не удалось обновить роль участника")); }
    finally { setBusy(""); }
  };

  const removeMember = async (member: TeamMember) => {
    if (!token || !team?.can_manage || team.status !== "active" || member.membership_id === team.owner_membership_id || !window.confirm(`Исключить ${member.person.name} из команды?`)) return;
    setBusy(`remove-${member.id}`); setError("");
    try { await deleteAuth(`/api/accelerators/team-members/${member.id}`, token); await load(); }
    catch (reason) { setError(teamError(reason, "Не удалось исключить участника")); }
    finally { setBusy(""); }
  };

  const leaveTeam = async () => {
    const ownMember = team?.members.find((member) => member.membership_id === membershipId);
    if (!token || !canLeaveTeam || ownMember?.status !== "active" || !window.confirm(`Покинуть команду «${team?.name}»?`)) return;
    setBusy("leave"); setError("");
    try { await deleteAuth(`/api/accelerators/team-members/${ownMember.id}`, token); await refresh(); }
    catch (reason) { setError(teamError(reason, "Не удалось покинуть команду")); }
    finally { setBusy(""); }
  };

  const actionableInvitations = useMemo(() => invitations.filter((invitation) => (invitation.status || "pending") === "pending" && invitation.can_respond !== false), [invitations]);
  const pendingTeamInvitations = useMemo(() => (team?.pending_invitations || []).filter((invitation) => (invitation.status || "pending") === "pending"), [team]);
  const invitedMembershipIds = useMemo(() => new Set(pendingTeamInvitations.map((row) => row.invitee?.membership_id).filter((id): id is number => Boolean(id))), [pendingTeamInvitations]);
  const pendingTeamIds = useMemo(() => new Set(pool.applications.filter((row) => row.can_cancel).map((row) => row.team_id)), [pool.applications]);
  const activeMemberCount = team?.members.filter((member) => member.status === "active").length || 0;
  const capacityUsed = activeMemberCount + pendingTeamInvitations.length;
  const teamIsFull = Boolean(team && capacityUsed >= team.max_members);
  const viewerActive = team?.members.some((member) => member.membership_id === membershipId && member.status === "active") || false;
  const teamReadOnly = Boolean(team && (team.status !== "active" || (!team.can_manage && !viewerActive)));
  const canEditTeam = Boolean(team?.can_manage && team.status === "active");
  const canLeaveTeam = Boolean(team && team.status === "active" && viewerActive && team.owner_membership_id !== membershipId);
  const incomingApplications = pool.applications.filter(row => row.can_respond);
  const openTeams = pool.teams.filter(row => row.id !== team?.id && row.recruiting_open && row.member_count < row.max_members);

  if (loading) return <section className="workspace-card grid min-h-44 place-items-center"><Loader2 className="animate-spin text-white/35" /></section>;

  return <div className="space-y-5">
    <section>
      <header className="flex min-w-0 items-start justify-between gap-2.5 sm:gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight [overflow-wrap:anywhere] sm:text-3xl">{team?.name || "Команда"}</h1>
          {team?.status === "archived" && <span className="mt-1 inline-block text-xs text-white/50">В архиве</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {team && <span className="flex min-h-9 items-center gap-1 rounded-lg bg-white/8 px-2 text-xs tabular-nums text-white/65"
            aria-label={`${activeMemberCount} участников из ${team.max_members}`} title="Участники / лимит">
            <Users size={13} aria-hidden="true" />{activeMemberCount}/{team.max_members}
          </span>}
          {canEditTeam && <button type="button" aria-label="Настройки команды" aria-expanded={settingsOpen} aria-controls="team-settings"
            onClick={() => setSettingsOpen(current => !current)} className="grid size-9 place-items-center rounded-lg border border-white/10 text-white/65 hover:bg-white/8">
            <Settings size={16} />
          </button>}
          <button type="button" onClick={() => void refresh()} disabled={Boolean(busy)} aria-label="Обновить команду"
            className="grid size-9 place-items-center rounded-lg border border-white/10 text-white/55 hover:bg-white/8"><RefreshCw size={15} /></button>
        </div>
      </header>
      {team && canEditTeam && settingsOpen && <div id="team-settings" className="mt-3 rounded-xl border border-white/10 px-3.5 py-3">
        <form onSubmit={saveTeam} aria-label="Настройки команды" className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
          <label className="min-w-0 text-xs text-white/60">Название команды
            <input value={settings.name} onChange={event => setSettings({ ...settings, name: event.target.value })} minLength={2} maxLength={500}
              required aria-label="Название команды" className="workspace-input mt-1" />
          </label>
          <label className="text-xs text-white/60">Лимит участников
            <input type="number" min={Math.max(1, capacityUsed)} max={20} value={settings.maxMembers}
              onChange={event => setSettings({ ...settings, maxMembers: Number(event.target.value) })} aria-label="Максимум участников команды" className="workspace-input mt-1" />
          </label>
          <button disabled={Boolean(busy)} className="workspace-button"><Save size={14} /> Сохранить команду</button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={() => void toggleRecruiting()} disabled={Boolean(busy)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70">
            {team.recruiting_open ? "Закрыть набор" : "Открыть набор"}
          </button>
          {pendingTeamInvitations.length > 0 && <span className="text-xs text-white/50">Ожидают ответа: {pendingTeamInvitations.length}</span>}
        </div>
        <p className="mt-2 text-xs text-white/45">Для архивирования команды обратитесь к организатору.</p>
      </div>}

      {team && !team.can_manage && !viewerActive && <p className="mt-4 rounded-2xl border border-white/8 bg-white/[.025] p-4 text-sm text-white/50">Вы больше не состоите в этой команде. История состава доступна только для просмотра.</p>}

      {actionableInvitations.length > 0 && <div className="mt-5 space-y-3"><h3 className="text-sm text-white/55">Входящие приглашения</h3>{actionableInvitations.map((invitation) => <article key={invitation.id} className="rounded-2xl border border-blue-300/15 bg-blue-300/[0.04] p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><p>{invitationTeamName(invitation)}</p>{invitation.invited_by?.name && <p className="mt-1 text-xs text-white/35">Приглашает {invitation.invited_by.name}</p>}{invitation.message && <p className="mt-2 text-sm text-white/50">{invitation.message}</p>}</div><div className="flex gap-2"><button type="button" onClick={() => void answerInvitation(invitation.id, "accepted")} disabled={Boolean(busy)} className="workspace-button"><Check size={14} />{team ? "Принять и перейти" : "Принять"}</button><button type="button" onClick={() => void answerInvitation(invitation.id, "declined")} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-4 py-2 text-sm text-white/50"><X size={14} /> Отклонить</button></div></div></article>)}</div>}

      {<div className="mt-6 flex overflow-x-auto border-b border-white/10"><Mode active={mode === "create"} onClick={() => setMode("create")}>{team ? "Моя команда" : "Создать свою"}</Mode><Mode active={mode === "find"} onClick={() => setMode("find")}>{team ? "Перейти в другую команду" : "Найти команду"}</Mode><Mode active={mode === "applications"} onClick={() => setMode("applications")}>Мои заявки <span className="ml-1 rounded-md bg-white/10 px-2 py-0.5 text-xs">{pool.applications.filter(row => row.can_cancel).length}</span></Mode></div>}
      {!team && mode === "create" && <form onSubmit={createTeam} className="mt-6 overflow-hidden rounded-2xl border border-white/10"><div className="grid lg:grid-cols-[1fr_360px]"><div className="p-5 sm:p-6"><h3 className="text-xl">Создать команду</h3><p className="mt-1 text-sm text-white/40">Соберите участников вокруг своего проекта</p><div className="mt-5 rounded-2xl border border-white/9 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-[.15em] text-white/35">Проект</p><p className="mt-2 text-lg">{project?.name || "Проект будет добавлен позже"}</p><p className="mt-1 text-sm text-white/40">После создания вы станете капитаном команды</p></div><span className="rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300">Будет привязан</span></div></div><div className="mt-5 grid gap-4 sm:grid-cols-[1fr_200px]"><label className="text-sm text-white/55">Название команды<input aria-label="Название" value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} minLength={2} maxLength={200} required className="workspace-input mt-2" /></label><label className="text-sm text-white/55">Максимум участников<input type="number" min={1} max={20} value={createForm.maxMembers} onChange={(event) => setCreateForm({ ...createForm, maxMembers: Number(event.target.value) })} className="workspace-input mt-2" /></label></div><button aria-label="Создать" disabled={busy === "create"} className="workspace-button mt-5"><Users size={15} /> Создать команду</button></div><aside className="border-t border-white/8 bg-white/[.018] p-5 sm:p-6 lg:border-l lg:border-t-0"><h3 className="text-lg">После создания</h3><div className="mt-5 space-y-5">{["Приглашайте участников потока","Управляйте ролями команды","Получите общего трекера"].map(item=><p key={item} className="flex items-center gap-3 text-sm text-white/65"><span className="grid size-8 place-items-center rounded-full bg-emerald-400/15 text-emerald-300"><Check size={15}/></span>{item}</p>)}</div></aside></div></form>}
      {mode === "find" && <section className="mt-5">
        <h2 className="text-lg font-medium">Открытые команды</h2>
        {team && <div className="mt-3 rounded-xl border border-amber-300/15 p-3 text-sm text-white/65">
          {transfer?.allowed ? <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1" checked={transferConfirmed} onChange={event => setTransferConfirmed(event.target.checked)} aria-label="Подтверждаю переход после одобрения заявки" />
            <span>{transferDescription(transfer)} До одобрения заявки ваша команда останется активной.</span>
          </label> : <p>{transfer?.reason || "Обновите команду, чтобы проверить возможность перехода."}</p>}
        </div>}
        <OpenTeamDirectory teams={openTeams} pendingIds={pendingTeamIds} busy={Boolean(busy)} blocked={Boolean(team && (!transfer?.allowed || !transferConfirmed))}
          messages={messages} onMessageChange={(id, value) => setMessages(current => ({ ...current, [id]: value }))} onApply={applyToTeam} />
      </section>}

      {mode === "applications" && <div className="mt-6 overflow-hidden rounded-2xl border border-white/9">{pool.applications.filter(row => row.can_cancel).map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 p-4 last:border-0"><div><p>{row.team_name}</p><p className="mt-1 text-sm text-white/40">{row.desired_role ? `Желаемая роль: ${row.desired_role}` : "Заявка на вступление"}</p><p className="mt-1 text-xs text-amber-200">Ожидает ответа</p></div><button type="button" onClick={() => void respondApplication(row.id, "cancelled")} disabled={Boolean(busy)} className="overview-secondary">Отозвать заявку</button></article>)}{!pool.applications.some(row => row.can_cancel) && <p className="py-12 text-center text-sm text-white/35">Активных заявок нет.</p>}</div>}
      {team && mode === "create" && ((canEditTeam && !team.project) || canLeaveTeam) && <div className="mt-3">
        {team.can_manage && team.status === "active" && !team.project && <div className="mt-5 rounded-2xl border border-blue-300/15 bg-blue-300/[0.035] p-4"><h3>Добавить проект</h3><p className="mt-1 text-xs text-white/40">После привязки откроются аудит и другие проектные функции.</p>{ownedProjects.length > 0 && <div className="mt-4 flex flex-col gap-2 sm:flex-row"><select value={projectToAttach} onChange={(event) => setProjectToAttach(event.target.value)} className="workspace-input"><option value="">Выберите проект</option>{ownedProjects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button type="button" onClick={() => void attachProject(Number(projectToAttach))} disabled={!projectToAttach || busy === "project"} className="workspace-button shrink-0">Привязать проект</button></div>}<form onSubmit={createAndAttachProject} className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} minLength={2} maxLength={200} placeholder="Название нового проекта" className="workspace-input" /><button disabled={!newProjectName.trim() || busy === "new-project"} className="workspace-button shrink-0">Создать и привязать</button></form></div>}
        {canLeaveTeam && <button type="button" onClick={() => void leaveTeam()} disabled={Boolean(busy)} className="mt-4 inline-flex items-center gap-1 rounded-full border border-red-300/15 px-4 py-2 text-sm text-red-200"><X size={14} /> Покинуть команду</button>}
      </div>}
    </section>

    {team && mode === "create" && <section className="workspace-card"><h2 className="flex items-center gap-2 text-xl"><ShieldCheck size={18} /> Участники</h2><div className="mt-3 grid gap-2 lg:grid-cols-2 lg:items-start">{team.members.map((member) => <MemberCard key={`${member.id}-${member.role}-${member.title || ""}`} member={member} isOwner={member.membership_id === team.owner_membership_id} canManage={team.can_manage} readOnly={teamReadOnly} busy={busy} onSave={updateMember} onRemove={removeMember} onTransferCaptain={transferCaptain} />)}</div></section>}

    {team && canEditTeam && mode === "create" && incomingApplications.length > 0 && <section id={`resident-matching-${team.id}`} tabIndex={-1} className="workspace-card">
      <h2 className="flex items-center gap-2 text-xl"><UserPlus size={18} /> Заявки в команду</h2>
      {teamIsFull && <p className="mt-3 text-sm text-amber-100">В команде достигнут лимит участников.</p>}
      <div className="mt-3 space-y-2">
        {incomingApplications.map(row => <article key={row.id} className="rounded-xl border border-white/10 p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <p>{row.applicant?.name}</p>
              {Boolean(row.applicant?.competencies.length) && <p className="mt-1 text-sm text-white/55">{row.applicant?.competencies.join(" · ")}</p>}
              {(row.applicant?.email || row.applicant?.telegram) && <p className="mt-1 text-xs text-blue-200">{row.applicant.email} {row.applicant.telegram}</p>}
              {row.message && <p className="mt-2 text-sm text-white/55">{row.message}</p>}
              {row.transfer_context && <p className="mt-2 text-xs text-amber-100">
                Участник подтвердил переход из команды «{row.transfer_context.team_name}».
                {row.transfer_context.action === "archive" ? " Она будет архивирована после одобрения." : " Она продолжит работу."}
              </p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void respondApplication(row.id, "accepted")} disabled={Boolean(busy) || teamIsFull} className="workspace-button"><Check size={14} /> Принять</button>
              <button type="button" onClick={() => void respondApplication(row.id, "declined")} disabled={Boolean(busy)} className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/65">Отклонить</button>
            </div>
          </div>
        </article>)}
      </div>
    </section>}

    {canEditTeam && mode === "create" && <CandidateDirectory candidates={pool.candidates} membershipId={membershipId}
      token={token} teamIsFull={teamIsFull} busy={Boolean(busy)} invitedIds={invitedMembershipIds} onInvite={inviteCandidate} />}

    {mode === "create" && additionalTeams.length > 0 && <section className="workspace-card">
      <h2 className="text-xl">Другие мои команды</h2>
      <div className="mt-4 space-y-3">
        {additionalTeams.map((item) => <article key={item.id} className="rounded-xl border border-white/10 p-4">
          <h3 className="font-medium [overflow-wrap:anywhere]">{item.name}</h3>
          <ul className="my-3 space-y-1 text-sm text-white/60">
            {item.members.filter(member => member.status === "active").map(member => <li key={member.membership_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
              <span>{member.person.name}{member.role === "owner" && <span className="ml-2 text-xs text-amber-200">Капитан</span>}</span>
              {member.person.email && <a href={`mailto:${member.person.email}`} className="min-w-0 text-xs text-blue-200 hover:underline">{member.person.email}</a>}
            </li>)}
          </ul>
          {item.project && <button type="button" className="workspace-button" onClick={() => setPassportTeam(item)}>Паспорт проекта</button>}
        </article>)}
      </div>
    </section>}
    {passportTeam?.project && <PassportModal projectId={passportTeam.project.id} projectName={passportTeam.project.name}
      readOnly={passportTeam.owner_membership_id !== membershipId} onClose={() => setPassportTeam(null)} />}
    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}

function MemberCard({ member, isOwner, canManage, readOnly, busy, onSave, onRemove, onTransferCaptain }: {
  member: TeamMember;
  isOwner: boolean;
  canManage: boolean;
  readOnly: boolean;
  busy: string;
  onSave: (member: TeamMember, payload: { role: "member" | "cofounder"; title: string | null }) => Promise<void>;
  onRemove: (member: TeamMember) => Promise<void>;
  onTransferCaptain: (member: TeamMember) => Promise<void>;
}) {
  const [role, setRole] = useState<"member" | "cofounder">(member.role === "cofounder" ? "cofounder" : "member");
  const [title, setTitle] = useState(member.title || "");
  const [open, setOpen] = useState(false);
  const actionsId = useId();
  const editRole = canManage && !isOwner && !readOnly && member.status === "active";
  const roleLabel = isOwner ? "Капитан" : member.role === "cofounder" ? "Сооснователь" : "Участник";
  return <article className="min-w-0 rounded-xl border border-white/10">
    <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p className="flex items-center gap-2 text-sm font-medium">{member.person.name}{isOwner && <Crown size={13} className="shrink-0 text-amber-300" />}</p>
          <p className="mt-0.5 text-xs text-white/50">{roleLabel}{member.title && ` · ${member.title}`}{member.status !== "active" && " · Вышел"}</p>
        </div>
        {member.person.email && <a href={`mailto:${member.person.email}`} className="inline-flex min-w-0 items-center gap-1.5 text-xs text-blue-200 hover:underline [overflow-wrap:anywhere]">
          <Mail size={13} className="shrink-0" aria-hidden="true" /><span className="min-w-0">{member.person.email}</span>
        </a>}
      </div>
      {editRole && <button type="button" aria-label={`Действия участника ${member.person.name}`} aria-expanded={open} aria-controls={actionsId}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-white/55 hover:bg-white/8" onClick={() => setOpen(current => !current)}>
        <ChevronDown size={15} className={open ? "rotate-180" : ""} />
      </button>}
    </div>
    {editRole && open && <div id={actionsId} className="grid min-w-0 gap-2 border-t border-white/8 px-3 py-3 sm:grid-cols-2">
        <select value={role} onChange={event => setRole(event.target.value as "member" | "cofounder")} aria-label={`Роль ${member.person.name}`} className="workspace-input">
          <option value="member">Участник</option><option value="cofounder">Сооснователь</option>
        </select>
        <input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="Зона ответственности" aria-label={`Зона ответственности ${member.person.name}`} className="workspace-input" />
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="button" onClick={() => void onSave(member, { role, title: title.trim() || null })} disabled={Boolean(busy)} className="workspace-button"><Save size={13} /> Сохранить роль</button>
          <button type="button" onClick={() => void onTransferCaptain(member)} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-lg border border-amber-300/15 px-3 py-2 text-xs text-amber-200"><Crown size={13} /> Сделать капитаном</button>
          <button type="button" onClick={() => void onRemove(member)} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-lg border border-red-300/15 px-3 py-2 text-xs text-red-200"><Trash2 size={13} /> Исключить</button>
        </div>
    </div>}
  </article>;
}

function Mode({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`shrink-0 border-b-2 px-3 py-2.5 text-sm ${active ? "border-white text-white" : "border-transparent text-white/45"}`}>{children}</button>; }

function invitationTeamName(row: TeamInvitation) { return row.team?.name || row.team_name || "Приглашение в команду"; }

function teamError(reason: unknown, fallback: string) {
  if (reason instanceof ApiError && reason.status === 403) return "Недостаточно прав для этого действия в команде.";
  if (reason instanceof ApiError && reason.status === 409) {
    if (/архив/i.test(reason.message)) return "Команда уже находится в архиве и доступна только для просмотра.";
    if (/project|проект/i.test(reason.message)) return reason.message || "Проверьте доступ к выбранному проекту.";
    if (/мест|заполн|лимит/i.test(reason.message)) return reason.message || "В команде нет свободных мест.";
    if (/приглаш/i.test(reason.message)) return "Приглашение этому резиденту уже отправлено или обработано.";
    if (/переход|капитан|состав|подтверд|текущ/i.test(reason.message)) return reason.message;
    if (/уже.*состоит|уже.*команде/i.test(reason.message)) return reason.message;
    return reason.message || "Состояние команды уже изменилось. Обновите данные и повторите действие.";
  }
  return describeApiError(reason, fallback);
}

function transferDescription(transfer: TransferState) {
  return transfer.action === "archive"
    ? `После вступления команда «${transfer.team_name}», в которой вы один, будет архивирована. Личный проект и история сохранятся. Ожидающие заявки и приглашения этой команды будут отменены.`
    : `После вступления вы выйдете из команды «${transfer.team_name}». Она продолжит работу. Ваши личные проекты сохранятся.`;
}
