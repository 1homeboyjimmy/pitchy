"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Loader2, Plus, Search, Sparkles, UserRoundCheck } from "lucide-react";

import { describeApiError, getAuthJson, patchAuthJson, postAuthJson } from "@/lib/api";
import type { MatchProfile, MatchRow } from "@/components/accelerator/MatchmakingWorkspace";

type Candidate = { id: number; name: string; email: string };
type Recommendation = { profile: MatchProfile; score: number; reasons: string[]; existing_status?: string | null };
type PoolRole = "tracker" | "expert";
const roleLabels = { resident: "Резидент", tracker: "Трекер", expert: "Эксперт" };
const parseTags = (value: string) => Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));

export function MatchmakingManager({ cohortId, token }: { cohortId: number; token: string }) {
  const [profiles, setProfiles] = useState<MatchProfile[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [selectedMembershipId, setSelectedMembershipId] = useState("");
  const [recommendationRole, setRecommendationRole] = useState<MatchProfile["role"]>("expert");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [poolRole, setPoolRole] = useState<PoolRole>("expert");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [poolForm, setPoolForm] = useState({ bio: "", expertise: "", industries: "", goals: "", formats: "", maxMatches: 5 });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy("load"); setError("");
    try {
      const [profileRows, matchRows] = await Promise.all([
        getAuthJson<MatchProfile[]>(`/api/accelerators/cohorts/${cohortId}/matchmaking/profiles`, token),
        getAuthJson<MatchRow[]>(`/api/accelerators/cohorts/${cohortId}/matches`, token),
      ]);
      setProfiles(profileRows); setMatches(matchRows);
      const residents = profileRows.filter((row) => row.role === "resident" && row.active);
      setSelectedMembershipId((current) => current && residents.some((row) => String(row.membership_id) === current) ? current : String(residents[0]?.membership_id || ""));
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить матчмейкинг")); }
    finally { setBusy(""); }
  }, [cohortId, token]);
  useEffect(() => { void load(); }, [load]);

  const residents = useMemo(() => profiles.filter((row) => row.role === "resident" && row.active), [profiles]);
  const pool = useMemo(() => profiles.filter((row) => row.role !== "resident"), [profiles]);

  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy("search"); setError("");
    try { setCandidates(await getAuthJson<Candidate[]>(`/api/accelerators/cohorts/${cohortId}/matchmaking/candidates?role=${poolRole}&q=${encodeURIComponent(query)}`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось найти пользователя")); }
    finally { setBusy(""); }
  };

  const addPoolProfile = async (event: FormEvent) => {
    event.preventDefault(); if (!selectedCandidate) return;
    setBusy("add"); setError("");
    try {
      await postAuthJson(`/api/accelerators/cohorts/${cohortId}/matchmaking/profiles`, {
        user_id: selectedCandidate.id, role: poolRole, bio: poolForm.bio || null,
        expertise: parseTags(poolForm.expertise), needs: [], industries: parseTags(poolForm.industries),
        goals: parseTags(poolForm.goals), preferred_formats: parseTags(poolForm.formats),
        max_matches: poolForm.maxMatches, active: true,
      }, token);
      setSelectedCandidate(null); setCandidates([]); setQuery("");
      setPoolForm({ bio: "", expertise: "", industries: "", goals: "", formats: "", maxMatches: 5 });
      await load();
    } catch (reason) { setError(describeApiError(reason, "Не удалось добавить кандидата")); }
    finally { setBusy(""); }
  };

  const recommend = async () => {
    if (!selectedMembershipId) return;
    setBusy("recommend"); setError("");
    try { setRecommendations(await getAuthJson<Recommendation[]>(`/api/accelerators/memberships/${selectedMembershipId}/matchmaking/recommendations?role=${recommendationRole}`, token)); }
    catch (reason) { setRecommendations([]); setError(describeApiError(reason, "Не удалось построить рекомендации")); }
    finally { setBusy(""); }
  };

  const confirm = async (profileId: number) => {
    if (!selectedMembershipId) return;
    setBusy(`confirm-${profileId}`); setError("");
    try {
      await postAuthJson(`/api/accelerators/memberships/${selectedMembershipId}/matches`, { counterpart_profile_id: profileId }, token);
      await Promise.all([load(), recommend()]);
    } catch (reason) { setError(describeApiError(reason, "Не удалось подтвердить связку")); }
    finally { setBusy(""); }
  };

  const setMatchStatus = async (match: MatchRow, status: "active" | "ended") => {
    setBusy(`match-${match.id}`); setError("");
    try { await patchAuthJson(`/api/accelerators/matches/${match.id}`, { status }, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось изменить связку")); }
    finally { setBusy(""); }
  };

  return <div className="space-y-5">
    <section className="workspace-card">
      <div><h2 className="text-xl">Подобрать связку</h2><p className="mt-1 text-sm text-white/40">Алгоритм объясняет оценку, но назначение подтверждает организатор.</p></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_220px_auto]"><select value={selectedMembershipId} onChange={(event) => { setSelectedMembershipId(event.target.value); setRecommendations([]); }} className="workspace-input"><option value="">Выберите резидента с заполненным профилем</option>{residents.map((row) => <option key={row.id} value={row.membership_id || ""}>{row.name}</option>)}</select><select value={recommendationRole} onChange={(event) => { setRecommendationRole(event.target.value as MatchProfile["role"]); setRecommendations([]); }} className="workspace-input"><option value="expert">Эксперт</option><option value="tracker">Трекер</option><option value="resident">Другой резидент</option></select><button type="button" onClick={() => void recommend()} disabled={!selectedMembershipId || busy === "recommend"} className="workspace-button"><Sparkles size={15} /> Подобрать</button></div>
      {!residents.length && <p className="mt-4 rounded-2xl bg-amber-400/10 p-4 text-sm text-amber-100">Резиденты должны заполнить профиль в своём кабинете. После этого они появятся в подборе.</p>}
      <div className="mt-5 grid gap-3 md:grid-cols-2">{recommendations.map((item) => <article key={item.profile.id} className="rounded-2xl border border-white/10 p-4"><div className="flex items-start justify-between gap-3"><div><p>{item.profile.name}</p><p className="text-xs text-white/35">{roleLabels[item.profile.role]} · {item.profile.active_matches}/{item.profile.max_matches} связок</p></div><span className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300">{item.score}%</span></div>{item.profile.bio && <p className="mt-3 text-sm text-white/55">{item.profile.bio}</p>}<p className="mt-3 text-xs text-white/40">{item.reasons.join(" · ")}</p><button type="button" onClick={() => void confirm(item.profile.id)} disabled={Boolean(item.existing_status === "active" || busy)} className="workspace-button mt-4"><Link2 size={14} /> {item.existing_status === "active" ? "Уже связаны" : "Подтвердить"}</button></article>)}</div>
    </section>

    <section className="workspace-card">
      <h2 className="flex items-center gap-2 text-xl"><Plus size={18} /> Добавить трекера или эксперта в пул</h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-[180px_1fr_auto]"><select value={poolRole} onChange={(event) => { setPoolRole(event.target.value as PoolRole); setCandidates([]); setSelectedCandidate(null); }} className="workspace-input"><option value="expert">Эксперт</option><option value="tracker">Трекер</option></select><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или email пользователя" className="workspace-input" /><button type="button" onClick={() => void search()} className="workspace-button"><Search size={15} /> Найти</button></div>
      {!!candidates.length && <div className="mt-3 flex flex-wrap gap-2">{candidates.map((row) => <button type="button" key={row.id} onClick={() => setSelectedCandidate(row)} className={`rounded-full border px-3 py-2 text-sm ${selectedCandidate?.id === row.id ? "border-white bg-white text-black" : "border-white/10 text-white/55"}`}>{row.name} · {row.email}</button>)}</div>}
      {selectedCandidate && <form onSubmit={addPoolProfile} className="mt-5 grid gap-3 rounded-2xl border border-white/10 p-4 sm:grid-cols-2"><p className="sm:col-span-2">{selectedCandidate.name} — {roleLabels[poolRole]}</p><label className="text-sm text-white/55 sm:col-span-2">Описание<textarea value={poolForm.bio} onChange={(event) => setPoolForm({ ...poolForm, bio: event.target.value })} rows={2} className="workspace-input mt-2 resize-y" /></label><PoolInput label="Компетенции" value={poolForm.expertise} onChange={(value) => setPoolForm({ ...poolForm, expertise: value })} /><PoolInput label="Отрасли" value={poolForm.industries} onChange={(value) => setPoolForm({ ...poolForm, industries: value })} /><PoolInput label="Цели" value={poolForm.goals} onChange={(value) => setPoolForm({ ...poolForm, goals: value })} /><PoolInput label="Форматы" value={poolForm.formats} onChange={(value) => setPoolForm({ ...poolForm, formats: value })} /><label className="text-sm text-white/55">Максимум связок<input type="number" min={1} max={100} value={poolForm.maxMatches} onChange={(event) => setPoolForm({ ...poolForm, maxMatches: Number(event.target.value) })} className="workspace-input mt-2" /></label><div className="flex items-end"><button disabled={busy === "add"} className="workspace-button"><UserRoundCheck size={15} /> Добавить в пул</button></div></form>}
      <div className="mt-6 grid gap-3 md:grid-cols-2">{pool.map((row) => <article key={row.id} className="rounded-2xl border border-white/8 p-4"><div className="flex justify-between gap-3"><div><p>{row.name}</p><p className="text-xs text-white/35">{roleLabels[row.role]} · {row.email}</p></div><span className="text-xs text-white/35">{row.active_matches}/{row.max_matches}</span></div><p className="mt-3 text-sm text-white/45">{row.expertise.join(", ") || "Компетенции не указаны"}</p></article>)}</div>
    </section>

    <section className="workspace-card"><h2 className="text-xl">Подтверждённые связки</h2><div className="mt-5 space-y-3">{matches.map((match) => <article key={match.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 p-4"><div><p>{match.resident.name} ↔ {match.counterpart.name}</p><p className="mt-1 text-xs text-white/35">{roleLabels[match.counterpart_role]} · совпадение {match.score}% · {match.reasons.join(" · ")}</p></div><button type="button" onClick={() => void setMatchStatus(match, match.status === "active" ? "ended" : "active")} disabled={Boolean(busy)} className="workspace-button !bg-transparent !text-white">{match.status === "active" ? "Завершить" : "Возобновить"}</button></article>)}{!matches.length && <p className="text-sm text-white/35">Связок пока нет.</p>}</div></section>
    {busy === "load" && <Loader2 className="mx-auto animate-spin text-white/35" />}
    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}

function PoolInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-sm text-white/55">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder="через запятую" className="workspace-input mt-2" /></label>;
}
