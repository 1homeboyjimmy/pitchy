"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, CheckCircle2, Loader2, RefreshCw, Save, Users } from "lucide-react";

import { describeApiError, getAuthJson, postAuthJson, putAuthJson } from "@/lib/api";

type Decision = { outcome: "completed" | "withdrawn"; reason: string; updated_at?: string };
type ClosureResident = {
  membership_id: number;
  name: string;
  email?: string | null;
  status: string;
  project_id?: number | null;
  decision?: Decision | null;
  snapshot_ready: boolean;
};
type ClosureData = {
  cohort_id: number;
  cohort_status: string;
  closure?: { id: number; status: string; summary?: string | null; completed_at?: string | null } | null;
  residents: ClosureResident[];
  missing_decision_membership_ids: number[];
  blockers: string[];
  can_complete: boolean;
};
type Draft = { outcome: "completed" | "withdrawn"; reason: string };

export function CohortClosure({ cohortId, token, onCompleted }: { cohortId: number; token: string; onCompleted?: () => Promise<void> | void }) {
  const [data, setData] = useState<ClosureData | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const apply = useCallback((next: ClosureData) => {
    setData(next);
    setSummary(next.closure?.summary || "");
    setDrafts(Object.fromEntries(next.residents.map((resident) => [resident.membership_id, {
      outcome: resident.decision?.outcome || (resident.status === "accepted" ? "withdrawn" : "completed"),
      reason: resident.decision?.reason || "",
    }])));
  }, []);
  const load = useCallback(async () => {
    setError("");
    try { apply(await getAuthJson<ClosureData>(`/api/accelerators/cohorts/${cohortId}/closure`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить завершение потока")); }
  }, [apply, cohortId, token]);
  useEffect(() => { void load(); }, [load]);

  const prepare = async () => {
    setBusy("prepare"); setError("");
    try { apply(await postAuthJson<ClosureData>(`/api/accelerators/cohorts/${cohortId}/closure/prepare`, {}, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось начать завершение потока")); }
    finally { setBusy(""); }
  };
  const saveDecision = async (membershipId: number) => {
    const draft = drafts[membershipId];
    if (!draft?.reason.trim()) { setError("Для итогового решения нужна причина."); return; }
    setBusy(`decision-${membershipId}`); setError("");
    try { apply(await putAuthJson<ClosureData>(`/api/accelerators/cohorts/${cohortId}/closure/decisions/${membershipId}`, { ...draft, reason: draft.reason.trim() }, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось сохранить решение")); }
    finally { setBusy(""); }
  };
  const complete = async () => {
    if (!data?.can_complete || !window.confirm("Завершить поток? Результаты будут зафиксированы, а рабочие разделы станут доступны только для чтения.")) return;
    setBusy("complete"); setError("");
    try {
      apply(await postAuthJson<ClosureData>(`/api/accelerators/cohorts/${cohortId}/closure/complete`, { summary: summary.trim() || null }, token));
      await onCompleted?.();
    } catch (reason) { setError(describeApiError(reason, "Не удалось завершить поток")); }
    finally { setBusy(""); }
  };
  const decided = useMemo(() => data?.residents.filter((row) => row.decision).length || 0, [data]);

  if (!data) return <section className="workspace-card grid min-h-48 place-items-center"><Loader2 className="animate-spin text-white/35" /></section>;
  const completed = data.closure?.status === "completed";
  return <div className="space-y-6">
    <section className="workspace-card">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.18em] text-white/30">Жизненный цикл потока</p><h2 className="mt-2 text-2xl">Итоговые решения и снимки</h2><p className="mt-2 max-w-3xl text-sm text-white/45">Перед завершением выберите результат для каждого активного резидента. Система сохранит неизменяемый снимок программы, отчётности, артефактов, команды и расхода лимитов.</p></div><button type="button" onClick={() => void load()} className="rounded-full border border-white/10 p-3 text-white/40" aria-label="Обновить завершение"><RefreshCw size={16} /></button></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3"><Stat label="Резидентов" value={data.residents.length} /><Stat label="Решения готовы" value={decided} /><Stat label="Осталось" value={data.missing_decision_membership_ids.length} /></div>
      {!data.closure && data.cohort_status === "active" && <button type="button" onClick={() => void prepare()} disabled={Boolean(busy)} className="workspace-button mt-5"><Archive size={15} /> Подготовить завершение</button>}
      {completed && <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-sm text-emerald-100"><CheckCircle2 size={17} className="mr-2 inline" />Поток завершён. Итоговые снимки сохранены, обычные изменения состава и программы заморожены.</div>}
    </section>

    {data.closure && <section className="workspace-card"><h2 className="text-xl">Решения по резидентам</h2><div className="mt-5 space-y-3">{data.residents.map((resident) => { const draft = drafts[resident.membership_id] || { outcome: "completed", reason: "" }; return <article key={resident.membership_id} className="rounded-2xl border border-white/9 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p>{resident.name}</p><p className="mt-1 text-xs text-white/35">{resident.email || "Контакт недоступен"} · {resident.status}</p></div>{resident.snapshot_ready && <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300">Снимок готов</span>}</div>{!completed && <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]"><select value={draft.outcome} onChange={(event) => setDrafts((current) => ({ ...current, [resident.membership_id]: { ...draft, outcome: event.target.value as Draft["outcome"] } }))} className="workspace-input" aria-label={`Итог ${resident.name}`}><option value="completed" disabled={resident.status === "accepted"}>Выпускник</option><option value="withdrawn">Выбыл</option></select><input value={draft.reason} onChange={(event) => setDrafts((current) => ({ ...current, [resident.membership_id]: { ...draft, reason: event.target.value } }))} minLength={2} maxLength={4000} placeholder="Причина итогового решения" className="workspace-input" aria-label={`Причина ${resident.name}`} /><button type="button" onClick={() => void saveDecision(resident.membership_id)} disabled={Boolean(busy)} className="workspace-button"><Save size={14} /> Сохранить</button></div>}{completed && resident.decision && <p className="mt-3 text-sm text-white/45">{resident.decision.outcome === "completed" ? "Выпускник" : "Выбыл"}: {resident.decision.reason}</p>}</article>; })}{!data.residents.length && <p className="text-sm text-white/35">В потоке нет активных резидентов.</p>}</div></section>}

    {data.closure && !completed && <section className="workspace-card"><h2 className="text-xl">Финальная фиксация</h2><textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} maxLength={10000} placeholder="Итог потока, результаты и важные замечания" className="workspace-input mt-4 resize-y" /><button type="button" onClick={() => void complete()} disabled={!data.can_complete || Boolean(busy)} className="workspace-button mt-4"><CheckCircle2 size={15} /> Завершить поток</button>{data.blockers.length > 0 && <ul className="mt-4 space-y-1 text-sm text-amber-100">{data.blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}</ul>}</section>}
    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border border-white/8 p-4"><p className="text-2xl">{value}</p><p className="mt-1 text-xs text-white/35"><Users size={12} className="mr-1 inline" />{label}</p></div>; }
