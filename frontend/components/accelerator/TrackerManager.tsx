"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Save, Search, Trash2, UserRoundCheck, Users } from "lucide-react";
import { deleteAuth, describeApiError, getAuthJson, postAuthJson, putAuthJson } from "@/lib/api";

type Resident = { membership_id: number; name: string; email: string; status: string };
type Tracker = { staff_id: number; user_id: number; name: string; email: string; membership_ids: number[]; team_ids: number[] };
type Candidate = { id: number; name: string; email: string };
type QueueTeam = { team_id: number; team_name: string; member_count: number; issue: "unassigned" | "conflict"; personal_trackers: Array<{ id: number; name: string }> };
type TrackerQueue = { teams: QueueTeam[]; participants: Resident[]; trackers: Candidate[]; team_membership_ids: number[] };

export function TrackerManager({ token, cohortId, residents }: { token: string; cohortId: number; residents: Resident[] }) {
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [queue, setQueue] = useState<TrackerQueue>({ teams: [], participants: [], trackers: [], team_membership_ids: [] });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [assignments, setAssignments] = useState<Record<number, number[]>>({});
  const [teamSelections, setTeamSelections] = useState<Record<number, number>>({});
  const [newMembershipIds, setNewMembershipIds] = useState<number[]>([]);
  const [newTeamId, setNewTeamId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const teamMembershipIds = useMemo(() => new Set(queue.team_membership_ids), [queue.team_membership_ids]);
  const assignableResidents = useMemo(() => residents.filter((row) => ["enrolled", "suspended"].includes(row.status) && !teamMembershipIds.has(row.membership_id)), [residents, teamMembershipIds]);

  const load = useCallback(async () => {
    try {
      const [rows, workQueue] = await Promise.all([
        getAuthJson<Tracker[]>(`/api/accelerators/cohorts/${cohortId}/trackers`, token),
        getAuthJson<TrackerQueue>(`/api/accelerators/cohorts/${cohortId}/tracker-work-queue`, token),
      ]);
      setTrackers(rows); setQueue(workQueue);
      setAssignments(Object.fromEntries(rows.map((row) => [row.user_id, row.membership_ids])));
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить назначения трекеров")); }
  }, [cohortId, token]);
  useEffect(() => { void load(); setCandidates([]); setNewMembershipIds([]); setNewTeamId(null); }, [load]);

  const search = async (event: FormEvent) => {
    event.preventDefault(); if (query.trim().length < 2) return;
    setBusy("search"); setError("");
    try { setCandidates(await getAuthJson<Candidate[]>(`/api/accelerators/cohorts/${cohortId}/tracker-candidates?q=${encodeURIComponent(query.trim())}`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось найти пользователя")); }
    finally { setBusy(""); }
  };
  const toggle = (current: number[], membershipId: number) => current.includes(membershipId) ? current.filter((id) => id !== membershipId) : [...current, membershipId];
  const assignCandidate = async (candidate: Candidate) => {
    if (!newTeamId && !newMembershipIds.length) { setError("Выберите команду или участника без команды"); return; }
    setBusy(`assign-${candidate.id}`); setError("");
    try {
      if (newTeamId) await putAuthJson(`/api/accelerators/teams/${newTeamId}/tracker`, { tracker_user_id: candidate.id }, token);
      else await postAuthJson(`/api/accelerators/cohorts/${cohortId}/trackers`, { user_id: candidate.id, membership_ids: newMembershipIds }, token);
      setCandidates([]); setQuery(""); setNewMembershipIds([]); setNewTeamId(null); await load();
    } catch (reason) { setError(describeApiError(reason, "Не удалось назначить трекера")); }
    finally { setBusy(""); }
  };
  const assignTeam = async (teamId: number) => {
    const trackerUserId = teamSelections[teamId];
    if (!trackerUserId) { setError("Выберите трекера для команды"); return; }
    setBusy(`team-${teamId}`); setError("");
    try { await putAuthJson(`/api/accelerators/teams/${teamId}/tracker`, { tracker_user_id: trackerUserId }, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось назначить трекера команде")); }
    finally { setBusy(""); }
  };
  const save = async (tracker: Tracker) => {
    setBusy(`save-${tracker.user_id}`); setError("");
    try { await putAuthJson(`/api/accelerators/cohorts/${cohortId}/trackers/${tracker.user_id}`, { membership_ids: assignments[tracker.user_id] || [] }, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось сохранить персональные назначения")); }
    finally { setBusy(""); }
  };
  const remove = async (tracker: Tracker) => {
    if (!window.confirm(`Убрать трекера ${tracker.name} из этого потока?`)) return;
    setBusy(`remove-${tracker.user_id}`);
    try { await deleteAuth(`/api/accelerators/cohorts/${cohortId}/trackers/${tracker.user_id}`, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось убрать трекера")); }
    finally { setBusy(""); }
  };
  const residentChecklist = (selected: number[], onChange: (ids: number[]) => void) => <div className="mt-3 grid gap-2 sm:grid-cols-2">{assignableResidents.map((resident) => <label key={resident.membership_id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/8 p-3"><input type="checkbox" checked={selected.includes(resident.membership_id)} onChange={() => onChange(toggle(selected, resident.membership_id))} className="mt-1" /><span><span className="block text-sm">{resident.name}</span><span className="block text-xs text-white/35">{resident.email} · {resident.status === "suspended" ? "приостановлен" : "активен"}</span></span></label>)}</div>;

  return <div className="space-y-6">
    <section className="workspace-card"><div className="flex items-start gap-3"><AlertTriangle className="mt-1 text-amber-300" size={19} /><div><h2 className="text-xl">Рабочая очередь</h2><p className="mt-1 text-sm text-white/40">Назначьте трекеров командам и участникам без команды. Конфликт означает разные прежние назначения членов команды.</p></div></div>
      <div className="mt-5 space-y-3">{queue.teams.map((team) => <article key={team.team_id} className="rounded-2xl border border-white/10 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="flex items-center gap-2"><Users size={15} />{team.team_name}</p><p className="mt-1 text-xs text-white/35">{team.member_count} участников · {team.issue === "conflict" ? `конфликт: ${team.personal_trackers.map((row) => row.name).join(", ")}` : "трекер не назначен"}</p></div><div className="flex gap-2"><select aria-label={`Трекер команды ${team.team_name}`} value={teamSelections[team.team_id] || ""} onChange={(event) => setTeamSelections((current) => ({ ...current, [team.team_id]: Number(event.target.value) }))} className="workspace-input min-w-48"><option value="">Выберите трекера</option>{queue.trackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.name}</option>)}</select><button type="button" onClick={() => void assignTeam(team.team_id)} disabled={Boolean(busy)} className="workspace-button">Назначить</button></div></div></article>)}{!queue.teams.length && !queue.participants.length && <p className="text-sm text-emerald-300">Очередь пуста: все активные команды и участники распределены.</p>}{queue.participants.length > 0 && <p className="text-sm text-amber-100">Без персонального трекера: {queue.participants.map((row) => row.name).join(", ")}</p>}</div>
    </section>
    <section className="workspace-card"><h2 className="text-xl">Добавить трекера</h2><p className="mt-1 text-sm text-white/40">Команде назначается один общий трекер. Персональный трекер доступен участнику без команды.</p>
      <form onSubmit={search} className="mt-5 flex gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} minLength={2} placeholder="Имя или email" className="workspace-input" /><button className="workspace-button shrink-0" disabled={busy === "search"}>{busy === "search" ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Найти</button></form>
      {candidates.length > 0 && <div className="mt-4 rounded-2xl border border-white/10 p-4"><label className="text-sm text-white/55">Назначить команде<select value={newTeamId || ""} onChange={(event) => setNewTeamId(event.target.value ? Number(event.target.value) : null)} className="workspace-input mt-2"><option value="">Без команды — выбрать участников ниже</option>{queue.teams.map((team) => <option key={team.team_id} value={team.team_id}>{team.team_name}</option>)}</select></label>{!newTeamId && residentChecklist(newMembershipIds, setNewMembershipIds)}<div className="mt-4 space-y-2">{candidates.map((candidate) => <div key={candidate.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[.03] p-3"><div><p>{candidate.name}</p><p className="text-xs text-white/35">{candidate.email}</p></div><button type="button" onClick={() => void assignCandidate(candidate)} className="workspace-button" disabled={Boolean(busy)}><UserRoundCheck size={15} /> Назначить</button></div>)}</div></div>}
    </section>
    <section className="workspace-card"><h2 className="text-xl">Трекеры потока</h2><div className="mt-5 space-y-4">{!trackers.length ? <p className="text-sm text-white/35">Трекеры ещё не назначены.</p> : trackers.map((tracker) => <article key={tracker.user_id} className="rounded-2xl border border-white/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p>{tracker.name}</p><p className="text-sm text-white/35">{tracker.email} · команд: {tracker.team_ids.length}</p></div><button type="button" onClick={() => void remove(tracker)} title="Убрать трекера" className="rounded-xl border border-white/10 p-2 text-white/40 hover:text-red-300"><Trash2 size={15} /></button></div><p className="mt-4 text-xs uppercase tracking-wide text-white/30">Персональные участники без команды</p>{residentChecklist(assignments[tracker.user_id] || [], (ids) => setAssignments((current) => ({ ...current, [tracker.user_id]: ids })))}<button type="button" onClick={() => void save(tracker)} disabled={Boolean(busy)} className="workspace-button mt-4"><Save size={15} /> Сохранить персональные назначения</button></article>)}</div></section>
    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}
