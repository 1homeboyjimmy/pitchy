"use client";

import Link from "next/link";
import { ArrowRight, Check, LockKeyhole, Sparkles } from "lucide-react";

export function GrantActionsPaywall({ compact = false }: { compact?: boolean }) {
  return (
    <section
      className={`relative overflow-hidden rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/[0.12] via-white/[0.035] to-amber-400/[0.07] ${
        compact ? "p-5 sm:p-6" : "p-6 sm:p-8"
      }`}
    >
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-violet-500/15 blur-3xl" />
      <div className={`relative flex ${compact ? "flex-col gap-5 sm:flex-row sm:items-center" : "flex-col gap-6 md:flex-row md:items-center"}`}>
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-violet-200">
            <LockKeyhole size={20} />
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-violet-200/70">
                Доступен просмотр
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/15 bg-emerald-400/[0.08] px-2 py-0.5 text-[10px] text-emerald-200/75">
                <Check size={10} /> Каталог открыт
              </span>
            </div>
            <h2 className={`${compact ? "text-xl" : "text-2xl"} font-display text-white`}>
              Подача заявки не подключена
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">
              Изучайте программы, условия и дедлайны бесплатно. Чтобы подбирать их под свой проект, сохранять в «Мои гранты», вести воронку и генерировать заявку из паспорта, докупите подачу заявки.
            </p>
          </div>
        </div>
        <Link
          href="/pricing"
          className="group inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition-all hover:bg-violet-100 sm:self-center"
        >
          <Sparkles size={15} /> Докупить подачу
          <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </section>
  );
}
