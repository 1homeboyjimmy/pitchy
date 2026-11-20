"use client";

import { useAcceleratorRefresh } from "@/lib/hooks/useAcceleratorRefresh";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Crown, Loader2, Mail, Search, Users, X } from "lucide-react";
import { describeApiError, getAuthJson, putAuthJson } from "@/lib/api";
import type { ResidentTeam } from "@/components/accelerator/TeamWorkspace";
import { useAcceleratorNavigationState } from "@/lib/hooks/useAcceleratorNavigation";
import { ResultPages } from "./ResultPages";

type Tracker = { user_id: number; name: string; email: string };
type Status = "all" | "recruiting" | "pending" | "ready";
type Sort = "name" | "members" | "attendance-asc" | "attendance-desc";
const PAGE_SIZES = [12, 20, 40, 60];

export function TeamManager({ cohortId, token, trackersEnabled = true, focusTeamId }: { cohortId: number; token: string; trackersEnabled?: boolean; focusTeamId?: number }) {
  const [attendanceFilter, setAttendanceFilter] = useAcceleratorNavigationState("TeamManager:attendanceFilter", "all");
  const [teams, setTeams] = useState<ResidentTeam[]>([]);
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [selected, setSelected] = useState<ResidentTeam | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [sort, setSort] = useState<Sort>("name");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [teamResult, trackerRows] = await Promise.all([
        getAuthJson<{ teams: ResidentTeam[] }>(`/api/accelerators/cohorts/${cohortId}/teams`, token),
        trackersEnabled ? getAuthJson<Tracker[]>(`/api/accelerators/cohorts/${cohortId}/trackers`, token).catch(() => []) : Promise.resolve([]),
      ]);
      const rows = teamResult.teams || [];
      setTeams(rows);
      setTrackers(trackerRows);
      setSelected(current => current ? rows.find(row => row.id === current.id) || null : null);
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось загрузить команды потока"));
    } finally {
      setLoading(false);
    }
  }, [cohortId, token, trackersEnabled]);

  useAcceleratorRefresh(load, cohortId);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const entries = useMemo(() => teams.map(team => ({
    team,
    activeMembers: team.members.filter(member => member.status === "active"),
    pending: pendingCount(team),
  })), [teams]);
  useEffect(() => { if (focusTeamId) setSelected(teams.find(team => team.id === focusTeamId) || null); }, [teams, focusTeamId]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter(entry => attendanceFilter !== "zero" || (entry.team.attendance_percent === 0 && !entry.team.attendance_team_id && entry.team.status === "active")).filter(({ team, activeMembers, pending }) => {
      const matchesStatus = status === "all" || (status === "recruiting" && team.recruiting_open)
        || (status === "pending" && pending > 0) || (status === "ready" && activeMembers.length >= team.max_members);
      return matchesStatus && (!needle || [team.name, team.project?.name || "", ...team.members.map(member => member.person.name)]
        .some(value => value.toLowerCase().includes(needle)));
    }).sort((a, b) => {
      const byName = () => a.team.name.localeCompare(b.team.name, "ru");
      if (sort === "members") return b.activeMembers.length - a.activeMembers.length || byName();
      if (sort === "name") return byName();
      const left = a.team.attendance_percent;
      const right = b.team.attendance_percent;
      if (left == null) return right == null ? byName() : 1;
      if (right == null) return -1;
      return (sort === "attendance-asc" ? left - right : right - left) || byName();
    });
  }, [entries, query, sort, status, attendanceFilter]);
  const hasTrackers = trackersEnabled && filtered.some(({ team }) => Boolean(team.tracker?.name));
  const desktopColumns = hasTrackers
    ? "md:grid-cols-[minmax(0,1.6fr)_minmax(max-content,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto]"
    : "md:grid-cols-[minmax(0,1.6fr)_minmax(max-content,1fr)_minmax(0,1fr)_auto]";
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const pageStart = currentPage * pageSize;
  const members = new Set(entries.flatMap(({ activeMembers }) => activeMembers.map(member => member.membership_id))).size;
  const pending = entries.reduce((sum, entry) => sum + entry.pending, 0);

  const assignTracker = async (value: string) => {
    if (!selected || !value) return;
    setBusy("tracker");
    try {
      await putAuthJson(`/api/accelerators/teams/${selected.id}/tracker`, { tracker_user_id: Number(value) }, token);
      await load();
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось назначить трекера команды"));
    } finally {
      setBusy("");
    }
  };

  return <section>
    <div className="flex flex-wrap items-center gap-x-7 gap-y-3 rounded-2xl border border-white/8 px-5 py-4">
      <Stat value={teams.length} label="команды" />
      <Stat value={members} label="участников" />
      <Stat value={pending} label="ожидают ответа" tone={pending ? "yellow" : undefined} />
    </div>
    <label className="mt-5 block text-xs text-white/50">Посещаемость команд<select aria-label="Посещаемость команд" value={attendanceFilter} onChange={event => {setAttendanceFilter(event.target.value);setPage(0)}} className="workspace-input mt-2"><option value="all">Все команды</option><option value="zero">Нулевая посещаемость</option></select></label>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_minmax(0,17rem)]">
      <label className="relative block min-w-0 sm:col-span-2 xl:col-span-1">
        <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
        <input type="search" aria-label="Поиск по командам, участникам или проектам" value={query}
          onChange={event => { setQuery(event.target.value); setPage(0); }}
          placeholder="Поиск по командам, участникам или проектам" className="workspace-input !pl-11" />
      </label>
      <select aria-label="Статус команды" value={status} onChange={event => { setStatus(event.target.value as Status); setPage(0); }} className="workspace-input">
        <option value="all">Статус: все</option>
        <option value="recruiting">Набор открыт</option>
        <option value="pending">Ожидают ответа</option>
        <option value="ready">Команда собрана</option>
      </select>
      <select aria-label="Сортировка команд" value={sort} onChange={event => { setSort(event.target.value as Sort); setPage(0); }} className="workspace-input">
        <option value="name">Сортировка: по названию</option>
        <option value="members">По числу участников</option>
        <option value="attendance-asc">Посещаемость ↑</option>
        <option value="attendance-desc">Посещаемость ↓</option>
      </select>
    </div>
    {loading && !teams.length ? <div className="grid min-h-56 place-items-center"><Loader2 className="animate-spin text-white/35" /></div>
      : filtered.length ? <>
        <ul aria-label="Команды потока" className="mt-5 divide-y divide-white/8 rounded-2xl border border-white/9">
          {filtered.slice(pageStart, pageStart + pageSize).map(({ team, activeMembers }) => <li key={team.id}>
            <button type="button" onClick={() => setSelected(team)}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3 gap-y-2 p-4 text-left hover:bg-white/5 ${desktopColumns}`}>
              <span className="col-start-1 row-start-1 min-w-0 [overflow-wrap:anywhere]">
                <span className="block text-sm font-medium leading-6">{team.name}</span>
                {hasDistinctProjectName(team) && <span className="mt-0.5 block text-xs text-white/50">{team.project?.name}</span>}
              </span>
              <span className="col-start-2 row-start-1 flex items-baseline gap-1.5 whitespace-nowrap text-xs text-white/70">
                Посещаемость <strong className="text-base font-semibold tabular-nums text-white">{attendanceLabel(team)}</strong>
              </span>
              <span className="col-start-1 row-start-2 flex flex-wrap gap-1 md:col-start-3 md:row-start-1">
                {activeMembers.map(member => <span key={member.id} title={member.person.name}
                  className="grid size-7 place-items-center rounded-full bg-white/10 text-[10px]">
                  <span aria-hidden="true">{member.person.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2)}</span>
                  <span className="sr-only">{member.person.name}</span>
                </span>)}
              </span>
              {team.tracker?.name && <span className="col-start-2 row-start-2 min-w-0 text-xs text-white/50 [overflow-wrap:anywhere] md:col-start-4 md:row-start-1">
                {team.tracker.name}
              </span>}
              <ChevronRight size={16} className={`col-start-3 row-start-1 self-center text-white/40 ${hasTrackers ? "md:col-start-5" : "md:col-start-4"}`} />
            </button>
          </li>)}
        </ul>
        <ResultPages page={currentPage} pageSize={pageSize} total={filtered.length} onChange={setPage}>
          <select aria-label="Команд на странице" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }}
            className="workspace-input !w-auto !rounded-lg !px-3 !py-2">
            {PAGE_SIZES.map(size => <option key={size} value={size}>{size} на странице</option>)}
          </select>
        </ResultPages>
      </> : <div className="py-16 text-center">
        <Users className="mx-auto text-white/20" />
        <p className="mt-4">{teams.length ? "Команды не найдены" : "Команд пока нет"}</p>
        <p className="mt-2 text-sm text-white/50">{teams.length ? "Измените поиск или статус." : "Они появятся после создания участниками."}</p>
      </div>}
    {error && <p role="alert" className="mt-5 rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
    {selected && <div className="fixed inset-0 z-[80] flex justify-end bg-black/65" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}>
      <aside role="dialog" aria-modal="true" aria-labelledby="team-title"
        className="h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#1c1b1b] p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <h2 id="team-title" className="text-2xl">{selected.name}</h2>
            {hasDistinctProjectName(selected) && <p className="mt-1 text-sm text-white/40">Проект: {selected.project?.name}</p>}
            {!selected.project && <p className="mt-1 text-sm text-white/40">Проект не привязан</p>}
          </div>
          <button type="button" onClick={() => setSelected(null)} aria-label="Закрыть карточку команды" className="shrink-0">
            <X className="text-white/45" />
          </button>
        </div>
        <div className="mt-6 flex gap-2">
          <span className="rounded-full bg-white/7 px-3 py-1.5 text-xs">
            <Users size={13} className="mr-1 inline" />{selected.members.filter(member => member.status === "active").length}/{selected.max_members}
          </span>
          <span className={`rounded-full px-3 py-1.5 text-xs ${selected.recruiting_open ? "bg-emerald-400/10 text-emerald-300" : "bg-white/7 text-white/45"}`}>
            {selected.recruiting_open ? "Набор открыт" : "Набор закрыт"}
          </span>
        </div>
        <div className="my-6 border-t border-white/8" />
        <section>
          <p className="mb-4 text-sm text-white/60">Посещаемость {attendanceLabel(selected)}</p>
          <h3>Капитан</h3>
          <div className="mt-3">{selected.members.filter(member => member.membership_id === selected.owner_membership_id)
            .map(member => <Member key={member.id} member={member} captain />)}</div>
        </section>
        <section className="mt-7">
          <h3>Участники</h3>
          <div className="mt-3 space-y-2">{selected.members.filter(member => member.membership_id !== selected.owner_membership_id && member.status === "active")
            .map(member => <Member key={member.id} member={member} />)}</div>
        </section>
        {pendingCount(selected) > 0 && <section className="mt-7 border-t border-white/8 pt-6">
          <h3>Ожидают ответа</h3>
          <div className="mt-3 space-y-2">{selected.pending_invitations.filter(row => (row.status || "pending") === "pending")
            .map(row => <p key={row.id} className="rounded-xl border border-amber-300/15 p-3 text-sm text-amber-100">
              {row.invitee?.name || row.person?.name || "Приглашённый участник"}
              <span className="mt-1 block text-xs text-white/35">Приглашение отправлено</span>
            </p>)}</div>
        </section>}
        {trackersEnabled && <section className="mt-7 border-t border-white/8 pt-5">
          <h3>Трекер команды</h3>
          <p className="mt-1 text-xs text-white/35">Назначение применяется ко всей команде.</p>
          <select value={selected.tracker?.id || ""} onChange={event => void assignTracker(event.target.value)}
            disabled={busy === "tracker"} className="workspace-input mt-3">
            <option value="">Не назначен</option>
            {trackers.map(tracker => <option key={tracker.user_id} value={tracker.user_id}>{tracker.name}</option>)}
          </select>
        </section>}
      </aside>
    </div>}
  </section>;
}

function pendingCount(team: ResidentTeam) {
  return team.pending_invitations.filter(row => (row.status || "pending") === "pending").length;
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: "yellow" }) {
  return <p>
    <strong className={`mr-2 text-xl ${tone ? "text-amber-200" : ""}`}>{value}</strong><span className="text-sm text-white/45">{label}</span>
  </p>;
}

function Member({ member, captain }: { member: ResidentTeam["members"][number]; captain?: boolean }) {
  return <div className="rounded-xl border border-white/8 p-3">
    <p className="flex items-center gap-2 text-sm">{member.person.name}{captain && <Crown size={13} className="text-amber-300" />}</p>
    <p className="mt-1 text-xs text-white/35">{member.title || member.role}</p>
    {member.person.email && <a href={`mailto:${member.person.email}`} className="mt-2 inline-flex items-center gap-1 text-xs text-blue-200">
      <Mail size={11} />{member.person.email}
    </a>}
  </div>;
}

function attendanceLabel(team: ResidentTeam) {
  return team.attendance_percent == null ? "—" : `${team.attendance_percent}%`;
}

function hasDistinctProjectName(team: ResidentTeam) {
  const projectName = team.project?.name.trim();
  return Boolean(projectName && projectName.toLowerCase() !== team.name.trim().toLowerCase());
}
