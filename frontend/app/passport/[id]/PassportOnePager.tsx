"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Printer, ChevronLeft, Loader } from "lucide-react";
import { getToken } from "@/lib/auth";
import { getProject, type Project } from "@/lib/api";
import { notifyError } from "@/lib/ui";

// Печать одностраничника — браузерный диалог «Сохранить как PDF».
// Правила @media print заданы локально на этой странице (см. PRINT_CSS),
// поэтому портретный @page не конфликтует с альбомным @page презентации
// из globals.css: локальный <style> существует только пока смонтирован
// этот маршрут.
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html, body { background: #ffffff !important; }
  .op-toolbar { display: none !important; }
  .op-screen { background: #ffffff !important; padding: 0 !important; min-height: 0 !important; }
  .op-doc { box-shadow: none !important; border: none !important; margin: 0 !important; width: 100% !important; max-width: 100% !important; border-radius: 0 !important; padding: 0 !important; }
  .op-section { break-inside: avoid; }
  .op-row { break-inside: avoid; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;

function txt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

function listOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (typeof x === "string") return x;
      if (typeof x === "number") return String(x);
      if (x && typeof x === "object") return Object.values(x as Record<string, unknown>).map(String).filter(Boolean).join(" · ");
      return "";
    })
    .map((s) => s.trim())
    .filter(Boolean);
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  try {
    return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return "";
  }
}

function readinessColor(r: number): string {
  if (r >= 70) return "text-emerald-600 border-emerald-300 bg-emerald-50";
  if (r >= 40) return "text-amber-600 border-amber-300 bg-amber-50";
  return "text-rose-600 border-rose-300 bg-rose-50";
}

// Длинный текстовый блок (проблема, решение, аудитория).
function Block({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="op-row">
      <div className="font-mono-label text-[10px] uppercase tracking-widest text-neutral-400 mb-1">{label}</div>
      <div className="text-[13px] leading-relaxed text-neutral-800 whitespace-pre-line">{value}</div>
    </div>
  );
}

// Короткое значение в одну строку (стадия, гео, метрика).
function Inline({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="op-row">
      <div className="font-mono-label text-[10px] uppercase tracking-widest text-neutral-400 mb-0.5">{label}</div>
      <div className="text-[13px] text-neutral-900 font-medium break-words">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="op-section border-t border-neutral-200 pt-4">
      <h2 className="font-display text-[12px] font-bold uppercase tracking-[0.18em] text-neutral-900 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function PassportOnePager() {
  const params = useParams();
  const projectId = Number(params.id);

  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    (async () => {
      const t = getToken();
      setHasToken(!!t);
      if (!t || !Number.isFinite(projectId)) {
        setLoading(false);
        return;
      }
      try {
        const proj = await getProject(projectId, t);
        setProject(proj);
      } catch (e) {
        notifyError(e instanceof Error ? e.message : "Не удалось загрузить паспорт");
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-100 text-neutral-500">
        <Loader className="animate-spin" size={22} />
      </div>
    );
  }

  if (hasToken === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-neutral-100 text-neutral-600 px-6 text-center">
        <p className="text-[14px]">Сессия не найдена. Войдите и откройте паспорт из кабинета.</p>
        <Link href="/dashboard" className="text-[13px] underline text-neutral-900">В кабинет</Link>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-neutral-100 text-neutral-600 px-6 text-center">
        <p className="text-[14px]">Паспорт не найден.</p>
        <Link href="/dashboard" className="text-[13px] underline text-neutral-900">В кабинет</Link>
      </div>
    );
  }

  const p = (project.passport || {}) as Record<string, unknown>;
  const core = (p.core as Record<string, unknown>) || {};
  const market = (p.market as Record<string, unknown>) || {};
  const metrics = (p.metrics as Record<string, unknown>) || {};
  const custdev = (p.custdev as Record<string, unknown>) || {};
  const legal = (p.legal as Record<string, unknown>) || {};
  const team = listOf(p.team);
  const competitors = listOf(market.competitors);
  const personas = listOf(custdev.personas);

  const readiness = project.readiness_index ?? 0;
  const updated = fmtDate(project.passport_updated_at || project.updated_at);

  const metricRows: { label: string; value: string }[] = [
    { label: "MRR", value: txt(metrics.mrr) },
    { label: "Пользователи", value: txt(metrics.users) },
    { label: "CAC", value: txt(metrics.cac) },
    { label: "Рост", value: txt(metrics.growth) },
  ].filter((r) => r.value);

  const hasCore = !!(txt(core.problem) || txt(core.solution) || txt(core.target_audience) || txt(core.stage) || txt(core.business_model) || txt(core.geo));
  const hasMarket = !!(txt(market.size) || competitors.length);
  const hasMetrics = metricRows.length > 0;
  const hasTeam = team.length > 0;
  const hasCustdev = personas.length > 0 || !!txt(custdev.interviews_done);
  const hasLegal = !!(txt(legal.entity_type) || txt(legal.requisites));
  const anything = hasCore || hasMarket || hasMetrics || hasTeam || hasCustdev || hasLegal;

  return (
    <div className="op-screen min-h-screen bg-neutral-200 py-6 px-4 flex flex-col items-center">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {/* Панель действий — только на экране */}
      <div className="op-toolbar w-full max-w-[820px] flex items-center justify-between mb-4 print:hidden">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-[13px] text-neutral-600 hover:text-neutral-900 transition">
          <ChevronLeft size={16} /> В кабинет
        </Link>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white text-[13px] font-medium rounded-md hover:bg-neutral-800 transition"
        >
          <Printer size={15} /> Печать / Сохранить PDF
        </button>
      </div>

      {/* Документ A4 */}
      <article className="op-doc w-full max-w-[820px] bg-white text-neutral-900 rounded-xl shadow-xl border border-neutral-200 p-5 sm:p-10">
        {/* Шапка */}
        <header className="flex items-start justify-between gap-6 pb-5">
          <div className="min-w-0">
            <div className="font-mono-label text-[10px] uppercase tracking-[0.22em] text-neutral-400 mb-2">Паспорт проекта</div>
            <h1 className="font-display text-[26px] leading-tight font-bold text-neutral-900 break-words">{project.name}</h1>
            {updated && <div className="text-[11px] text-neutral-400 mt-2 font-code">обновлён {updated}</div>}
          </div>
          <div className={`shrink-0 flex flex-col items-center justify-center w-20 h-20 rounded-lg border ${readinessColor(readiness)}`}>
            <span className="text-[24px] font-bold leading-none">{readiness}</span>
            <span className="font-mono-label text-[8px] uppercase tracking-widest mt-1">готов %</span>
          </div>
        </header>

        {!anything && (
          <div className="border-t border-neutral-200 pt-6 text-[13px] text-neutral-500">
            Паспорт пока не заполнен. Откройте мастер заполнения в кабинете, чтобы добавить проблему, решение и метрики — и одностраничник оживёт.
          </div>
        )}

        <div className="space-y-5">
          {hasCore && (
            <Section title="Основное">
              <Block label="Проблема" value={txt(core.problem)} />
              <Block label="Решение" value={txt(core.solution)} />
              <Block label="Целевая аудитория" value={txt(core.target_audience)} />
              <div className="grid grid-cols-3 gap-4">
                <Inline label="Стадия" value={txt(core.stage)} />
                <Inline label="Бизнес-модель" value={txt(core.business_model)} />
                <Inline label="География" value={txt(core.geo)} />
              </div>
            </Section>
          )}

          {hasMarket && (
            <Section title="Рынок">
              <Inline label="Объём рынка" value={txt(market.size)} />
              {competitors.length > 0 && (
                <div className="op-row">
                  <div className="font-mono-label text-[10px] uppercase tracking-widest text-neutral-400 mb-1">Конкуренты</div>
                  <div className="flex flex-wrap gap-1.5">
                    {competitors.map((c, i) => (
                      <span key={i} className="px-2 py-0.5 text-[12px] bg-neutral-100 border border-neutral-200 rounded text-neutral-700">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {hasMetrics && (
            <Section title="Метрики">
              <div className="grid grid-cols-4 gap-4">
                {metricRows.map((r) => (
                  <Inline key={r.label} label={r.label} value={r.value} />
                ))}
              </div>
            </Section>
          )}

          {hasTeam && (
            <Section title="Команда">
              <ul className="space-y-1">
                {team.map((m, i) => (
                  <li key={i} className="op-row text-[13px] text-neutral-800 flex gap-2">
                    <span className="text-neutral-300">—</span>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {hasCustdev && (
            <Section title="CustDev">
              {personas.length > 0 && (
                <div className="op-row">
                  <div className="font-mono-label text-[10px] uppercase tracking-widest text-neutral-400 mb-1">Персоны</div>
                  <ul className="space-y-1">
                    {personas.map((c, i) => (
                      <li key={i} className="text-[13px] text-neutral-800 flex gap-2">
                        <span className="text-neutral-300">—</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Inline label="Проведено интервью" value={txt(custdev.interviews_done)} />
            </Section>
          )}

          {hasLegal && (
            <Section title="Юридические данные">
              <div className="grid grid-cols-2 gap-4">
                <Inline label="Юр. форма" value={txt(legal.entity_type)} />
              </div>
              <Block label="Реквизиты" value={txt(legal.requisites)} />
            </Section>
          )}
        </div>

        {/* Подвал */}
        <footer className="border-t border-neutral-200 mt-6 pt-4 flex items-center justify-between text-[10px] text-neutral-400 font-code">
          <span>Сгенерировано в Pitchy</span>
          <span>pitchy.pro</span>
        </footer>
      </article>
    </div>
  );
}
