"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save, Search, Trash2, UserRoundCheck } from "lucide-react";

import { deleteAuth, describeApiError, getAuthJson, postAuthJson, putAuthJson } from "@/lib/api";

type Resident = { membership_id: number; name: string; email: string; status: string };
type Tracker = { staff_id: number; user_id: number; name: string; email: string; membership_ids: number[] };
type Candidate = { id: number; name: string; email: string };

export function TrackerManager({ token, cohortId, residents }: { token: string; cohortId: number; residents: Resident[] }) {
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [assignments, setAssignments] = useState<Record<number, number[]>>({});
  const [newMembershipIds, setNewMembershipIds] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const assignableResidents = useMemo(() => residents.filter((row) => ["enrolled", "suspended"].includes(row.status)), [residents]);

  const load = useCallback(async () => {
    try {
      const rows = await getAuthJson<Tracker[]>(`/api/accelerators/cohorts/${cohortId}/trackers`, token);
      setTrackers(rows); setAssignments(Object.fromEntries(rows.map((row) => [row.user_id, row.membership_ids])));
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить трекеров")); }
  }, [cohortId, token]);
  useEffect(() => { void load(); setCandidates([]); setNewMembershipIds([]); }, [load]);

  const search = async (event: FormEvent) => {
    event.preventDefault(); if (query.trim().length < 2) return;
    setBusy("search"); setError("");
    try { setCandidates(await getAuthJson<Candidate[]>(`/api/accelerators/cohorts/${cohortId}/tracker-candidates?q=${encodeURIComponent(query.trim())}`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось найти пользователя")); }
    finally { setBusy(""); }
  };
  const toggle = (current: number[], membershipId: number) => current.includes(membershipId) ? current.filter((id) => id !== membershipId) : [...current, membershipId];
  const assign = async (candidate: Candidate) => {
    if (!newMembershipIds.length) { setError("Выберите хотя бы одного резидента для нового трекера"); return; }
    setBusy(`assign-${candidate.id}`); setError("");
    try {
      await postAuthJson(`/api/accelerators/cohorts/${cohortId}/trackers`, { user_id: candidate.id, membership_ids: newMembershipIds }, token);
      setCandidates([]); setQuery(""); setNewMembershipIds([]); await load();
    } catch (reason) { setError(describeApiError(reason, "Не удалось назначить трекера")); }
    finally { setBusy(""); }
  };
  const save = async (tracker: Tracker) => {
    setBusy(`save-${tracker.user_id}`); setError("");
    try { await putAuthJson(`/api/accelerators/cohorts/${cohortId}/trackers/${tracker.user_id}`, { membership_ids: assignments[tracker.user_id] || [] }, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось сохранить назначения")); }
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
    <section className="workspace-card"><h2 className="text-xl">Назначить трекера</h2><p className="mt-1 text-sm text-white/40">Трекер увидит отчёты только выбранных резидентов.</p>
      <form onSubmit={search} className="mt-5 flex gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} minLength={2} placeholder="Имя или email" className="workspace-input" /><button className="workspace-button shrink-0" disabled={busy === "search"}>{busy === "search" ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Найти</button></form>
      {candidates.length > 0 && <div className="mt-4 rounded-2xl border border-white/10 p-4">{residentChecklist(newMembershipIds, setNewMembershipIds)}<div className="mt-4 space-y-2">{candidates.map((candidate) => <div key={candidate.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[.03] p-3"><div><p>{candidate.name}</p><p className="text-xs text-white/35">{candidate.email}</p></div><button type="button" onClick={() => void assign(candidate)} className="workspace-button" disabled={Boolean(busy)}><UserRoundCheck size={15} /> Назначить</button></div>)}</div></div>}
    </section>
    <section className="workspace-card"><h2 className="text-xl">Трекеры потока</h2><div className="mt-5 space-y-4">{!trackers.length ? <p className="text-sm text-white/35">Трекеры ещё не назначены.</p> : trackers.map((tracker) => <article key={tracker.user_id} className="rounded-2xl border border-white/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p>{tracker.name}</p><p className="text-sm text-white/35">{tracker.email}</p></div><button type="button" onClick={() => void remove(tracker)} title="Убрать трекера" className="rounded-xl border border-white/10 p-2 text-white/40 hover:text-red-300"><Trash2 size={15} /></button></div>{residentChecklist(assignments[tracker.user_id] || [], (ids) => setAssignments((current) => ({ ...current, [tracker.user_id]: ids })))}<button type="button" onClick={() => void save(tracker)} disabled={Boolean(busy)} className="workspace-button mt-4"><Save size={15} /> Сохранить назначения</button></article>)}</div></section>
    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}
