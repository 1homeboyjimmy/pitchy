"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader, ChevronLeft, FileText, Banknote } from "lucide-react";
import { getToken } from "@/lib/auth";
import { notifyError } from "@/lib/ui";
import {
  getGrantApplications, getGrants,
  type GrantApplication, type Grant,
} from "@/lib/api";

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Черновик", cls: "bg-white/5 text-white/40" },
  generated: { label: "Сгенерирована", cls: "bg-emerald-500/10 text-emerald-300/80" },
  submitted: { label: "Подана", cls: "bg-sky-500/10 text-sky-300/80" },
};

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  } catch { return s; }
}

export function GrantApplicationsClient() {
  const [token, setTok] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState<GrantApplication[]>([]);
  const [grants, setGrants] = useState<Record<number, Grant>>({});

  useEffect(() => {
    const t = getToken();
    setTok(t);
    if (!t) { setLoading(false); return; }
    (async () => {
      try {
        const [list, allGrants] = await Promise.all([getGrantApplications(t), getGrants(t)]);
        setApps(list);
        const map: Record<number, Grant> = {};
        for (const g of allGrants) map[g.id] = g;
        setGrants(map);
      } catch (e) {
        console.error(e);
        notifyError("Не удалось загрузить заявки");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="h-full bg-black flex items-center justify-center">
        <Loader className="animate-spin text-white/40" size={28} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-8 pt-24 pb-10 relative z-10">
        <Link href="/grants" className="flex items-center gap-2 text-white/40 hover:text-white text-sm mb-8 transition-colors">
          <ChevronLeft size={16} /> Гранты
        </Link>

        <div className="flex items-center gap-3 mb-10">
          <FileText className="text-white/70" size={26} strokeWidth={1.5} />
          <h1 className="text-4xl tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>Мои заявки</h1>
        </div>

        {apps.length === 0 ? (
          <div className="lovable-glass rounded-3xl p-10 text-center border border-white/10">
            <Banknote className="mx-auto text-white/20 mb-4" size={36} />
            <p className="text-white/50 mb-5">Вы ещё не создавали заявок на гранты.</p>
            <Link href="/grants" className="inline-flex bg-white text-black font-semibold text-sm px-7 py-3 rounded-full hover:bg-neutral-200 transition-all">
              Подобрать грант ›
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {apps.map((a) => {
              const g = grants[a.grant_id];
              const st = STATUS_LABELS[a.status] || STATUS_LABELS.draft;
              return (
                <Link key={a.id} href={`/grants/${a.grant_id}`}
                  className="lovable-glass rounded-2xl p-5 border border-white/10 hover:border-white/20 transition-all flex items-center gap-4 group">
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-lg text-white truncate">{g?.name || `Грант #${a.grant_id}`}</p>
                    {g?.organization && <p className="text-white/40 text-sm truncate">{g.organization}</p>}
                    <p className="text-white/30 text-xs mt-1">Обновлено {formatDate(a.updated_at)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className={`text-[11px] px-2.5 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                    {a.match_score != null && (
                      <span className="text-xs font-mono text-white/40">матч {a.match_score}</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
    </div>
  );
}
