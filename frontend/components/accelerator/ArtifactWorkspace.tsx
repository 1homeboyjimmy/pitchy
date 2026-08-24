"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Banknote,
  Eye,
  EyeOff,
  FileSearch,
  GitBranch,
  Loader2,
  MessageSquare,
  Presentation,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";

import { describeApiError, getAuthJson } from "@/lib/api";

type ArtifactStatus = "started" | "ready" | "failed";
type ActionType = "chat" | "roadmap" | "research" | "custdev" | "grants" | "presentation";

type CohortArtifact = {
  id: number;
  artifact_type: ActionType;
  status: ArtifactStatus;
  title: string;
  summary?: string | null;
  url?: string | null;
  visibility: { organizer?: boolean; tracker?: boolean };
  updated_at?: string | null;
  details_visible: boolean;
  resident: { id: number; name: string };
  project: { id: number; name: string };
  action: { id: number; title: string; action_type: ActionType };
  stage: { id: number; title: string };
};

type ArtifactResponse = {
  access_role: "global_admin" | "organizer" | "tracker";
  artifacts: CohortArtifact[];
};

const ACTION_META = {
  chat: { label: "Чат", icon: MessageSquare },
  roadmap: { label: "Дорожная карта", icon: GitBranch },
  research: { label: "Исследование", icon: FileSearch },
  custdev: { label: "Кастдев", icon: Users },
  grants: { label: "Грантовая заявка", icon: Banknote },
  presentation: { label: "Презентация", icon: Presentation },
} satisfies Record<ActionType, { label: string; icon: typeof MessageSquare }>;

const STATUS_META: Record<ArtifactStatus, { label: string; className: string }> = {
  started: { label: "В работе", className: "bg-amber-400/10 text-amber-200" },
  ready: { label: "Готов", className: "bg-emerald-400/10 text-emerald-300" },
  failed: { label: "Ошибка", className: "bg-red-400/10 text-red-200" },
};

export function ArtifactWorkspace({ cohortId, token }: { cohortId: number; token: string }) {
  const [data, setData] = useState<ArtifactResponse | null>(null);
  const [status, setStatus] = useState<"all" | ArtifactStatus>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await getAuthJson<ArtifactResponse>(`/api/accelerators/cohorts/${cohortId}/artifacts`, token));
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось загрузить результаты резидентов"));
    } finally {
      setLoading(false);
    }
  }, [cohortId, token]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return (data?.artifacts || []).filter((artifact) => {
      if (status !== "all" && artifact.status !== status) return false;
      if (!normalized) return true;
      return [artifact.resident.name, artifact.project.name, artifact.action.title, artifact.stage.title]
        .some((value) => value.toLocaleLowerCase("ru").includes(normalized));
    });
  }, [data, query, status]);

  const stats = useMemo(() => ({
    total: data?.artifacts.length || 0,
    ready: data?.artifacts.filter((artifact) => artifact.status === "ready").length || 0,
    shared: data?.artifacts.filter((artifact) => artifact.details_visible).length || 0,
  }), [data]);

  return (
    <div className="space-y-5">
      <section className="workspace-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs uppercase tracking-[.18em] text-white/30">Результаты Pitchy</p><h2 className="mt-2 text-2xl">Артефакты резидентов</h2><p className="mt-2 max-w-2xl text-sm text-white/40">Здесь видно только опубликованное резидентом краткое описание. Полные чаты, исследования и другие рабочие данные остаются в его личном пространстве.</p></div>
          <button type="button" onClick={() => void load()} disabled={loading} className="rounded-full border border-white/10 p-3 text-white/45" aria-label="Обновить результаты"><RefreshCw size={17} className={loading ? "animate-spin" : ""} /></button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Stat label="Всего запущено" value={stats.total} />
          <Stat label="Готово" value={stats.ready} />
          <Stat label="Открыто вам" value={stats.shared} />
        </div>
      </section>

      <section className="workspace-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label className="relative block md:max-w-md md:flex-1"><Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Резидент, проект, этап или действие" className="workspace-input !pl-11" /></label>
          <div className="flex gap-2 overflow-x-auto">
            {(["all", "ready", "started", "failed"] as const).map((value) => <button type="button" key={value} onClick={() => setStatus(value)} className={`shrink-0 rounded-full border px-3 py-2 text-xs ${status === value ? "border-white bg-white text-black" : "border-white/10 text-white/45"}`}>{value === "all" ? "Все" : STATUS_META[value].label}</button>)}
          </div>
        </div>
      </section>

      {loading && !data ? <section className="workspace-card grid min-h-48 place-items-center"><Loader2 className="animate-spin text-white/35" /></section> : rows.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {rows.map((artifact) => {
            const meta = ACTION_META[artifact.action.action_type];
            const Icon = meta.icon;
            const statusMeta = STATUS_META[artifact.status];
            return (
              <article key={artifact.id} className="workspace-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/45"><Icon size={18} /></span><div className="min-w-0"><h3 className="truncate text-lg">{artifact.action.title}</h3><p className="mt-1 truncate text-xs text-white/35">{artifact.stage.title} · {meta.label}</p></div></div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${statusMeta.className}`}>{statusMeta.label}</span>
                </div>
                <div className="mt-4 grid gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-4 sm:grid-cols-2">
                  <div><p className="text-xs text-white/30">Резидент</p><p className="mt-1 text-sm">{artifact.resident.name}</p></div>
                  <div><p className="text-xs text-white/30">Проект</p><p className="mt-1 text-sm">{artifact.project.name}</p></div>
                </div>
                {artifact.details_visible ? (
                  <div className="mt-4">
                    <p className="flex items-center gap-2 text-xs text-emerald-300"><Eye size={14} /> Резидент опубликовал описание</p>
                    <h4 className="mt-3 font-medium">{artifact.title}</h4>
                    {artifact.summary && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/50">{artifact.summary}</p>}
                    {artifact.url && <a href={artifact.url} target="_blank" rel="noreferrer" className="workspace-button mt-4"><ArrowUpRight size={15} /> Открыть результат</a>}
                  </div>
                ) : (
                  <div className="mt-4 flex gap-3 rounded-2xl border border-white/8 p-4 text-sm text-white/40"><EyeOff size={17} className="mt-0.5 shrink-0" /><p>Резидент ещё не поделился содержимым результата с вашей ролью.</p></div>
                )}
                {artifact.updated_at && <p className="mt-4 text-xs text-white/25">Обновлено {formatDateTime(artifact.updated_at)}</p>}
              </article>
            );
          })}
        </div>
      ) : <section className="workspace-card py-12 text-center"><FileSearch className="mx-auto mb-4 text-white/25" size={34} /><h3 className="text-xl">Результатов пока нет</h3><p className="mx-auto mt-2 max-w-lg text-sm text-white/40">Они появятся, когда резиденты запустят действия из опубликованных этапов программы.</p></section>}
      {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4"><p className="text-2xl">{value}</p><p className="mt-1 text-xs text-white/35">{label}</p></div>;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
