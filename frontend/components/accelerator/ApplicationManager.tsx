"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Link2, Loader2, Search, X } from "lucide-react";

import { type ApplicationFormSchema } from "./ApplicationFormEditor";
import { describeApiError, getAuthJson, patchAuthJson, postAuthJson } from "@/lib/api";
import { csvDate, datedCsvFilename, downloadCsv } from "@/lib/csv";

export type AcceleratorApplication = {
  id: number; applicant_name?: string | null; applicant_email?: string | null; application_type: string; status: string;
  membership_status?: string | null; membership_id?: number | null; project_name?: string | null; tracker_names?: string[];
  form_payload: Record<string, unknown>; source_type?: string | null; form_version?: number; form_schema_snapshot?: ApplicationFormSchema;
  submitted_at: string; reviewed_at?: string | null; review_comment?: string | null;
};
type EventRow = { id: number; from_status?: string | null; to_status: string; comment?: string | null; created_at: string };
type Queue = "decision" | "needs_info" | "waitlisted" | "approved" | "all";
type DetailTab = "answers" | "history";
const STATUS_LABELS: Record<string, string> = { submitted: "Новая", under_review: "На рассмотрении", needs_info: "Нужны данные", waitlisted: "Лист ожидания", approved: "Принят", rejected: "Отклонена", archived: "Архив" };
const MEMBERSHIP_LABELS: Record<string, string> = { accepted: "Ждёт подтверждения", enrolled: "Участвует", suspended: "Приостановлен", completed: "Завершил участие", withdrawn: "Выбыл" };
const QUEUES: Array<{ key: Queue; label: string }> = [{ key: "decision", label: "Требуют решения" }, { key: "needs_info", label: "Нужны данные" }, { key: "waitlisted", label: "Лист ожидания" }, { key: "approved", label: "Приняты" }, { key: "all", label: "Все" }];

function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return String(value ?? "").trim();
}
function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
function fieldRows(row: AcceleratorApplication, fallback: ApplicationFormSchema) {
  const snapshot = row.form_schema_snapshot?.fields?.length ? row.form_schema_snapshot : fallback;
  const configured = snapshot.fields || [];
  const keys = new Set(configured.map((field) => field.key));
  const extra = Object.keys(row.form_payload || {}).filter((key) => !keys.has(key)).map((key) => ({ key, label: key.replaceAll("_", " ") }));
  return [...configured, ...extra].map((field) => ({ label: field.label, key: field.key, value: valueText(row.form_payload?.[field.key]) })).filter((field) => field.value);
}
function queueMatch(row: AcceleratorApplication, queue: Queue) {
  if (queue === "decision") return row.status === "submitted" || row.status === "under_review";
  return queue === "all" || row.status === queue;
}

export function ApplicationManager({ token, applications, schema, cohortName, publicUrl, onChanged }: {
  token: string; applications: AcceleratorApplication[]; schema: ApplicationFormSchema; cohortName?: string; publicUrl?: string; onChanged: () => Promise<void>;
}) {
  const [queue, setQueue] = useState<Queue>("decision");
  const [query, setQuery] = useState("");
  const [applicationType, setApplicationType] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [detailTab, setDetailTab] = useState<DetailTab>("answers");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsError, setEventsError] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const openButton = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const eventRequest = useRef(0);
  const selected = applications.find((row) => row.id === selectedId) || null;
  const counts = useMemo(() => Object.fromEntries(QUEUES.map((item) => [item.key, applications.filter((row) => queueMatch(row, item.key)).length])) as Record<Queue, number>, [applications]);
  const filtered = useMemo(() => applications.filter((row) => {
    const search = (row.applicant_name || "") + " " + (row.applicant_email || "") + " " + (row.project_name || "") + " " + Object.values(row.form_payload || {}).map(valueText).join(" ");
    return queueMatch(row, queue) && (applicationType === "all" || row.application_type === applicationType) && search.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"));
  }).sort((a, b) => sort === "newest" ? new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime() : new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime()), [applications, queue, applicationType, query, sort]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const savedQueue = params.get("applicationsQueue") as Queue | null;
    if (savedQueue && QUEUES.some((item) => item.key === savedQueue)) setQueue(savedQueue);
    setQuery(params.get("applicationsQuery") || "");
    setApplicationType(params.get("applicationsType") || "all");
    setSort(params.get("applicationsSort") === "oldest" ? "oldest" : "newest");
    const id = Number(params.get("application"));
    if (id > 0) setSelectedId(id);
    setUrlReady(true);
  }, []);
  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams(window.location.search);
    params.set("applicationsQueue", queue);
    if (query) params.set("applicationsQuery", query); else params.delete("applicationsQuery");
    if (applicationType !== "all") params.set("applicationsType", applicationType); else params.delete("applicationsType");
    if (sort !== "newest") params.set("applicationsSort", sort); else params.delete("applicationsSort");
    if (selectedId) params.set("application", String(selectedId)); else params.delete("application");
    window.history.replaceState(window.history.state, "", window.location.pathname + "?" + params.toString());
  }, [urlReady, queue, query, applicationType, sort, selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); openButton.current?.focus(); };
  }, [selectedId]);
  const loadEvents = useCallback(async (id: number) => {
    const request = ++eventRequest.current;
    setLoadingEvents(true); setEventsError("");
    try {
      const rows = await getAuthJson<EventRow[]>("/api/accelerators/applications/" + id + "/events", token);
      if (eventRequest.current === request) setEvents(rows);
    } catch (reason) {
      if (eventRequest.current === request) setEventsError(describeApiError(reason, "Не удалось загрузить историю"));
    } finally { if (eventRequest.current === request) setLoadingEvents(false); }
  }, [token]);
  useEffect(() => { if (selectedId) void loadEvents(selectedId); else eventRequest.current += 1; }, [selectedId, loadEvents]);
  const open = (row: AcceleratorApplication, button: HTMLButtonElement) => {
    openButton.current = button; setSelectedId(row.id); setDetailTab("answers"); setComment(""); setError(""); setNotice("");
  };
  const act = async (row: AcceleratorApplication, action: "accept" | "needs_info" | "rejected") => {
    if (busy || (action === "needs_info" && !comment.trim())) return;
    setBusy("action"); setError(""); setNotice("");
    try {
      if (action === "accept") await postAuthJson("/api/accelerators/applications/" + row.id + "/accept", { comment: comment.trim() || null }, token);
      else await patchAuthJson("/api/accelerators/applications/" + row.id + "/status", { status: action, comment: comment.trim() || null }, token);
      await onChanged(); setSelectedId(null);
    } catch (reason) { setError(describeApiError(reason, "Не удалось обработать заявку")); }
    finally { setBusy(""); }
  };
  const resendInvitation = async (row: AcceleratorApplication) => {
    if (busy) return;
    setBusy("resend"); setError("");
    try { await postAuthJson("/api/accelerators/applications/" + row.id + "/resend-invitation", {}, token); setNotice("Приглашение добавлено в очередь отправки."); }
    catch (reason) { setError(describeApiError(reason, "Не удалось отправить приглашение")); }
    finally { setBusy(""); }
  };
  const canBulk = (row: AcceleratorApplication, target: "waitlisted" | "rejected") => target === "waitlisted"
    ? ["submitted", "under_review"].includes(row.status)
    : ["submitted", "under_review", "needs_info", "waitlisted"].includes(row.status);
  const bulkAction = async (target: "waitlisted" | "rejected") => {
    const ids = selectedIds.filter((id) => { const row = applications.find((item) => item.id === id); return row && canBulk(row, target); });
    if (!ids.length || busy || !window.confirm("Изменить статус выбранных заявок: " + ids.length + "?")) return;
    setBusy("bulk"); setError("");
    const results = await Promise.allSettled(ids.map((id) => patchAuthJson("/api/accelerators/applications/" + id + "/status", { status: target, comment: null }, token)));
    const failed = ids.filter((_, index) => results[index].status === "rejected");
    setSelectedIds(failed);
    if (failed.length) setError("Обработано " + (ids.length - failed.length) + " из " + ids.length + ". Оставшиеся заявки выделены для повторной попытки.");
    try { await onChanged(); } catch (reason) { setError(describeApiError(reason, "Не удалось обновить список заявок")); }
    setBusy("");
  };
  const exportCsv = (full: boolean) => {
    const configured = schema.fields || [];
    const keys = new Set(configured.map((field) => field.key));
    const extras = Array.from(new Set(filtered.flatMap((row) => Object.keys(row.form_payload || {})))).filter((key) => !keys.has(key));
    const fields = full ? [...configured.map(({ key, label }) => ({ key, label })), ...extras.map((key) => ({ key, label: key.replaceAll("_", " ") }))] : [];
    downloadCsv(datedCsvFilename(full ? "accelerator-full-applications" : "accelerator-applications"), [
      ["ID", "Кандидат", "Email", "Тип", "Проект", "Статус", "Участие", "Подана", ...fields.map((field) => field.label)],
      ...filtered.map((row) => [row.id, row.applicant_name, row.applicant_email, row.application_type === "project" ? "С проектом" : "Без проекта", row.project_name, STATUS_LABELS[row.status] || row.status, MEMBERSHIP_LABELS[row.membership_status || ""] || "", csvDate(row.submitted_at), ...fields.map((field) => valueText(row.form_payload?.[field.key]))]),
    ]);
  };
  const copyLink = async () => { if (!publicUrl) return; try { await navigator.clipboard.writeText(new URL(publicUrl, window.location.origin).href); setNotice("Ссылка скопирована"); } catch { setError("Не удалось скопировать ссылку. Откройте анкету и скопируйте адрес."); } };
  const allFilteredSelected = filtered.length > 0 && filtered.every((row) => selectedIds.includes(row.id));

  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-3xl font-semibold tracking-tight">Заявки</h1><p className="mt-1 text-white/55">Отбор участников{cohortName ? " · " + cohortName : ""}</p></div>
      <div className="flex flex-wrap gap-2">
        {publicUrl && <button type="button" onClick={() => void copyLink()} className="rounded-lg border border-white/25 px-4 py-2 text-sm"><Link2 size={15} className="mr-2 inline" />Ссылка на заявку</button>}
        <details className="relative"><summary className="cursor-pointer list-none rounded-lg border border-white/25 px-4 py-2 text-sm"><Download size={15} className="mr-2 inline" />Экспорт</summary><div className="absolute right-0 z-20 mt-2 min-w-48 rounded-lg border border-white/20 bg-[#242323] p-2 shadow-xl"><button type="button" onClick={() => exportCsv(false)} disabled={!filtered.length} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-white/10">Рабочий CSV</button><button type="button" onClick={() => exportCsv(true)} disabled={!filtered.length} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-white/10">Полные анкеты</button></div></details>
      </div>
    </header>
    {!selected && notice && <p role="status" className="text-sm text-emerald-200">{notice}</p>}
    {!selected && error && <p role="alert" className="rounded-lg border border-red-300/25 p-3 text-sm text-red-200">{error}</p>}
    <div className="flex flex-wrap gap-2" role="group" aria-label="Очереди заявок">{QUEUES.map((item) => <button key={item.key} type="button" onClick={() => setQueue(item.key)} aria-pressed={queue === item.key} className={"rounded-lg border px-3 py-2 text-sm " + (queue === item.key ? "border-white bg-white font-medium text-[#141313]" : "border-white/10 bg-[#242323] text-white/65 hover:text-white")}>{item.label} <span className="ml-1 rounded-full bg-black/10 px-1.5 py-0.5 text-xs">{counts[item.key]}</span></button>)}</div>
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_150px]">
      <label className="relative"><Search size={17} className="absolute left-3 top-3 text-white/50" /><span className="sr-only">Поиск заявок</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени, email, проекту или ответам" className="workspace-input !rounded-lg !pl-10" /></label>
      <label><span className="sr-only">Тип участия</span><select value={applicationType} onChange={(event) => setApplicationType(event.target.value)} className="workspace-input !rounded-lg"><option value="all">Все типы</option><option value="project">С проектом</option><option value="participant">Без проекта</option></select></label>
      <label><span className="sr-only">Сортировка</span><select value={sort} onChange={(event) => setSort(event.target.value as "newest" | "oldest")} className="workspace-input !rounded-lg"><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option></select></label>
    </div>
    {selectedIds.length > 0 && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/15 bg-white/5 p-3 text-sm"><span>Выбрано: {selectedIds.length}</span><button type="button" disabled={Boolean(busy)} onClick={() => void bulkAction("waitlisted")} className="underline">В лист ожидания</button><button type="button" disabled={Boolean(busy)} onClick={() => void bulkAction("rejected")} className="underline">Отклонить</button></div>}

    <div className={selected ? "grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]" : ""}>
      <section className="min-w-0 overflow-hidden rounded-xl border border-white/15 bg-[#1c1b1b]">
        <div className="grid grid-cols-[30px_minmax(0,1.15fr)_minmax(0,1fr)_100px_60px] items-center gap-3 border-b border-white/15 px-4 py-3 text-xs text-white/55 max-md:hidden"><input type="checkbox" aria-label="Выбрать все видимые заявки" checked={allFilteredSelected} onChange={(event) => setSelectedIds(event.target.checked ? Array.from(new Set([...selectedIds, ...filtered.map((row) => row.id)])) : selectedIds.filter((id) => !filtered.some((row) => row.id === id)))} /><span>Кандидат</span><span>Проект / опыт</span><span>Статус</span><span>Дата</span></div>
        {!filtered.length ? <div className="p-6 text-sm text-white/60">{queue === "decision" && !query && applicationType === "all" ? <>Все заявки рассмотрены. <button type="button" onClick={() => setQueue("all")} className="underline">Посмотреть все</button></> : "По выбранным условиям заявок нет."}</div> : filtered.map((row) => {
          const answers = fieldRows(row, schema);
          const summary = row.application_type === "project" ? answers.find((field) => /problem|solution|project/i.test(field.key)) : answers.find((field) => /experience|motivation/i.test(field.key));
          return <div key={row.id} className={"flex items-start gap-3 border-b border-white/10 px-4 py-4 last:border-0 " + (selectedId === row.id ? "bg-white/10" : "hover:bg-white/[0.035]")}>
            <input type="checkbox" className="mt-2 shrink-0" aria-label={"Выбрать заявку " + (row.applicant_name || row.id)} checked={selectedIds.includes(row.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, row.id] : ids.filter((id) => id !== row.id))} />
            <button type="button" onClick={(event) => open(row, event.currentTarget)} className="grid min-w-0 flex-1 gap-2 text-left md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_100px_60px] md:items-center md:gap-3">
              <span className="min-w-0"><span className="block truncate font-medium">{row.applicant_name || "Без имени"}</span><span className="block truncate text-sm text-white/55">{row.applicant_email}</span><span className="block text-xs text-white/45 md:hidden">{row.application_type === "project" ? "С проектом" : "Без проекта"}</span></span>
              <span className="min-w-0"><span className="block truncate text-sm">{row.project_name || (row.application_type === "project" ? "Проект не указан" : "Без проекта")}</span><span className="line-clamp-2 text-xs text-white/55">{summary?.value || (row.application_type === "project" ? "Описание проекта не указано" : "Опыт не указан")}</span></span>
              <span className="w-fit rounded-md border border-amber-300/20 bg-amber-300/[0.07] px-2 py-1 text-xs text-amber-100">{STATUS_LABELS[row.status] || row.status}</span>
              <span className="text-xs text-white/55">{formatDate(row.submitted_at)}</span>
            </button>
          </div>;
        })}
      </section>

      {selected && <aside role="dialog" aria-label={"Заявка " + selected.id} className="fixed inset-0 z-50 flex min-w-0 flex-col overflow-y-auto border-l border-white/15 bg-[#1c1b1b] lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:max-h-[calc(100dvh-2rem)] lg:rounded-xl lg:border">
        <div className="sticky top-0 z-10 border-b border-white/15 bg-[#1c1b1b] p-5">
          <div className="flex justify-between gap-3"><p className="font-medium">Заявка №{selected.id}</p><button ref={closeButton} type="button" onClick={() => setSelectedId(null)} aria-label="Закрыть анкету"><X size={18} /></button></div>
          <h2 className="mt-5 text-2xl font-semibold">{selected.applicant_name || "Без имени"}</h2><p className="mt-1 text-sm text-white/55">{selected.applicant_email}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-md bg-white/10 px-2 py-1">{selected.application_type === "project" ? "С проектом" : "Без проекта"}</span><span className="rounded-md bg-amber-300/10 px-2 py-1 text-amber-100">{STATUS_LABELS[selected.status] || selected.status}</span>{selected.source_type && selected.source_type !== "pitchy" && <span className="rounded-md bg-white/10 px-2 py-1">Импорт: {selected.source_type === "google_forms" ? "Google Forms" : selected.source_type === "yandex_forms" ? "Яндекс Формы" : "другая форма"}</span>}{selected.membership_status && <span className="rounded-md bg-emerald-300/10 px-2 py-1 text-emerald-100">{MEMBERSHIP_LABELS[selected.membership_status] || selected.membership_status}</span>}</div>
          <div className="mt-5 flex gap-6 text-sm"><button type="button" onClick={() => setDetailTab("answers")} aria-pressed={detailTab === "answers"} className={detailTab === "answers" ? "border-b-2 border-white pb-2" : "pb-2 text-white/55"}>Анкета</button><button type="button" onClick={() => setDetailTab("history")} aria-pressed={detailTab === "history"} className={detailTab === "history" ? "border-b-2 border-white pb-2" : "pb-2 text-white/55"}>История</button></div>
        </div>
        <div className="flex-1 space-y-5 p-5 text-sm">
          {detailTab === "answers" ? <>
            <p className="text-white/55">Подана {formatDate(selected.submitted_at)}{selected.form_version ? " · Версия анкеты " + selected.form_version : ""}</p>
            {selected.project_name && <div><p className="text-white/55">Проект</p><p className="mt-1 text-lg font-medium">{selected.project_name}</p></div>}
            {fieldRows(selected, schema).length ? fieldRows(selected, schema).map((field) => <div key={field.key}><h3 className="text-white/60">{field.label}</h3><p className="mt-1 whitespace-pre-wrap leading-relaxed">{field.value}</p></div>) : <p className="text-white/55">В анкете нет содержательных ответов.</p>}
          </> : <>
            {selected.review_comment && <p className="rounded-lg border border-white/10 p-3">Комментарий кандидату: {selected.review_comment}</p>}
            {loadingEvents ? <Loader2 className="animate-spin" /> : eventsError ? <p role="alert">{eventsError} <button type="button" onClick={() => void loadEvents(selected.id)} className="underline">Повторить</button></p> : !events.length ? <p className="text-white/55">Событий пока нет.</p> : events.map((event) => <div key={event.id} className="border-l border-white/20 pl-4"><p>{STATUS_LABELS[event.to_status] || event.to_status}</p><p className="text-xs text-white/55">{formatDate(event.created_at)}</p>{event.comment && <p className="mt-1 text-white/75">{event.comment}</p>}</div>)}
          </>}
        </div>
        <div className="sticky bottom-0 border-t border-white/15 bg-[#1c1b1b] p-5">
          {error && <p role="alert" className="mb-3 text-sm text-red-200">{error}</p>}
          {notice && <p role="status" className="mb-3 text-sm text-emerald-200">{notice}</p>}
          {["submitted", "under_review", "needs_info", "waitlisted"].includes(selected.status) && <>
            <label className="block text-sm">Комментарий кандидату<textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="Напишите комментарий…" className="workspace-input mt-2 !rounded-lg" /></label>
            <p className="mt-1 text-xs text-white/50">Для запроса уточнений комментарий обязателен.</p>
            <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => void act(selected, "accept")} className="workspace-button !rounded-lg">Принять</button><button type="button" disabled={Boolean(busy) || !comment.trim()} onClick={() => void act(selected, "needs_info")} className="rounded-lg border border-white/45 px-3 py-2 text-sm">Запросить уточнение</button><button type="button" disabled={Boolean(busy)} onClick={() => void act(selected, "rejected")} className="px-3 py-2 text-sm text-red-300">Отклонить</button></div>
          </>}
          {selected.status === "approved" && selected.membership_status === "accepted" && <button type="button" disabled={Boolean(busy)} onClick={() => void resendInvitation(selected)} className="rounded-lg border border-white/40 px-3 py-2 text-sm">Отправить приглашение повторно</button>}
        </div>
      </aside>}
    </div>
  </div>;
}
