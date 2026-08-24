"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Loader2, Power, RefreshCw, ShieldAlert } from "lucide-react";

import { describeApiError, getAuthJson, putAuthJson } from "@/lib/api";

type Analytics = {
  applications: Record<string, number>;
  residents: Record<string, number>;
  program: { published_stages: number; completion_percent: number };
  homework: { published: number; submissions: Record<string, number> };
  attendance: { published_events: number; attendance_percent: number };
  quota_usage: Record<string, number>;
  artifacts: Record<string, number>;
  teams: { active: number; active_members: number; average_size: number };
  demo_day: { projects: number; outcomes: Record<string, number> };
  alumni: { published_profiles: number };
  runtime_disabled_modules: Record<string, { scope_type: string; expires_at?: string | null }>;
};

type HealthIssue = {
  code: string;
  severity: "info" | "warning" | "error";
  count: number;
  message: string;
  recommended_action: string;
};

type Health = {
  status: "healthy" | "warning" | "error";
  issues: HealthIssue[];
  summary: { error: number; warning: number; info: number };
};

type RuntimeOverride = {
  id: number;
  scope_type: "global" | "accelerator" | "cohort";
  scope_id?: number | null;
  module_key: string;
  reason: string;
  expires_at?: string | null;
  active: boolean;
};

const MODULE_LABELS: Record<string, string> = {
  homework: "Домашние задания",
  attendance: "Посещаемость",
  progress_tracking: "Трекинг прогресса",
  matchmaking: "Матчмейкинг и команды",
  project_audit: "Аудит проекта",
  demo_day: "Демо-день",
  pitchy_artifacts: "Результаты Pitchy",
  alumni: "Каталог выпускников",
};

const SCOPE_LABELS = { global: "Вся платформа", accelerator: "Этот акселератор", cohort: "Этот поток" } as const;

export function AcceleratorOperations({ cohortId, acceleratorId, token, isAdmin }: { cohortId: number; acceleratorId: number; token: string; isAdmin: boolean }) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [overrides, setOverrides] = useState<RuntimeOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ scope: "cohort" as keyof typeof SCOPE_LABELS, module: "homework", reason: "", expiresAt: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [analyticsData, healthData, overrideData] = await Promise.all([
        getAuthJson<Analytics>(`/api/accelerators/cohorts/${cohortId}/analytics`, token),
        getAuthJson<Health>(`/api/accelerators/cohorts/${cohortId}/operations-health`, token),
        isAdmin ? getAuthJson<{ overrides: RuntimeOverride[] }>("/api/accelerators/runtime-overrides", token) : Promise.resolve({ overrides: [] }),
      ]);
      setAnalytics(analyticsData);
      setHealth(healthData);
      setOverrides(overrideData.overrides);
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось загрузить состояние потока"));
    } finally {
      setLoading(false);
    }
  }, [cohortId, isAdmin, token]);

  useEffect(() => { void load(); }, [load]);

  const visibleOverrides = useMemo(() => overrides.filter((row) => row.active && (
    row.scope_type === "global" ||
    (row.scope_type === "accelerator" && row.scope_id === acceleratorId) ||
    (row.scope_type === "cohort" && row.scope_id === cohortId)
  )), [acceleratorId, cohortId, overrides]);

  const changeOverride = async (payload: { scope_type: keyof typeof SCOPE_LABELS; scope_id: number | null; module_key: string; disabled: boolean; reason: string; expires_at: string | null }) => {
    setBusy(true);
    setError("");
    try {
      const result = await putAuthJson<{ overrides: RuntimeOverride[] }>("/api/accelerators/runtime-overrides", payload, token);
      setOverrides(result.overrides);
      setForm((value) => ({ ...value, reason: "", expiresAt: "" }));
      await load();
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось изменить доступность функции"));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const scopeId = form.scope === "global" ? null : form.scope === "accelerator" ? acceleratorId : cohortId;
    await changeOverride({
      scope_type: form.scope,
      scope_id: scopeId,
      module_key: form.module,
      disabled: true,
      reason: form.reason.trim(),
      expires_at: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    });
  };

  if (loading && !analytics) return <section className="workspace-card grid min-h-56 place-items-center"><Loader2 className="animate-spin text-white/35" /></section>;

  const applications = Object.values(analytics?.applications || {}).reduce((sum, value) => sum + value, 0);
  const residents = (analytics?.residents.enrolled || 0) + (analytics?.residents.completed || 0);

  return <div className="space-y-6">
    <section className="workspace-card">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.18em] text-white/30">Состояние потока</p><h2 className="mt-2 text-2xl">Операционный обзор</h2><p className="mt-2 max-w-2xl text-sm text-white/40">Только сводные показатели: персональные данные резидентов здесь не показываются.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="rounded-full border border-white/10 p-3 text-white/45" aria-label="Обновить"><RefreshCw size={17} className={loading ? "animate-spin" : ""} /></button></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Заявок" value={applications} /><Stat label="Участников" value={residents} /><Stat label="Пройдено программы" value={`${analytics?.program.completion_percent || 0}%`} /><Stat label="Посещаемость" value={`${analytics?.attendance.attendance_percent || 0}%`} /></div>
    </section>

    <section className="workspace-card">
      <div className="flex items-start gap-3">{health?.status === "healthy" ? <CheckCircle2 className="mt-1 text-emerald-300" /> : <Activity className={health?.status === "error" ? "mt-1 text-red-300" : "mt-1 text-amber-300"} />}<div><h3 className="text-xl">{health?.status === "healthy" ? "Критичных отклонений нет" : health?.status === "error" ? "Нужны действия" : "Есть задачи для проверки"}</h3><p className="mt-1 text-sm text-white/40">Красные пункты влияют на работу, жёлтые требуют внимания, информационные поясняют текущее состояние.</p></div></div>
      <div className="mt-5 space-y-3">{health?.issues.length ? health.issues.map((issue) => <article key={issue.code} className={`rounded-2xl border p-4 ${issue.severity === "error" ? "border-red-400/20 bg-red-400/[.05]" : issue.severity === "warning" ? "border-amber-400/20 bg-amber-400/[.04]" : "border-sky-400/20 bg-sky-400/[.04]"}`}><div className="flex items-start gap-3">{issue.severity === "error" ? <ShieldAlert size={18} className="mt-0.5 shrink-0 text-red-300" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" />}<div><p>{issue.message} <span className="text-white/35">· {issue.count}</span></p><p className="mt-1 text-sm text-white/40">{issue.recommended_action}</p></div></div></article>) : <p className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[.04] p-4 text-sm text-emerald-200">Автоматическая проверка не нашла проблем.</p>}</div>
    </section>

    <section className="workspace-card">
      <h3 className="text-xl">Ключевые показатели</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Опубликовано этапов" value={analytics?.program.published_stages || 0} /><Stat label="Домашних заданий" value={analytics?.homework.published || 0} /><Stat label="Активных команд" value={analytics?.teams.active || 0} /><Stat label="Проектов демо-дня" value={analytics?.demo_day.projects || 0} /></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><Summary title="Использование лимитов" rows={analytics?.quota_usage || {}} /><Summary title="Результаты Pitchy" rows={analytics?.artifacts || {}} /></div>
    </section>

    {visibleOverrides.length > 0 && <section className="workspace-card border-amber-400/20"><div className="flex items-center gap-3"><Power className="text-amber-300" /><div><h3 className="text-xl">Временно отключённые функции</h3><p className="text-sm text-white/40">Конфигурация потока сохранена; после включения работа продолжится.</p></div></div><div className="mt-4 space-y-3">{visibleOverrides.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 p-4"><div><p>{MODULE_LABELS[row.module_key] || row.module_key}</p><p className="mt-1 text-xs text-white/35">{SCOPE_LABELS[row.scope_type]} · {row.reason}{row.expires_at ? ` · до ${formatDate(row.expires_at)}` : ""}</p></div>{isAdmin && <button type="button" disabled={busy} onClick={() => void changeOverride({ scope_type: row.scope_type, scope_id: row.scope_id ?? null, module_key: row.module_key, disabled: false, reason: "Работа восстановлена", expires_at: null })} className="workspace-button">Включить</button>}</div>)}</div></section>}

    {isAdmin && <section className="workspace-card"><div className="flex items-start gap-3"><Power className="mt-1 text-white/45" /><div><h3 className="text-xl">Временно отключить функцию</h3><p className="mt-1 text-sm text-white/40">Используйте при сбое или обслуживании. Настройки конструктора не изменятся, действие попадёт в журнал.</p></div></div><form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2"><Label text="Область"><select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value as keyof typeof SCOPE_LABELS })} className="workspace-input mt-2">{Object.entries(SCOPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Label><Label text="Функция"><select value={form.module} onChange={(event) => setForm({ ...form, module: event.target.value })} className="workspace-input mt-2">{Object.entries(MODULE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Label><Label text="Причина"><textarea required minLength={2} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} rows={3} className="workspace-input mt-2 resize-y" placeholder="Что произошло и когда проверить снова" /></Label><Label text="Автоматически включить (необязательно)"><input type="datetime-local" value={form.expiresAt} min={toLocalInput(new Date())} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} className="workspace-input mt-2" /></Label><button disabled={busy} className="workspace-button md:col-span-2 md:justify-self-start">{busy && <Loader2 size={15} className="animate-spin" />} Временно отключить</button></form></section>}
    {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}

function Stat({ label, value }: { label: string; value: number | string }) { return <div className="rounded-2xl border border-white/8 bg-white/[.02] p-4"><p className="text-2xl">{value}</p><p className="mt-1 text-xs text-white/35">{label}</p></div>; }
function Summary({ title, rows }: { title: string; rows: Record<string, number> }) { const entries = Object.entries(rows); return <div className="rounded-2xl border border-white/8 p-4"><p className="text-sm text-white/55">{title}</p><div className="mt-3 flex flex-wrap gap-2">{entries.length ? entries.map(([key, value]) => <span key={key} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/45">{key}: <b className="text-white/75">{value}</b></span>) : <span className="text-xs text-white/30">Пока нет данных</span>}</div></div>; }
function Label({ text, children }: { text: string; children: React.ReactNode }) { return <label className="text-sm text-white/55">{text}{children}</label>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function toLocalInput(value: Date) { const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
