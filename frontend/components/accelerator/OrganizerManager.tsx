"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, Search, Trash2, UserPlus } from "lucide-react";

import { deleteAuth, describeApiError, getAuthJson, postAuthJson } from "@/lib/api";

type Organizer = { id: number; user_id: number; name: string; email: string };
type Candidate = { id: number; name: string; email: string };

export function OrganizerManager({ token, acceleratorId }: { token: string; acceleratorId: number }) {
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setOrganizers(await getAuthJson<Organizer[]>(`/api/accelerators/${acceleratorId}/organizers`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить организаторов")); }
  }, [acceleratorId, token]);
  useEffect(() => { void load(); setCandidates([]); setQuery(""); }, [load]);

  const search = async (event: FormEvent) => {
    event.preventDefault(); if (query.trim().length < 2) return;
    setBusy("search"); setError("");
    try { setCandidates(await getAuthJson<Candidate[]>(`/api/accelerators/${acceleratorId}/organizer-candidates?q=${encodeURIComponent(query.trim())}`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось найти пользователя")); }
    finally { setBusy(""); }
  };
  const assign = async (candidate: Candidate) => {
    setBusy(`assign-${candidate.id}`); setError("");
    try { await postAuthJson(`/api/accelerators/${acceleratorId}/organizers`, { user_id: candidate.id }, token); setCandidates((rows) => rows.filter((row) => row.id !== candidate.id)); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось назначить организатора")); }
    finally { setBusy(""); }
  };
  const remove = async (organizer: Organizer) => {
    if (!window.confirm(`Убрать ${organizer.name} из организаторов?`)) return;
    setBusy(`remove-${organizer.user_id}`); setError("");
    try { await deleteAuth(`/api/accelerators/${acceleratorId}/organizers/${organizer.user_id}`, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось убрать организатора")); }
    finally { setBusy(""); }
  };

  return <section className="workspace-card">
    <h2 className="text-xl">Команда организаторов</h2><p className="mt-1 text-sm text-white/40">Найдите пользователя Pitchy по имени или email. Числовой ID больше не нужен.</p>
    <form onSubmit={search} className="mt-5 flex gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} minLength={2} placeholder="Имя или email" className="workspace-input" /><button disabled={busy === "search"} className="workspace-button shrink-0">{busy === "search" ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Найти</button></form>
    {candidates.length > 0 && <div className="mt-4 rounded-2xl border border-white/10 p-3"><p className="mb-2 text-xs uppercase tracking-[.16em] text-white/30">Результаты</p>{candidates.map((candidate) => <div key={candidate.id} className="flex items-center justify-between gap-3 border-t border-white/[.06] py-3 first:border-0"><div><p className="text-sm">{candidate.name}</p><p className="text-xs text-white/35">{candidate.email}</p></div><button type="button" onClick={() => void assign(candidate)} disabled={Boolean(busy)} className="workspace-button"><UserPlus size={15} /> Назначить</button></div>)}</div>}
    <div className="mt-6 space-y-3">{!organizers.length ? <p className="text-sm text-white/35">Организаторы ещё не назначены.</p> : organizers.map((organizer) => <div key={organizer.user_id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 p-4"><div><p>{organizer.name}</p><p className="text-sm text-white/40">{organizer.email}</p></div><button type="button" title="Убрать организатора" onClick={() => void remove(organizer)} disabled={Boolean(busy)} className="rounded-xl border border-white/10 p-2 text-white/40 hover:text-red-300"><Trash2 size={16} /></button></div>)}</div>
    {error && <p role="alert" className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </section>;
}
