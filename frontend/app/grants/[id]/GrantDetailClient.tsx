"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
  Loader, ChevronLeft, Banknote, MapPin, Building2, Clock, Sparkles,
  ExternalLink, CheckCircle2, AlertTriangle, FileText,
} from "lucide-react";
import { getToken } from "@/lib/auth";
import { notifyError } from "@/lib/ui";
import {
  getGrant, getProjects, generateGrantApplication,
  type Grant, type ProjectListItem, type GrantApplication,
} from "@/lib/api";

const SECTION_LABELS: Record<string, string> = {
  summary: "Резюме проекта",
  problem: "Проблема",
  solution: "Решение",
  market: "Рынок",
  team: "Команда",
  budget: "Бюджет",
  impact: "Эффект и значимость",
};

function formatAmount(min: number | null, max: number | null): string | null {
  const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
  if (min != null && max != null) return min === max ? `${fmt(min)} ₽` : `${fmt(min)} – ${fmt(max)} ₽`;
  if (max != null) return `до ${fmt(max)} ₽`;
  if (min != null) return `от ${fmt(min)} ₽`;
  return null;
}

function formatDate(s: string | null): string | null {
  if (!s) return null;
  try {
    return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  } catch { return s; }
}

export function GrantDetailClient() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const grantId = Number(params.id);
  const projectParam = search.get("project");

  const [token, setTok] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectId, setProjectId] = useState<number | null>(projectParam ? Number(projectParam) : null);
  const [extra, setExtra] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GrantApplication | null>(null);

  useEffect(() => {
    const t = getToken();
    setTok(t);
    if (!t) { setLoading(false); return; }
    (async () => {
      try {
        const [g, pj] = await Promise.all([getGrant(grantId, t), getProjects(t)]);
        setGrant(g);
        setProjects(pj);
        if (projectId == null && pj.length > 0) setProjectId(pj[0].id);
      } catch (e) {
        console.error(e);
        notifyError("Не удалось загрузить грант");
      } finally {
        setLoading(false);
      }
    })();
  }, [grantId]);

  const handleGenerate = async () => {
    if (!token || projectId == null) return;
    setGenerating(true);
    try {
      const app = await generateGrantApplication(grantId, projectId, token, extra || undefined);
      setResult(app);
    } catch (e) {
      console.error(e);
      notifyError("Не удалось сгенерировать заявку");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full bg-black flex items-center justify-center">
        <Loader className="animate-spin text-white/40" size={28} />
      </div>
    );
  }

  if (!grant) {
    return (
      <div className="h-full flex items-center justify-center text-white/40">Грант не найден</div>
    );
  }

  const sections = result?.content?.sections || {};
  const gaps = result?.content?.gaps || [];
  const sectionKeys = Object.keys(SECTION_LABELS).filter((k) => sections[k]);

  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-8 pt-24 pb-10 relative z-10">
        <Link href="/grants" className="flex items-center gap-2 text-white/40 hover:text-white text-sm mb-8 transition-colors">
          <ChevronLeft size={16} /> Все гранты
        </Link>

        <div className="mb-8">
          {grant.status === "open" && (
            <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-mono uppercase tracking-wider mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Приём открыт
            </span>
          )}
          <h1 className="text-3xl md:text-4xl tracking-tight mb-2" style={{ fontFamily: "'Instrument Serif', serif" }}>
            {grant.name}
          </h1>
          {grant.organization && (
            <p className="flex items-center gap-2 text-white/50"><Building2 size={15} /> {grant.organization}</p>
          )}
        </div>

        {/* Факты */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {formatAmount(grant.amount_min, grant.amount_max) && (
            <div className="lovable-glass rounded-2xl p-4 border border-white/10">
              <Banknote size={16} className="text-white/40 mb-2" />
              <div className="text-white font-medium text-sm">{formatAmount(grant.amount_min, grant.amount_max)}</div>
            </div>
          )}
          {grant.geo && (
            <div className="lovable-glass rounded-2xl p-4 border border-white/10">
              <MapPin size={16} className="text-white/40 mb-2" />
              <div className="text-white font-medium text-sm">{grant.geo}</div>
            </div>
          )}
          {grant.deadline && (
            <div className="lovable-glass rounded-2xl p-4 border border-white/10">
              <Clock size={16} className="text-white/40 mb-2" />
              <div className="text-white font-medium text-sm">{formatDate(grant.deadline)}</div>
            </div>
          )}
          {grant.url && (
            <a href={grant.url} target="_blank" rel="noopener noreferrer"
              className="lovable-glass rounded-2xl p-4 border border-white/10 hover:border-white/20 transition-all">
              <ExternalLink size={16} className="text-white/40 mb-2" />
              <div className="text-white font-medium text-sm">Сайт программы</div>
            </a>
          )}
        </div>

        {grant.description && (
          <div className="lovable-glass rounded-2xl p-6 border border-white/10 mb-8">
            <p className="text-white/70 leading-relaxed whitespace-pre-wrap">{grant.description}</p>
          </div>
        )}

        {(grant.stages.length > 0 || grant.sectors.length > 0 || grant.entity_types.length > 0) && (
          <div className="flex flex-wrap gap-2 mb-10">
            {grant.stages.map((s) => <span key={s} className="text-xs px-3 py-1 rounded-full bg-white/5 text-white/50">{s}</span>)}
            {grant.sectors.map((s) => <span key={s} className="text-xs px-3 py-1 rounded-full bg-white/5 text-white/50">{s}</span>)}
            {grant.entity_types.map((s) => <span key={s} className="text-xs px-3 py-1 rounded-full bg-white/5 text-white/50">{s}</span>)}
          </div>
        )}

        {/* Генерация заявки */}
        <section className="border-t border-white/10 pt-8">
          <div className="flex items-center gap-2 mb-4 text-white/70">
            <Sparkles size={18} />
            <h2 className="font-display text-xl">Сгенерировать заявку из паспорта</h2>
          </div>

          {projects.length === 0 ? (
            <div className="lovable-glass rounded-2xl p-6 border border-amber-500/20 flex items-start gap-3">
              <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={18} />
              <p className="text-white/60 text-sm">
                Чтобы собрать заявку, нужен проект с паспортом. Создайте папку проекта в дашборде.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-white/40 text-xs font-mono uppercase tracking-wider mb-2">Проект</label>
                <div className="flex flex-wrap gap-2">
                  {projects.map((p) => (
                    <button key={p.id} onClick={() => setProjectId(p.id)}
                      className={`px-4 py-2 rounded-xl text-sm transition-all border ${
                        projectId === p.id ? "bg-white text-black border-white font-medium" : "lovable-glass text-white/60 border-white/10 hover:text-white"
                      }`}>
                      {p.name} <span className={projectId === p.id ? "text-black/50" : "text-white/30"}>{p.readiness_index}%</span>
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder="Дополнительный контекст под этот грант (необязательно)…"
                rows={3}
                className="w-full lovable-glass rounded-2xl p-4 text-white text-sm border border-white/10 focus:border-white/30 outline-none resize-none mb-4 placeholder:text-white/25"
              />

              <button
                onClick={handleGenerate}
                disabled={generating || projectId == null}
                className="bg-white text-black font-semibold text-sm px-7 py-3.5 rounded-full hover:bg-neutral-200 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? <><Loader className="animate-spin" size={16} /> Собираем заявку…</> : <><Sparkles size={16} /> Сгенерировать</>}
              </button>
            </>
          )}
        </section>

        {/* Результат */}
        {result && (
          <section className="mt-10">
            <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 size={18} /> <span className="font-display text-lg text-white">Заявка готова</span>
              </div>
              <Link href="/grants/my" className="flex items-center gap-2 text-white/60 hover:text-white text-sm">
                <FileText size={15} /> Все мои заявки
              </Link>
            </div>

            {gaps.length > 0 && (
              <div className="lovable-glass rounded-2xl p-5 border border-amber-500/20 mb-5">
                <p className="flex items-center gap-2 text-amber-400 text-sm font-medium mb-2">
                  <AlertTriangle size={15} /> Нужно дозаполнить
                </p>
                <ul className="list-disc list-inside text-white/50 text-sm space-y-1">
                  {gaps.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              </div>
            )}

            <div className="space-y-4">
              {sectionKeys.map((k) => (
                <div key={k} className="lovable-glass rounded-2xl p-6 border border-white/10">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-3">{SECTION_LABELS[k]}</h3>
                  <p className="text-white/80 leading-relaxed whitespace-pre-wrap">{sections[k]}</p>
                </div>
              ))}
            </div>
          </section>
        )}
    </div>
  );
}
