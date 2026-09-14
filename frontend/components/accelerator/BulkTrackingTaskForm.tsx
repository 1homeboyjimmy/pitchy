"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, Loader2, Users } from "lucide-react";

import { describeApiError, getAuthJson, postAuthJson } from "@/lib/api";
import { notifySuccess } from "@/lib/ui";

type ResidentRow = {
  membership_id: number;
  name: string;
  email: string;
  risk: { level: "green" | "yellow" | "red" };
};

type TrackingDashboardResponse = { rows: ResidentRow[] };

export function BulkTrackingTaskForm({ cohortId, token, onCreated }: { cohortId: number; token: string; onCreated?: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ResidentRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ title: "", description: "", dueAt: "" });
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await getAuthJson<TrackingDashboardResponse>(`/api/accelerators/cohorts/${cohortId}/tracking-dashboard`, token);
      setRows(response.rows);
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось загрузить список участников"));
    } finally {
      setLoading(false);
    }
  }, [cohortId, token]);

  useEffect(() => {
    if (open && !rows.length) void loadRows();
  }, [loadRows, open, rows.length]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => !needle || `${row.name} ${row.email}`.toLowerCase().includes(needle));
  }, [query, rows]);

  const allVisibleSelected = Boolean(visibleRows.length) && visibleRows.every((row) => selected.has(row.membership_id));
  const toggleAllVisible = () => {
    setSelected((current) => {
      const next = new Set(current);
      visibleRows.forEach((row) => allVisibleSelected ? next.delete(row.membership_id) : next.add(row.membership_id));
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected.size) {
      setError("Выберите хотя бы одного участника");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await postAuthJson<{ created: number }>(`/api/accelerators/cohorts/${cohortId}/tracking-tasks/bulk`, {
        membership_ids: Array.from(selected),
        title: form.title,
        description: form.description || null,
        due_at: form.dueAt ? new Date(form.dueAt).toISOString() : null,
      }, token);
      notifySuccess(`Задача назначена: ${result.created}`);
      setForm({ title: "", description: "", dueAt: "" });
      setSelected(new Set());
      setOpen(false);
      await onCreated?.();
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось назначить задачи"));
    } finally {
      setSubmitting(false);
    }
  };

  return <section className="workspace-card">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-xl"><Users size={19} /> Массовая задача</h2><p className="mt-1 text-sm text-white/40">Назначьте одну обязательную задачу выбранным участникам.</p></div>
      <button type="button" onClick={() => setOpen((value) => !value)} className="workspace-button">{open ? "Свернуть" : "Назначить"}</button>
    </div>
    {open && <form onSubmit={submit} className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="workspace-input" placeholder="Поиск участника" />
        <div className="mt-3 flex items-center justify-between gap-3 text-sm"><span className="text-white/45">Выбрано: {selected.size}</span><button type="button" onClick={toggleAllVisible} disabled={!visibleRows.length} className="text-white/60 hover:text-white">{allVisibleSelected ? "Снять выбор" : "Выбрать всех из списка"}</button></div>
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
          {loading ? <Loader2 className="mx-auto my-8 animate-spin text-white/40" /> : visibleRows.map((row) => <label key={row.membership_id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/8 p-3 hover:border-white/15">
            <input type="checkbox" checked={selected.has(row.membership_id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.membership_id)) next.delete(row.membership_id); else next.add(row.membership_id); return next; })} className="size-4 accent-white" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm">{row.name}</span><span className="block truncate text-xs text-white/35">{row.email}</span></span>
            <span className={`text-xs ${row.risk.level === "red" ? "text-red-200" : row.risk.level === "yellow" ? "text-amber-200" : "text-emerald-300"}`}>{row.risk.level === "red" ? "Высокий риск" : row.risk.level === "yellow" ? "Внимание" : "В норме"}</span>
          </label>)}
          {!loading && !visibleRows.length && <p className="py-8 text-center text-sm text-white/35">Участники не найдены.</p>}
        </div>
      </div>
      <div>
        <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required minLength={2} className="workspace-input" placeholder="Что нужно сделать" />
        <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} className="workspace-input mt-3 resize-y" placeholder="Описание задачи" />
        <label className="mt-3 block text-xs text-white/40">Срок (необязательно)<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} className="workspace-input mt-1" /></label>
        <button disabled={submitting || loading || !selected.size} className="workspace-button mt-4 inline-flex items-center gap-2">{submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckSquare size={16} />} Назначить {selected.size ? `(${selected.size})` : ""}</button>
      </div>
      {error && <p role="alert" className="lg:col-span-2 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
    </form>}
  </section>;
}
