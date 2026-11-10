"use client";

import { FormEvent, useState } from "react";
import { describeApiError, patchAuthJson } from "@/lib/api";

type Details = { host_name?: string | null; location?: string | null; meeting_url?: string | null; online_platform?: string | null; venue_details?: string | null; map_url?: string | null };

export function EventDetailsDialog({ event, token, onClose, onSaved }: { event: Details & { id: number; title: string }; token: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ host_name: event.host_name || "", location: event.location || "", meeting_url: event.meeting_url || "", online_platform: event.online_platform || "", venue_details: event.venue_details || "", map_url: event.map_url || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await patchAuthJson(`/api/accelerators/events/${event.id}/details`, form, token); await onSaved(); onClose(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось сохранить данные мероприятия")); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[95] grid place-items-center bg-black/75 p-4"><form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="event-details-edit-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/15 bg-[#1c1b1b] p-6">
    <h2 id="event-details-edit-title" className="text-xl">Уточнить данные мероприятия</h2><p className="mt-2 text-sm text-white/50">{event.title}</p>
    <p className="mt-2 text-xs text-white/40">Спикера, адрес и ссылки можно заполнить позже. Для изменения даты используйте «Перенести».</p>
    {error && <p role="alert" className="mt-4 text-sm text-red-200">{error}</p>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="text-sm text-white/60">Спикер<input value={form.host_name} onChange={e => setForm({ ...form, host_name: e.target.value })} className="workspace-input mt-2" /></label>
      <label className="text-sm text-white/60">Платформа<input value={form.online_platform} onChange={e => setForm({ ...form, online_platform: e.target.value })} className="workspace-input mt-2" /></label>
      <label className="text-sm text-white/60 sm:col-span-2">Ссылка на подключение<input type="url" value={form.meeting_url} onChange={e => setForm({ ...form, meeting_url: e.target.value })} className="workspace-input mt-2" /></label>
      <label className="text-sm text-white/60 sm:col-span-2">Адрес<input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className="workspace-input mt-2" /></label>
      <label className="text-sm text-white/60 sm:col-span-2">Карта<input type="url" value={form.map_url} onChange={e => setForm({ ...form, map_url: e.target.value })} className="workspace-input mt-2" /></label>
      <label className="text-sm text-white/60 sm:col-span-2">Как пройти<textarea value={form.venue_details} onChange={e => setForm({ ...form, venue_details: e.target.value })} className="workspace-input mt-2" /></label>
    </div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="overview-secondary">Отмена</button><button disabled={busy} className="workspace-button">{busy ? "Сохраняем…" : "Сохранить данные"}</button></div>
  </form></div>;
}
