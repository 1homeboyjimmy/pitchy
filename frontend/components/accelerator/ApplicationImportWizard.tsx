"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Upload } from "lucide-react";
import { describeApiError, postAuthForm } from "@/lib/api";

type Source = "google_forms" | "yandex_forms" | "other";
type Column = "name" | "email" | "type" | "project_name" | "submitted_at";
type Report = {
  headers: string[]; sheets: string[]; sheet: string; sample?: string[][]; total: number;
  counts?: { ready: number; duplicate: number; invalid: number; imported: number };
  rows?: Array<{ row: number; name: string; email: string; status: string; reason: string }>;
  truncated?: boolean;
};
const COLUMNS: Array<{ key: Column; label: string }> = [
  { key: "name", label: "Имя *" }, { key: "email", label: "Email *" },
  { key: "type", label: "Тип заявки" }, { key: "project_name", label: "Проект" },
  { key: "submitted_at", label: "Дата подачи" },
];
function suggest(headers: string[]): Partial<Record<Column, number>> {
  const patterns: Record<Column, RegExp> = {
    name: /^(имя|фио|name|full.name|кандидат)/i, email: /^(e.?mail|электронная почта|почта)/i,
    type: /(тип заявки|с проектом|участие|application.type)/i,
    project_name: /(название проекта|project.name|проект)/i,
    submitted_at: /(время|дата|timestamp|submitted)/i,
  };
  return Object.fromEntries(COLUMNS.flatMap((column) => {
    const index = headers.findIndex((header) => patterns[column.key].test(header));
    return index < 0 ? [] : [[column.key, index]];
  })) as Partial<Record<Column, number>>;
}

export function ApplicationImportWizard({ token, cohortId, onImported, onApplications }: { token: string; cohortId: number; onImported: () => Promise<void>; onApplications: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<Source>("other");
  const [sheet, setSheet] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<Column, number>>>({});
  const [defaultType, setDefaultType] = useState<"" | "project" | "participant">("");
  const [loaded, setLoaded] = useState<Report | null>(null);
  const [preview, setPreview] = useState<Report | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const send = async (mode: "load" | "preview" | "commit", selectedSheet = sheet, selectedFile = file) => {
    if (!selectedFile || busy) return;
    setBusy(mode); setError("");
    const form = new FormData();
    form.append("file", selectedFile); form.append("source", source); form.append("sheet", selectedSheet);
    form.append("mapping_json", JSON.stringify(mode === "load" ? {} : mapping));
    form.append("default_type", defaultType);
    form.append("commit", String(mode === "commit"));
    try {
      const response = await postAuthForm<Report>("/api/accelerators/cohorts/" + cohortId + "/applications/import", form, token);
      if (mode === "load") { setLoaded(response); setSheet(response.sheet); setMapping(suggest(response.headers)); setPreview(null); setResult(null); }
      else if (mode === "preview") { setPreview(response); setResult(null); }
      else { setResult(response); setPreview(null); await onImported(); }
    } catch (reason) { setError(describeApiError(reason, "Не удалось обработать файл")); }
    finally { setBusy(""); }
  };
  const changeMapping = (key: Column, value: string) => {
    setMapping((current) => { const next = { ...current }; if (value === "") delete next[key]; else next[key] = Number(value); return next; });
    setPreview(null);
  };
  const chooseFile = (next: File | null) => {
    setFile(next); setLoaded(null); setPreview(null); setResult(null); setMapping({}); setError("");
    if (next) void send("load", "", next);
  };
  return <section className="rounded-xl border border-white/15 bg-[#1c1b1b] p-5">
    <h2 className="text-lg font-semibold">Ответы из других форм</h2>
    <p className="mt-2 text-sm text-white/55">Загрузите CSV или XLSX, сопоставьте столбцы и проверьте результат перед импортом.</p>
    <label className="mt-4 block text-xs text-white/55">Источник<select value={source} onChange={(event) => { setSource(event.target.value as Source); setPreview(null); }} className="workspace-input mt-2 !rounded-lg"><option value="other">Другая форма</option><option value="google_forms">Google Forms</option><option value="yandex_forms">Яндекс Формы</option></select></label>
    <label className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-white/35 px-4 py-5 text-center text-sm hover:bg-white/5"><Upload size={22} /><span>{file ? file.name : "Загрузить CSV / XLSX"}</span><span className="text-xs text-white/45">До 5 МБ и 2000 ответов</span><input type="file" accept=".csv,.xlsx" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0] || null)} /></label>
    <details className="mt-3 text-xs text-white/55"><summary className="cursor-pointer underline">Как выгрузить ответы</summary><p className="mt-2">В Google или Яндекс Форме откройте раздел ответов, выгрузите таблицу ответов в CSV или XLSX и загрузите файл здесь.</p></details>
    {busy && <p role="status" className="mt-4 text-sm text-white/60"><Loader2 size={14} className="mr-2 inline animate-spin" />{busy === "commit" ? "Импортируем…" : "Проверяем файл…"}</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-200">{error}</p>}
    {loaded && <>
      {loaded.sheets.length > 1 && <label className="mt-4 block text-xs text-white/55">Лист<select value={sheet} onChange={(event) => { setSheet(event.target.value); setPreview(null); void send("load", event.target.value); }} className="workspace-input mt-2 !rounded-lg">{loaded.sheets.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>}
      <p className="mt-4 text-sm">Найдено ответов: {loaded.total}</p>
      <div className="mt-4 space-y-2">{COLUMNS.map((column) => <label key={column.key} className="grid grid-cols-2 items-center gap-2 text-xs text-white/65"><span>{column.label}</span><select aria-label={column.label} value={mapping[column.key] ?? ""} onChange={(event) => changeMapping(column.key, event.target.value)} className="min-w-0 rounded-lg border border-white/20 bg-[#242323] px-2 py-2"><option value="">Не задан</option>{loaded.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></label>)}</div>
      {mapping.type === undefined && <label className="mt-4 block text-xs text-white/55">Тип для ответов без отдельного столбца<select value={defaultType} onChange={(event) => { setDefaultType(event.target.value as typeof defaultType); setPreview(null); }} className="workspace-input mt-2 !rounded-lg"><option value="">Выберите тип</option><option value="project">С проектом</option><option value="participant">Без проекта</option></select></label>}
      <p className="mt-4 text-xs text-white/55">Остальные столбцы сохранятся в анкете с исходными названиями.</p>
      <button type="button" disabled={Boolean(busy) || mapping.name === undefined || mapping.email === undefined || (mapping.type === undefined && !defaultType)} onClick={() => void send("preview")} className="mt-4 w-full rounded-lg border border-white/45 px-4 py-2 text-sm disabled:opacity-40">Проверить ответы</button>
    </>}
    {preview?.counts && <div className="mt-5 border-t border-white/15 pt-4 text-sm">
      <p>К добавлению: {preview.counts.ready} · Дубликаты: {preview.counts.duplicate} · Ошибки: {preview.counts.invalid}</p>
      {!!preview.rows?.length && <div className="mt-3 max-h-48 overflow-y-auto text-xs">{preview.rows.slice(0, 10).map((row) => <p key={row.row} className="border-t border-white/10 py-2">Строка {row.row} · {row.name || row.email || "Без имени"} · {row.status === "ready" ? "готова" : row.reason}</p>)}</div>}
      <button type="button" disabled={Boolean(busy) || preview.counts.ready === 0} onClick={() => void send("commit")} className="workspace-button mt-4 w-full !rounded-lg">Импортировать {preview.counts.ready} заявок</button>
    </div>}
    {result?.counts && <div role="status" className="mt-5 border-t border-white/15 pt-4 text-sm"><p>Добавлено: {result.counts.imported} · Пропущено: {result.counts.duplicate} · Ошибки: {result.counts.invalid}</p><button type="button" onClick={onApplications} className="mt-3 inline-flex items-center gap-2 underline">Перейти к списку заявок <ArrowRight size={14} /></button></div>}
  </section>;
}
