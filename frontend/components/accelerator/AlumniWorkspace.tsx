"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Save, ShieldCheck, Trash2, Users } from "lucide-react";

import { deleteAuth, describeApiError, getAuthJson, putAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";

type AlumniProfile = { membership_id: number; name: string; project?: { id: number; name: string } | null; active: boolean; headline?: string | null; bio?: string | null; achievements: string[]; expertise: string[]; interests: string[]; contact_url?: string | null };
type AlumniDirectory = { cohort_id: number; profiles: AlumniProfile[] };
type Snapshot = { checksum: string; payload: { membership?: { outcome?: string }; project?: { name?: string; readiness_index?: number } | null; program?: { published: number; completed: number }; homework?: { published: number; accepted: number }; attendance?: { published_events: number; present: number }; artifacts?: { total: number; ready: number }; team?: { name: string; role: string } | null } };
type Checkin = { id: number; period_date: string; summary: string; metrics: Record<string, unknown> };

function join(values?: string[]) { return (values || []).join(", "); }
function split(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }

export function AlumniWorkspace({ membershipId, cohortId }: { membershipId: number; cohortId: number }) {
  const { token } = useAuth();
  const [profile, setProfile] = useState<AlumniProfile | null>(null);
  const [directory, setDirectory] = useState<AlumniProfile[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [form, setForm] = useState({ headline: "", bio: "", achievements: "", expertise: "", interests: "", contactUrl: "", consent: false });
  const [checkin, setCheckin] = useState({ period: new Date().toISOString().slice(0, 10), summary: "", customers: "", teamSize: "" });
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const [profileRow, directoryRow, snapshotRow, checkinRow] = await Promise.all([
        getAuthJson<AlumniProfile>(`/api/accelerators/memberships/${membershipId}/alumni-profile`, token),
        getAuthJson<AlumniDirectory>(`/api/accelerators/cohorts/${cohortId}/alumni`, token),
        getAuthJson<Snapshot>(`/api/accelerators/memberships/${membershipId}/closure-snapshot`, token),
        getAuthJson<{ checkins: Checkin[] }>(`/api/accelerators/memberships/${membershipId}/alumni-checkins`, token),
      ]);
      setProfile(profileRow); setDirectory(directoryRow.profiles); setSnapshot(snapshotRow); setCheckins(checkinRow.checkins);
      setForm({ headline: profileRow.headline || "", bio: profileRow.bio || "", achievements: join(profileRow.achievements), expertise: join(profileRow.expertise), interests: join(profileRow.interests), contactUrl: profileRow.contact_url || "", consent: profileRow.active });
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить пространство выпускника")); }
    finally { setLoading(false); }
  }, [cohortId, membershipId, token]);
  useEffect(() => { void load(); }, [load]);
  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); if (!token) return; setBusy("profile"); setError("");
    try { await putAuthJson(`/api/accelerators/memberships/${membershipId}/alumni-profile`, { headline: form.headline.trim() || null, bio: form.bio.trim() || null, achievements: split(form.achievements), expertise: split(form.expertise), interests: split(form.interests), contact_url: form.contactUrl.trim() || null, accept_directory_terms: form.consent }, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось опубликовать профиль")); }
    finally { setBusy(""); }
  };
  const optOut = async () => {
    if (!token || !profile?.active || !window.confirm("Убрать профиль из каталога и удалить alumni-отметки?")) return; setBusy("optout");
    try { await deleteAuth(`/api/accelerators/memberships/${membershipId}/alumni-profile`, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось скрыть профиль")); }
    finally { setBusy(""); }
  };
  const saveCheckin = async (event: FormEvent) => {
    event.preventDefault(); if (!token) return; setBusy("checkin"); setError("");
    const metrics: Record<string, number> = {}; if (checkin.customers) metrics.customers = Number(checkin.customers); if (checkin.teamSize) metrics.team_size = Number(checkin.teamSize);
    try { await putAuthJson(`/api/accelerators/memberships/${membershipId}/alumni-checkins`, { period_date: checkin.period, summary: checkin.summary.trim(), metrics }, token); setCheckin((row) => ({ ...row, summary: "" })); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось сохранить обновление")); }
    finally { setBusy(""); }
  };
  if (loading) return <section className="workspace-card grid min-h-48 place-items-center"><Loader2 className="animate-spin text-white/35" /></section>;
  const result = snapshot?.payload;
  return <div className="space-y-6">
    <section className="workspace-card"><p className="text-xs uppercase tracking-[.18em] text-white/30">Выпускник</p><h2 className="mt-2 text-2xl">Итог программы</h2><p className="mt-2 text-sm text-white/45">Снимок сформирован в момент завершения потока и больше не изменяется.</p>{result && <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Result label="Проект" value={result.project?.name || "Без проекта"} /><Result label="Готовность" value={`${result.project?.readiness_index ?? 0}%`} /><Result label="Этапы" value={`${result.program?.completed || 0} / ${result.program?.published || 0}`} /><Result label="Артефакты" value={`${result.artifacts?.ready || 0} / ${result.artifacts?.total || 0}`} /></div>}</section>

    <section className="workspace-card"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl">Профиль в каталоге выпускников</h2><p className="mt-1 text-sm text-white/40">Публикация добровольная. Email не показывается; контакт появится только если вы сами укажете ссылку.</p></div>{profile?.active && <button type="button" onClick={() => void optOut()} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-full border border-red-300/15 px-4 py-2 text-sm text-red-200"><Trash2 size={14} /> Убрать профиль</button>}</div><form onSubmit={saveProfile} className="mt-5 space-y-3"><input value={form.headline} onChange={(event) => setForm({ ...form, headline: event.target.value })} maxLength={200} placeholder="Коротко: чем занимаетесь сейчас" className="workspace-input" /><textarea value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} rows={4} maxLength={5000} placeholder="О себе и проекте" className="workspace-input resize-y" /><div className="grid gap-3 md:grid-cols-3"><input value={form.achievements} onChange={(event) => setForm({ ...form, achievements: event.target.value })} placeholder="Достижения через запятую" className="workspace-input" /><input value={form.expertise} onChange={(event) => setForm({ ...form, expertise: event.target.value })} placeholder="Компетенции через запятую" className="workspace-input" /><input value={form.interests} onChange={(event) => setForm({ ...form, interests: event.target.value })} placeholder="Интересы через запятую" className="workspace-input" /></div><input value={form.contactUrl} onChange={(event) => setForm({ ...form, contactUrl: event.target.value })} placeholder="Безопасная ссылка для связи: https://… или mailto:…" className="workspace-input" /><label className="flex items-start gap-3 text-sm text-white/55"><input type="checkbox" checked={form.consent} onChange={(event) => setForm({ ...form, consent: event.target.checked })} className="mt-1" />Я добровольно публикую эти данные в каталоге выпускников и могу удалить их в любой момент.</label><button disabled={Boolean(busy) || !form.consent} className="workspace-button"><Save size={14} /> {profile?.active ? "Обновить профиль" : "Опубликовать профиль"}</button></form></section>

    {profile?.active && <section className="workspace-card"><h2 className="text-xl">Обновление после выпуска</h2><form onSubmit={saveCheckin} className="mt-4 grid gap-3 md:grid-cols-2"><input type="date" value={checkin.period} onChange={(event) => setCheckin({ ...checkin, period: event.target.value })} required className="workspace-input" /><input type="number" min="0" value={checkin.customers} onChange={(event) => setCheckin({ ...checkin, customers: event.target.value })} placeholder="Клиенты, необязательно" className="workspace-input" /><input type="number" min="0" value={checkin.teamSize} onChange={(event) => setCheckin({ ...checkin, teamSize: event.target.value })} placeholder="Размер команды, необязательно" className="workspace-input" /><textarea value={checkin.summary} onChange={(event) => setCheckin({ ...checkin, summary: event.target.value })} minLength={2} required rows={3} placeholder="Что изменилось после выпуска" className="workspace-input resize-y md:col-span-2" /><button disabled={Boolean(busy)} className="workspace-button md:col-span-2 md:justify-self-start"><Save size={14} /> Сохранить обновление</button></form><div className="mt-5 space-y-2">{checkins.map((row) => <article key={row.id} className="rounded-2xl border border-white/8 p-4"><p className="text-xs text-white/35">{new Date(row.period_date).toLocaleDateString("ru-RU")}</p><p className="mt-2 text-sm text-white/60">{row.summary}</p></article>)}</div></section>}

    <section className="workspace-card"><h2 className="flex items-center gap-2 text-xl"><Users size={18} /> Каталог выпускников</h2><div className="mt-5 grid gap-3 md:grid-cols-2">{directory.map((row) => <article key={row.membership_id} className="rounded-2xl border border-white/9 p-4"><p>{row.name}</p><p className="mt-1 text-sm text-white/45">{row.headline || row.project?.name || "Выпускник потока"}</p>{row.bio && <p className="mt-3 text-sm text-white/55">{row.bio}</p>}{row.contact_url && <a href={row.contact_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-blue-300"><ExternalLink size={13} /> Связаться</a>}</article>)}{!directory.length && <p className="text-sm text-white/35">Пока никто не опубликовал профиль.</p>}</div></section>
    <div className="flex items-start gap-2 rounded-2xl border border-white/8 p-4 text-xs text-white/35"><ShieldCheck size={15} className="shrink-0" />Каталог показывает только добровольно опубликованные поля. Итоговый снимок виден вам и организаторам потока.</div>
    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}

function Result({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-white/8 p-4"><p className="text-xs text-white/35">{label}</p><p className="mt-1 text-lg">{value}</p></div>; }
