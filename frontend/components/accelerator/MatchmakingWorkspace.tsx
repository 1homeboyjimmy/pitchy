"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Save, Users } from "lucide-react";

import { describeApiError, getAuthJson, putAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { TeamWorkspace } from "@/components/accelerator/TeamWorkspace";

export type MatchProfile = {
  id: number; user_id: number; membership_id?: number | null; role: "resident" | "tracker" | "expert";
  name: string; email?: string; bio?: string | null; expertise: string[]; needs: string[];
  industries: string[]; goals: string[]; preferred_formats: string[]; max_matches: number;
  active: boolean; active_matches: number;
};
export type MatchRow = {
  id: number; resident: { membership_id: number; user_id: number; name: string; email?: string };
  counterpart: MatchProfile; counterpart_role: MatchProfile["role"]; score: number;
  reasons: string[]; status: "active" | "ended"; created_at: string; ended_at?: string | null;
};
type MeData = { access_role: string; profiles: MatchProfile[]; matches: MatchRow[] };

const roleLabels = { resident: "резидент", tracker: "трекер", expert: "эксперт" };

function joinTags(values: string[]) { return values.join(", "); }
function parseTags(value: string) { return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean))); }

export function MatchmakingWorkspace({ cohortId, membershipId, project }: { cohortId: number; membershipId?: number; project?: { id: number; name: string } | null }) {
  const { token } = useAuth();
  const [me, setMe] = useState<MeData | null>(null);
  const [profile, setProfile] = useState<MatchProfile | null>(null);
  const [form, setForm] = useState({ bio: "", expertise: "", needs: "", industries: "", goals: "", formats: "", maxMatches: 5 });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const fillForm = useCallback((row: MatchProfile | null) => {
    setForm({
      bio: row?.bio || "", expertise: joinTags(row?.expertise || []), needs: joinTags(row?.needs || []),
      industries: joinTags(row?.industries || []), goals: joinTags(row?.goals || []),
      formats: joinTags(row?.preferred_formats || []), maxMatches: row?.max_matches || 5,
    });
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setBusy("load"); setError("");
    try {
      const own = await getAuthJson<MeData>(`/api/accelerators/cohorts/${cohortId}/matchmaking/me`, token);
      setMe(own);
      const row = membershipId
        ? await getAuthJson<MatchProfile | null>(`/api/accelerators/memberships/${membershipId}/match-profile`, token)
        : own.profiles[0] || null;
      setProfile(row); fillForm(row);
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить матчмейкинг")); }
    finally { setBusy(""); }
  }, [cohortId, fillForm, membershipId, token]);

  useEffect(() => { void load(); }, [load]);

  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!token) return;
    setBusy("save"); setError("");
    const payload = {
      bio: form.bio || null, expertise: parseTags(form.expertise), needs: parseTags(form.needs),
      industries: parseTags(form.industries), goals: parseTags(form.goals),
      preferred_formats: parseTags(form.formats), max_matches: form.maxMatches,
      active: profile?.active ?? true,
    };
    try {
      const row = membershipId
        ? await putAuthJson<MatchProfile>(`/api/accelerators/memberships/${membershipId}/match-profile`, payload, token)
        : profile ? await putAuthJson<MatchProfile>(`/api/accelerators/matchmaking/profiles/${profile.id}`, payload, token) : null;
      if (row) { setProfile(row); fillForm(row); await load(); }
    } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить профиль")); }
    finally { setBusy(""); }
  };

  if (busy === "load" && !me) return <section className="workspace-card grid place-items-center py-14"><Loader2 className="animate-spin text-white/35" /></section>;

  return <div className="space-y-5">
    {membershipId && <TeamWorkspace membershipId={membershipId} project={project} />}
    <section className="workspace-card">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl">Профиль для подбора</h2><p className="mt-1 text-sm text-white/40">Теги можно вводить через запятую. Чем точнее запросы и опыт, тем полезнее рекомендации.</p></div><button type="button" onClick={() => void load()} className="rounded-full border border-white/10 p-3 text-white/40" aria-label="Обновить"><RefreshCw size={16} /></button></div>
      {!profile && !membershipId ? <p className="mt-5 text-sm text-white/40">Организатор ещё не добавил ваш профиль в пул потока.</p> : <form onSubmit={save} className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-white/55 sm:col-span-2">О себе<textarea value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} rows={3} className="workspace-input mt-2 resize-y" /></label>
        <TagInput label="Компетенции" value={form.expertise} onChange={(value) => setForm({ ...form, expertise: value })} placeholder="продажи, маркетинг, финансы" />
        <TagInput label="Какая помощь нужна" value={form.needs} onChange={(value) => setForm({ ...form, needs: value })} placeholder="продажи, инвестиции, найм" />
        <TagInput label="Отрасли" value={form.industries} onChange={(value) => setForm({ ...form, industries: value })} placeholder="EdTech, SaaS, производство" />
        <TagInput label="Цели" value={form.goals} onChange={(value) => setForm({ ...form, goals: value })} placeholder="первые продажи, выход на рынок" />
        <TagInput label="Форматы" value={form.formats} onChange={(value) => setForm({ ...form, formats: value })} placeholder="онлайн, офлайн, разовая консультация" />
        <label className="text-sm text-white/55">Максимум активных связок<input type="number" min={1} max={100} value={form.maxMatches} onChange={(event) => setForm({ ...form, maxMatches: Number(event.target.value) })} className="workspace-input mt-2" /></label>
        <div className="sm:col-span-2"><button disabled={busy === "save" || (!profile && !membershipId)} className="workspace-button"><Save size={15} /> Сохранить профиль</button></div>
      </form>}
    </section>

    <section className="workspace-card"><h2 className="flex items-center gap-2 text-xl"><Users size={18} /> Мои связки</h2><div className="mt-5 grid gap-3 md:grid-cols-2">{(me?.matches || []).map((match) => { const residentSide = Boolean(membershipId); const person = residentSide ? match.counterpart : match.resident; return <article key={match.id} className="rounded-2xl border border-white/10 p-4"><div className="flex items-start justify-between gap-3"><div><p>{person.name}</p><p className="text-xs text-white/35">{residentSide ? roleLabels[match.counterpart_role] : "резидент"}</p></div><span className={`rounded-full px-2 py-1 text-xs ${match.status === "active" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-white/35"}`}>{match.status === "active" ? "Активна" : "Завершена"}</span></div><p className="mt-3 text-sm text-white/45">{match.reasons.join(" · ")}</p></article>; })}{!me?.matches.length && <p className="text-sm text-white/35">Подтверждённых связок пока нет.</p>}</div></section>
    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}

function TagInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="text-sm text-white/55">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="workspace-input mt-2" /></label>;
}
