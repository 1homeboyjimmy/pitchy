"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, History, Loader2, RotateCcw } from "lucide-react";

import { describeApiError, getAuthJson, patchAuthJson } from "@/lib/api";

type QueueItem = {
  id: number;
  membership_id: number;
  team_id?: number | null;
  resident: { name: string; email: string };
  answer_text?: string | null;
  attachments: string[];
  score?: number | null;
  passed?: boolean | null;
  display_status: "review_pending" | "needs_revision" | "accepted";
  attempt_count: number;
  submitted_at: string;
  review_comment?: string | null;
  assignment: { id: number; title: string; stage_id?: number | null; assignment_type: "quiz" | "text_files"; submission_mode: "individual" | "team"; due_at?: string | null; passing_score?: number | null; max_attempts: number };
  team?: { id: number; name: string } | null;
  trackers: Array<{ id: number; name: string }>;
};
type Attempt = { id: number; attempt_number: number; answer_text?: string | null; attachments: string[]; score?: number | null; passed?: boolean | null; review_status?: string | null; review_comment?: string | null; created_at: string; quiz_results: Array<{ question_id: string; prompt: string; selected_option_label?: string | null; correct_option_label?: string | null; correct: boolean }> };
type Filters = { stage: string; assignment: string; participant: string; team: string; tracker: string; status: string };

const STATUS_LABELS: Record<string, string> = { review_pending: "На проверке", needs_revision: "На доработке", accepted: "Принято" };

export function HomeworkReviewQueue({ cohortId, token }: { cohortId: number; token: string }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [filters, setFilters] = useState<Filters>({ stage: "", assignment: "", participant: "", team: "", tracker: "", status: "review_pending" });
  const [comments, setComments] = useState<Record<number, string>>({});
  const [attempts, setAttempts] = useState<Record<number, Attempt[]>>({});
  const [openHistory, setOpenHistory] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await getAuthJson<{ items: QueueItem[] }>(`/api/accelerators/cohorts/${cohortId}/homework-review-queue`, token);
      setItems(data.items);
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить очередь проверки")); }
  }, [cohortId, token]);
  useEffect(() => { void load(); }, [load]);

  const options = useMemo(() => ({
    stages: Array.from(new Set(items.map((row) => row.assignment.stage_id).filter(Boolean))).sort((a, b) => Number(a) - Number(b)),
    assignments: Array.from(new Map(items.map((row) => [row.assignment.id, row.assignment])).values()),
    participants: Array.from(new Map(items.map((row) => [row.membership_id, row.resident])).entries()),
    teams: Array.from(new Map(items.filter((row) => row.team).map((row) => [row.team!.id, row.team!])).values()),
    trackers: Array.from(new Map(items.flatMap((row) => row.trackers.map((tracker) => [tracker.id, tracker] as const))).values()),
  }), [items]);
  const visible = useMemo(() => items.filter((row) =>
    (!filters.stage || String(row.assignment.stage_id) === filters.stage)
    && (!filters.assignment || String(row.assignment.id) === filters.assignment)
    && (!filters.participant || String(row.membership_id) === filters.participant)
    && (!filters.team || String(row.team_id) === filters.team)
    && (!filters.tracker || row.trackers.some((tracker) => String(tracker.id) === filters.tracker))
    && (!filters.status || row.display_status === filters.status)
  ), [filters, items]);

  const review = async (item: QueueItem, status: "accepted" | "needs_revision") => {
    setBusy(`review-${item.id}`); setError("");
    try {
      await patchAuthJson(`/api/accelerators/homework/submissions/${item.id}/review`, { status, comment: comments[item.id] || null }, token);
      await load();
    } catch (reason) { setError(describeApiError(reason, "Не удалось сохранить решение")); }
    finally { setBusy(""); }
  };
  const toggleHistory = async (item: QueueItem) => {
    if (openHistory === item.id) { setOpenHistory(null); return; }
    setOpenHistory(item.id); setBusy(`history-${item.id}`);
    try {
      const rows = await getAuthJson<Attempt[]>(`/api/accelerators/homework/submissions/${item.id}/attempts`, token);
      setAttempts((current) => ({ ...current, [item.id]: rows }));
    }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить историю попыток")); }
    finally { setBusy(""); }
  };
  const patchFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));

  return <section className="workspace-card"><div><h2 className="text-xl">Единая очередь проверки</h2><p className="mt-1 text-sm text-white/40">Ответы можно отфильтровать по этапу, заданию, участнику, команде, трекеру и статусу.</p></div>
    <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><Filter label="Этап" value={filters.stage} onChange={(value) => patchFilter("stage", value)} options={options.stages.map((id) => [String(id), `Этап #${id}`])} /><Filter label="Задание" value={filters.assignment} onChange={(value) => patchFilter("assignment", value)} options={options.assignments.map((row) => [String(row.id), row.title])} /><Filter label="Участник" value={filters.participant} onChange={(value) => patchFilter("participant", value)} options={options.participants.map(([id, row]) => [String(id), row.name])} /><Filter label="Команда" value={filters.team} onChange={(value) => patchFilter("team", value)} options={options.teams.map((row) => [String(row.id), row.name])} /><Filter label="Трекер" value={filters.tracker} onChange={(value) => patchFilter("tracker", value)} options={options.trackers.map((row) => [String(row.id), row.name])} /><Filter label="Статус" value={filters.status} onChange={(value) => patchFilter("status", value)} options={Object.entries(STATUS_LABELS)} /></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
    <div className="mt-5 space-y-3">{visible.map((item) => <article key={item.id} className="rounded-2xl border border-white/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-white/35">{item.assignment.title}{item.team ? ` · ${item.team.name}` : ""}</p><h3 className="mt-1">{item.resident.name}</h3><p className="mt-1 text-xs text-white/30">Попытка {item.attempt_count}{item.score != null ? ` · ${item.score}%` : ""} · {new Date(item.submitted_at).toLocaleString("ru-RU")}</p></div><span className="rounded-full bg-white/7 px-2 py-1 text-xs text-white/55">{STATUS_LABELS[item.display_status] || item.display_status}</span></div>{item.answer_text && <p className="mt-4 whitespace-pre-wrap text-sm text-white/60">{item.answer_text}</p>}{item.attachments.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-2 block text-sm text-sky-300 underline">Файл {index + 1}</a>)}{item.review_comment && <p className="mt-3 rounded-xl bg-white/[.04] p-3 text-sm text-white/50">Комментарий: {item.review_comment}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><button type="button" onClick={() => void toggleHistory(item)} className="inline-flex items-center gap-2 text-sm text-white/45"><History size={14} /> История <ChevronDown size={13} /></button>{item.assignment.assignment_type === "text_files" && <div className="flex flex-1 flex-wrap justify-end gap-2"><textarea aria-label={`Комментарий к ответу ${item.resident.name}`} value={comments[item.id] || ""} onChange={(event) => setComments({ ...comments, [item.id]: event.target.value })} placeholder="Комментарий трекера" rows={1} className="workspace-input !w-auto min-w-56 flex-1" /><button type="button" onClick={() => void review(item, "needs_revision")} disabled={Boolean(busy)} className="workspace-button !bg-transparent !text-white"><RotateCcw size={14} /> На доработку</button><button type="button" onClick={() => void review(item, "accepted")} disabled={Boolean(busy)} className="workspace-button"><CheckCircle2 size={14} /> Принять</button></div>}</div>
      {openHistory === item.id && <AttemptHistory rows={attempts[item.id]} loading={busy === `history-${item.id}`} />}
    </article>)}{!visible.length && <p className="py-5 text-center text-sm text-white/35">По выбранным фильтрам ответов нет.</p>}</div>
  </section>;
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) { return <label className="text-xs text-white/40">{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="workspace-input mt-1"><option value="">Все</option>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>; }

function AttemptHistory({ rows, loading }: { rows?: Attempt[]; loading: boolean }) { if (loading) return <Loader2 className="mt-4 animate-spin text-white/40" />; return <div className="mt-4 space-y-3 border-t border-white/8 pt-4">{(rows || []).map((attempt) => <div key={attempt.id} className="rounded-xl bg-black/25 p-3"><p className="text-sm">Попытка {attempt.attempt_number}{attempt.score != null ? ` · ${attempt.score}%` : ""}</p>{attempt.review_comment && <p className="mt-1 text-xs text-white/45">Комментарий: {attempt.review_comment}</p>}{attempt.quiz_results.map((result) => <p key={result.question_id} className={`mt-2 text-xs ${result.correct ? "text-emerald-300" : "text-amber-200"}`}>{result.correct ? "✓" : "×"} {result.prompt}: {result.selected_option_label || "нет ответа"}{!result.correct && result.correct_option_label ? ` · верно: ${result.correct_option_label}` : ""}</p>)}</div>)}</div>; }
