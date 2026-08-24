"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Crown,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { ApiError, deleteAuth, describeApiError, getAuthJson, patchAuthJson, postAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";

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
  invitee?: { name: string } | null;
  invited_by?: { name: string } | null;
  can_respond?: boolean;
  can_cancel?: boolean;
};

export type ResidentTeam = {
  id: number;
  name: string;
  status: string;
  max_members: number;
  project: { id: number; name: string } | null;
  owner_membership_id: number;
  can_manage: boolean;
  members: TeamMember[];
  pending_invitations: TeamInvitation[];
};

type TeamData = { team: ResidentTeam | null; invitations: TeamInvitation[] };
type ResidentRecommendation = {
  profile: { id: number; membership_id?: number | null; role: string; name: string; bio?: string | null };
  score: number;
  reasons: string[];
  existing_status?: string | null;
};

export function TeamWorkspace({ membershipId, project }: { membershipId: number; project?: { id: number; name: string } | null }) {
  const { token } = useAuth();
  const [team, setTeam] = useState<ResidentTeam | null>(null);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [recommendations, setRecommendations] = useState<ResidentRecommendation[]>([]);
  const [createForm, setCreateForm] = useState({ name: project ? `Команда ${project.name}` : "", maxMembers: 5 });
  const [settings, setSettings] = useState({ name: "", maxMembers: 5 });
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const response = await getAuthJson<TeamData>(`/api/accelerators/memberships/${membershipId}/team`, token);
      setTeam(response.team);
      setInvitations(response.invitations || []);
      if (response.team) setSettings({ name: response.team.name, maxMembers: response.team.max_members });
    } catch (reason) {
      setError(teamError(reason, "Не удалось загрузить команду"));
    } finally {
      setLoading(false);
    }
  }, [membershipId, token]);

  useEffect(() => { void load(); }, [load]);

  const createTeam = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !project) return;
    setBusy("create"); setError("");
    try {
      await postAuthJson(`/api/accelerators/memberships/${membershipId}/team`, { name: createForm.name.trim(), max_members: createForm.maxMembers }, token);
      await load();
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
    setBusy(`invitation-${invitationId}`); setError("");
    try {
      await patchAuthJson(`/api/accelerators/team-invitations/${invitationId}`, { status }, token);
      await load();
    } catch (reason) { setError(teamError(reason, status === "accepted" ? "Не удалось принять приглашение" : "Не удалось отклонить приглашение")); }
    finally { setBusy(""); }
  };

  const loadResidents = async () => {
    if (!token || !team?.can_manage || team.status !== "active") return;
    setBusy("recommendations"); setError("");
    try {
      const rows = await getAuthJson<ResidentRecommendation[]>(`/api/accelerators/memberships/${membershipId}/matchmaking/recommendations?role=resident`, token);
      setRecommendations(rows.filter((row) => row.profile.role === "resident"));
    } catch (reason) { setError(teamError(reason, "Не удалось подобрать резидентов")); }
    finally { setBusy(""); }
  };

  const invite = async (profileId: number) => {
    if (!token || !team?.can_manage || team.status !== "active") return;
    setBusy(`invite-${profileId}`); setError("");
    try {
      await postAuthJson(`/api/accelerators/teams/${team.id}/invitations`, { counterpart_profile_id: profileId, message: messages[profileId]?.trim() || null }, token);
      setMessages((current) => ({ ...current, [profileId]: "" }));
      await load();
    } catch (reason) { setError(teamError(reason, "Не удалось отправить приглашение")); }
    finally { setBusy(""); }
  };

  const cancelInvitation = async (invitationId: number) => {
    if (!token || !team?.can_manage || team.status !== "active" || !window.confirm("Отозвать приглашение в команду?")) return;
    setBusy(`cancel-${invitationId}`); setError("");
    try { await deleteAuth(`/api/accelerators/team-invitations/${invitationId}`, token); await load(); }
    catch (reason) { setError(teamError(reason, "Не удалось отозвать приглашение")); }
    finally { setBusy(""); }
  };

  const updateMember = async (member: TeamMember, payload: { role: "member" | "cofounder"; title: string | null }) => {
    if (!token || !team?.can_manage || team.status !== "active") return;
    setBusy(`member-${member.id}`); setError("");
    try { await patchAuthJson(`/api/accelerators/team-members/${member.id}`, payload, token); await load(); }
    catch (reason) { setError(teamError(reason, "Не удалось обновить роль участника")); }
    finally { setBusy(""); }
  };

  const toggleContact = async (member: TeamMember) => {
    if (!token || team?.status !== "active" || member.membership_id !== membershipId || member.status !== "active") return;
    setBusy(`contact-${member.id}`); setError("");
    try { await patchAuthJson(`/api/accelerators/team-members/${member.id}/contact`, { share_contact: !member.share_contact }, token); await load(); }
    catch (reason) { setError(teamError(reason, "Не удалось изменить доступ к контакту")); }
    finally { setBusy(""); }
  };

  const removeMember = async (member: TeamMember) => {
    if (!token || !team?.can_manage || team.status !== "active" || member.membership_id === team.owner_membership_id || !window.confirm(`Исключить ${member.person.name} из команды?`)) return;
    setBusy(`remove-${member.id}`); setError("");
    try { await deleteAuth(`/api/accelerators/team-members/${member.id}`, token); await load(); }
    catch (reason) { setError(teamError(reason, "Не удалось исключить участника")); }
    finally { setBusy(""); }
  };

  const archiveTeam = async () => {
    if (!token || !team?.can_manage || team.status !== "active" || !window.confirm(`Архивировать команду «${team.name}»? Вернуть её в работу через интерфейс нельзя.`)) return;
    setBusy("archive"); setError("");
    try { await patchAuthJson(`/api/accelerators/teams/${team.id}`, { status: "archived" }, token); await load(); }
    catch (reason) { setError(teamError(reason, "Не удалось архивировать команду")); }
    finally { setBusy(""); }
  };

  const leaveTeam = async () => {
    const ownMember = team?.members.find((member) => member.membership_id === membershipId);
    if (!token || !team || team.can_manage || team.status !== "active" || ownMember?.status !== "active" || !window.confirm(`Покинуть команду «${team.name}»?`)) return;
    setBusy("leave"); setError("");
    try { await deleteAuth(`/api/accelerators/team-members/${ownMember.id}`, token); await load(); }
    catch (reason) { setError(teamError(reason, "Не удалось покинуть команду")); }
    finally { setBusy(""); }
  };

  const actionableInvitations = useMemo(() => invitations.filter((invitation) => (invitation.status || "pending") === "pending" && invitation.can_respond !== false), [invitations]);
  const pendingTeamInvitations = useMemo(() => (team?.pending_invitations || []).filter((invitation) => (invitation.status || "pending") === "pending"), [team]);
  const pendingProfileIds = useMemo(() => new Set(pendingTeamInvitations.map(invitationProfileId).filter((id): id is number => Boolean(id))), [pendingTeamInvitations]);
  const activeMemberCount = team?.members.filter((member) => member.status === "active").length || 0;
  const capacityUsed = activeMemberCount + pendingTeamInvitations.length;
  const teamIsFull = Boolean(team && capacityUsed >= team.max_members);
  const viewerActive = team?.members.some((member) => member.membership_id === membershipId && member.status === "active") || false;
  const teamReadOnly = Boolean(team && (team.status !== "active" || (!team.can_manage && !viewerActive)));

  if (loading) return <section className="workspace-card grid min-h-44 place-items-center"><Loader2 className="animate-spin text-white/35" /></section>;

  return <div className="space-y-5">
    <section className="workspace-card">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.18em] text-white/30">Команда проекта</p><h2 className="mt-2 text-xl">{team ? team.name : "Соберите команду"}</h2><p className="mt-1 max-w-2xl text-sm text-white/40">{team?.status === "archived" ? "Архивная команда доступна только для просмотра." : team && !team.can_manage && !viewerActive ? "Вы больше не состоите в этой команде. История состава доступна только для просмотра." : "Приглашайте только рекомендованных резидентов. Контакты каждого участника скрыты, пока он сам не разрешит их показывать."}</p></div><button type="button" onClick={() => void load()} disabled={Boolean(busy)} className="rounded-full border border-white/10 p-3 text-white/40" aria-label="Обновить команду"><RefreshCw size={16} /></button></div>

      {actionableInvitations.length > 0 && <div className="mt-5 space-y-3"><h3 className="text-sm text-white/55">Входящие приглашения</h3>{actionableInvitations.map((invitation) => <article key={invitation.id} className="rounded-2xl border border-blue-300/15 bg-blue-300/[0.04] p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><p>{invitationTeamName(invitation)}</p>{invitation.invited_by?.name && <p className="mt-1 text-xs text-white/35">Приглашает {invitation.invited_by.name}</p>}{invitation.message && <p className="mt-2 text-sm text-white/50">{invitation.message}</p>}</div><div className="flex gap-2"><button type="button" onClick={() => void answerInvitation(invitation.id, "accepted")} disabled={Boolean(busy)} className="workspace-button"><Check size={14} /> Принять</button><button type="button" onClick={() => void answerInvitation(invitation.id, "declined")} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-4 py-2 text-sm text-white/50"><X size={14} /> Отклонить</button></div></div></article>)}</div>}

      {!team && project && <form onSubmit={createTeam} className="mt-6 grid gap-4 rounded-2xl border border-white/10 p-4 sm:grid-cols-[1fr_160px_auto]"><label className="text-sm text-white/55">Название<input value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} minLength={2} maxLength={200} required className="workspace-input mt-2" /></label><label className="text-sm text-white/55">Максимум участников<input type="number" min={2} max={20} value={createForm.maxMembers} onChange={(event) => setCreateForm({ ...createForm, maxMembers: Number(event.target.value) })} className="workspace-input mt-2" /></label><div className="flex items-end"><button disabled={busy === "create"} className="workspace-button"><Users size={15} /> Создать</button></div><p className="text-xs text-white/30 sm:col-span-3">Команда будет привязана к проекту «{project.name}».</p></form>}
      {!team && !project && <div className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-4 text-sm text-amber-100">Создать команду можно после зачисления проекта в поток.</div>}

      {team && <div className="mt-6">
        <div className="grid gap-3 sm:grid-cols-3"><Info label="Проект" value={team.project?.name || "Не привязан"} /><Info label="Занято и приглашено" value={`${capacityUsed} / ${team.max_members}`} /><Info label="Статус" value={team.status === "active" ? "Активна" : "В архиве"} /></div>
        {team.can_manage && team.status === "active" && <><form onSubmit={saveTeam} className="mt-5 grid gap-3 rounded-2xl border border-white/8 p-4 sm:grid-cols-[1fr_150px_auto]"><input value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} minLength={2} required aria-label="Название команды" className="workspace-input" /><input type="number" min={Math.max(2, capacityUsed)} max={20} value={settings.maxMembers} onChange={(event) => setSettings({ ...settings, maxMembers: Number(event.target.value) })} aria-label="Максимум участников команды" className="workspace-input" /><button disabled={busy === "settings"} className="workspace-button"><Save size={14} /> Сохранить</button></form><button type="button" onClick={() => void archiveTeam()} disabled={Boolean(busy)} className="mt-3 inline-flex items-center gap-1 rounded-full border border-red-300/15 px-4 py-2 text-sm text-red-200"><Trash2 size={14} /> Архивировать команду</button></>}
        {!team.can_manage && team.status === "active" && viewerActive && <button type="button" onClick={() => void leaveTeam()} disabled={Boolean(busy)} className="mt-4 inline-flex items-center gap-1 rounded-full border border-red-300/15 px-4 py-2 text-sm text-red-200"><X size={14} /> Покинуть команду</button>}
      </div>}
    </section>

    {team && <section className="workspace-card"><h2 className="flex items-center gap-2 text-xl"><ShieldCheck size={18} /> Участники</h2><div className="mt-5 grid gap-3 lg:grid-cols-2">{team.members.map((member) => <MemberCard key={`${member.id}-${member.role}-${member.title || ""}`} member={member} isSelf={member.membership_id === membershipId} isOwner={member.membership_id === team.owner_membership_id} canManage={team.can_manage} readOnly={teamReadOnly} busy={busy} onSave={updateMember} onToggleContact={toggleContact} onRemove={removeMember} />)}</div></section>}

    {team?.can_manage && team.status === "active" && <section className="workspace-card">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl"><UserPlus size={18} /> Пригласить резидента</h2><p className="mt-1 text-sm text-white/40">Кнопка приглашения доступна только для рекомендаций типа «резидент».</p></div><button type="button" onClick={() => void loadResidents()} disabled={Boolean(busy) || teamIsFull} className="workspace-button"><UserPlus size={15} /> Подобрать резидентов</button></div>
      {teamIsFull && <p className="mt-4 rounded-2xl bg-amber-300/[0.07] p-4 text-sm text-amber-100">В команде достигнут лимит участников. Увеличьте его в настройках команды.</p>}
      <div className="mt-5 grid gap-3 lg:grid-cols-2">{recommendations.map((item) => { const pending = pendingProfileIds.has(item.profile.id); return <article key={item.profile.id} className="rounded-2xl border border-white/9 p-4"><div className="flex items-start justify-between gap-3"><div><p>{item.profile.name}</p><p className="mt-1 text-xs text-white/35">резидент</p></div><span className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300">{item.score}%</span></div>{item.profile.bio && <p className="mt-3 text-sm text-white/50">{item.profile.bio}</p>}<p className="mt-3 text-xs text-white/35">{item.reasons.join(" · ")}</p><input value={messages[item.profile.id] || ""} onChange={(event) => setMessages((current) => ({ ...current, [item.profile.id]: event.target.value }))} maxLength={1000} aria-label={`Сообщение для ${item.profile.name}`} placeholder="Сообщение к приглашению" className="workspace-input mt-4" /><button type="button" onClick={() => void invite(item.profile.id)} disabled={Boolean(busy) || pending || teamIsFull} className="workspace-button mt-3"><Send size={14} /> {pending ? "Уже приглашён" : "Пригласить в команду"}</button></article>; })}{!recommendations.length && !teamIsFull && <p className="text-sm text-white/35">Нажмите «Подобрать резидентов», чтобы увидеть кандидатов.</p>}</div>
      {!!pendingTeamInvitations.length && <div className="mt-6 border-t border-white/8 pt-5"><h3 className="text-sm text-white/55">Ожидают ответа</h3><div className="mt-3 flex flex-wrap gap-2">{pendingTeamInvitations.map((invitation) => <div key={invitation.id} className="flex items-center gap-2 rounded-full border border-white/10 py-1.5 pl-3 pr-1.5 text-sm text-white/55"><span>{invitationPersonName(invitation)}</span>{invitation.can_cancel !== false && <button type="button" onClick={() => void cancelInvitation(invitation.id)} disabled={Boolean(busy)} className="rounded-full p-1.5 text-white/30 hover:text-red-300" aria-label={`Отозвать приглашение для ${invitationPersonName(invitation)}`}><Trash2 size={13} /></button>}</div>)}</div></div>}
    </section>}

    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}

function MemberCard({ member, isSelf, isOwner, canManage, readOnly, busy, onSave, onToggleContact, onRemove }: {
  member: TeamMember;
  isSelf: boolean;
  isOwner: boolean;
  canManage: boolean;
  readOnly: boolean;
  busy: string;
  onSave: (member: TeamMember, payload: { role: "member" | "cofounder"; title: string | null }) => Promise<void>;
  onToggleContact: (member: TeamMember) => Promise<void>;
  onRemove: (member: TeamMember) => Promise<void>;
}) {
  const [role, setRole] = useState<"member" | "cofounder">(member.role === "cofounder" ? "cofounder" : "member");
  const [title, setTitle] = useState(member.title || "");
  return <article className="rounded-2xl border border-white/9 p-4"><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2">{member.person.name}{isOwner && <Crown size={14} className="text-amber-300" />}</p><p className="mt-1 text-xs text-white/35">{member.title || member.role}{member.status !== "active" ? ` · ${member.status}` : ""}</p>{member.person.email && <a href={`mailto:${member.person.email}`} className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-300"><Mail size={12} /> {member.person.email}</a>}</div>{isSelf && !readOnly && <button type="button" onClick={() => void onToggleContact(member)} disabled={Boolean(busy)} aria-label={`${member.share_contact ? "Скрыть" : "Открыть"} контакт ${member.person.name}`} className={`rounded-full px-3 py-1.5 text-xs ${member.share_contact ? "bg-emerald-400/10 text-emerald-300" : "border border-white/10 text-white/40"}`}>{member.share_contact ? "Контакт открыт" : "Контакт скрыт"}</button>}</div>{canManage && !isOwner && !readOnly && <div className="mt-4 grid gap-2 sm:grid-cols-2"><select value={role} onChange={(event) => setRole(event.target.value as "member" | "cofounder")} aria-label={`Роль ${member.person.name}`} className="workspace-input"><option value="member">Участник</option><option value="cofounder">Сооснователь</option></select><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="Зона ответственности" aria-label={`Зона ответственности ${member.person.name}`} className="workspace-input" /><div className="flex gap-2 sm:col-span-2"><button type="button" onClick={() => void onSave(member, { role, title: title.trim() || null })} disabled={Boolean(busy)} className="workspace-button"><Save size={13} /> Сохранить роль</button><button type="button" onClick={() => void onRemove(member)} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-full border border-red-300/15 px-3 py-2 text-xs text-red-200"><Trash2 size={13} /> Исключить</button></div></div>}</article>;
}

function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-white/8 p-4"><p className="text-xs text-white/30">{label}</p><p className="mt-1 text-sm">{value}</p></div>; }
function invitationTeamName(row: TeamInvitation) { return row.team?.name || row.team_name || "Приглашение в команду"; }
function invitationPersonName(row: TeamInvitation) { return row.person?.name || row.profile?.name || row.invitee?.name || "Резидент"; }
function invitationProfileId(row: TeamInvitation) { return row.counterpart_profile_id || row.profile?.id || null; }

function teamError(reason: unknown, fallback: string) {
  if (reason instanceof ApiError && reason.status === 403) return "Недостаточно прав для этого действия в команде.";
  if (reason instanceof ApiError && reason.status === 409) {
    if (/архив/i.test(reason.message)) return "Команда уже находится в архиве и доступна только для просмотра.";
    if (/project|проект/i.test(reason.message)) return "Сначала привяжите к резидентству собственный проект.";
    if (/мест|заполн|лимит/i.test(reason.message)) return "В команде нет свободных мест.";
    if (/приглаш/i.test(reason.message)) return "Приглашение этому резиденту уже отправлено или обработано.";
    if (/команд|состоит/i.test(reason.message)) return "Резидент уже состоит в команде.";
    return reason.message || "Состояние команды уже изменилось. Обновите данные и повторите действие.";
  }
  return describeApiError(reason, fallback);
}
