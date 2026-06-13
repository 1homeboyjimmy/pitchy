"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader, CheckCircle2, Lock, Sparkles, ArrowRight, Trophy, ChevronDown, Gift,
} from "lucide-react";
import { getToken } from "@/lib/auth";
import { notifyError } from "@/lib/ui";
import {
  getProjects, getRoadmap, patchPassport,
  type ProjectListItem, type Roadmap, type RoadmapCheckpoint, type RoadmapField,
} from "@/lib/api";

const UNLOCK_META: Record<string, { label: string; href?: string }> = {
  custdev: { label: "Виртуальная фокус-группа" },
  grants: { label: "Подбор грантов", href: "/grants" },
  scoring: { label: "Скоринг и юнит-экономика" },
  applications: { label: "Генерация заявок на гранты", href: "/grants" },
};

/** Текстовое представление значения поля для редактирования. */
function fieldToText(f: RoadmapField): string {
  if (f.value == null) return "";
  if (Array.isArray(f.value)) {
    return f.value
      .map((v) => (typeof v === "string" ? v : (v as { name?: string })?.name || JSON.stringify(v)))
      .join("\n");
  }
  return String(f.value);
}

function CheckpointCard({
  cp, isOpen, onToggle, onSave, saving,
}: {
  cp: RoadmapCheckpoint;
  isOpen: boolean;
  onToggle: () => void;
  onSave: (fields: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const locked = cp.status === "locked";

  useEffect(() => {
    if (isOpen) {
      const init: Record<string, string> = {};
      cp.fields.forEach((f) => { init[f.path] = fieldToText(f); });
      setDraft(init);
    }
  }, [isOpen, cp.fields]);

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

  const statusRing =
    cp.status === "done" ? "border-emerald-500/40 bg-emerald-500/[0.04]"
    : cp.status === "current" ? "border-white/25 bg-white/[0.03] shadow-[0_0_50px_-20px_rgba(255,255,255,0.3)]"
    : "border-white/8 bg-black/20 opacity-60";

  return (
    <div className={`rounded-3xl border transition-all ${statusRing}`}>
      <button
        onClick={() => !locked && onToggle()}
        className={`w-full text-left p-5 sm:p-6 flex items-start gap-4 ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        {/* статус-иконка */}
        <div className="shrink-0 mt-0.5">
          {cp.status === "done" ? (
            <CheckCircle2 className="text-emerald-400" size={26} />
          ) : cp.status === "locked" ? (
            <Lock className="text-white/25" size={24} />
          ) : (
            <div className="h-6 w-6 rounded-full border-2 border-white/60 flex items-center justify-center">
              <div className="h-2 w-2 rounded-full bg-white/60" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-lg sm:text-xl text-white leading-tight">{cp.title}</h3>
            <span className="shrink-0 text-xs font-mono text-white/40 tabular-nums">{cp.filled}/{cp.total}</span>
          </div>
          <p className="text-white/40 text-sm mt-0.5">{cp.subtitle}</p>

          {/* прогресс-бар */}
          <div className="mt-3 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full ${cp.status === "done" ? "bg-emerald-400" : "bg-white"}`}
              style={{ width: `${cp.progress}%` }}
            />
          </div>

          {/* награда */}
          <div className="mt-3 flex items-center gap-2 text-[13px]">
            <Gift size={14} className="text-white/40 shrink-0" />
            <span className="text-white/55">{cp.reward}</span>
          </div>
        </div>

        {!locked && (
          <ChevronDown
            size={18}
            className={`shrink-0 mt-1 text-white/30 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* форма заполнения */}
      <AnimatePresence initial={false}>
        {isOpen && !locked && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 sm:px-6 pb-6 pt-1 border-t border-white/5 space-y-4">
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
                      type={f.type === "number" ? "text" : "text"}
                      value={draft[f.path] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.path]: e.target.value }))}
                      placeholder="…"
                      className="w-full bg-white/[0.03] rounded-xl p-3 text-white text-sm border border-white/10 focus:border-white/30 outline-none placeholder:text-white/25"
                    />
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 pt-1">
                {cp.unlocks && (
                  <p className="text-[12px] text-white/40 flex items-center gap-1.5 min-w-0">
                    <Sparkles size={13} className="shrink-0 text-white/40" />
                    <span className="truncate">Откроется: {cp.unlocks.label}</span>
                  </p>
                )}
                <button
                  onClick={submit}
                  disabled={saving}
                  className="ml-auto shrink-0 bg-white text-black font-semibold text-sm px-6 py-2.5 rounded-full hover:bg-neutral-200 transition-all flex items-center gap-2 disabled:opacity-40"
                >
                  {saving ? <Loader className="animate-spin" size={15} /> : <CheckCircle2 size={15} />} Сохранить
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function RoadmapView() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [pid, setPid] = useState<number | null>(null);
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const t = getToken();
      if (!t) { setLoading(false); return; }
      try {
        const pj = await getProjects(t);
        setProjects(pj);
        if (pj.length > 0) setPid(pj[0].id);
      } catch {
        notifyError("Не удалось загрузить проекты");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadRoadmap = useCallback(async (id: number) => {
    const t = getToken();
    if (!t) return;
    try {
      const r = await getRoadmap(id, t);
      setRoadmap(r);
      // авто-открыть текущий шаг
      if (r.next) setOpen(r.next);
    } catch {
      notifyError("Не удалось загрузить карту");
    }
  }, []);

  useEffect(() => { if (pid != null) loadRoadmap(pid); }, [pid, loadRoadmap]);

  const handleSave = async (fields: Record<string, unknown>) => {
    if (pid == null || Object.keys(fields).length === 0) return;
    const t = getToken();
    if (!t) return;
    setSaving(true);
    try {
      await patchPassport(pid, fields, t);
      await loadRoadmap(pid);
    } catch {
      notifyError("Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center"><Loader className="animate-spin text-white/40" size={26} /></div>;
  }

  if (projects.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4">
        <Trophy className="text-white/30 mb-4" size={36} />
        <h2 className="font-display text-2xl text-white mb-2">Сначала создайте проект</h2>
        <p className="text-white/40 max-w-md mb-5">Дорожная карта ведёт вас по заполнению паспорта проекта шаг за шагом.</p>
        <Link href="/dashboard?tab=overview" className="bg-white text-black font-semibold text-sm px-7 py-3 rounded-full">Создать проект</Link>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pb-10">
      <div className="max-w-3xl mx-auto pt-2">
        {/* выбор проекта */}
        {projects.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => { setPid(p.id); setOpen(null); }}
                className={`px-4 py-2 rounded-2xl text-sm border transition-all ${pid === p.id ? "bg-white text-black border-white font-medium" : "lovable-glass text-white/60 border-white/10 hover:text-white"}`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        {roadmap && (
          <>
            {/* шапка прогресса */}
            <div className="lovable-glass rounded-3xl border border-white/10 p-6 sm:p-7 mb-6">
              <div className="flex items-center gap-2 mb-1 text-white/40">
                <Sparkles size={15} />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Дорожная карта проекта</span>
              </div>
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <h1 className="font-display text-3xl sm:text-4xl text-white">Готовность {roadmap.readiness}%</h1>
                <span className="text-white/50 text-sm">{roadmap.completed} из {roadmap.total} этапов</span>
              </div>
              <div className="mt-4 h-2 w-full rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-white/70 to-white"
                  initial={{ width: 0 }}
                  animate={{ width: `${roadmap.readiness}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
              <p className="text-white/40 text-sm mt-4">
                Заполняйте шаги — каждый пишется в паспорт проекта и открывает новые возможности.
              </p>

              {/* что открыто */}
              {roadmap.unlocked.length > 0 && (
                <div className="mt-5 pt-5 border-t border-white/10">
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-300/50 mb-2.5">Уже открыто</p>
                  <div className="flex flex-wrap gap-2">
                    {roadmap.unlocked.map((u) => {
                      const m = UNLOCK_META[u];
                      if (!m) return null;
                      const badge = (
                        <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-300/90 border border-emerald-500/20">
                          <CheckCircle2 size={13} /> {m.label}
                          {m.href && <ArrowRight size={12} />}
                        </span>
                      );
                      return m.href ? <Link key={u} href={m.href}>{badge}</Link> : <span key={u}>{badge}</span>;
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* чекпоинты */}
            <div className="space-y-3">
              {roadmap.checkpoints.map((cp) => (
                <CheckpointCard
                  key={cp.id}
                  cp={cp}
                  isOpen={open === cp.id}
                  onToggle={() => setOpen((o) => (o === cp.id ? null : cp.id))}
                  onSave={handleSave}
                  saving={saving}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default RoadmapView;
