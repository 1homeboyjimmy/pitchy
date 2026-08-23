"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { CalendarDays, Check, Clipboard, Loader2, MapPin, Plus, QrCode, Send, Users } from "lucide-react";

import { describeApiError, getAuthJson, patchAuthJson, postAuthJson } from "@/lib/api";

type EventRow = { id: number; title: string; description?: string | null; starts_at: string; ends_at: string; event_format: "online" | "offline" | "hybrid"; location?: string | null; meeting_url?: string | null; status: "draft" | "published"; checkin_url: string; attendance_count: number };
type Attendee = { membership_id: number; name: string; email: string; status: "not_marked" | "present" | "absent" | "excused"; checked_in_at?: string | null };
const empty = { title: "", description: "", startsAt: "", endsAt: "", format: "online" as EventRow["event_format"], location: "", meetingUrl: "" };

export function AttendanceManager({ cohortId, token }: { cohortId: number; token: string }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [attendees, setAttendees] = useState<Record<number, Attendee[]>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setEvents(await getAuthJson<EventRow[]>(`/api/accelerators/cohorts/${cohortId}/events`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить мероприятия")); }
  }, [cohortId, token]);
  useEffect(() => { void load(); }, [load]);

  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy("save"); setError("");
    try {
      await postAuthJson(`/api/accelerators/cohorts/${cohortId}/events`, { title: form.title, description: form.description || null, starts_at: new Date(form.startsAt).toISOString(), ends_at: new Date(form.endsAt).toISOString(), event_format: form.format, location: form.location || null, meeting_url: form.meetingUrl || null }, token);
      setForm(empty); setShowForm(false); await load();
    } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить мероприятие")); }
    finally { setBusy(""); }
  };
  const publish = async (id: number) => {
    setBusy(`publish-${id}`); setError("");
    try { await postAuthJson(`/api/accelerators/events/${id}/publish`, {}, token); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось опубликовать мероприятие")); }
    finally { setBusy(""); }
  };
  const openAttendance = async (id: number) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id); setBusy(`attendance-${id}`);
    try { const rows = await getAuthJson<Attendee[]>(`/api/accelerators/events/${id}/attendance`, token); setAttendees((current) => ({ ...current, [id]: rows })); }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить посещаемость")); }
    finally { setBusy(""); }
  };
  const mark = async (eventId: number, membershipId: number, status: "present" | "absent" | "excused") => {
    setBusy(`mark-${membershipId}`);
    try { await patchAuthJson(`/api/accelerators/events/${eventId}/attendance`, { membership_id: membershipId, status }, token); const rows = await getAuthJson<Attendee[]>(`/api/accelerators/events/${eventId}/attendance`, token); setAttendees((current) => ({ ...current, [eventId]: rows })); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось сохранить посещаемость")); }
    finally { setBusy(""); }
  };

  return <section className="workspace-card"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl">Мероприятия и посещаемость</h2><p className="mt-1 text-sm text-white/40">После публикации покажите QR-код резидентам или отметьте участие вручную.</p></div><button onClick={() => setShowForm(!showForm)} className="workspace-button"><Plus size={15} />{showForm ? "Закрыть" : "Новое мероприятие"}</button></div>
    {error && <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
    {showForm && <form onSubmit={save} className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-5"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-white/60 sm:col-span-2">Название<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required minLength={2} className="workspace-input mt-2" /></label><label className="text-sm text-white/60">Начало<input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} required className="workspace-input mt-2" /></label><label className="text-sm text-white/60">Окончание<input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} required className="workspace-input mt-2" /></label><label className="text-sm text-white/60">Формат<select value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value as EventRow["event_format"] })} className="workspace-input mt-2"><option value="online">Онлайн</option><option value="offline">Очно</option><option value="hybrid">Гибрид</option></select></label><label className="text-sm text-white/60">Место<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} required={form.format !== "online"} placeholder="Адрес или площадка" className="workspace-input mt-2" /></label><label className="text-sm text-white/60 sm:col-span-2">Ссылка на подключение<input type="url" value={form.meetingUrl} onChange={(event) => setForm({ ...form, meetingUrl: event.target.value })} placeholder="https://…" className="workspace-input mt-2" /></label><label className="text-sm text-white/60 sm:col-span-2">Описание<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} className="workspace-input mt-2 resize-y" /></label></div><div className="mt-5 flex justify-end"><button disabled={busy === "save"} className="workspace-button">{busy === "save" && <Loader2 size={15} className="animate-spin" />} Сохранить черновик</button></div></form>}
    <div className="mt-6 space-y-3">{!events.length ? <p className="py-6 text-center text-sm text-white/35">Мероприятий пока нет.</p> : events.map((event) => <article key={event.id} className="rounded-2xl border border-white/9 bg-white/[0.02] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs ${event.status === "published" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/7 text-white/40"}`}>{event.status === "published" ? "Опубликовано" : "Черновик"}</span><span className="text-xs text-white/35"><Users size={12} className="mr-1 inline" />{event.attendance_count}</span></div><h3 className="text-lg">{event.title}</h3><p className="mt-2 text-sm text-white/45"><CalendarDays size={14} className="mr-1 inline" />{new Date(event.starts_at).toLocaleString("ru-RU")} — {new Date(event.ends_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</p>{event.location && <p className="mt-1 text-sm text-white/40"><MapPin size={14} className="mr-1 inline" />{event.location}</p>}</div><div className="flex flex-wrap gap-2">{event.status === "draft" ? <button onClick={() => void publish(event.id)} disabled={busy === `publish-${event.id}`} className="workspace-button"><Send size={14} /> Опубликовать</button> : <><button onClick={() => void navigator.clipboard.writeText(event.checkin_url)} className="workspace-button !bg-transparent !text-white"><Clipboard size={14} /> Ссылка</button><button onClick={() => void openAttendance(event.id)} className="workspace-button"><Users size={14} /> Участники</button></>}</div></div>{event.status === "published" && <details className="mt-4 rounded-2xl border border-white/8 p-4"><summary className="cursor-pointer text-sm text-white/55"><QrCode size={15} className="mr-2 inline" />Показать QR-код</summary><div className="mt-4 flex flex-wrap items-center gap-5"><div className="rounded-2xl bg-white p-3"><Image unoptimized src={`/api/accelerators/events/${event.id}/qr`} alt={`QR-код для ${event.title}`} width={160} height={160} /></div><p className="max-w-md break-all text-xs text-white/35">{event.checkin_url}</p></div></details>}{openId === event.id && <div className="mt-5 border-t border-white/8 pt-5">{busy === `attendance-${event.id}` ? <Loader2 className="mx-auto animate-spin text-white/40" /> : !(attendees[event.id] || []).length ? <p className="text-sm text-white/35">Зачисленных резидентов пока нет.</p> : <div className="space-y-2">{(attendees[event.id] || []).map((resident) => <div key={resident.membership_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-black/25 p-3"><div><p className="text-sm">{resident.name}</p><p className="text-xs text-white/35">{resident.email} · {resident.status === "present" ? "присутствовал" : resident.status === "absent" ? "отсутствовал" : resident.status === "excused" ? "уважительная причина" : "не отмечен"}</p></div><div className="flex gap-2"><button onClick={() => void mark(event.id, resident.membership_id, "present")} disabled={busy === `mark-${resident.membership_id}`} className="rounded-full border border-white/10 p-2 text-emerald-300" aria-label="Присутствовал"><Check size={15} /></button><button onClick={() => void mark(event.id, resident.membership_id, "absent")} disabled={busy === `mark-${resident.membership_id}`} className="rounded-full border border-white/10 px-3 py-2 text-xs text-white/50">Нет</button><button onClick={() => void mark(event.id, resident.membership_id, "excused")} disabled={busy === `mark-${resident.membership_id}`} className="rounded-full border border-white/10 px-3 py-2 text-xs text-white/50">Уваж.</button></div></div>)}</div>}</div>}</article>)}</div>
  </section>;
}
