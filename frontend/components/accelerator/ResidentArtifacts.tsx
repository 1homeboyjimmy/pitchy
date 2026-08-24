"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  GitBranch,
  Loader2,
  MessageSquare,
  Presentation,
  RefreshCw,
  Save,
  Share2,
  Users,
} from "lucide-react";

import { describeApiError, getAuthJson, patchAuthJson, postAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";

type ActionType = "chat" | "roadmap" | "research" | "custdev" | "grants" | "presentation";
type ArtifactStatus = "started" | "ready" | "failed";

type Artifact = {
  id: number;
  action_id: number;
  artifact_type: ActionType;
  status: ArtifactStatus;
  title: string;
  summary?: string | null;
  url?: string | null;
  source_type?: "chat_session" | "research_job" | "roadmap" | "grant_application" | "external" | null;
  source_id?: string | null;
  visibility: { organizer?: boolean; tracker?: boolean };
  updated_at?: string | null;
};

type ProgramAction = {
  id: number;
  action_type: ActionType;
  title: string;
  description?: string | null;
  required: boolean;
  artifact?: Artifact | null;
};

type ProgramStage = {
  id: number;
  title: string;
  state: "locked" | "available" | "completed";
  actions?: ProgramAction[];
};

type LaunchResponse = { artifact: Artifact; launch_url: string };

const ACTION_META = {
  chat: { label: "Чат с аналитиком", icon: MessageSquare, syncLabel: "Проверить диалог" },
  roadmap: { label: "Дорожная карта", icon: GitBranch, syncLabel: "Проверить готовность" },
  research: { label: "Исследование", icon: FileSearch, syncLabel: "Найти результат исследования" },
  custdev: { label: "Кастдев", icon: Users, syncLabel: null },
  grants: { label: "Грантовая заявка", icon: Banknote, syncLabel: "Найти последнюю заявку" },
  presentation: { label: "Презентация", icon: Presentation, syncLabel: null },
} satisfies Record<ActionType, { label: string; icon: typeof MessageSquare; syncLabel: string | null }>;

const STATUS_META: Record<ArtifactStatus, { label: string; className: string }> = {
  started: { label: "В работе", className: "bg-amber-400/10 text-amber-200" },
  ready: { label: "Готов", className: "bg-emerald-400/10 text-emerald-300" },
  failed: { label: "Нужна проверка", className: "bg-red-400/10 text-red-200" },
};

export function ResidentArtifacts({ membershipId }: { membershipId: number }) {
  const { token } = useAuth();
  const [stages, setStages] = useState<ProgramStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      setStages(await getAuthJson<ProgramStage[]>(`/api/accelerators/memberships/${membershipId}/program-stages`, token));
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось загрузить действия программы"));
    } finally {
      setLoading(false);
    }
  }, [membershipId, token]);

  useEffect(() => { void load(); }, [load]);

  const actionCount = useMemo(
    () => stages.reduce((total, stage) => total + (stage.actions?.length || 0), 0),
    [stages],
  );

  const launch = async (action: ProgramAction) => {
    if (!token) return;
    const target = window.open("about:blank", "_blank");
    if (target) target.opener = null;
    setBusy(`launch-${action.id}`);
    setError("");
    try {
      const response = await postAuthJson<LaunchResponse>(`/api/accelerators/program/actions/${action.id}/launch`, {}, token);
      await load();
      if (target) target.location.replace(response.launch_url);
      else window.location.assign(response.launch_url);
    } catch (reason) {
      target?.close();
      setError(describeApiError(reason, "Не удалось открыть инструмент"));
    } finally {
      setBusy("");
    }
  };

  const sync = async (artifact: Artifact) => {
    if (!token) return;
    setBusy(`sync-${artifact.id}`);
    setError("");
    try {
      await postAuthJson(`/api/accelerators/program/artifacts/${artifact.id}/sync`, {}, token);
      await load();
    } catch (reason) {
      setError(describeApiError(reason, "Основной инструмент Pitchy пока не вернул готовый результат"));
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return <section className="workspace-card grid min-h-40 place-items-center"><Loader2 className="animate-spin text-white/35" /></section>;
  }
  if (!token || !actionCount) return null;

  return (
    <section className="workspace-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[.18em] text-white/30">Практика в Pitchy</p>
          <h2 className="mt-2 text-xl">Действия и результаты</h2>
          <p className="mt-1 max-w-2xl text-sm text-white/40">Открывайте нужный инструмент отсюда. Результат остаётся приватным, пока вы сами не разрешите доступ.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={Boolean(busy)} className="rounded-full border border-white/10 p-2.5 text-white/45" aria-label="Обновить действия"><RefreshCw size={16} /></button>
      </div>

      <div className="mt-5 space-y-5">
        {stages.filter((stage) => stage.actions?.length).map((stage) => (
          <div key={stage.id}>
            <h3 className="mb-3 text-sm text-white/55">{stage.title}</h3>
            <div className="grid gap-3 lg:grid-cols-2">
              {stage.actions?.map((action) => {
                const meta = ACTION_META[action.action_type];
                const Icon = meta.icon;
                const artifact = action.artifact;
                const status = artifact ? STATUS_META[artifact.status] : null;
                return (
                  <article key={action.id} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/50"><Icon size={17} /></span>
                        <div className="min-w-0"><p className="font-medium">{action.title}</p><p className="mt-0.5 text-xs text-white/35">{meta.label}{action.required ? " · обязательный результат" : ""}</p></div>
                      </div>
                      {status && <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${status.className}`}>{status.label}</span>}
                    </div>
                    {action.description && <p className="mt-3 text-sm leading-6 text-white/45">{action.description}</p>}

                    {!artifact ? (
                      <button type="button" onClick={() => void launch(action)} disabled={Boolean(busy)} className="workspace-button mt-4">
                        {busy === `launch-${action.id}` ? <Loader2 size={15} className="animate-spin" /> : <ArrowUpRight size={15} />} Начать
                      </button>
                    ) : (
                      <div className="mt-4 space-y-4">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => void launch(action)} disabled={Boolean(busy)} className="workspace-button">
                            {busy === `launch-${action.id}` ? <Loader2 size={15} className="animate-spin" /> : <ArrowUpRight size={15} />} Продолжить
                          </button>
                          {meta.syncLabel && <button type="button" onClick={() => void sync(artifact)} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-2 text-sm text-white/65 hover:text-white">
                            {busy === `sync-${artifact.id}` ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {meta.syncLabel}
                          </button>}
                          {artifact.url && <a href={artifact.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-2 text-sm text-white/65 hover:text-white"><ExternalLink size={15} /> Результат</a>}
                        </div>
                        <ArtifactEditor key={`${artifact.id}-${artifact.updated_at || "initial"}`} action={action} artifact={artifact} token={token} busy={busy} setBusy={setBusy} onSaved={load} onError={setError} />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {error && <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
    </section>
  );
}

function ArtifactEditor({ action, artifact, token, busy, setBusy, onSaved, onError }: {
  action: ProgramAction;
  artifact: Artifact;
  token: string;
  busy: string;
  setBusy: (value: string) => void;
  onSaved: () => Promise<void>;
  onError: (value: string) => void;
}) {
  const externalResult = action.action_type === "custdev" || action.action_type === "presentation";
  const [title, setTitle] = useState(artifact.title || action.title);
  const [summary, setSummary] = useState(artifact.summary || "");
  const [url, setUrl] = useState(artifact.source_type === "external" ? artifact.url || "" : "");
  const [shareOrganizer, setShareOrganizer] = useState(Boolean(artifact.visibility?.organizer));
  const [shareTracker, setShareTracker] = useState(Boolean(artifact.visibility?.tracker));

  const save = async () => {
    setBusy(`save-${artifact.id}`);
    onError("");
    try {
      await patchAuthJson(`/api/accelerators/program/artifacts/${artifact.id}`, {
        title: title.trim() || action.title,
        summary: summary.trim() || null,
        ...(externalResult ? { status: "ready", source_type: "external", source_id: null, url: url.trim() } : {}),
        share_with_organizer: shareOrganizer,
        share_with_tracker: shareTracker,
      }, token);
      await onSaved();
    } catch (reason) {
      onError(describeApiError(reason, externalResult ? "Проверьте ссылку на готовый результат" : "Не удалось сохранить описание и доступ"));
    } finally {
      setBusy("");
    }
  };

  const canSave = externalResult ? /^https?:\/\//i.test(url.trim()) : Boolean(artifact.source_type);

  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm text-white/65">
        {artifact.status === "ready" ? <CheckCircle2 size={16} className="text-emerald-300" /> : <Share2 size={16} />}
        {externalResult && artifact.status !== "ready" ? "Добавьте ссылку на готовый результат" : "Описание и доступ к результату"}
      </div>
      <div className="space-y-3">
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} placeholder="Название результата" className="workspace-input" />
        <textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={10000} rows={3} placeholder="Кратко опишите результат" className="workspace-input resize-y" />
        {externalResult && <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder={action.action_type === "presentation" ? "https://... — ссылка на презентацию" : "https://... — ссылка на отчёт кастдева"} className="workspace-input" />}
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/55">
          <label className="flex items-center gap-2"><input type="checkbox" checked={shareOrganizer} onChange={(event) => setShareOrganizer(event.target.checked)} className="accent-white" /> Организатору</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={shareTracker} onChange={(event) => setShareTracker(event.target.checked)} className="accent-white" /> Трекеру</label>
        </div>
        {!canSave && !externalResult && <p className="text-xs text-white/35">Сначала получите результат в инструменте и нажмите «Проверить».</p>}
        <button type="button" onClick={() => void save()} disabled={Boolean(busy) || !canSave} className="workspace-button">
          {busy === `save-${artifact.id}` ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {externalResult && artifact.status !== "ready" ? "Готово и сохранить" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
