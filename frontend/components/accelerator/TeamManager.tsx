"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Loader2, Mail, RefreshCw, Search, Users } from "lucide-react";

import { describeApiError, getAuthJson } from "@/lib/api";
import type { ResidentTeam } from "@/components/accelerator/TeamWorkspace";

type TeamListResponse = { teams: ResidentTeam[] };

export function TeamManager({ cohortId, token }: { cohortId: number; token: string }) {
  const [teams, setTeams] = useState<ResidentTeam[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await getAuthJson<TeamListResponse>(`/api/accelerators/cohorts/${cohortId}/teams`, token);
      setTeams(response.teams || []);
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить команды потока")); }
    finally { setLoading(false); }
  }, [cohortId, token]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return teams;
    return teams.filter((team) => [team.name, team.project?.name || "", ...team.members.map((member) => member.person.name)]
      .some((value) => value.toLocaleLowerCase("ru").includes(normalized)));
  }, [query, teams]);
  const memberCount = useMemo(() => teams.reduce((total, team) => total + team.members.filter((member) => member.status === "active").length, 0), [teams]);

  return <section className="workspace-card">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.18em] text-white/30">Матчмейкинг резидентов</p><h2 className="mt-2 text-xl">Команды потока</h2><p className="mt-1 max-w-2xl text-sm text-white/40">Организатор видит состав и заполненность команд, но не принимает приглашения вместо резидентов.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="rounded-full border border-white/10 p-3 text-white/40" aria-label="Обновить команды"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-3"><Stat label="Команды" value={teams.length} /><Stat label="Участники" value={memberCount} /><Stat label="Ожидают ответа" value={teams.reduce((total, team) => total + pendingCount(team), 0)} /></div>
    <label className="relative mt-5 block max-w-lg"><Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Команда, проект или участник" className="workspace-input !pl-11" /></label>

    {loading && !teams.length ? <div className="grid min-h-44 place-items-center"><Loader2 className="animate-spin text-white/35" /></div> : filtered.length ? <div className="mt-5 grid gap-4 xl:grid-cols-2">{filtered.map((team) => <article key={team.id} className="rounded-2xl border border-white/9 bg-white/[0.02] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg">{team.name}</h3><p className="mt-1 text-xs text-white/35">{team.project?.name || "Проект не привязан"}</p></div><span className={`rounded-full px-2.5 py-1 text-xs ${team.status === "active" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/7 text-white/40"}`}>{team.members.filter((member) => member.status === "active").length + pendingCount(team)}/{team.max_members}</span></div>
      <div className="mt-4 space-y-2">{team.members.map((member) => <div key={member.id} className="rounded-xl border border-white/7 p-3"><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm">{member.person.name}{member.membership_id === team.owner_membership_id && <Crown size={13} className="text-amber-300" />}</p><p className="mt-1 text-xs text-white/35">{member.title || member.role}</p>{member.person.email && <a href={`mailto:${member.person.email}`} className="mt-1 inline-flex items-center gap-1 text-xs text-blue-300"><Mail size={11} /> {member.person.email}</a>}</div>{member.status !== "active" && <span className="text-xs text-white/30">{member.status}</span>}</div></div>)}</div>
      {pendingCount(team) > 0 && <p className="mt-4 text-xs text-amber-200">Ожидают ответа: {pendingCount(team)}</p>}
    </article>)}</div> : <div className="py-12 text-center"><Users className="mx-auto mb-4 text-white/20" size={32} /><h3>Команд пока нет</h3><p className="mt-2 text-sm text-white/35">Они появятся после того, как резиденты создадут команды своих проектов.</p></div>}
    {error && <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </section>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border border-white/8 p-4"><p className="text-2xl">{value}</p><p className="mt-1 text-xs text-white/35">{label}</p></div>; }
function pendingCount(team: ResidentTeam) { return team.pending_invitations.filter((invitation) => (invitation.status || "pending") === "pending").length; }
