"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "@mantine/hooks";
import { X, Loader, Plus, Save, Hand, Sparkles, Award, Gauge } from "lucide-react";
import { getPassport, patchPassport, type PassportData } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { notifyError, notifySuccess } from "@/lib/ui";

type FieldDef = { k: string; label: string; multiline?: boolean };
type SectionDef = { key: string; label: string; fields: FieldDef[]; lists?: FieldDef[] };

const SECTIONS: SectionDef[] = [
  {
    key: "core", label: "Основное",
    fields: [
      { k: "name", label: "Название" },
      { k: "problem", label: "Проблема", multiline: true },
      { k: "solution", label: "Решение", multiline: true },
      { k: "target_audience", label: "Целевая аудитория", multiline: true },
      { k: "stage", label: "Стадия" },
      { k: "business_model", label: "Бизнес-модель" },
      { k: "geo", label: "География" },
    ],
  },
  {
    key: "market", label: "Рынок",
    fields: [{ k: "size", label: "Объём рынка" }],
    lists: [{ k: "competitors", label: "Конкуренты (по одному в строке)" }],
  },
  {
    key: "metrics", label: "Метрики",
    fields: [
      { k: "mrr", label: "MRR" },
      { k: "users", label: "Пользователи" },
      { k: "cac", label: "CAC" },
      { k: "growth", label: "Рост" },
    ],
  },
  {
    key: "legal", label: "Юр. данные",
    fields: [
      { k: "entity_type", label: "Юр. форма" },
      { k: "inn", label: "ИНН" },
    ],
  },
];

const SOURCE_BADGE: Record<string, { label: string; cls: string; icon: typeof Hand }> = {
  manual: { label: "вручную", cls: "text-sky-300/80 bg-sky-500/10", icon: Hand },
  ai: { label: "ИИ", cls: "text-violet-300/80 bg-violet-500/10", icon: Sparkles },
  grant: { label: "грант", cls: "text-amber-300/80 bg-amber-500/10", icon: Award },
};

function getMeta(passport: PassportData): Record<string, { source?: string }> {
  return (passport?._meta as Record<string, { source?: string }>) || {};
}

function getPath(passport: PassportData, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = passport;
  for (const p of parts) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[p];
    } else return undefined;
  }
  return cur;
}

function asText(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n");
  if (typeof v === "object") return "";
  return String(v);
}

interface Props {
  projectId: number;
  projectName: string;
  onClose: () => void;
  onSaved?: (readiness: number) => void;
}

export function PassportModal({ projectId, projectName, onClose, onSaved }: Props) {
  const mounted = useMounted();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passport, setPassport] = useState<PassportData>({});
  const [readiness, setReadiness] = useState(0);
  const [missing, setMissing] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  useEffect(() => {
    const t = getToken();
    if (!t) { setLoading(false); return; }
    getPassport(projectId, t)
      .then((v) => {
        setPassport(v.passport || {});
        setReadiness(v.readiness_index);
        setMissing(v.missing_sections || []);
      })
      .catch((e) => { console.error(e); notifyError("Не удалось загрузить паспорт"); })
      .finally(() => setLoading(false));
  }, [projectId]);

  const valueFor = (path: string, isList = false): string => {
    if (path in edits) return edits[path];
    return asText(getPath(passport, path));
  };

  const setValue = (path: string, v: string) => setEdits((p) => ({ ...p, [path]: v }));

  const handleSave = async () => {
    const t = getToken();
    if (!t) return;
    const fields: Record<string, unknown> = {};
    for (const [path, raw] of Object.entries(edits)) {
      const isList = path === "market.competitors" || path === "custdev.personas";
      if (isList) {
        const arr = raw.split("\n").map((s) => s.trim()).filter(Boolean);
        fields[path] = arr;
      } else {
        fields[path] = raw.trim();
      }
    }
    if (Object.keys(fields).length === 0) { onClose(); return; }
    setSaving(true);
    try {
      const res = await patchPassport(projectId, fields, t);
      setReadiness(res.readiness_index);
      setMissing(res.missing_sections || []);
      onSaved?.(res.readiness_index);
      notifySuccess("Паспорт обновлён");
      onClose();
    } catch (e) {
      console.error(e);
      notifyError("Не удалось сохранить паспорт");
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustom = () => {
    const key = newKey.trim().toLowerCase().replace(/[^a-z0-9а-я_]+/gi, "_").replace(/^_+|_+$/g, "");
    if (!key || !newVal.trim()) return;
    setValue(`custom.${key}`, newVal.trim());
    setNewKey("");
    setNewVal("");
  };

  const meta = getMeta(passport);
  const sourceBadge = (path: string) => {
    const src = (path in edits) ? "manual" : meta[path]?.source;
    if (!src || !SOURCE_BADGE[src]) return null;
    const b = SOURCE_BADGE[src];
    const Icon = b.icon;
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${b.cls}`}>
        <Icon size={10} /> {b.label}
      </span>
    );
  };

  // Кастомные поля, которые уже есть в паспорте.
  const customObj = (passport.custom as Record<string, unknown>) || {};
  const customKeys = Object.keys(customObj);
  const editedCustomKeys = Object.keys(edits)
    .filter((p) => p.startsWith("custom.") && !customKeys.includes(p.slice(7)))
    .map((p) => p.slice(7));
  const allCustomKeys = [...customKeys, ...editedCustomKeys];

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[88vh] bg-neutral-950 border border-white/10 rounded-3xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-white/10">
          <div className="min-w-0">
            <h2 className="font-display text-xl text-white truncate">Паспорт · {projectName}</h2>
            <div className="flex items-center gap-2 mt-1 text-white/40 text-xs">
              <Gauge size={13} /> Готовность {readiness}%
              {missing.length > 0 && <span className="text-white/30">· не хватает: {missing.join(", ")}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white p-2 rounded-xl hover:bg-white/5 transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
          {loading ? (
            <div className="flex justify-center py-12"><Loader className="animate-spin text-white/30" size={24} /></div>
          ) : (
            <>
              {SECTIONS.map((sec) => (
                <div key={sec.key}>
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-3">{sec.label}</h3>
                  <div className="space-y-4">
                    {sec.fields.map((f) => {
                      const path = `${sec.key}.${f.k}`;
                      return (
                        <div key={path}>
                          <label className="flex items-center gap-2 text-white/50 text-xs mb-1.5">
                            {f.label} {sourceBadge(path)}
                          </label>
                          {f.multiline ? (
                            <textarea
                              value={valueFor(path)}
                              onChange={(e) => setValue(path, e.target.value)}
                              rows={2}
                              className="w-full bg-white/[0.03] rounded-xl p-3 text-white text-sm border border-white/10 focus:border-white/30 outline-none resize-none placeholder:text-white/20"
                            />
                          ) : (
                            <input
                              value={valueFor(path)}
                              onChange={(e) => setValue(path, e.target.value)}
                              className="w-full bg-white/[0.03] rounded-xl px-3 py-2.5 text-white text-sm border border-white/10 focus:border-white/30 outline-none placeholder:text-white/20"
                            />
                          )}
                        </div>
                      );
                    })}
                    {(sec.lists || []).map((f) => {
                      const path = `${sec.key}.${f.k}`;
                      return (
                        <div key={path}>
                          <label className="flex items-center gap-2 text-white/50 text-xs mb-1.5">
                            {f.label} {sourceBadge(path)}
                          </label>
                          <textarea
                            value={valueFor(path, true)}
                            onChange={(e) => setValue(path, e.target.value)}
                            rows={3}
                            className="w-full bg-white/[0.03] rounded-xl p-3 text-white text-sm border border-white/10 focus:border-white/30 outline-none resize-none placeholder:text-white/20"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Кастомные поля */}
              <div>
                <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-3">Свои поля</h3>
                <div className="space-y-4">
                  {allCustomKeys.map((ck) => {
                    const path = `custom.${ck}`;
                    return (
                      <div key={path}>
                        <label className="flex items-center gap-2 text-white/50 text-xs mb-1.5">
                          {ck} {sourceBadge(path)}
                        </label>
                        <input
                          value={valueFor(path)}
                          onChange={(e) => setValue(path, e.target.value)}
                          className="w-full bg-white/[0.03] rounded-xl px-3 py-2.5 text-white text-sm border border-white/10 focus:border-white/30 outline-none"
                        />
                      </div>
                    );
                  })}

                  <div className="flex items-end gap-2 pt-1">
                    <div className="flex-1">
                      <input
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        placeholder="Название поля"
                        className="w-full bg-white/[0.03] rounded-xl px-3 py-2.5 text-white text-sm border border-white/10 focus:border-white/30 outline-none placeholder:text-white/25"
                      />
                    </div>
                    <div className="flex-1">
                      <input
                        value={newVal}
                        onChange={(e) => setNewVal(e.target.value)}
                        placeholder="Значение"
                        onKeyDown={(e) => e.key === "Enter" && handleAddCustom()}
                        className="w-full bg-white/[0.03] rounded-xl px-3 py-2.5 text-white text-sm border border-white/10 focus:border-white/30 outline-none placeholder:text-white/25"
                      />
                    </div>
                    <button
                      onClick={handleAddCustom}
                      className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white transition-all"
                      title="Добавить поле"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-white/10">
          <p className="text-white/30 text-xs">Поля «вручную» ИИ не перезаписывает без вашего согласия.</p>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="bg-white text-black font-semibold text-sm px-6 py-2.5 rounded-full hover:bg-neutral-200 transition-all flex items-center gap-2 disabled:opacity-40"
          >
            {saving ? <Loader className="animate-spin" size={15} /> : <Save size={15} />} Сохранить
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
