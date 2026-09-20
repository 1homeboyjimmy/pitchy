"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Clock3, Loader2, MoreHorizontal, RefreshCw, Search } from "lucide-react";
import { describeApiError, getAuthJson, patchAuthJson } from "@/lib/api";

type Risk = { level: "green" | "yellow" | "red"; reasons: string[]; attendance_percent: number };
type Signal = { membership_id: number; kind: string; fingerprint: string; severity: "low" | "medium" | "high"; title: string; reason: string; due_at?: string | null; state: "open" | "acknowledged" | "snoozed" | "resolved" };
type Row = { membership_id: number; name: string; email: string; program: { completed: number; total: number; percent: number }; risk: Risk; open_tasks: number; signals: Signal[] };
type Dashboard = { summary: { residents: number; open_signals: number; high_signals: number; overdue_signals: number; no_checkin: number }; rows: Row[]; signals: Signal[] };
type SignalFilter = "today" | "high" | "overdue" | "inactive" | "all";

const riskLabel = { green: "В норме", yellow: "Требует внимания", red: "Высокий риск" };
const riskClass = { green: "text-emerald-300", yellow: "text-amber-200", red: "text-red-300" };

export function TrackingDashboard({ cohortId, token, onOpenParticipant, headerAction }: { cohortId: number; token: string; onOpenParticipant?: (membershipId: number) => void; headerAction?: React.ReactNode }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [view, setView] = useState<"attention" | "participants">("attention");
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("today");
  const [riskFilter, setRiskFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [snooze, setSnooze] = useState<Signal | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy("load"); setError("");
    try { setDashboard(await getAuthJson<Dashboard>(`/api/accelerators/cohorts/${cohortId}/tracking-dashboard`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить трекинг")); }
    finally { setBusy(""); }
  }, [cohortId, token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); setSnooze(null); } }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, []);

  const allSignals = useMemo<Signal[]>(() => {
    if (!dashboard) return [];
    const source = dashboard.signals?.length ? dashboard.signals : dashboard.rows.flatMap((row) => row.signals || []);
    const memberships = new Set(source.map((signal) => signal.membership_id));
    return [...source, ...dashboard.rows.filter((row) => row.risk.level !== "green" && !memberships.has(row.membership_id)).map((row) => ({ membership_id: row.membership_id, kind: "risk", fingerprint: `risk-${row.membership_id}`, severity: row.risk.level === "red" ? "high" as const : "medium" as const, title: riskLabel[row.risk.level], reason: row.risk.reasons[0] || "Требуется внимание", due_at: null, state: "open" as const }))];
  }, [dashboard]);
  const visibleSignals = useMemo(() => allSignals.filter((signal) => {
    const active = signal.state === "open" || signal.state === "acknowledged";
    if (signalFilter === "all") return true;
    if (!active) return false;
    if (signalFilter === "high") return signal.severity === "high";
    if (signalFilter === "overdue") return Boolean(signal.due_at && new Date(signal.due_at) < new Date());
    if (signalFilter === "inactive") return signal.kind === "no_activity" || signal.kind === "no_checkin";
    return true;
  }), [allSignals, signalFilter]);
  const participants = useMemo(() => (dashboard?.rows || []).filter((row) => {
    const needle = query.trim().toLowerCase();
    return (riskFilter === "all" || row.risk.level === riskFilter) && (!needle || `${row.name} ${row.email}`.toLowerCase().includes(needle));
  }), [dashboard, query, riskFilter]);
  const resident = (id: number) => dashboard?.rows.find((row) => row.membership_id === id);

  const updateSignal = async (signal: Signal, state: Signal["state"], until?: string) => {
    setBusy(`signal-${signal.fingerprint}`); setError("");
    try {
      await patchAuthJson(`/api/accelerators/memberships/${signal.membership_id}/tracking-signals/${signal.fingerprint}`, { state, snoozed_until: until ? new Date(until).toISOString() : null }, token);
      setMenu(null); setSnooze(null); await load();
    } catch (reason) { setError(describeApiError(reason, "Не удалось изменить сигнал")); }
    finally { setBusy(""); }
  };

  const summary = dashboard?.summary;
  return <section>
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/8 pb-6">
      <div><p className="text-xs text-white/35">Обзор потока&nbsp; / &nbsp;Трекинг</p><h1 className="mt-3 text-3xl font-semibold">Трекинг</h1><p className="mt-1 text-sm text-white/45">Состояние и сопровождение участников</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => void load()} disabled={busy === "load"} className="overview-secondary"><RefreshCw size={15} className={busy === "load" ? "animate-spin" : ""} /> Обновить</button>{headerAction}</div>
    </header>

    {summary && <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-3 border-b border-white/8 pb-5">
      <Metric value={summary.high_signals} label="требуют внимания" tone="red" /><Dot /><Metric value={summary.overdue_signals} label="просрочено" tone="yellow" /><Dot /><Metric value={summary.no_checkin} label="без чек-ина" /><Dot /><Metric value={summary.residents} label="участников" />
    </div>}

    <div className="mt-5 flex border-b border-white/10">
      <Tab active={view === "attention"} onClick={() => setView("attention")}>Требуют внимания <Count>{summary?.open_signals || 0}</Count></Tab>
      <Tab active={view === "participants"} onClick={() => setView("participants")}>Все участники <Count>{summary?.residents || 0}</Count></Tab>
    </div>

    {error && <p role="alert" className="mt-5 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertTriangle size={15} className="mr-2 inline" />{error}</p>}
    {busy === "load" && !dashboard ? <div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin text-white/40" /></div> : view === "attention" ? <>
      <div className="mt-5 flex flex-wrap gap-2">{([['today','Все сигналы'],['high','Высокий риск'],['overdue','Просрочено'],['inactive','Без активности']] as Array<[SignalFilter,string]>).map(([key,label]) => <button type="button" key={key} onClick={() => setSignalFilter(key)} className={`rounded-xl border px-3 py-2 text-xs ${signalFilter === key ? "border-white/25 bg-white/10 text-white" : "border-white/8 text-white/45"}`}>{label}</button>)}</div>
      <div className="mt-5 overflow-visible rounded-2xl border border-white/9">
        {visibleSignals.map((signal) => { const row = resident(signal.membership_id); return <div key={signal.fingerprint} className="grid gap-4 border-b border-white/8 p-4 last:border-0 md:grid-cols-[220px_145px_1fr_150px_auto] md:items-center">
          <button type="button" onClick={() => onOpenParticipant?.(signal.membership_id)} className="text-left"><span className="block text-sm font-medium">{row?.name || "Участник"}</span><span className="mt-1 block truncate text-xs text-white/35">{row?.email}</span></button>
          <span className={`text-sm ${signal.severity === "high" ? "text-red-300" : signal.severity === "medium" ? "text-amber-200" : "text-white/55"}`}>{signal.severity === "high" ? "Высокий риск" : signal.severity === "medium" ? "Требует внимания" : "Наблюдение"}</span>
          <div><p className="text-sm">{signal.title}</p><p className="mt-1 text-xs text-white/40">{signal.reason}</p></div>
          <p className={`text-xs ${signal.due_at && new Date(signal.due_at) < new Date() ? "text-red-300" : "text-white/40"}`}>{signal.due_at ? `Срок: ${new Date(signal.due_at).toLocaleString("ru-RU")}` : "Без срока"}</p>
          <div className="relative flex items-center gap-2"><button type="button" onClick={() => onOpenParticipant?.(signal.membership_id)} className="overview-secondary whitespace-nowrap">Открыть карточку</button>{signal.kind !== "risk" && <><button type="button" aria-label="Действия с сигналом" onClick={() => setMenu(menu === signal.fingerprint ? null : signal.fingerprint)} className="rounded-xl border border-white/10 p-2.5 text-white/55"><MoreHorizontal size={16} /></button>{menu === signal.fingerprint && <div className="absolute right-0 top-12 z-20 min-w-44 rounded-xl border border-white/10 bg-[#1c1b1b] p-1 shadow-2xl"><MenuButton onClick={() => void updateSignal(signal, "acknowledged")}>В работу</MenuButton><MenuButton onClick={() => { setSnooze(signal); setSnoozeUntil(new Date(Date.now() + 86400000).toISOString().slice(0,16)); setMenu(null); }}>Отложить</MenuButton><MenuButton onClick={() => void updateSignal(signal, "resolved")}>Закрыть сигнал</MenuButton></div>}</>}</div>
        </div>; })}
        {!visibleSignals.length && <Empty title="Сейчас никто не требует внимания" text="Новые сигналы появятся здесь автоматически." />}
      </div>
    </> : <>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_220px]"><label className="relative"><Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени или email" className="workspace-input !pl-11" /></label><select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)} className="workspace-input"><option value="all">Все статусы</option><option value="red">Высокий риск</option><option value="yellow">Требует внимания</option><option value="green">В норме</option></select></div>
      <div className="mt-5 overflow-hidden rounded-2xl border border-white/9">{participants.map((row) => <button key={row.membership_id} type="button" onClick={() => onOpenParticipant?.(row.membership_id)} className="grid w-full gap-3 border-b border-white/8 p-4 text-left last:border-0 md:grid-cols-[1.2fr_1fr_1fr_1fr_auto] md:items-center"><span><span className="block text-sm">{row.name}</span><span className="block text-xs text-white/35">{row.email}</span></span><span><span className={`text-sm ${riskClass[row.risk.level]}`}>{riskLabel[row.risk.level]}</span><span className="block text-xs text-white/35">{row.risk.reasons[0] || "Отклонений нет"}</span></span><span className="text-sm text-white/55">Программа {row.program.percent}%</span><span className="text-sm text-white/55">Посещаемость {row.risk.attendance_percent}% · задач {row.open_tasks}</span><ChevronRight size={17} className="text-white/30" /></button>)}{!participants.length && <Empty title="Участники не найдены" text="Измените поиск или фильтр." />}</div>
    </>}

    {snooze && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSnooze(null); }}><div role="dialog" aria-modal="true" aria-labelledby="snooze-title" className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1c1b1b] p-5 shadow-2xl"><h2 id="snooze-title" className="text-xl">Отложить сигнал</h2><p className="mt-2 text-sm text-white/45">Сигнал вернётся в очередь в выбранное время.</p><label className="mt-5 block text-xs text-white/45">Дата и время<input type="datetime-local" value={snoozeUntil} onChange={(event) => setSnoozeUntil(event.target.value)} className="workspace-input mt-2" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setSnooze(null)} className="overview-secondary">Отмена</button><button type="button" disabled={!snoozeUntil || busy.startsWith("signal-")} onClick={() => void updateSignal(snooze, "snoozed", snoozeUntil)} className="workspace-button"><Clock3 size={15} /> Отложить</button></div></div></div>}
  </section>;
}

function Metric({ value, label, tone }: { value: number; label: string; tone?: "red" | "yellow" }) { return <p><strong className={`mr-2 text-xl ${tone === "red" ? "text-red-300" : tone === "yellow" ? "text-amber-200" : ""}`}>{value}</strong><span className="text-sm text-white/50">{label}</span></p>; }
function Dot() { return <span aria-hidden className="hidden text-white/20 sm:inline">•</span>; }
function Count({ children }: { children: React.ReactNode }) { return <span className="ml-2 rounded-md bg-white/8 px-2 py-0.5 text-xs text-white/50">{children}</span>; }
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`border-b-2 px-4 py-3 text-sm ${active ? "border-white text-white" : "border-transparent text-white/45"}`}>{children}</button>; }
function MenuButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white/65 hover:bg-white/5 hover:text-white">{children}</button>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="px-4 py-14 text-center"><p className="text-sm">{title}</p><p className="mt-2 text-xs text-white/35">{text}</p></div>; }
