"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Banknote, Calendar, Sparkles, Loader, ChevronLeft, AlertCircle,
  CheckCircle2, XCircle, Clock, ArrowUpRight, FolderOpen, FileText,
} from "lucide-react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";
import { getToken } from "@/lib/auth";
import { notifyError } from "@/lib/ui";
import {
  getProjects, getGrants, matchGrants,
  type ProjectListItem, type Grant, type GrantMatch,
} from "@/lib/api";

const EASE = [0.16, 1, 0.3, 1] as const;

function formatAmount(min: number | null, max: number | null): string | null {
  const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
  if (min != null && max != null) {
    if (min === max) return `${fmt(min)} ₽`;
    return `${fmt(min)} – ${fmt(max)} ₽`;
  }
  if (max != null) return `до ${fmt(max)} ₽`;
  if (min != null) return `от ${fmt(min)} ₽`;
  return null;
}

function formatDate(s: string | null): string | null {
  if (!s) return null;
  try {
    return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return s;
  }
}

function daysLeft(s: string | null): number | null {
  if (!s) return null;
  const d = new Date(s).getTime() - Date.now();
  return Math.ceil(d / (1000 * 60 * 60 * 24));
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-white/40";
}

export function GrantsPageClient() {
  const router = useRouter();
  const [token, setTok] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [activeProject, setActiveProject] = useState<number | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [matches, setMatches] = useState<GrantMatch[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [onlyEligible, setOnlyEligible] = useState(false);

  useEffect(() => {
    const t = getToken();
    setTok(t);
    if (!t) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const [pj, gr] = await Promise.all([getProjects(t), getGrants(t)]);
        setProjects(pj);
        setGrants(gr);
        if (pj.length > 0) setActiveProject(pj[0].id);
      } catch (e) {
        console.error(e);
        notifyError("Не удалось загрузить гранты");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Автоподбор под выбранный проект.
  useEffect(() => {
    if (!token || activeProject == null) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setMatchLoading(true);
    matchGrants(activeProject, token, { onlyEligible })
      .then((m) => { if (!cancelled) setMatches(m); })
      .catch((e) => { console.error(e); if (!cancelled) notifyError("Не удалось подобрать гранты"); })
      .finally(() => { if (!cancelled) setMatchLoading(false); });
    return () => { cancelled = true; };
  }, [token, activeProject, onlyEligible]);

  const openGrants = useMemo(() => grants.filter((g) => g.status === "open"), [grants]);
  const calendar = useMemo(() => {
    return grants
      .filter((g) => g.deadline && g.status !== "closed")
      .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())
      .slice(0, 12);
  }, [grants]);

  const grantHref = (id: number) =>
    activeProject != null ? `/grants/${id}?project=${activeProject}` : `/grants/${id}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader className="animate-spin text-white/40" size={28} />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <TopNavBar />
        <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
          <h1 className="text-4xl text-white mb-4" style={{ fontFamily: "'Instrument Serif', serif" }}>
            Войдите, чтобы подбирать гранты
          </h1>
          <Link href="/login" className="bg-white text-black font-semibold text-sm px-8 py-3 rounded-full mt-4">
            Войти ›
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col antialiased">
      <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-white/5 blur-[120px] rounded-full pointer-events-none" />
      <TopNavBar />

      <div className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 py-10 relative z-10">
        <div className="flex items-center justify-between gap-4 mb-8">
          <Link href="/dashboard" className="flex items-center gap-2 text-white/40 hover:text-white text-sm transition-colors">
            <ChevronLeft size={16} /> Дашборд
          </Link>
          <Link href="/grants/my" className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors">
            <FileText size={16} /> Мои заявки
          </Link>
        </div>

        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <Banknote className="text-white/70" size={28} strokeWidth={1.5} />
            <h1 className="text-4xl md:text-5xl tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>
              Гранты
            </h1>
          </div>
          <p className="text-white/40 font-light max-w-2xl">
            Автоподбор грантовых программ под паспорт вашего проекта и генерация готовой заявки в один клик.
          </p>
        </div>

        {/* Выбор проекта */}
        {projects.length === 0 ? (
          <div className="lovable-glass rounded-3xl p-8 mb-10 flex items-start gap-4 border border-amber-500/20">
            <AlertCircle className="text-amber-400 shrink-0 mt-1" size={22} />
            <div>
              <p className="text-white font-medium mb-1">Нужна папка проекта</p>
              <p className="text-white/50 text-sm leading-relaxed">
                Подбор грантов работает на основе паспорта проекта. Создайте папку проекта в дашборде и заполните паспорт — тогда мы оценим соответствие каждой программы.
              </p>
            </div>
          </div>
        ) : (
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-3 text-white/40">
              <FolderOpen size={15} />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Проект для подбора</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActiveProject(p.id)}
                  className={`px-4 py-2.5 rounded-2xl text-sm transition-all border ${
                    activeProject === p.id
                      ? "bg-white text-black border-white font-medium"
                      : "lovable-glass text-white/60 hover:text-white border-white/10"
                  }`}
                >
                  {p.name}
                  <span className={`ml-2 text-[11px] ${activeProject === p.id ? "text-black/50" : "text-white/30"}`}>
                    {p.readiness_index}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Верхний блок: слева — текущие программы, справа — календарь */}
        {(openGrants.length > 0 || calendar.length > 0) && (
          <div className="grid lg:grid-cols-2 gap-6 mb-12">
            {/* Слева: сейчас идёт приём */}
            <section>
              <div className="flex items-center gap-2 mb-4 text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Сейчас идёт приём</span>
              </div>
              {openGrants.length > 0 ? (
                <div className="space-y-3">
                  {openGrants.slice(0, 5).map((g) => {
                    const dl = daysLeft(g.deadline);
                    return (
                      <Link key={g.id} href={grantHref(g.id)}
                        className="block lovable-glass rounded-2xl p-5 border border-white/10 hover:border-white/20 transition-all group">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-display text-lg text-white truncate group-hover:text-white">{g.name}</p>
                            {g.organization && <p className="text-white/40 text-sm truncate">{g.organization}</p>}
                          </div>
                          <ArrowUpRight className="text-white/30 group-hover:text-white shrink-0" size={18} />
                        </div>
                        <div className="flex items-center gap-3 mt-4 text-xs flex-wrap">
                          {formatAmount(g.amount_min, g.amount_max) && (
                            <span className="text-white/70 font-medium">{formatAmount(g.amount_min, g.amount_max)}</span>
                          )}
                          {dl != null && dl >= 0 && (
                            <span className={`flex items-center gap-1 ${dl <= 7 ? "text-amber-400" : "text-white/40"}`}>
                              <Clock size={12} /> {dl === 0 ? "сегодня" : `${dl} дн.`}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="lovable-glass rounded-2xl p-6 text-white/40 text-sm border border-white/10">
                  Сейчас нет программ с открытым приёмом.
                </div>
              )}
            </section>

            {/* Справа: календарь дедлайнов */}
            <section>
              <div className="flex items-center gap-2 mb-4 text-white/70">
                <Calendar size={16} />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Календарь дедлайнов</span>
              </div>
              {calendar.length > 0 ? (
                <div className="lovable-glass rounded-3xl border border-white/10 divide-y divide-white/5 overflow-hidden">
                  {calendar.map((g) => {
                    const dl = daysLeft(g.deadline);
                    return (
                      <Link key={g.id} href={grantHref(g.id)}
                        className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] transition-colors group">
                        <div className="text-center shrink-0 w-16">
                          <div className="text-sm font-mono text-white/70">{formatDate(g.deadline)?.replace(/ \d{4} г\.?$/, "")}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white truncate group-hover:text-white font-display">{g.name}</p>
                          {g.organization && <p className="text-white/35 text-xs truncate">{g.organization}</p>}
                        </div>
                        {dl != null && (
                          <span className={`text-xs shrink-0 ${dl <= 7 ? "text-amber-400" : "text-white/35"}`}>
                            {dl < 0 ? "завершён" : dl === 0 ? "сегодня" : `${dl} дн.`}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="lovable-glass rounded-2xl p-6 text-white/40 text-sm border border-white/10">
                  Ближайших дедлайнов нет.
                </div>
              )}
            </section>
          </div>
        )}

        {/* Автоподбор */}
        {activeProject != null && (
          <section className="mb-12">
            <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
              <div className="flex items-center gap-2 text-white/70">
                <Sparkles size={16} />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Автоподбор под паспорт</span>
              </div>
              <label className="flex items-center gap-2 text-sm text-white/50 cursor-pointer select-none">
                <input type="checkbox" checked={onlyEligible}
                  onChange={(e) => setOnlyEligible(e.target.checked)}
                  className="accent-white w-4 h-4" />
                Только подходящие
              </label>
            </div>

            {matchLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader className="animate-spin text-white/30" size={22} />
              </div>
            ) : matches.length === 0 ? (
              <div className="lovable-glass rounded-2xl p-6 text-white/40 text-sm">
                Нет грантов по текущим условиям. Попробуйте снять фильтр «только подходящие».
              </div>
            ) : (
              <div className="space-y-3">
                {matches.map((m, i) => (
                  <motion.div
                    key={m.grant.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, delay: i * 0.03 } }}
                  >
                    <Link href={grantHref(m.grant.id)}
                      className="lovable-glass rounded-2xl p-5 border border-white/10 hover:border-white/20 transition-all group flex items-start gap-5">
                      <div className="text-center shrink-0 w-14">
                        <div className={`text-2xl font-mono font-bold ${scoreColor(m.score)}`}>{m.score}</div>
                        <div className="text-[9px] uppercase tracking-wider text-white/30 mt-0.5">матч</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-display text-lg text-white truncate">{m.grant.name}</p>
                          {m.hard_pass ? (
                            <CheckCircle2 className="text-emerald-400 shrink-0" size={15} />
                          ) : (
                            <XCircle className="text-white/30 shrink-0" size={15} />
                          )}
                        </div>
                        {m.grant.organization && <p className="text-white/40 text-sm truncate">{m.grant.organization}</p>}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {(m.reasons.matched || []).slice(0, 3).map((r) => (
                            <span key={r} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300/80">{r}</span>
                          ))}
                          {(m.reasons.missing || []).slice(0, 2).map((r) => (
                            <span key={r} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-white/40">нет: {r}</span>
                          ))}
                        </div>
                      </div>
                      <ArrowUpRight className="text-white/30 group-hover:text-white shrink-0 mt-1" size={18} />
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </section>
        )}

        {grants.length === 0 && (
          <div className="lovable-glass rounded-3xl p-10 text-center text-white/40">
            Каталог грантов пока пуст. Скоро здесь появятся актуальные программы.
          </div>
        )}
      </div>

      <SiteFooter />
    </div>
  );
}
