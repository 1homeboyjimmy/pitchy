"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { History, Loader2, Plus, Search, UserRoundCheck } from "lucide-react";

import { describeApiError, getAuthJson, postAuthJson, putAuthJson } from "@/lib/api";
import type { MatchProfile } from "@/components/accelerator/MatchmakingWorkspace";
import { TeamManager } from "@/components/accelerator/TeamManager";

type Candidate = { id: number; name: string; email: string };
type HistoryRow = { id: number; action: string; target_type: string; target_id: number | null; actor_user_id: number | null; details: Record<string, unknown>; created_at: string };

const HISTORY_LABELS: Record<string, string> = {
  "team.application_created": "Подана заявка в команду",
  "team.application_accepted": "Заявка в команду принята",
  "team.application_declined": "Заявка в команду отклонена",
  "team.application_cancelled": "Заявка в команду отозвана",
  "team.member_left": "Участник вышел из команды",
  "team.member_removed": "Участник исключён из команды",
  "team.captain_transferred": "Передано капитанство",
  "team.recruiting_updated": "Изменён статус набора",
  "team.closed_by_last_member": "Команда закрыта последним участником",
  "tracker.team_assigned": "Назначен трекер команды",
  "tracker.assigned": "Назначен персональный трекер",
  "tracker.assignments_updated": "Изменены назначения трекера",
  "tracker.removed": "Трекер снят",
  "cohort.expert_assigned": "Назначен эксперт потока",
};

const parseTags = (value: string) => Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));

export function MatchmakingManager({ cohortId, token }: { cohortId: number; token: string }) {
  const [profiles, setProfiles] = useState<MatchProfile[]>([]);
  const [currentExpert, setCurrentExpert] = useState<{ user_id: number; name: string; email: string } | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [poolForm, setPoolForm] = useState({ bio: "", expertise: "", industries: "", goals: "", formats: "", maxMatches: 5 });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy("load"); setError("");
    try {
      const [profileRows, expert, historyRows] = await Promise.all([
        getAuthJson<MatchProfile[]>(`/api/accelerators/cohorts/${cohortId}/matchmaking/profiles`, token),
        getAuthJson<{ user_id: number; name: string; email: string } | null>(`/api/accelerators/cohorts/${cohortId}/expert`, token),
        getAuthJson<HistoryRow[]>(`/api/accelerators/cohorts/${cohortId}/matchmaking-history`, token),
      ]);
      setProfiles(profileRows); setCurrentExpert(expert); setHistory(historyRows);
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить матчмейкинг")); }
    finally { setBusy(""); }
  }, [cohortId, token]);
  useEffect(() => { void load(); }, [load]);

  const experts = useMemo(() => profiles.filter((row) => row.role === "expert" && row.active), [profiles]);

  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy("search"); setError("");
    try { setCandidates(await getAuthJson<Candidate[]>(`/api/accelerators/cohorts/${cohortId}/matchmaking/candidates?role=expert&q=${encodeURIComponent(query)}`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось найти эксперта")); }
    finally { setBusy(""); }
  };

  const addExpertProfile = async (event: FormEvent) => {
    event.preventDefault(); if (!selectedCandidate) return;
    setBusy("add"); setError("");
    try {
      await postAuthJson(`/api/accelerators/cohorts/${cohortId}/matchmaking/profiles`, {
        user_id: selectedCandidate.id, role: "expert", bio: poolForm.bio || null,
        expertise: parseTags(poolForm.expertise), needs: [], industries: parseTags(poolForm.industries),
        goals: parseTags(poolForm.goals), preferred_formats: parseTags(poolForm.formats),
        max_matches: poolForm.maxMatches, active: true,
      }, token);
      setSelectedCandidate(null); setCandidates([]); setQuery("");
      setPoolForm({ bio: "", expertise: "", industries: "", goals: "", formats: "", maxMatches: 5 });
      await load();
    } catch (reason) { setError(describeApiError(reason, "Не удалось добавить эксперта")); }
    finally { setBusy(""); }
  };

  const assignExpert = async (userId: number) => {
    if (!userId) return;
    setBusy("expert"); setError("");
    try { setCurrentExpert(await putAuthJson(`/api/accelerators/cohorts/${cohortId}/expert`, { user_id: userId }, token)); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось назначить эксперта потока")); }
    finally { setBusy(""); }
  };

  return <div className="space-y-5">
    <TeamManager cohortId={cohortId} token={token} />

    <section className="workspace-card"><h2 className="text-xl">Эксперт потока</h2><p className="mt-1 text-sm text-white/40">У потока один эксперт. Организатор может заменить его; изменение попадёт в историю.</p><div className="mt-5 flex flex-wrap items-center gap-3"><select aria-label="Эксперт потока" value={currentExpert?.user_id || ""} onChange={(event) => void assignExpert(Number(event.target.value))} className="workspace-input !w-auto"><option value="">Выберите эксперта</option>{experts.map((row) => <option key={row.id} value={row.user_id}>{row.name}</option>)}</select>{currentExpert && <span className="text-sm text-emerald-300">Назначен: {currentExpert.name}</span>}</div></section>

    <section className="workspace-card">
      <h2 className="flex items-center gap-2 text-xl"><Plus size={18} /> Добавить эксперта</h2>
      <p className="mt-1 text-sm text-white/40">Сначала добавьте профиль эксперта в поток, затем выберите его выше.</p>
      <div className="mt-5 flex gap-3"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или email пользователя" className="workspace-input" /><button type="button" onClick={() => void search()} disabled={busy === "search"} className="workspace-button shrink-0"><Search size={15} /> Найти</button></div>
      {!!candidates.length && <div className="mt-3 flex flex-wrap gap-2">{candidates.map((row) => <button type="button" key={row.id} onClick={() => setSelectedCandidate(row)} className={`rounded-full border px-3 py-2 text-sm ${selectedCandidate?.id === row.id ? "border-white bg-white text-black" : "border-white/10 text-white/55"}`}>{row.name} · {row.email}</button>)}</div>}
      {selectedCandidate && <form onSubmit={addExpertProfile} className="mt-5 grid gap-3 rounded-2xl border border-white/10 p-4 sm:grid-cols-2"><p className="sm:col-span-2">{selectedCandidate.name}</p><label className="text-sm text-white/55 sm:col-span-2">Описание<textarea value={poolForm.bio} onChange={(event) => setPoolForm({ ...poolForm, bio: event.target.value })} rows={2} className="workspace-input mt-2 resize-y" /></label><PoolInput label="Компетенции" value={poolForm.expertise} onChange={(value) => setPoolForm({ ...poolForm, expertise: value })} /><PoolInput label="Отрасли" value={poolForm.industries} onChange={(value) => setPoolForm({ ...poolForm, industries: value })} /><PoolInput label="Цели" value={poolForm.goals} onChange={(value) => setPoolForm({ ...poolForm, goals: value })} /><PoolInput label="Форматы" value={poolForm.formats} onChange={(value) => setPoolForm({ ...poolForm, formats: value })} /><label className="text-sm text-white/55">Лимит активных назначений<input type="number" min={1} max={100} value={poolForm.maxMatches} onChange={(event) => setPoolForm({ ...poolForm, maxMatches: Number(event.target.value) })} className="workspace-input mt-2" /></label><div className="flex items-end"><button disabled={busy === "add"} className="workspace-button"><UserRoundCheck size={15} /> Добавить</button></div></form>}
      <div className="mt-6 grid gap-3 md:grid-cols-2">{experts.map((row) => <article key={row.id} className="rounded-2xl border border-white/8 p-4"><p>{row.name}</p><p className="text-xs text-white/35">{row.email}</p><p className="mt-3 text-sm text-white/45">{row.expertise.join(", ") || "Компетенции не указаны"}</p></article>)}</div>
    </section>

    <section className="workspace-card"><h2 className="flex items-center gap-2 text-xl"><History size={18} /> История матчмейкинга</h2><div className="mt-5 space-y-3">{history.slice(0, 50).map((row) => <article key={row.id} className="flex flex-wrap items-start justify-between gap-3 border-l border-white/15 pl-4"><div><p className="text-sm">{HISTORY_LABELS[row.action] || row.action}</p><p className="mt-1 text-xs text-white/35">{row.target_type}{row.target_id ? ` #${row.target_id}` : ""}</p></div><time className="text-xs text-white/30">{new Date(row.created_at).toLocaleString("ru-RU")}</time></article>)}{!history.length && <p className="text-sm text-white/35">История пока пуста.</p>}</div></section>
    {busy === "load" && <Loader2 className="mx-auto animate-spin text-white/35" />}
    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}

function PoolInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-sm text-white/55">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder="через запятую" className="workspace-input mt-2" /></label>;
}
