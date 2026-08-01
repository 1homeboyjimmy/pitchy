"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "@mantine/hooks";
import { X, Loader, Plus, Save, Hand, Sparkles, Award, Gauge, Wand2, ChevronLeft, ChevronRight, Check, SkipForward, FileDown } from "lucide-react";
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
    ],
  },
];

const SOURCE_BADGE: Record<string, { label: string; cls: string; icon: typeof Hand }> = {
  manual: { label: "вручную", cls: "text-sky-300/80 bg-sky-500/10", icon: Hand },
  ai: { label: "ИИ", cls: "text-violet-300/80 bg-violet-500/10", icon: Sparkles },
  grant: { label: "грант", cls: "text-amber-300/80 bg-amber-500/10", icon: Award },
};

// Зеркало KEY_FIELDS из passport.py: путь, вес (важность для индекса
// готовности) и подсказка для мастера заполнения. Сумма весов = 24.
type WizardField = {
  path: string; section: string; label: string; hint: string;
  weight: number; multiline?: boolean; list?: boolean;
};
const WIZARD_FIELDS: WizardField[] = [
  { path: "core.name", section: "Основное", label: "Название проекта", hint: "Как называется ваш стартап?", weight: 3 },
  { path: "core.problem", section: "Основное", label: "Проблема", hint: "Какую боль клиента вы решаете? 1–2 предложения.", weight: 3, multiline: true },
  { path: "core.solution", section: "Основное", label: "Решение", hint: "Как ваш продукт закрывает эту боль?", weight: 3, multiline: true },
  { path: "core.target_audience", section: "Основное", label: "Целевая аудитория", hint: "Кто платит и пользуется? Сегмент, гео, размер.", weight: 2, multiline: true },
  { path: "core.stage", section: "Основное", label: "Стадия", hint: "Идея / прототип / первые продажи / рост.", weight: 1 },
  { path: "core.business_model", section: "Основное", label: "Бизнес-модель", hint: "Как зарабатываете: подписка, комиссия, разовые продажи?", weight: 2 },
  { path: "core.geo", section: "Основное", label: "География", hint: "Основной рынок: Россия, СНГ, конкретные регионы.", weight: 1 },
  { path: "market.size", section: "Рынок", label: "Объём рынка", hint: "Оценка рынка (TAM/SAM) в деньгах или числе клиентов.", weight: 2 },
  { path: "market.competitors", section: "Рынок", label: "Конкуренты", hint: "Перечислите по одному в строке.", weight: 1, list: true },
  { path: "metrics.mrr", section: "Метрики", label: "MRR", hint: "Ежемесячная выручка, если уже есть продажи.", weight: 1 },
  { path: "metrics.users", section: "Метрики", label: "Пользователи", hint: "Сколько активных пользователей или клиентов.", weight: 1 },
  { path: "team", section: "Команда", label: "Команда", hint: "Участники и роли — по одному в строке.", weight: 2, list: true },
  { path: "custdev.personas", section: "CustDev", label: "Персоны / CustDev", hint: "Кого интервьюировали? Ключевые персоны — по одной в строке.", weight: 1, list: true },
  { path: "legal.entity_type", section: "Юр. данные", label: "Юр. форма", hint: "ООО, ИП, самозанятый — или пока не оформлено.", weight: 1 },
];
const WIZARD_TOTAL = WIZARD_FIELDS.reduce((s, f) => s + f.weight, 0);
const LIST_PATHS = new Set(WIZARD_FIELDS.filter((f) => f.list).map((f) => f.path));

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
  const [missing, setMissing] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  // Мастер заполнения: пошаговый проход по пустым ключевым полям.
  const [wizard, setWizard] = useState(false);
  const [wizardPaths, setWizardPaths] = useState<string[]>([]);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t = getToken();
    if (!t) { setLoading(false); return; }
    getPassport(projectId, t)
      .then((v) => {
        setPassport(v.passport || {});
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

  // Живой индекс готовности: считаем локально по тем же весам, что и бэкенд,
  // чтобы шкала реагировала на ввод сразу, не дожидаясь сохранения.
  const localReadiness = useMemo(() => {
    const filled = (path: string) => {
      const raw = path in edits ? edits[path] : asText(getPath(passport, path));
      return !!raw && raw.trim().length > 0;
    };
    let got = 0;
    for (const f of WIZARD_FIELDS) if (filled(f.path)) got += f.weight;
    return Math.round((got * 100) / WIZARD_TOTAL);
  }, [passport, edits]);

  const startWizard = () => {
    const empty = WIZARD_FIELDS.filter((f) => {
      const raw = f.path in edits ? edits[f.path] : asText(getPath(passport, f.path));
      return !raw || !raw.trim();
    }).map((f) => f.path);
    setWizardPaths(empty);
    setStep(0);
    setWizard(true);
  };

  const wizardDefs = wizardPaths
    .map((p) => WIZARD_FIELDS.find((f) => f.path === p))
    .filter((f): f is WizardField => !!f);
  const wizardCurrent = wizardDefs[step];
  const wizardLast = step >= wizardDefs.length - 1;

  const wizardNext = () => {
    if (wizardLast) handleSave();
    else setStep((s) => Math.min(wizardDefs.length - 1, s + 1));
  };
  const wizardBack = () => setStep((s) => Math.max(0, s - 1));

  const handleSave = async () => {
    const t = getToken();
    if (!t) return;
    const fields: Record<string, unknown> = {};
    for (const [path, raw] of Object.entries(edits)) {
      const isList = LIST_PATHS.has(path);
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
    <div className="fixed inset-0 z-[300] flex items-center justify-center overflow-y-auto overscroll-contain p-2 sm:p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] bg-neutral-950 border border-white/10 rounded-2xl sm:rounded-3xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10">
          <div className="flex items-start justify-between gap-4">
            <h2 className="font-display text-xl text-white truncate min-w-0">Паспорт · {projectName}</h2>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => window.open(`/passport/${projectId}`, "_blank", "noopener")}
                className="flex items-center gap-1.5 text-white/50 hover:text-white text-xs px-2.5 py-2 rounded-xl hover:bg-white/5 transition-all"
                title="Одностраничник для печати / сохранения в PDF"
              >
                <FileDown size={15} /> PDF
              </button>
              <button onClick={onClose} className="text-white/40 hover:text-white p-2 -mr-2 rounded-xl hover:bg-white/5 transition-all">
                <X size={18} />
              </button>
            </div>
          </div>
          {/* Живая шкала готовности */}
          <div className="mt-3">
            <div className="flex items-center gap-2 text-xs mb-1.5">
              <Gauge size={13} className="text-white/40" />
              <span className="text-white/50">Готовность паспорта</span>
              <span className={`ml-auto font-mono font-bold tabular-nums ${localReadiness >= 70 ? "text-emerald-300" : localReadiness >= 40 ? "text-amber-300" : "text-white/60"}`}>{localReadiness}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${localReadiness >= 70 ? "bg-emerald-400/70" : localReadiness >= 40 ? "bg-amber-400/70" : "bg-white/40"}`}
                style={{ width: `${localReadiness}%` }}
              />
            </div>
            {missing.length > 0 && (
              <p className="text-white/30 text-[11px] mt-1.5">Не хватает: {missing.join(", ")}</p>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
          {loading ? (
            <div className="flex justify-center py-12"><Loader className="animate-spin text-white/30" size={24} /></div>
          ) : wizard ? (
            wizardDefs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                  <Check className="text-emerald-300" size={26} />
                </div>
                <h3 className="font-display text-lg text-white mb-1">Ключевые поля заполнены</h3>
                <p className="text-white/40 text-sm max-w-xs">Паспорт готов для подбора грантов. Вернитесь в обычный режим, чтобы дополнить детали.</p>
                <button onClick={() => setWizard(false)} className="mt-5 text-sm text-white/60 hover:text-white px-4 py-2 rounded-full border border-white/10 hover:bg-white/5 transition-all">
                  К обычному режиму
                </button>
              </div>
            ) : wizardCurrent ? (
              <div>
                {/* Прогресс по шагам */}
                <div className="flex items-center gap-1.5 mb-6">
                  {wizardDefs.map((_, i) => (
                    <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i < step ? "bg-emerald-400/60" : i === step ? "bg-white/50" : "bg-white/[0.08]"}`} />
                  ))}
                </div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30 mb-2">
                  {wizardCurrent.section} · шаг {step + 1} из {wizardDefs.length}
                </p>
                <h3 className="font-display text-xl text-white mb-1.5 flex items-center gap-2 flex-wrap">
                  {wizardCurrent.label} {sourceBadge(wizardCurrent.path)}
                </h3>
                <p className="text-white/40 text-sm mb-4 leading-relaxed">{wizardCurrent.hint}</p>
                {wizardCurrent.multiline || wizardCurrent.list ? (
                  <textarea
                    autoFocus
                    value={valueFor(wizardCurrent.path, wizardCurrent.list)}
                    onChange={(e) => setValue(wizardCurrent.path, e.target.value)}
                    rows={wizardCurrent.list ? 4 : 3}
                    placeholder={wizardCurrent.list ? "По одному в строке…" : "Введите ответ…"}
                    className="w-full bg-white/[0.03] rounded-xl p-3.5 text-white text-sm border border-white/10 focus:border-white/30 outline-none resize-none placeholder:text-white/20"
                  />
                ) : (
                  <input
                    autoFocus
                    value={valueFor(wizardCurrent.path)}
                    onChange={(e) => setValue(wizardCurrent.path, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") wizardNext(); }}
                    placeholder="Введите ответ…"
                    className="w-full bg-white/[0.03] rounded-xl px-3.5 py-3 text-white text-sm border border-white/10 focus:border-white/30 outline-none placeholder:text-white/20"
                  />
                )}
                <p className="text-white/25 text-[11px] mt-3 flex items-start gap-1.5">
                  <Sparkles size={11} className="text-violet-300/50 shrink-0 mt-0.5" />
                  Поля с пометкой «ИИ» уже заполнены из ваших чатов — мастер ведёт только по тому, что осталось.
                </p>
              </div>
            ) : null
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
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/10">
          {wizard ? (
            <>
              <button
                onClick={wizardBack}
                disabled={step === 0}
                className="text-white/50 hover:text-white text-sm px-3 py-2 rounded-full hover:bg-white/5 transition-all disabled:opacity-30 flex items-center gap-1.5"
              >
                <ChevronLeft size={16} /> Назад
              </button>
              <button onClick={() => setWizard(false)} className="text-white/30 hover:text-white/60 text-xs transition-all">
                выйти из мастера
              </button>
              <div className="flex items-center gap-2">
                {!wizardLast && wizardDefs.length > 0 && (
                  <button
                    onClick={() => setStep((s) => Math.min(wizardDefs.length - 1, s + 1))}
                    className="text-white/40 hover:text-white text-sm px-3 py-2 rounded-full hover:bg-white/5 transition-all flex items-center gap-1.5"
                  >
                    <SkipForward size={14} /> Пропустить
                  </button>
                )}
                <button
                  onClick={wizardNext}
                  disabled={saving}
                  className="bg-white text-black font-semibold text-sm px-5 py-2.5 rounded-full hover:bg-neutral-200 transition-all flex items-center gap-2 disabled:opacity-40"
                >
                  {wizardLast ? (saving ? <Loader className="animate-spin" size={15} /> : <Check size={15} />) : <ChevronRight size={15} />}
                  {wizardLast ? "Готово" : "Далее"}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={startWizard}
                disabled={loading}
                className="flex items-center gap-2 text-sm text-white/60 hover:text-white px-3.5 py-2 rounded-full border border-white/10 hover:bg-white/5 transition-all disabled:opacity-40"
              >
                <Wand2 size={15} /> Мастер заполнения
              </button>
              <button
                onClick={handleSave}
                disabled={saving || loading}
                className="bg-white text-black font-semibold text-sm px-6 py-2.5 rounded-full hover:bg-neutral-200 transition-all flex items-center gap-2 disabled:opacity-40"
              >
                {saving ? <Loader className="animate-spin" size={15} /> : <Save size={15} />} Сохранить
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
