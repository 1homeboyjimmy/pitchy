"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, RotateCcw, X } from "lucide-react";
import { deleteAuth, describeApiError, getAuthJson, postAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";

type Recommendation = { key: string; title: string; description: string; source: string; section?: string | null; href?: string | null };
type TodayRecommendations = { recommendations: Recommendation[]; dismissed_recommendations: Recommendation[] };

export function ResidentProjectRecommendations({ membershipId, onNavigate }: { membershipId: number; onNavigate: (section: string) => void }) {
  const { token } = useAuth();
  const [data, setData] = useState<TodayRecommendations | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await getAuthJson<TodayRecommendations>("/api/accelerators/memberships/" + membershipId + "/today", token)); setError(""); }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить советы по проекту")); }
  }, [membershipId, token]);
  useEffect(() => { void load(); }, [load]);
  const change = async (row: Recommendation, restore: boolean) => {
    if (!token || busy) return;
    setBusy(row.key);
    try {
      const path = "/api/accelerators/memberships/" + membershipId + "/recommendations/" + encodeURIComponent(row.key);
      if (restore) await deleteAuth(path + "/dismissal", token);
      else await postAuthJson(path + "/dismiss", {}, token);
      await load();
    } catch (reason) { setError(describeApiError(reason, "Не удалось изменить рекомендацию")); }
    finally { setBusy(""); }
  };
  if (!data && !error) return <Loader2 className="animate-spin text-white/50" />;
  return <section className="workspace-card"><h2 className="text-xl">Советы по проекту</h2><p className="mt-1 text-sm text-white/55">Необязательные шаги, которые можно скрыть и вернуть позже.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-200">{error}<button type="button" onClick={() => void load()} className="ml-2 underline">Повторить</button></p>}
    {data && <><div className="mt-5 grid gap-3 md:grid-cols-2">{data.recommendations.length ? data.recommendations.map((row) => <article key={row.key} className="rounded-lg border border-white/15 p-4"><div className="flex justify-between gap-3"><h3 className="font-medium">{row.title}</h3><button type="button" disabled={Boolean(busy)} onClick={() => void change(row, false)} aria-label={"Скрыть рекомендацию «" + row.title + "»"}><X size={16} /></button></div><p className="mt-2 text-sm text-white/60">{row.description}</p><p className="mt-2 text-xs text-white/45">{row.source}</p>{row.href ? <Link href={row.href} className="mt-3 inline-flex items-center gap-2 text-sm underline">Открыть <ArrowRight size={14} /></Link> : row.section ? <button type="button" onClick={() => onNavigate(row.section!)} className="mt-3 inline-flex items-center gap-2 text-sm underline">Открыть <ArrowRight size={14} /></button> : null}</article>) : <p className="text-sm text-white/55">Новых советов пока нет.</p>}</div>{data.dismissed_recommendations.length > 0 && <details className="mt-5"><summary className="cursor-pointer text-sm text-white/55">Скрытые советы · {data.dismissed_recommendations.length}</summary><div className="mt-3 space-y-2">{data.dismissed_recommendations.map((row) => <div key={row.key} className="flex justify-between gap-3 rounded-lg border border-white/10 p-3 text-sm"><span>{row.title}</span><button type="button" disabled={Boolean(busy)} onClick={() => void change(row, true)} className="inline-flex items-center gap-1"><RotateCcw size={14} />Вернуть</button></div>)}</div></details>}</>}
  </section>;
}
