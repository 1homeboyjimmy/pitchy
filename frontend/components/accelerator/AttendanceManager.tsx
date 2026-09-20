"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Archive, CalendarDays, Clipboard, Copy, Download, History, Loader2, MapPin, Paperclip, Pencil, Plus, QrCode, Send, Users, X } from "lucide-react";

import { describeApiError, getAuthJson, patchAuthJson, postAuthJson, putAuthJson } from "@/lib/api";
import { notifySuccess } from "@/lib/ui";

type HomeworkLink = { assignment_id: number; relation: "before" | "during" | "after"; title?: string };
type MaterialLink = { title: string; url: string };
type EventStatus = "draft" | "published" | "completed" | "cancelled";
type EventRow = {
  id: number; stage_id?: number | null; title: string; description?: string | null;
  preview_url?: string | null;
  event_type: "webinar" | "workshop" | "tracker_session" | "expert_session" | "networking" | "other";
  host_name?: string | null; starts_at: string; ends_at: string; event_format: "online" | "offline" | "hybrid";
  location?: string | null; meeting_url?: string | null; online_platform?: string | null; venue_details?: string | null;
  map_url?: string | null; recording_url?: string | null; outcome?: string | null; next_step?: string | null;
  post_materials: MaterialLink[]; cancellation_reason?: string | null; timezone?: string | null;
  homework_links: HomeworkLink[]; status: EventStatus; checkin_url: string; attendance_count: number;
};
type EventHistory = { id: number; action: string; reason?: string | null; created_at: string; actor?: { name: string } | null };
type Attendee = { membership_id: number; name: string; email: string; status: "not_marked" | "present" | "absent" | "excused" };
type Option = { id: number; title: string; status: string };
type RescheduleForm = { id: number; startsAt: string; endsAt: string; reason: string };
type FollowupForm = { id: number; recordingUrl: string; outcome: string; nextStep: string; materials: MaterialLink[] };

const localDate = (value: string) => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const empty = { title: "", description: "", previewUrl: "", stageId: "", eventType: "webinar" as EventRow["event_type"], hostName: "", startsAt: "", endsAt: "", format: "online" as EventRow["event_format"], location: "", meetingUrl: "", onlinePlatform: "", venueDetails: "", mapUrl: "", materials: [] as MaterialLink[], homeworkLinks: [] as HomeworkLink[] };
const statusLabel: Record<EventStatus, string> = { draft: "Черновик", published: "Опубликовано", completed: "Завершено", cancelled: "Отменено" };
const actionLabel: Record<string, string> = { created: "Создано", updated: "Изменено", published: "Опубликовано", rescheduled: "Перенесено", cancelled: "Отменено", completed: "Завершено автоматически", followup_updated: "Добавлены итоги" };

import { useDashboardFocus } from "./useDashboardFocus";

export function AttendanceManager({ cohortId, token, focusId }: { cohortId: number; token: string; focusId?: number }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  useDashboardFocus("event", focusId, events.length);
  const [homework, setHomework] = useState<Option[]>([]);
  const [stages, setStages] = useState<Option[]>([]);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [attendees, setAttendees] = useState<Record<number, Attendee[]>>({});
  const [history, setHistory] = useState<Record<number, EventHistory[]>>({});
  const [reschedule, setReschedule] = useState<RescheduleForm | null>(null);
  const [cancellation, setCancellation] = useState<{ id: number; reason: string } | null>(null);
  const [followup, setFollowup] = useState<FollowupForm | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [eventView, setEventView] = useState<"upcoming" | "past" | "draft" | "cancelled">("upcoming");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "attendance" | "outcomes">("overview");
  const [formStep, setFormStep] = useState<"main" | "place" | "links">("main");
  const [qrEventId, setQrEventId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [eventRows, homeworkRows, stageRows] = await Promise.all([
        getAuthJson<EventRow[]>(`/api/accelerators/cohorts/${cohortId}/events`, token),
        getAuthJson<Option[]>(`/api/accelerators/cohorts/${cohortId}/homework`, token).catch(() => []),
        getAuthJson<Option[]>(`/api/accelerators/cohorts/${cohortId}/program-stages`, token).catch(() => []),
      ]);
      setEvents(eventRows); setHomework(homeworkRows); setStages(stageRows);
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить мероприятия")); }
  }, [cohortId, token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setShowForm(false); setDetailId(null); setReschedule(null); setCancellation(null); } }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, []);

  const loadAttendance = useCallback(async (id: number) => {
    const rows = await getAuthJson<Attendee[]>(`/api/accelerators/events/${id}/attendance`, token);
    setAttendees((current) => ({ ...current, [id]: rows }));
  }, [token]);
  useEffect(() => {
    if (!openId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void Promise.all([loadAttendance(openId), load()]).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [load, loadAttendance, openId]);

  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy("save"); setError("");
    const payload = { title: form.title, description: form.description || null, preview_url: form.previewUrl || null, stage_id: form.stageId ? Number(form.stageId) : null, event_type: form.eventType, host_name: form.hostName || null, starts_at: new Date(form.startsAt).toISOString(), ends_at: new Date(form.endsAt).toISOString(), event_format: form.format, location: form.location || null, meeting_url: form.meetingUrl || null, online_platform: form.onlinePlatform || null, venue_details: form.venueDetails || null, map_url: form.mapUrl || null, post_materials: form.materials, homework_links: form.homeworkLinks };
    try { if (editingId) await putAuthJson(`/api/accelerators/events/${editingId}`, payload, token); else await postAuthJson(`/api/accelerators/cohorts/${cohortId}/events`, payload, token); setForm(empty); setEditingId(null); setShowForm(false); await load(); }
    catch (reason) { setError(describeApiError(reason, "Не удалось сохранить мероприятие")); } finally { setBusy(""); }
  };
  const publish = async (id: number) => { setBusy(`publish-${id}`); try { await postAuthJson(`/api/accelerators/events/${id}/publish`, {}, token); await load(); } catch (reason) { setError(describeApiError(reason, "Не удалось опубликовать мероприятие")); } finally { setBusy(""); } };
  const edit = (row: EventRow) => { setForm({ title: row.title, description: row.description || "", previewUrl: row.preview_url || "", stageId: row.stage_id ? String(row.stage_id) : "", eventType: row.event_type, hostName: row.host_name || "", startsAt: localDate(row.starts_at), endsAt: localDate(row.ends_at), format: row.event_format, location: row.location || "", meetingUrl: row.meeting_url || "", onlinePlatform: row.online_platform || "", venueDetails: row.venue_details || "", mapUrl: row.map_url || "", materials: row.post_materials || [], homeworkLinks: row.homework_links || [] }); setEditingId(row.id); setFormStep("main"); setShowForm(true); };
  const uploadEventFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("upload"); setError("");
    try {
      const uploaded: MaterialLink[] = [];
      for (const file of Array.from(files)) {
        const body = new FormData(); body.append("file", file);
        const headers: Record<string, string> = { "x-pitchy-api": "1" };
        if (token !== "cookie-session") headers.Authorization = `Bearer ${token}`;
        const response = await fetch(`/api/accelerators/cohorts/${cohortId}/event-files`, { method: "POST", headers, body, credentials: "include" });
        if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.detail || `Не удалось загрузить ${file.name}`); }
        const result = await response.json() as { name: string; url: string };
        uploaded.push({ title: result.name, url: result.url });
      }
      setForm((current) => ({ ...current, materials: [...current.materials, ...uploaded] }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить файл мероприятия"); }
    finally { setBusy(""); }
  };
  const uploadPreview = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Для превью выберите изображение"); return; }
    setBusy("preview"); setError("");
    try {
      const body = new FormData(); body.append("file", file);
      const headers: Record<string, string> = { "x-pitchy-api": "1" };
      if (token !== "cookie-session") headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`/api/accelerators/cohorts/${cohortId}/event-files`, { method: "POST", headers, body, credentials: "include" });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.detail || "Не удалось загрузить превью"); }
      const result = await response.json() as { url: string };
      setForm((current) => ({ ...current, previewUrl: `${result.url}?inline=1` }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить превью"); }
    finally { setBusy(""); }
  };
  const uploadFollowupFiles = async (files: FileList | null) => {
    if (!files?.length || !followup) return;
    setBusy("followup-upload"); setError("");
    try {
      const uploaded: MaterialLink[] = [];
      for (const file of Array.from(files)) {
        const body = new FormData(); body.append("file", file);
        const headers: Record<string, string> = { "x-pitchy-api": "1" };
        if (token !== "cookie-session") headers.Authorization = `Bearer ${token}`;
        const response = await fetch(`/api/accelerators/cohorts/${cohortId}/event-files`, { method: "POST", headers, body, credentials: "include" });
        if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.detail || `Не удалось загрузить ${file.name}`); }
        const result = await response.json() as { name: string; url: string };
        uploaded.push({ title: result.name, url: result.url });
      }
      setFollowup((current) => current ? { ...current, materials: [...current.materials, ...uploaded] } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить материал"); }
    finally { setBusy(""); }
  };
  const lifecycle = async (row: EventRow, action: "duplicate" | "archive") => { if (action === "archive" && !window.confirm(`Архивировать мероприятие «${row.title}»?`)) return; setBusy(`${action}-${row.id}`); try { await postAuthJson(`/api/accelerators/events/${row.id}/${action}`, {}, token); await load(); } catch (reason) { setError(describeApiError(reason, "Не удалось выполнить действие")); } finally { setBusy(""); } };
  const submitReschedule = async (event: FormEvent) => { event.preventDefault(); if (!reschedule) return; setBusy(`reschedule-${reschedule.id}`); try { await postAuthJson(`/api/accelerators/events/${reschedule.id}/reschedule`, { starts_at: new Date(reschedule.startsAt).toISOString(), ends_at: new Date(reschedule.endsAt).toISOString(), reason: reschedule.reason }, token); setReschedule(null); await load(); } catch (reason) { setError(describeApiError(reason, "Не удалось перенести мероприятие")); } finally { setBusy(""); } };
  const submitCancellation = async (event: FormEvent) => { event.preventDefault(); if (!cancellation) return; setBusy(`cancel-${cancellation.id}`); try { await postAuthJson(`/api/accelerators/events/${cancellation.id}/cancel`, { reason: cancellation.reason }, token); setCancellation(null); await load(); } catch (reason) { setError(describeApiError(reason, "Не удалось отменить мероприятие")); } finally { setBusy(""); } };
  const submitFollowup = async (event: FormEvent) => { event.preventDefault(); if (!followup) return; setBusy(`followup-${followup.id}`); try { await putAuthJson(`/api/accelerators/events/${followup.id}/followup`, { recording_url: followup.recordingUrl || null, outcome: followup.outcome || null, next_step: followup.nextStep || null, post_materials: followup.materials.filter((item) => item.title.trim() && item.url.trim()) }, token); setFollowup(null); await load(); } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить итоги")); } finally { setBusy(""); } };
  const toggleHistory = async (id: number) => { setDetailId(id); setDetailTab("outcomes"); if (!history[id]) try { const rows = await getAuthJson<EventHistory[]>(`/api/accelerators/events/${id}/history`, token); setHistory((current) => ({ ...current, [id]: rows })); } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить историю")); } };
  const openAttendance = async (id: number) => { setDetailId(id); setDetailTab("attendance"); setOpenId(id); try { await loadAttendance(id); } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить посещаемость")); } };
  const mark = async (eventId: number, membershipId: number, status: "present" | "absent" | "excused") => { try { await patchAuthJson(`/api/accelerators/events/${eventId}/attendance`, { membership_id: membershipId, status }, token); await loadAttendance(eventId); await load(); } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить посещаемость")); } };
  const copyAttendanceLink = async (url: string) => {
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(url); copied = true; }
        catch { copied = false; }
      }
      if (!copied) {
        const input = document.createElement("textarea"); input.value = url; input.style.position = "fixed"; input.style.opacity = "0";
        document.body.appendChild(input); input.select();
        copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("copy_failed");
      }
      notifySuccess("Ссылка для отметки скопирована");
    } catch { setError("Не удалось скопировать ссылку. Откройте её и скопируйте адрес вручную."); }
  };
  const exportAttendance = async (eventId: number) => {
    setBusy(`export-${eventId}`); setError("");
    try {
      const headers: Record<string, string> = { "x-pitchy-api": "1" };
      if (token !== "cookie-session") headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`/api/accelerators/events/${eventId}/attendance/export.csv`, { headers, credentials: "include" });
      if (!response.ok) throw new Error("export_failed");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `event-${eventId}-attendance.csv`; anchor.click(); URL.revokeObjectURL(url);
    } catch { setError("Не удалось скачать посещаемость"); }
    finally { setBusy(""); }
  };

  const visibleEvents = useMemo(() => events.filter((row) => eventView === "draft" ? row.status === "draft" : eventView === "cancelled" ? row.status === "cancelled" : eventView === "past" ? row.status === "completed" || (row.status === "published" && new Date(row.ends_at) < new Date()) : row.status === "published" && new Date(row.ends_at) >= new Date()), [eventView, events]);
  const selectedEvent = events.find((row) => row.id === detailId) || null;

  return <section>
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/8 pb-6"><div><p className="text-xs text-white/35">Обзор потока&nbsp; / &nbsp;Программа</p><h1 className="mt-3 text-3xl font-semibold">Мероприятия и посещаемость</h1><p className="mt-2 text-sm text-white/40">{events.length} мероприятий&nbsp; · &nbsp;{events.filter((row) => row.status === "published" && new Date(row.ends_at) >= new Date()).length} предстоящих</p></div><button type="button" onClick={() => { setEditingId(null); setForm(empty); setFormStep("main"); setShowForm(true); }} className="workspace-button"><Plus size={15} />Новое мероприятие</button></div>
    <div className="mt-5 flex gap-1 overflow-x-auto border-b border-white/10">{([['upcoming','Предстоящие'],['past','Прошедшие'],['draft','Черновики'],['cancelled','Отменённые']] as const).map(([key,label]) => <button type="button" key={key} onClick={() => setEventView(key)} className={`shrink-0 border-b-2 px-4 py-3 text-sm ${eventView === key ? "border-white text-white" : "border-transparent text-white/45"}`}>{label}<span className="ml-2 rounded-md bg-white/8 px-2 py-0.5 text-xs">{events.filter((row) => key === 'draft' ? row.status === 'draft' : key === 'cancelled' ? row.status === 'cancelled' : key === 'past' ? row.status === 'completed' || (row.status === 'published' && new Date(row.ends_at) < new Date()) : row.status === 'published' && new Date(row.ends_at) >= new Date()).length}</span></button>)}</div>
    {error && <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
    {showForm && <div className="fixed inset-0 z-[80] flex justify-end bg-black/65" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setShowForm(false); setEditingId(null); setForm(empty); } }}><form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="event-form-title" className="flex h-full w-full max-w-3xl flex-col border-l border-white/10 bg-[#1c1b1b] shadow-2xl"><div className="flex items-start justify-between px-5 pb-4 pt-5 sm:px-6"><div><div className="flex flex-wrap items-center gap-3"><h3 id="event-form-title" className="text-2xl">{editingId ? "Редактирование мероприятия" : "Новое мероприятие"}</h3><span className="rounded-full border border-violet-300/25 bg-violet-400/10 px-2.5 py-1 text-xs text-violet-200">Черновик</span></div><p className="mt-1 text-sm text-white/40">{form.title || "Заполните основные сведения"}</p></div><button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm(empty); }} aria-label="Закрыть" className="rounded-full p-2 text-white/45 hover:bg-white/5"><X /></button></div><div className="grid grid-cols-3 border-b border-white/10 px-5 sm:px-6">{([['main','1','Основное'],['place','2','Время и место'],['links','3','Материалы и связи']] as const).map(([key,index,label])=><button key={key} type="button" onClick={()=>setFormStep(key)} className={`flex items-center justify-center gap-2 border-b-2 px-2 py-4 text-sm ${formStep===key?'border-white text-white':'border-transparent text-white/45'}`}><span className={`grid size-7 place-items-center rounded-full border text-xs ${formStep===key?'border-white bg-white text-black':'border-white/20'}`}>{index}</span><span className="hidden sm:inline">{label}</span></button>)}</div><div className="flex-1 overflow-y-auto p-5 sm:p-6"><div className="grid gap-4 sm:grid-cols-2">
      {formStep === "main" && <>
      <label className="text-sm text-white/60 sm:col-span-2">Название<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={2} className="workspace-input mt-2" /></label>
      <label className="text-sm text-white/60">Этап<select value={form.stageId} onChange={(e) => setForm({ ...form, stageId: e.target.value })} className="workspace-input mt-2"><option value="">Без этапа</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select></label>
      <label className="text-sm text-white/60">Тип<select value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value as EventRow["event_type"] })} className="workspace-input mt-2"><option value="webinar">Вебинар</option><option value="workshop">Воркшоп</option><option value="tracker_session">Сессия с трекером</option><option value="expert_session">Сессия с экспертом</option><option value="networking">Нетворкинг</option><option value="other">Другое</option></select></label>
      <label className="text-sm text-white/60">Ведущий<input value={form.hostName} onChange={(e) => setForm({ ...form, hostName: e.target.value })} placeholder="Имя и роль" className="workspace-input mt-2" /></label><span />
      <label className="text-sm text-white/60 sm:col-span-2">Описание<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={5} className="workspace-input mt-2 resize-y" /></label>
      <div className="rounded-2xl border border-dashed border-white/15 p-4 sm:col-span-2"><label className="inline-flex cursor-pointer items-center gap-2 text-sm text-white/65"><CalendarDays size={15} />Загрузить обложку события<input type="file" accept="image/*" className="sr-only" onChange={(event) => void uploadPreview(event.target.files?.[0])} /></label>{form.previewUrl && <div className="relative mt-3 overflow-hidden rounded-xl"><Image unoptimized src={form.previewUrl} alt="Предпросмотр обложки" width={960} height={360} className="h-40 w-full object-cover" /><button type="button" onClick={() => setForm((current) => ({ ...current, previewUrl: "" }))} className="absolute right-2 top-2 rounded-full bg-black/70 p-2" aria-label="Убрать обложку"><X size={14} /></button></div>}</div>
      </>}
      {formStep === "place" && <>
      <label className="text-sm text-white/60">Начало<input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} required className="workspace-input mt-2" /></label><label className="text-sm text-white/60">Окончание<input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} required className="workspace-input mt-2" /></label>
      <label className="text-sm text-white/60">Формат<select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as EventRow["event_format"] })} className="workspace-input mt-2"><option value="online">Онлайн</option><option value="offline">Очно</option><option value="hybrid">Гибрид</option></select></label>
      {form.format !== "online" && <label className="text-sm text-white/60">Адрес<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} required className="workspace-input mt-2" /></label>}
      {form.format !== "offline" && <><label className="text-sm text-white/60">Ссылка на подключение<input type="url" value={form.meetingUrl} onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })} required className="workspace-input mt-2" /></label><label className="text-sm text-white/60">Платформа<input value={form.onlinePlatform} onChange={(e) => setForm({ ...form, onlinePlatform: e.target.value })} className="workspace-input mt-2" /></label></>}
      {form.format !== "online" && <><label className="text-sm text-white/60">Карта<input type="url" value={form.mapUrl} onChange={(e) => setForm({ ...form, mapUrl: e.target.value })} className="workspace-input mt-2" /></label><label className="text-sm text-white/60 sm:col-span-2">Как пройти<textarea value={form.venueDetails} onChange={(e) => setForm({ ...form, venueDetails: e.target.value })} rows={3} className="workspace-input mt-2 resize-y" /></label></>}
      </>}
      {formStep === "links" && <>
      <div className="rounded-2xl border border-dashed border-white/15 p-4 sm:col-span-2"><label className="inline-flex cursor-pointer items-center gap-2 text-sm text-white/65"><Paperclip size={15} />Прикрепить файлы<input type="file" multiple className="sr-only" onChange={(event) => void uploadEventFiles(event.target.files)} /></label>{form.materials.map((item) => <div key={item.url} className="mt-2 flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-white/55"><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><button type="button" onClick={() => setForm((current) => ({ ...current, materials: current.materials.filter((row) => row.url !== item.url) }))} aria-label={`Убрать ${item.title}`}><X size={13} /></button></div>)}</div>
      </>}
    </div>{formStep === "links" && <HomeworkLinks homework={homework} links={form.homeworkLinks} onChange={(homeworkLinks) => setForm({ ...form, homeworkLinks })} />}</div><div className="flex items-center justify-between gap-2 border-t border-white/8 bg-[#1c1b1b] px-5 py-4 sm:px-6"><button type="button" onClick={() => formStep === "links" ? setFormStep("place") : formStep === "place" ? setFormStep("main") : setShowForm(false)} className="overview-secondary">{formStep === "main" ? "Отмена" : "Назад"}</button><div className="flex gap-2"><button disabled={busy === "save" || busy === "upload" || busy === "preview"} className="overview-secondary">Сохранить черновик</button>{formStep !== "links" && <button type="button" onClick={()=>setFormStep(formStep === "main" ? "place" : "links")} className="workspace-button">Продолжить</button>}</div></div></form></div>}
    <div className="mt-6 space-y-3">{!visibleEvents.length ? <div className="grid min-h-64 place-items-center rounded-2xl border border-white/8"><div className="text-center"><CalendarDays className="mx-auto text-white/20" size={36} /><p className="mt-4">В этом разделе мероприятий нет</p><p className="mt-2 text-sm text-white/35">Выберите другой режим или создайте новое мероприятие.</p></div></div> : visibleEvents.map((row) => <article id={`dashboard-event-${row.id}`} key={row.id} className="rounded-2xl border border-white/9 bg-white/[0.02] p-4 sm:p-5"><EventHeader row={row} onOpen={() => { setDetailId(row.id); setDetailTab("overview"); }} onEdit={edit} onPublish={publish} onAttendance={openAttendance} onReschedule={() => setReschedule({ id: row.id, startsAt: localDate(row.starts_at), endsAt: localDate(row.ends_at), reason: "" })} onCancel={() => setCancellation({ id: row.id, reason: "" })} onFollowup={() => { void toggleHistory(row.id); setFollowup({ id: row.id, recordingUrl: row.recording_url || "", outcome: row.outcome || "", nextStep: row.next_step || "", materials: row.post_materials || [] }); }} onHistory={toggleHistory} onLifecycle={lifecycle} /></article>)}</div>
    {selectedEvent && <div className="fixed inset-0 z-[70] flex justify-end bg-black/65" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDetailId(null); setOpenId(null); } }}><aside role="dialog" aria-modal="true" aria-labelledby="event-detail-title" className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#1c1b1b] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><div className="flex flex-wrap items-center gap-3"><h2 id="event-detail-title" className="text-2xl">{selectedEvent.title}</h2><span className={`rounded-full border px-2.5 py-1 text-xs ${selectedEvent.status === 'published' ? 'border-emerald-300/30 text-emerald-300' : 'border-white/15 text-white/45'}`}>{statusLabel[selectedEvent.status]}</span></div><p className="mt-2 text-sm text-white/45">{new Date(selectedEvent.starts_at).toLocaleString("ru-RU")} · {new Date(selectedEvent.ends_at).toLocaleTimeString("ru-RU", {hour:'2-digit',minute:'2-digit'})}</p></div><button type="button" onClick={() => { setDetailId(null); setOpenId(null); }}><X className="text-white/45" /></button></div><div className="mt-5 flex border-b border-white/10"><DrawerTab active={detailTab === "overview"} onClick={() => setDetailTab("overview")}>Обзор</DrawerTab><DrawerTab active={detailTab === "attendance"} onClick={() => { setDetailTab("attendance"); void openAttendance(selectedEvent.id); }}>Посещаемость</DrawerTab><DrawerTab active={detailTab === "outcomes"} onClick={() => { setDetailTab("outcomes"); void toggleHistory(selectedEvent.id); }}>Итоги и история</DrawerTab></div>{detailTab === "overview" && <div className="mt-5"><EventDetails row={selectedEvent} />{selectedEvent.status === "published" && <button type="button" onClick={()=>setQrEventId(selectedEvent.id)} className="overview-secondary mt-5"><QrCode size={15}/>QR-код и ссылка для отметки</button>}<div className="mt-8 flex flex-wrap gap-2 border-t border-white/8 pt-5">{selectedEvent.status === 'published' && <><button type="button" onClick={()=>setReschedule({id:selectedEvent.id,startsAt:localDate(selectedEvent.starts_at),endsAt:localDate(selectedEvent.ends_at),reason:''})} className="overview-secondary">Перенести</button><button type="button" onClick={()=>setCancellation({id:selectedEvent.id,reason:''})} className="overview-secondary !text-red-200">Отменить</button></>}<button type="button" onClick={()=>void openAttendance(selectedEvent.id)} className="workspace-button">Посещаемость</button></div></div>}{detailTab === "attendance" && <AttendancePanel attendees={attendees[selectedEvent.id] || []} eventId={selectedEvent.id} onMark={mark} onExport={exportAttendance} onQr={()=>setQrEventId(selectedEvent.id)} exporting={busy === `export-${selectedEvent.id}`} />}{detailTab === "outcomes" && <div className="mt-5">{followup?.id === selectedEvent.id && <FollowupPanel value={followup} onChange={setFollowup} onSubmit={submitFollowup} onUpload={uploadFollowupFiles} uploading={busy === "followup-upload"} onClose={() => setFollowup(null)} />}<div className="mt-5 space-y-2">{(history[selectedEvent.id] || []).map((item) => <div key={item.id} className="rounded-xl bg-black/25 p-3 text-sm"><div className="flex justify-between gap-2"><span>{actionLabel[item.action] || item.action}</span><span className="text-xs text-white/30">{new Date(item.created_at).toLocaleString("ru-RU")}</span></div>{item.reason && <p className="mt-1 text-xs text-white/45">{item.reason}</p>}</div>)}</div></div>}</aside></div>}
    {qrEventId && events.find(row=>row.id===qrEventId) && <div className="fixed inset-0 z-[95] grid place-items-center bg-black/75 p-4" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setQrEventId(null)}}><div role="dialog" aria-modal="true" aria-labelledby="qr-title" className="w-full max-w-md rounded-2xl border border-white/15 bg-[#172029] p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 id="qr-title" className="text-2xl">QR-код и ссылка</h2><button type="button" onClick={()=>setQrEventId(null)}><X className="text-white/45"/></button></div><div className="mx-auto mt-6 w-fit rounded-2xl bg-white p-4"><Image unoptimized src={`/api/accelerators/events/${qrEventId}/qr`} alt="QR-код для отметки" width={180} height={180}/></div><p className="mt-5 text-sm text-white/55">Ссылка для регистрации участников</p><div className="mt-2 flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2"><span className="min-w-0 flex-1 truncate text-sm text-white/70">{events.find(row=>row.id===qrEventId)?.checkin_url}</span><button type="button" onClick={()=>void copyAttendanceLink(events.find(row=>row.id===qrEventId)!.checkin_url)} aria-label="Копировать"><Clipboard size={16}/></button></div><button type="button" onClick={()=>void copyAttendanceLink(events.find(row=>row.id===qrEventId)!.checkin_url)} className="overview-secondary mt-3 w-full justify-center">Копировать ссылку</button><button type="button" onClick={()=>setQrEventId(null)} className="overview-secondary mt-6 ml-auto flex">Закрыть</button></div></div>}
    {reschedule && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4"><div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#1c1b1b] p-5"><h2 className="text-xl">Перенести мероприятие</h2><ReschedulePanel value={reschedule} onChange={setReschedule} onSubmit={submitReschedule} onClose={() => setReschedule(null)} /></div></div>}
    {cancellation && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4"><form onSubmit={submitCancellation} className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#1c1b1b] p-5"><h2 className="text-xl">Отменить мероприятие?</h2><label className="mt-4 block text-xs text-white/50">Причина отмены<textarea required minLength={2} value={cancellation.reason} onChange={(e) => setCancellation({ ...cancellation, reason: e.target.value })} className="workspace-input mt-2" /></label><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setCancellation(null)} className="overview-secondary">Не отменять</button><button className="workspace-button !bg-red-100">Отменить мероприятие</button></div></form></div>}
  </section>;
}

function HomeworkLinks({ homework, links, onChange }: { homework: Option[]; links: HomeworkLink[]; onChange: (value: HomeworkLink[]) => void }) {
  if (!homework.length) return null;
  return <div className="mt-5 rounded-2xl border border-white/8 p-4"><p className="mb-3 text-sm text-white/55">Связанные домашние задания</p><div className="space-y-2">{homework.map((assignment) => { const link = links.find((row) => row.assignment_id === assignment.id); return <div key={assignment.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.025] p-3"><label className="flex min-w-0 flex-1 items-center gap-3 text-sm text-white/60"><input type="checkbox" checked={Boolean(link)} onChange={(e) => onChange(e.target.checked ? [...links, { assignment_id: assignment.id, relation: "after" }] : links.filter((row) => row.assignment_id !== assignment.id))} /><span className="truncate">{assignment.title}</span></label>{link && <select value={link.relation} onChange={(e) => onChange(links.map((row) => row.assignment_id === assignment.id ? { ...row, relation: e.target.value as HomeworkLink["relation"] } : row))} className="workspace-input !w-auto"><option value="before">До</option><option value="during">Во время</option><option value="after">После</option></select>}</div>; })}</div></div>;
}

function EventHeader({ row, onOpen, onEdit, onPublish, onAttendance, onReschedule, onCancel, onFollowup, onHistory, onLifecycle }: { row: EventRow; onOpen: () => void; onEdit: (row: EventRow) => void; onPublish: (id: number) => void; onAttendance: (id: number) => void; onReschedule: () => void; onCancel: () => void; onFollowup: () => void; onHistory: (id: number) => void; onLifecycle: (row: EventRow, action: "duplicate" | "archive") => void }) {
  return <div className="flex flex-wrap items-start justify-between gap-4"><button type="button" onClick={onOpen} className="min-w-0 text-left"><div className="mb-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs ${row.status === "completed" ? "bg-emerald-400/10 text-emerald-300" : row.status === "cancelled" ? "bg-red-400/10 text-red-200" : row.status === "published" ? "bg-blue-400/10 text-blue-200" : "bg-white/7 text-white/40"}`}>{statusLabel[row.status]}</span><span className="text-xs text-white/35"><Users size={12} className="mr-1 inline" />{row.attendance_count}</span></div><h3 className="text-lg">{row.title}</h3><p className="mt-2 text-sm text-white/45"><CalendarDays size={14} className="mr-1 inline" />{new Date(row.starts_at).toLocaleString("ru-RU", { timeZone: row.timezone || undefined })} — {new Date(row.ends_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: row.timezone || undefined })}{row.timezone ? ` · ${row.timezone}` : ""}</p>{row.host_name && <p className="mt-1 text-sm text-white/40">Ведущий: {row.host_name}</p>}{row.location && <p className="mt-1 text-sm text-white/40"><MapPin size={14} className="mr-1 inline" />{row.location}</p>}{row.cancellation_reason && <p className="mt-2 text-sm text-red-200">Причина: {row.cancellation_reason}</p>}</button><div className="flex flex-wrap gap-2">{row.status === "draft" ? <><button type="button" onClick={() => onEdit(row)} className="workspace-button !bg-transparent !text-white"><Pencil size={14} /> Изменить</button><button type="button" onClick={() => void onPublish(row.id)} className="workspace-button"><Send size={14} /> Опубликовать</button></> : row.status !== "cancelled" && <><button type="button" onClick={() => void onAttendance(row.id)} className="workspace-button"><Users size={14} /> Посещение</button>{row.status === "published" && <><button type="button" onClick={onReschedule} className="workspace-button !bg-transparent !text-white">Перенести</button><button type="button" onClick={onCancel} className="workspace-button !bg-transparent !text-red-200"><X size={14} /> Отменить</button></>}<button type="button" onClick={onFollowup} className="workspace-button !bg-transparent !text-white">Итоги</button></>}<button type="button" onClick={() => void onHistory(row.id)} className="rounded-full border border-white/10 p-2 text-white/50" aria-label="История изменений"><History size={15} /></button><button type="button" onClick={() => void onLifecycle(row, "duplicate")} className="rounded-full border border-white/10 p-2 text-white/50" aria-label="Создать копию"><Copy size={15} /></button><button type="button" onClick={() => void onLifecycle(row, "archive")} className="rounded-full border border-white/10 p-2 text-white/50" aria-label="Архивировать"><Archive size={15} /></button></div></div>;
}

function EventDetails({ row }: { row: EventRow }) {
  return <div className="space-y-5"><div className="grid gap-3 text-sm text-white/60 sm:grid-cols-2"><p><CalendarDays size={14} className="mr-2 inline" />{new Date(row.starts_at).toLocaleString("ru-RU")}</p><p><MapPin size={14} className="mr-2 inline" />{row.event_format === "online" ? row.online_platform || "Онлайн" : row.location || "Адрес не указан"}</p></div>{row.preview_url && <Image unoptimized src={row.preview_url} alt={`Обложка события ${row.title}`} width={960} height={360} className="h-48 w-full rounded-2xl object-cover" />}{row.description && <div><h3 className="text-sm">Описание</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/55">{row.description}</p></div>}{row.meeting_url && <a href={row.meeting_url} target="_blank" rel="noreferrer" className="overview-secondary">Открыть подключение</a>}{row.homework_links.length > 0 && <div><h3 className="text-sm">Связанные задания</h3><div className="mt-2 space-y-2">{row.homework_links.map((link) => <p key={link.assignment_id} className="rounded-xl border border-white/8 p-3 text-sm text-white/55">{link.title || `Задание #${link.assignment_id}`} · {link.relation === "before" ? "до мероприятия" : link.relation === "during" ? "во время" : "после мероприятия"}</p>)}</div></div>}</div>;
}

function DrawerTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`border-b-2 px-3 py-3 text-sm ${active ? "border-white text-white" : "border-transparent text-white/45"}`}>{children}</button>; }

function ReschedulePanel({ value, onChange, onSubmit, onClose }: { value: RescheduleForm; onChange: (value: RescheduleForm) => void; onSubmit: (event: FormEvent) => void; onClose: () => void }) {
  return <form onSubmit={onSubmit} className="mt-4 grid gap-3 rounded-2xl border border-blue-300/15 bg-blue-300/[0.03] p-4 sm:grid-cols-2"><label className="text-xs text-white/50">Новое начало<input type="datetime-local" required value={value.startsAt} onChange={(e) => onChange({ ...value, startsAt: e.target.value })} className="workspace-input mt-2" /></label><label className="text-xs text-white/50">Новое окончание<input type="datetime-local" required value={value.endsAt} onChange={(e) => onChange({ ...value, endsAt: e.target.value })} className="workspace-input mt-2" /></label><label className="text-xs text-white/50 sm:col-span-2">Причина<textarea required minLength={2} value={value.reason} onChange={(e) => onChange({ ...value, reason: e.target.value })} className="workspace-input mt-2" /></label><div className="flex gap-2 sm:col-span-2"><button className="workspace-button">Сохранить перенос</button><button type="button" onClick={onClose} className="workspace-button !bg-transparent !text-white">Закрыть</button></div></form>;
}

function FollowupPanel({ value, onChange, onSubmit, onUpload, uploading, onClose }: { value: FollowupForm; onChange: (value: FollowupForm) => void; onSubmit: (event: FormEvent) => void; onUpload: (files: FileList | null) => void; uploading: boolean; onClose: () => void }) {
  return <form onSubmit={onSubmit} className="mt-4 grid gap-3 rounded-2xl border border-white/8 p-4 sm:grid-cols-2"><label className="text-xs text-white/50 sm:col-span-2">Ссылка на запись<input type="url" value={value.recordingUrl} onChange={(e) => onChange({ ...value, recordingUrl: e.target.value })} className="workspace-input mt-2" /></label><label className="text-xs text-white/50">Итог<textarea rows={3} value={value.outcome} onChange={(e) => onChange({ ...value, outcome: e.target.value })} className="workspace-input mt-2" /></label><label className="text-xs text-white/50">Следующий шаг<textarea rows={3} value={value.nextStep} onChange={(e) => onChange({ ...value, nextStep: e.target.value })} className="workspace-input mt-2" /></label><div className="sm:col-span-2"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-white/50">Материалы после встречи</p><div className="flex items-center gap-3"><label className="cursor-pointer text-xs text-blue-200"><Paperclip size={12} className="mr-1 inline" />{uploading ? "Загрузка…" : "Загрузить файлы"}<input type="file" multiple disabled={uploading} className="sr-only" onChange={(event) => void onUpload(event.target.files)} /></label><button type="button" onClick={() => onChange({ ...value, materials: [...value.materials, { title: "", url: "" }] })} className="text-xs text-white/50">+ Добавить ссылку</button></div></div>{value.materials.map((item, index) => <div key={index} className="mb-2 grid gap-2 sm:grid-cols-2"><input value={item.title} onChange={(e) => onChange({ ...value, materials: value.materials.map((current, itemIndex) => itemIndex === index ? { ...current, title: e.target.value } : current) })} placeholder="Название" className="workspace-input" /><input value={item.url} onChange={(e) => onChange({ ...value, materials: value.materials.map((current, itemIndex) => itemIndex === index ? { ...current, url: e.target.value } : current) })} placeholder="https://… или загруженный файл" className="workspace-input" /></div>)}</div><div className="flex gap-2 sm:col-span-2"><button disabled={uploading} className="workspace-button">Сохранить итоги</button><button type="button" onClick={onClose} className="workspace-button !bg-transparent !text-white">Закрыть</button></div></form>;
}

function AttendancePanel({ attendees, eventId, onMark, onExport, onQr, exporting }: { attendees: Attendee[]; eventId: number; onMark: (eventId: number, membershipId: number, status: "present" | "absent" | "excused") => void; onExport: (eventId: number) => void; onQr:()=>void; exporting: boolean }) {
  const count=(status:Attendee['status'])=>attendees.filter(row=>row.status===status).length;
  return <div className="mt-5"><div className="grid overflow-hidden rounded-xl border border-white/9 sm:grid-cols-4"><AttendanceMetric value={count('present')} label="присутствовали" tone="green"/><AttendanceMetric value={count('absent')} label="отсутствовали" tone="red"/><AttendanceMetric value={count('excused')} label="уважительно" tone="yellow"/><AttendanceMetric value={count('not_marked')} label="не отмечен"/></div><div className="my-5 flex flex-wrap gap-2"><button type="button" onClick={onQr} className="overview-secondary"><QrCode size={14}/>QR-код и ссылка</button><button type="button" onClick={() => void onExport(eventId)} disabled={exporting} className="overview-secondary">{exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Скачать таблицу</button></div>{!attendees.length ? <p className="text-sm text-white/35">Зачисленных резидентов пока нет.</p> : <div className="divide-y divide-white/8">{attendees.map((resident) => <div key={resident.membership_id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm">{resident.name}</p><p className="text-xs text-white/35">{resident.email}</p></div><div className="grid grid-cols-3 overflow-hidden rounded-lg border border-white/12">{([['present','Присутствовал'],['absent','Отсутствовал'],['excused','Уважительная']] as const).map(([status,label])=><button key={status} type="button" onClick={() => void onMark(eventId, resident.membership_id, status)} className={`px-3 py-2 text-xs ${resident.status===status?(status==='present'?'bg-emerald-400/15 text-emerald-300':status==='absent'?'bg-red-400/15 text-red-200':'bg-amber-400/15 text-amber-200'):'border-l border-white/8 first:border-l-0 text-white/45'}`}>{label}</button>)}</div></div>)}</div>}</div>;
}
function AttendanceMetric({value,label,tone}:{value:number;label:string;tone?:'green'|'red'|'yellow'}){return <div className="border-b border-white/8 p-4 last:border-0 sm:border-b-0 sm:border-r"><p className={`text-2xl ${tone==='green'?'text-emerald-300':tone==='red'?'text-red-300':tone==='yellow'?'text-amber-200':''}`}>{value}</p><p className="mt-1 text-xs text-white/45">{label}</p></div>}
