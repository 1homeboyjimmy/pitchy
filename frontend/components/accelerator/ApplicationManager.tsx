"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";

import { type ApplicationFormSchema } from "./ApplicationFormEditor";
import { describeApiError, getAuthJson, patchAuthJson, postAuthJson } from "@/lib/api";

export type AcceleratorApplication = { id: number; applicant_name?: string | null; applicant_email?: string | null; application_type: string; status: string; membership_status?: string | null; form_payload: Record<string, unknown>; submitted_at: string; review_comment?: string | null };
type EventRow = { id: number; from_status?: string | null; to_status: string; comment?: string | null; created_at: string };

const STATUS_LABELS: Record<string, string> = { submitted: "Новая", under_review: "На рассмотрении", needs_info: "Нужны данные", waitlisted: "Лист ожидания", approved: "Принят", rejected: "Отклонена", archived: "Архив" };
const MEMBERSHIP_LABELS: Record<string, string> = { accepted: "ждёт подтверждения", enrolled: "участвует", suspended: "участие приостановлено", completed: "выпускник", withdrawn: "выбыл" };

function readableValue(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return String(value ?? "").trim();
}

export function ApplicationManager({ token, applications, schema, onChanged }: { token: string; applications: AcceleratorApplication[]; schema: ApplicationFormSchema; onChanged: () => Promise<void> }) {
  const [query, setQuery] = useState(""); const [status, setStatus] = useState("all"); const [applicationType, setApplicationType] = useState("all");
  const [selected, setSelected] = useState<AcceleratorApplication | null>(null); const [selectedIds, setSelectedIds] = useState<number[]>([]); const [events, setEvents] = useState<EventRow[]>([]); const [comment, setComment] = useState(""); const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const fieldsByKey = useMemo(() => new Map((schema.fields || []).map((field) => [field.key, field])), [schema]);
  const filtered = useMemo(() => applications.filter((row) => {
    const haystack = `${row.applicant_name || ""} ${row.applicant_email || ""} ${Object.values(row.form_payload).map(readableValue).join(" ")}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (status === "all" || row.status === status) && (applicationType === "all" || row.application_type === applicationType);
  }), [applicationType, applications, query, status]);
  const summaryFor = (row: AcceleratorApplication) => {
    const configured = schema.fields || [];
    const configuredKeys = new Set(configured.map((field) => field.key));
    const fallbackLabels: Record<string, string> = { project_name: "Название проекта", problem: "Проблема", solution: "Решение", target_audience: "Аудитория", motivation: "Мотивация", experience: "Опыт", team: "Команда", stage: "Стадия", traction: "Результаты" };
    const fallback = Object.keys(row.form_payload).filter((key) => !configuredKeys.has(key)).map((key) => ({ key, label: fallbackLabels[key] || key.replaceAll("_", " ") }));
    const ordered = [...configured, ...fallback].filter((field) => {
      const value = readableValue(row.form_payload[field.key]);
      return value && !["email", "name", "applicant_name"].includes(field.key);
    });
    const preferred = ordered.filter((field) => /(project|problem|solution|audience|motivation|experience|team|traction|stage)/i.test(field.key));
    return [...preferred, ...ordered.filter((field) => !preferred.includes(field))]
      .slice(0, 2)
      .map((field) => ({ label: field.label, value: readableValue(row.form_payload[field.key]) }));
  };
  const canBulk = (row: AcceleratorApplication, target: "waitlisted" | "rejected") => target === "waitlisted"
    ? ["submitted", "under_review"].includes(row.status)
    : ["submitted", "under_review", "needs_info", "waitlisted"].includes(row.status);

  const open = async (row: AcceleratorApplication) => { setSelected(row); setComment(""); setNotice(""); setBusy("events"); try { setEvents(await getAuthJson<EventRow[]>(`/api/accelerators/applications/${row.id}/events`, token)); } catch { setEvents([]); } finally { setBusy(""); } };
  const act = async (row: AcceleratorApplication, action: "accept" | "needs_info" | "rejected") => {
    setBusy("action"); setError("");
    try {
      if (action === "accept") await postAuthJson(`/api/accelerators/applications/${row.id}/accept`, { comment: comment || null }, token);
      else await patchAuthJson(`/api/accelerators/applications/${row.id}/status`, { status: action, comment: comment || null }, token);
      setSelected(null); await onChanged();
    } catch (reason) { setError(describeApiError(reason, "Не удалось обработать заявку")); }
    finally { setBusy(""); }
  };
  const resendInvitation = async (row: AcceleratorApplication) => {
    setBusy("resend"); setError(""); setNotice("");
    try { await postAuthJson(`/api/accelerators/applications/${row.id}/resend-invitation`, {}, token); setNotice("Приглашение сформировано повторно и добавлено в очередь отправки."); }
    catch (reason) { setError(describeApiError(reason, "Не удалось отправить приглашение повторно")); }
    finally { setBusy(""); }
  };
  const exportCsv = () => {
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [["ID", "Имя", "Email", "Тип", "Статус", "Дата"], ...filtered.map((row) => [row.id, row.applicant_name, row.applicant_email, row.application_type, row.status, row.submitted_at])];
    const blob = new Blob(["\ufeff" + rows.map((row) => row.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "accelerator-applications.csv"; anchor.click(); URL.revokeObjectURL(url);
  };
  const bulkAction = async (target: "waitlisted" | "rejected") => {
    const ids = selectedIds.filter((id) => { const row = applications.find((item) => item.id === id); return Boolean(row && canBulk(row, target)); });
    if (!ids.length) return;
    if (!window.confirm(`${target === "waitlisted" ? "Переместить в лист ожидания" : "Отклонить"} выбранные заявки: ${ids.length}?`)) return;
    setBusy("bulk"); setError("");
    try {
      const results = await Promise.allSettled(ids.map((id) => patchAuthJson(`/api/accelerators/applications/${id}/status`, { status: target, comment: null }, token)));
      const failed = results.filter((result) => result.status === "rejected").length;
      setSelectedIds(failed ? ids.filter((_, index) => results[index].status === "rejected") : []);
      if (failed) setError(`Обработано ${ids.length - failed} из ${ids.length}. Не удалось изменить: ${failed}. Проверьте оставшиеся заявки.`);
      await onChanged();
    } catch (reason) { setError(describeApiError(reason, "Не удалось обработать выбранные заявки.")); }
    finally { setBusy(""); }
  };

  return <div className="space-y-5">
    <section className="workspace-card"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl">Заявки <span className="text-white/30">{applications.length}</span></h2><p className="mt-1 text-sm text-white/40">Краткая выжимка, поиск по ответам и полная анкета без потери фильтров.</p></div><button type="button" onClick={exportCsv} disabled={!filtered.length} className="workspace-button !bg-transparent !text-white"><Download size={15} /> CSV</button></div>
      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto_auto]"><label className="relative"><Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, email, проект или ответ" className="workspace-input !pl-10" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} className="workspace-input"><option value="all">Все статусы</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={applicationType} onChange={(event) => setApplicationType(event.target.value)} className="workspace-input"><option value="all">Все типы</option><option value="project">Проекты</option><option value="participant">Без проекта</option></select></div>
      {error && <p role="alert" className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
      {filtered.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><label className="flex items-center gap-2 text-white/50"><input type="checkbox" checked={filtered.every((row) => selectedIds.includes(row.id))} onChange={(event) => setSelectedIds(event.target.checked ? Array.from(new Set([...selectedIds, ...filtered.map((row) => row.id)])) : selectedIds.filter((id) => !filtered.some((row) => row.id === id)))} /> Выбрать всё</label>{selectedIds.length > 0 && <><span className="text-white/35">Выбрано: {selectedIds.length}</span>{selectedIds.some((id) => { const row = applications.find((item) => item.id === id); return Boolean(row && canBulk(row, "waitlisted")); }) && <button type="button" onClick={() => void bulkAction("waitlisted")} disabled={Boolean(busy)} className="rounded-full border border-white/10 px-3 py-2 text-white/55">В лист ожидания</button>}{selectedIds.some((id) => { const row = applications.find((item) => item.id === id); return Boolean(row && canBulk(row, "rejected")); }) && <button type="button" onClick={() => void bulkAction("rejected")} disabled={Boolean(busy)} className="rounded-full border border-white/10 px-3 py-2 text-white/55">Отклонить</button>}</>}</div>}
    </section>
    <section className="workspace-card">{!filtered.length ? <p className="text-sm text-white/35">По выбранным условиям заявок нет.</p> : <div className="space-y-3">{filtered.map((row) => { const summary = summaryFor(row); return <article key={row.id} className="flex items-start gap-3 rounded-2xl border border-white/10 p-4 hover:border-white/25"><input type="checkbox" className="mt-1" aria-label={`Выбрать заявку ${row.applicant_name || row.id}`} checked={selectedIds.includes(row.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, row.id] : ids.filter((id) => id !== row.id))} /><button type="button" onClick={() => void open(row)} className="grid min-w-0 flex-1 gap-4 text-left md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_auto]"><div><p>{row.applicant_name || "Без имени"}</p><p className="mt-1 truncate text-sm text-white/40">{row.applicant_email}</p><p className="mt-2 text-xs text-white/30">{row.application_type === "project" ? "Проект" : "Участник без проекта"}</p></div><div className="space-y-2">{summary.length ? summary.map((item) => <p key={item.label} className="text-sm text-white/55"><span className="text-white/30">{item.label}: </span><span className="line-clamp-2">{item.value}</span></p>) : <p className="text-sm text-white/30">Содержательная выжимка появится после заполнения ответов.</p>}<span className="inline-flex items-center text-xs text-white/35">Открыть анкету полностью →</span></div><div className="text-left md:text-right"><span className="rounded-full bg-white/[.06] px-3 py-1 text-xs text-white/55">{STATUS_LABELS[row.status] || row.status}{row.membership_status && MEMBERSHIP_LABELS[row.membership_status] ? ` · ${MEMBERSHIP_LABELS[row.membership_status]}` : ""}</span><p className="mt-2 text-xs text-white/30">{new Date(row.submitted_at).toLocaleDateString("ru-RU")}</p></div></button></article>; })}</div>}</section>
    {selected && <section className="workspace-card border-white/20"><div className="flex items-start justify-between gap-3"><div><h2 className="text-2xl">{selected.applicant_name || "Без имени"}</h2><p className="mt-1 text-white/45">{selected.applicant_email}</p></div><button type="button" onClick={() => setSelected(null)} className="text-sm text-white/45">Закрыть</button></div>
      <dl className="mt-6 grid gap-3 sm:grid-cols-2">{Object.entries(selected.form_payload).map(([key, value]) => <div key={key} className="rounded-2xl bg-white/[.035] p-4"><dt className="text-xs text-white/35">{fieldsByKey.get(key)?.label || key}</dt><dd className="mt-2 whitespace-pre-wrap text-sm text-white/75">{Array.isArray(value) ? value.join(", ") : String(value ?? "—")}</dd></div>)}</dl>
      {selected.review_comment && <p className="mt-5 rounded-2xl bg-amber-300/[.05] p-4 text-sm text-amber-100/70">Комментарий: {selected.review_comment}</p>}
      <div className="mt-6"><p className="mb-3 text-xs uppercase tracking-[.16em] text-white/30">История</p>{busy === "events" ? <Loader2 size={18} className="animate-spin text-white/30" /> : !events.length ? <p className="text-sm text-white/35">Событий пока нет.</p> : <div className="space-y-2">{events.map((event) => <div key={event.id} className="border-l border-white/15 pl-4 text-sm"><span className="text-white/65">{STATUS_LABELS[event.to_status] || event.to_status}</span><span className="ml-2 text-xs text-white/30">{new Date(event.created_at).toLocaleString("ru-RU")}</span>{event.comment && <p className="mt-1 text-white/40">{event.comment}</p>}</div>)}</div>}</div>
      {!["approved", "rejected", "archived"].includes(selected.status) && <div className="mt-6 rounded-2xl border border-white/10 p-4"><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} placeholder="Комментарий кандидату (обязателен для доработки)" className="workspace-input resize-y" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void act(selected, "accept")} disabled={Boolean(busy)} className="workspace-button">Принять</button><button type="button" onClick={() => void act(selected, "needs_info")} disabled={Boolean(busy) || !comment.trim()} className="workspace-button !bg-amber-200">На доработку</button><button type="button" onClick={() => void act(selected, "rejected")} disabled={Boolean(busy)} className="workspace-button !bg-transparent !text-white">Отклонить</button></div></div>}
      {selected.status === "approved" && <p className="mt-6 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] p-4 text-sm text-emerald-100/70">Кандидат принят. Он самостоятельно подтвердит участие в своём кабинете.</p>}
      {selected.status === "approved" && selected.membership_status === "accepted" && <button type="button" onClick={() => void resendInvitation(selected)} disabled={Boolean(busy)} className="workspace-button mt-4 !bg-transparent !text-white">{busy === "resend" && <Loader2 size={15} className="animate-spin" />} Отправить приглашение повторно</button>}
      {notice && <p role="status" className="mt-4 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] p-4 text-sm text-emerald-100/70">{notice}</p>}
    </section>}
  </div>;
}
