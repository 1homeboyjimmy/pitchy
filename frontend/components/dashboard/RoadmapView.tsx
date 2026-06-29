"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader, CheckCircle2, Sparkles, Brain, ExternalLink, ArrowLeft, Plus } from "lucide-react";
import { getToken } from "@/lib/auth";
import { notifyError } from "@/lib/ui";
import {
  getProjects, getRoadmap, patchPassport, analyzeRoadmapStep, streamRoadmapOverall, createProject,
  type ProjectListItem, type Roadmap, type RoadmapCheckpoint, type RoadmapField, type RoadmapOverall,
} from "@/lib/api";

// Геометрия извилистого пути (в координатах viewBox; узлы позиционируются в %).
const VB_W = 280;
const STEP = 104;
const TOP = 40;
const BOTTOM = 56;
const X_LEFT = 80;
const X_RIGHT = 200;

/** Красивый рендер markdown-аналитики (заголовки, списки, таблицы). */
function Markdown({ children }: { children: string }) {
  return (
    <div
      lang="ru"
      className="prose prose-invert prose-sm max-w-none text-white/80 hyphens-auto
                 leading-relaxed
                 prose-headings:text-white prose-headings:font-semibold prose-headings:mt-6 prose-headings:mb-2.5
                 prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
                 prose-p:text-justify prose-p:leading-7 prose-p:my-3
                 prose-strong:text-white
                 prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-li:leading-relaxed
                 prose-hr:border-white/10 prose-hr:my-5"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ ...props }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-white/10 bg-white/5">
              <table className="w-full text-left border-collapse" {...props} />
            </div>
          ),
          thead: ({ ...props }) => <thead className="bg-white/10" {...props} />,
          th: ({ ...props }) => <th className="p-2 text-[11px] font-bold text-white/80 border-b border-white/10 uppercase tracking-wider" {...props} />,
          td: ({ ...props }) => <td className="p-2 text-[12px] text-white/80 border-b border-white/5 last:border-0" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function fieldToText(f: RoadmapField): string {
  if (f.value == null) return "";
  if (Array.isArray(f.value)) {
    return f.value
      .map((v) => (typeof v === "string" ? v : (v as { name?: string })?.name || JSON.stringify(v)))
      .join("\n");
  }
  return String(f.value);
}

/** Извилистая дорога с узлами-этапами. Клик выбирает этап для заполнения. */
function WindingMap({
  checkpoints, selectedId, onSelect,
}: {
  checkpoints: RoadmapCheckpoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const pts = useMemo(
    () => checkpoints.map((_, i) => ({ x: i % 2 === 0 ? X_LEFT : X_RIGHT, y: TOP + i * STEP })),
    [checkpoints],
  );
  const vbH = TOP + (checkpoints.length - 1) * STEP + BOTTOM;

  const roadD = useMemo(() => {
    if (pts.length === 0) return "";
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const my = (a.y + b.y) / 2;
      d += ` C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`;
    }
    return d;
  }, [pts]);

  return (
    <div className="relative w-full mx-auto" style={{ maxWidth: 340, aspectRatio: `${VB_W} / ${vbH}` }}>
      <svg viewBox={`0 0 ${VB_W} ${vbH}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
        <path d={roadD} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={14} strokeLinecap="round" />
        <path d={roadD} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={2} strokeDasharray="1 12" strokeLinecap="round" />
      </svg>

      {checkpoints.map((cp, i) => {
        const p = pts[i];
        const isSel = selectedId === cp.id;
        const base =
          cp.status === "done" ? "bg-emerald-500 text-white border-emerald-400"
          : cp.status === "current" ? "bg-white text-black border-white"
          : "bg-white/[0.06] text-white/50 border-white/15";
        return (
          <button
            key={cp.id}
            onClick={() => onSelect(cp.id)}
            className="absolute flex flex-col items-center"
            style={{ left: `${(p.x / VB_W) * 100}%`, top: `${(p.y / vbH) * 100}%`, transform: "translate(-50%,-50%)", width: 96 }}
          >
            <span
              className={`relative flex items-center justify-center h-12 w-12 rounded-full border-2 transition-all ${base} ${isSel ? "ring-4 ring-white/30 scale-110" : ""}`}
            >
              {cp.status === "done" ? <CheckCircle2 size={22} /> : <span className="font-display text-base">{i + 1}</span>}
              {cp.status === "current" && (
                <span className="absolute -inset-1 rounded-full border border-white/50 animate-ping" />
              )}
            </span>
            <span className={`mt-2 text-[11px] leading-tight text-center max-w-[92px] ${isSel ? "text-white" : "text-white/45"}`}>
              {cp.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Форма выбранного этапа — пишет поля в паспорт. */
function CheckpointEditor({
  cp, onSave, saving, analysis, analyzing,
}: {
  cp: RoadmapCheckpoint;
  onSave: (fields: Record<string, unknown>) => void;
  saving: boolean;
  analysis?: string;
  analyzing?: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    const init: Record<string, string> = {};
    cp.fields.forEach((f) => { init[f.path] = fieldToText(f); });
    setDraft(init);
  }, [cp.id, cp.fields]);

  const submit = () => {
    const fields: Record<string, unknown> = {};
    for (const f of cp.fields) {
      const raw = (draft[f.path] ?? "").trim();
      if (!raw) continue;
      if (f.type === "number") {
        const n = Number(raw.replace(/[^\d.-]/g, ""));
        fields[f.path] = Number.isFinite(n) ? n : raw;
      } else if (f.type === "list") {
        fields[f.path] = raw.split("\n").map((s) => s.trim()).filter(Boolean);
      } else {
        fields[f.path] = raw;
      }
    }
    onSave(fields);
  };

  return (
    <div className="lovable-glass rounded-3xl border border-white/10 p-6 sm:p-7">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="font-display text-2xl text-white">{cp.title}</h2>
        <span className="shrink-0 text-xs font-mono text-white/40 tabular-nums">{cp.filled}/{cp.total}</span>
      </div>
      <p className="text-white/40 text-sm">{cp.subtitle}</p>

      {/* что это даёт (качество результата, не раздача платного) */}
      <div className="mt-4 flex items-start gap-2 rounded-2xl bg-white/[0.03] border border-white/8 p-3.5">
        <Sparkles size={15} className="text-white/50 shrink-0 mt-0.5" />
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-white/35">Что это даёт</div>
          <div className="text-white/70 text-sm leading-snug mt-0.5">{cp.reward}</div>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {cp.fields.map((f) => (
          <div key={f.path}>
            <label className="flex items-center gap-2 text-white/50 text-xs font-mono uppercase tracking-wider mb-1.5">
              {f.label}
              {f.source === "manual" && <span className="text-emerald-400/50 normal-case tracking-normal">· ваше</span>}
            </label>
            {f.type === "textarea" || f.type === "list" ? (
              <textarea
                value={draft[f.path] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f.path]: e.target.value }))}
                rows={f.type === "list" ? 3 : 2}
                placeholder={f.type === "list" ? "по одному пункту на строку…" : "…"}
                className="w-full bg-white/[0.03] rounded-xl p-3 text-white text-sm border border-white/10 focus:border-white/30 outline-none resize-none placeholder:text-white/25"
              />
            ) : (
              <input
                value={draft[f.path] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f.path]: e.target.value }))}
                placeholder="…"
                className="w-full bg-white/[0.03] rounded-xl p-3 text-white text-sm border border-white/10 focus:border-white/30 outline-none placeholder:text-white/25"
              />
            )}
          </div>
        ))}
      </div>

      <button
        onClick={submit}
        disabled={saving}
        className="mt-5 bg-white text-black font-semibold text-sm px-7 py-3 rounded-full hover:bg-neutral-200 transition-all flex items-center gap-2 disabled:opacity-40"
      >
        {saving ? <Loader className="animate-spin" size={15} /> : <CheckCircle2 size={15} />} Сохранить шаг
      </button>

      {/* ИИ-разбор шага (тот же пайплайн, что у основного чата) */}
      {(analyzing || analysis) && (
        <div className="mt-5 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-4">
          <div className="flex items-center gap-2 mb-2 text-violet-300/80">
            <Brain size={15} />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">ИИ-разбор шага</span>
          </div>
          {analyzing ? (
            <div className="flex items-center gap-2 text-white/50 text-sm"><Loader className="animate-spin" size={14} /> Анализирую…</div>
          ) : (
            <Markdown>{analysis || ""}</Markdown>
          )}
        </div>
      )}
    </div>
  );
}

export function RoadmapView() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [pid, setPid] = useState<number | null>(null);
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [stepAnalysis, setStepAnalysis] = useState<Record<string, string>>({});
  const [analyzingStep, setAnalyzingStep] = useState<string | null>(null);
  const [overall, setOverall] = useState<RoadmapOverall | null>(null);
  const [analyzingOverall, setAnalyzingOverall] = useState(false);

  useEffect(() => {
    (async () => {
      const t = getToken();
      if (!t) { setLoading(false); return; }
      try {
        const pj = await getProjects(t);
        setProjects(pj);
        // Не выбираем проект автоматически — стартуем с хаба карт (выбор/создание).
      } catch {
        notifyError("Не удалось загрузить проекты");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadRoadmap = useCallback(async (id: number, keepSel: boolean) => {
    const t = getToken();
    if (!t) return;
    try {
      const r = await getRoadmap(id, t);
      setRoadmap(r);
      if (!keepSel) {
        setSelectedId(r.next || r.checkpoints[0]?.id || null);
        // Показываем ранее сгенерированный отчёт сразу (не генерируем заново).
        setOverall(r.analysis ? { analysis: r.analysis.text, sources: r.analysis.sources || [] } : null);
      }
    } catch {
      notifyError("Не удалось загрузить карту");
    }
  }, []);

  useEffect(() => {
    if (pid != null) { setOverall(null); setStepAnalysis({}); loadRoadmap(pid, false); }
  }, [pid, loadRoadmap]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    const t = getToken();
    if (!t) return;
    setCreating(true);
    try {
      const proj = await createProject({ name }, t);
      const pj = await getProjects(t);
      setProjects(pj);
      setNewName("");
      setPid(proj.id);
    } catch {
      notifyError("Не удалось создать проект");
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async (fields: Record<string, unknown>) => {
    if (pid == null || Object.keys(fields).length === 0) return;
    const t = getToken();
    if (!t) return;
    const cpId = selectedId;
    setSaving(true);
    try {
      await patchPassport(pid, fields, t);
      await loadRoadmap(pid, true);
    } catch {
      notifyError("Не удалось сохранить");
      setSaving(false);
      return;
    }
    setSaving(false);
    // ИИ-разбор шага через пайплайн основного чата (RAG + паспорт).
    if (cpId) {
      setAnalyzingStep(cpId);
      try {
        const res = await analyzeRoadmapStep(pid, cpId, t);
        setStepAnalysis((m) => ({ ...m, [cpId]: res.analysis }));
      } catch {
        notifyError("Не удалось получить разбор шага");
      } finally {
        setAnalyzingStep(null);
      }
    }
  };

  const handleOverall = async () => {
    if (pid == null) return;
    const t = getToken();
    if (!t) return;
    setAnalyzingOverall(true);
    setOverall({ analysis: "", sources: [] });
    try {
      for await (const ev of streamRoadmapOverall(pid, t)) {
        if (ev.type === "chunk" && ev.content) {
          setOverall((o) => ({ analysis: (o?.analysis || "") + ev.content, sources: o?.sources || [] }));
        } else if (ev.type === "sources" && ev.sources) {
          setOverall((o) => ({ analysis: o?.analysis || "", sources: ev.sources! }));
        } else if (ev.type === "error") {
          notifyError(ev.text || "Ошибка генерации аналитики");
        }
      }
    } catch {
      notifyError("Не удалось получить аналитику стартапа");
    } finally {
      setAnalyzingOverall(false);
    }
  };

  const selected = roadmap?.checkpoints.find((c) => c.id === selectedId) || null;

  if (loading) {
    return <div className="h-full flex items-center justify-center"><Loader className="animate-spin text-white/40" size={26} /></div>;
  }

  // ХАБ дорожных карт: выбор проекта или создание нового.
  if (pid === null) {
    return (
      <div className="h-full overflow-y-auto pb-10">
        <div className="max-w-5xl mx-auto pt-2">
          <div className="flex items-center gap-2 mb-1 text-white/40">
            <Sparkles size={15} />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Дорожные карты</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl text-white mb-2">Ваши проекты</h1>
          <p className="text-white/40 mb-6">Каждая карта ведёт по заполнению паспорта своего проекта. Выберите карту или создайте новую.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setPid(p.id)}
                className="lovable-glass rounded-3xl border border-white/10 p-5 text-left hover:border-white/30 transition-all"
              >
                <div className="text-white font-medium text-lg mb-3 truncate">{p.name}</div>
                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-white rounded-full transition-all" style={{ width: `${p.readiness_index}%` }} />
                </div>
                <div className="flex items-center justify-between text-white/40 text-xs">
                  <span>{p.readiness_index}% готовности</span>
                  <span>{p.session_count} чатов</span>
                </div>
              </button>
            ))}

            <div className="rounded-3xl border border-dashed border-white/15 p-5 flex flex-col gap-3 justify-center">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                placeholder="Название нового проекта"
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="bg-white text-black font-semibold text-sm px-4 py-2 rounded-full disabled:opacity-40 inline-flex items-center justify-center gap-2"
              >
                {creating ? <Loader className="animate-spin" size={15} /> : <Plus size={15} />} Создать карту
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pb-10">
      <div className="max-w-5xl mx-auto pt-2">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => setPid(null)} className="inline-flex items-center gap-1.5 text-white/50 hover:text-white text-sm">
            <ArrowLeft size={16} /> Все карты
          </button>
          <span className="text-white/20">·</span>
          <span className="text-white/40 text-[11px] uppercase tracking-[0.15em] font-bold">
            Паспорт: <span className="text-white/70 normal-case">{projects.find((p) => p.id === pid)?.name}</span>
          </span>
        </div>

        {roadmap && (
          <>
            <div className="lovable-glass rounded-3xl border border-white/10 p-6 sm:p-7 mb-6">
              <div className="flex items-center gap-2 mb-1 text-white/40">
                <Sparkles size={15} />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Дорожная карта проекта</span>
              </div>
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <h1 className="font-display text-3xl sm:text-4xl text-white">Карта заполнена на {roadmap.progress}%</h1>
                <span className="text-white/50 text-sm">{roadmap.completed} из {roadmap.total} этапов пройдено</span>
              </div>
              <div className="mt-4 h-2 w-full rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-white/70 to-white"
                  initial={{ width: 0 }}
                  animate={{ width: `${roadmap.progress}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
              <p className="text-white/40 text-sm mt-4">
                Каждый шаг пишется в паспорт проекта — чем полнее паспорт, тем точнее подбор грантов и сильнее заявки.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[340px_1fr] lg:items-start">
              <WindingMap checkpoints={roadmap.checkpoints} selectedId={selectedId} onSelect={setSelectedId} />
              {selected && (
                <CheckpointEditor
                  cp={selected}
                  onSave={handleSave}
                  saving={saving}
                  analysis={stepAnalysis[selected.id]}
                  analyzing={analyzingStep === selected.id}
                />
              )}
            </div>

            {/* Общая аналитика стартапа — после прохождения всей карты */}
            {roadmap.completed === roadmap.total && (
              <div className="lovable-glass rounded-3xl border border-violet-500/20 p-6 sm:p-7 mt-6">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 text-violet-300/80 mb-1">
                      <Brain size={16} />
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Полная аналитика стартапа</span>
                    </div>
                    <p className="text-white/50 text-sm">Карта пройдена — соберём обширный разбор по паспорту, рынку и источникам.</p>
                  </div>
                  <button
                    onClick={handleOverall}
                    disabled={analyzingOverall}
                    className="shrink-0 bg-white text-black font-semibold text-sm px-6 py-3 rounded-full hover:bg-neutral-200 transition-all flex items-center gap-2 disabled:opacity-40"
                  >
                    {analyzingOverall ? <><Loader className="animate-spin" size={15} /> Анализирую…</> : <><Sparkles size={15} /> {overall ? "Пересобрать" : "Получить аналитику"}</>}
                  </button>
                </div>

                {overall && (
                  <div className="mt-5 pt-5 border-t border-white/10">
                    {overall.analysis ? (
                      <Markdown>{overall.analysis}</Markdown>
                    ) : analyzingOverall ? (
                      <div className="flex items-center gap-2 text-white/50 text-sm"><Loader className="animate-spin" size={14} /> Собираю контекст и анализирую…</div>
                    ) : null}
                    {overall.sources.length > 0 && (
                      <div className="mt-4">
                        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/35 mb-2">Источники</p>
                        <div className="flex flex-col gap-1.5">
                          {overall.sources.map((s, i) => (
                            s.url ? (
                              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="text-violet-300/80 hover:text-violet-200 text-xs flex items-center gap-1.5 truncate">
                                <ExternalLink size={11} className="shrink-0" /> <span className="truncate">{s.title || s.url}</span>
                              </a>
                            ) : null
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default RoadmapView;
