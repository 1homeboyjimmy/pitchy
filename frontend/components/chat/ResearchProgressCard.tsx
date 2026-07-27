"use client";
import { Check, Circle, Search, ShieldCheck, FileText, X, ArrowUpRight } from "lucide-react";
import type { ResearchJob } from "@/lib/api";
import { ResearchActivityOrb } from "./ResearchActivityOrb";

const phases = [
  ["planning", "План исследования"], ["searching", "Поиск по направлениям"], ["reranking", "Отбор источников"],
  ["extracting", "Извлечение фактов"], ["verifying", "Проверка противоречий"], ["writing", "Подготовка отчёта"],
] as const;
const order = Object.fromEntries(phases.map((p,i)=>[p[0],i]));
const icons = { planning: Circle, searching: Search, reranking: Search, extracting: FileText, verifying: ShieldCheck, writing: FileText };

export function ResearchProgressCard({job,onCancel,onOpen}:{job:ResearchJob;onCancel?:()=>void;onOpen?:()=>void}) {
  const current = order[job.phase] ?? (job.status === "completed" ? phases.length : -1);
  const active = ["queued","running","cancelling"].includes(job.status);
  return <div className="mb-6 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.015] shadow-2xl">
    <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
      <div><div className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/35">Полное исследование</div><div className="mt-1 text-sm font-medium text-white/90">{active ? "Pitchy исследует тему" : job.status === "completed" ? "Исследование завершено" : job.status === "failed" ? "Исследование остановлено" : "Исследование отменено"}</div></div>
      {active && onCancel && <button onClick={onCancel} className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[10px] text-white/45 hover:bg-white/5 hover:text-white"><X className="h-3 w-3"/>Отменить</button>}
    </div>
    <div className="h-1 bg-white/5"><div className="h-full bg-white transition-all duration-700" style={{width:`${job.progress}%`}}/></div>
    <div className="grid gap-2 p-4 sm:grid-cols-2">
      {phases.map(([key,label],i)=>{ const Icon=icons[key]; const done=job.status==="completed" || i<current; const now=i===current && active; return <div key={key} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${now?"bg-white/[0.08]":"bg-white/[0.025]"}`}>
        <div className={`flex h-7 w-7 items-center justify-center rounded-full ${done?"bg-emerald-400/15 text-emerald-300":now?"":"bg-white/5 text-white/20"}`}>{done?<Check className="h-3.5 w-3.5"/>:now?<div className="scale-[0.72]"><ResearchActivityOrb compact /></div>:<Icon className="h-3.5 w-3.5"/>}</div>
        <span className={`text-[12px] ${done||now?"text-white/80":"text-white/25"}`}>{label}</span>
      </div>})}
    </div>
    <div className="flex items-center justify-between border-t border-white/5 px-5 py-3 text-[10px] text-white/30"><span>{job.events.at(-1)?.message || "Ожидание запуска"}</span><span className="font-mono">{job.progress}%</span></div>
    {job.error && <div className="border-t border-red-500/10 bg-red-500/[0.05] px-5 py-3 text-xs text-red-300/80">{job.error}</div>}
    {onOpen && <button type="button" onClick={onOpen} className="flex w-full items-center justify-center gap-2 border-t border-white/5 px-5 py-3 text-[11px] font-medium text-white/60 transition-colors hover:bg-white/[0.04] hover:text-white">
      {job.status === "completed" ? "Открыть отчёт" : "Открыть процесс исследования"}
      <ArrowUpRight className="h-3.5 w-3.5"/>
    </button>}
  </div>;
}
