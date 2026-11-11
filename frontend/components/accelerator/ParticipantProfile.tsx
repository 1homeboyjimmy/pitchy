"use client";

import { FormEvent, useState } from "react";
import { patchAuthJson, describeApiError } from "@/lib/api";

export type ParticipantFields = { study_group?: string | null; education_direction?: string | null; education_course?: string | null; employment?: string | null; tags?: string[]; registration_required?: boolean };
const TAGS = { student_startup: "Участник Студенческий стартап", startup_diploma: "Участник программы «Стартап как диплом»" };

export function ParticipantBadges({ profile }: { profile: ParticipantFields }) {
  return <div className="mt-2 flex flex-wrap gap-2">{(profile.tags || []).map(tag => <span key={tag} className={`rounded-full px-3 py-1 text-xs ${tag === "student_startup" ? "bg-sky-400/15 text-sky-200" : "bg-violet-400/15 text-violet-200"}`}>{TAGS[tag as keyof typeof TAGS] || tag}</span>)}<span className="rounded-full bg-white/10 px-3 py-1 text-xs">{profile.employment === "working" ? "Работаю" : profile.employment === "not_working" ? "Не работаю" : "Не указано"}</span></div>;
}

export function ParticipantProfileForm({ membershipId, token, profile, manager = false, required = false, onSaved }: { membershipId: number; token: string; profile: ParticipantFields; manager?: boolean; required?: boolean; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ study_group: profile.study_group || "", education_direction: profile.education_direction || "", education_course: profile.education_course || "", employment: profile.employment || "", tags: profile.tags || [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await patchAuthJson(`/api/accelerators/memberships/${membershipId}/participant-profile`, { study_group: form.study_group.trim() || null, education_direction: form.education_direction.trim() || null, education_course: form.education_course.trim() || null, ...(form.employment ? { employment: form.employment } : {}), ...(manager ? { tags: form.tags } : {}) }, token);
      await onSaved();
    } catch (err) { setError(describeApiError(err, "Не удалось сохранить профиль")); }
    finally { setBusy(false); }
  };
  return <form onSubmit={save} className="workspace-card space-y-4"><h2 className="text-xl">Профиль участника</h2><p className="text-sm text-white/60">{required ? "Для завершения регистрации укажите занятость. Учебные данные можно дополнить сейчас или позже." : "Учебные данные и занятость видны только вам и организаторам."}</p><ParticipantBadges profile={profile} /><div className="grid gap-4 sm:grid-cols-2">
    <label>Учебная группа<input maxLength={100} className="workspace-input mt-2" value={form.study_group} onChange={e => setForm({ ...form, study_group: e.target.value })} /></label>
    <label>Направление обучения<input maxLength={100} className="workspace-input mt-2" placeholder="БАК, МАГ, СПЕЦ, АСП или Сотрудник" value={form.education_direction} onChange={e => setForm({ ...form, education_direction: e.target.value })} /></label>
    <label>Уровень и курс<input maxLength={20} pattern="(БАК|МАГ|СПЕЦ|АСП)-[1-9][0-9]?" className="workspace-input mt-2" placeholder="БАК-2" value={form.education_course} onChange={e => setForm({ ...form, education_course: e.target.value })} /></label>
    <label>Занятость<select required={required} className="workspace-input mt-2" value={form.employment} onChange={e => setForm({ ...form, employment: e.target.value })}><option value="">Не указано</option><option value="working">Работаю</option><option value="not_working">Не работаю</option></select></label>
  </div>{manager && <fieldset className="space-y-2"><legend className="mb-2">Теги</legend>{Object.entries(TAGS).map(([key, label]) => <label key={key} className="flex gap-2 text-sm"><input type="checkbox" checked={form.tags.includes(key)} onChange={e => setForm({ ...form, tags: e.target.checked ? [...form.tags, key] : form.tags.filter(v => v !== key) })} />{label}</label>)}</fieldset>}{error && <p role="alert" className="text-red-200">{error}</p>}<button className="workspace-button" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button></form>;
}
