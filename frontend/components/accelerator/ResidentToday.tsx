"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CheckCircle2, FileText, GitBranch, Loader2, MessageCircle, Users } from "lucide-react";

import { describeApiError, getAuthJson, postAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";

export type TodaySection = "program" | "homework" | "tracking" | "events";
type TodayMembership = { membership_id: number; cohort: { id: number; name: string; timezone: string }; project?: { id: number; name: string } | null; modules: Record<string, boolean> };
type TodayAction = { key: string; title: string; description?: string | null; due_at?: string | null; section: TodaySection; target_id?: number; stage_id?: number; kind: "task" | "homework" | "material"; overdue: boolean };
type UpcomingItem = { key: string; kind: "event" | "deadline"; title: string; starts_at: string; description?: string | null; section: TodaySection; target_id?: number; meeting_url?: string | null; location?: string | null; event_format?: string | null };
type TodayData = {
  membership_id: number; timezone: string; required_actions: TodayAction[]; upcoming: UpcomingItem[];
  progress: { percent: number; completed_stages: number; total_stages: number; current_stage?: { id: number; title: string } | null };
  attendance?: { percent: number | null; present: number; total: number; unmarked: number } | null;
  unread_feedback?: Array<{ id: number }>;
  unavailable_sections: string[];
};

function utcDate(value: string) {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value + "Z");
}
function dateText(value: string | null | undefined, timezone: string, withTime = true) {
  if (!value) return "Без срока";
  const date = utcDate(value);
  if (Number.isNaN(date.getTime())) return "Дата уточняется";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}), timeZone: timezone }).format(date);
}
function todayText(timezone: string) {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: timezone }).format(new Date());
}

export function ResidentToday({ membership, onNavigate }: { membership: TodayMembership; onNavigate: (section: TodaySection, targetId?: number) => void }) {
  const { token } = useAuth();
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  const load = useCallback(async () => {
    if (!token) return;
    const current = ++request.current;
    setLoading(true);
    setError("");
    try {
      const next = await getAuthJson<TodayData>("/api/accelerators/memberships/" + membership.membership_id + "/today", token);
      if (request.current === current) setData(next);
    } catch (reason) {
      if (request.current === current) setError(describeApiError(reason, "Не удалось загрузить страницу «Сегодня»"));
    } finally {
      if (request.current === current) setLoading(false);
    }
  }, [membership.membership_id, token]);
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [load]);

  if (loading && !data) return <section className="grid min-h-64 place-items-center" aria-label="Загрузка страницы Сегодня"><Loader2 className="animate-spin text-white/50" /></section>;
  if (!data) return <section className="workspace-card"><p role="alert">{error}</p><button type="button" onClick={() => void load()} className="workspace-button mt-4">Повторить</button></section>;

  const timezone = data.timezone || membership.cohort.timezone || "Europe/Moscow";
  const actions = data.required_actions.slice(0, 3);
  const upcoming = data.upcoming.filter((row) => !actions.some((action) => action.section === row.section && action.target_id === row.target_id)).slice(0, 2);
  const stage = data.progress.current_stage;
  const attendance = data.attendance;
  const openFeedback = async () => {
    if (token && data.unread_feedback?.length) {
      try {
        await postAuthJson("/api/accelerators/memberships/" + membership.membership_id + "/feedback/read", { feedback_ids: data.unread_feedback.map((row) => row.id) }, token);
        setData((current) => current ? { ...current, unread_feedback: [] } : current);
      } catch (reason) { setError(describeApiError(reason, "Не удалось отметить отзыв прочитанным")); }
    }
    onNavigate("tracking");
  };

  return <div className="space-y-6 pb-8" data-testid="resident-today">
    <header>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Сегодня</h1>
      <p className="mt-1 text-base text-white/55">{todayText(timezone)}</p>
    </header>
    {error && <div role="alert" className="rounded-xl border border-red-300/25 p-3 text-sm text-red-100">{error}<button type="button" onClick={() => void load()} className="ml-3 underline">Повторить</button></div>}
    {data.unavailable_sections.length > 0 && <p role="status" className="rounded-xl border border-amber-300/20 p-3 text-sm text-amber-100">Часть данных временно недоступна. Обновите страницу позже.</p>}

    <section className="rounded-xl border border-white/15 bg-[#1c1b1b] p-5 sm:p-7">
      <p className="text-xs uppercase tracking-[.15em] text-white/50">Текущий этап</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-5">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold sm:text-3xl">{stage?.title || (data.progress.total_stages ? "Все опубликованные этапы завершены" : "Программа готовится")}</h2>
          <p className="mt-2 text-sm text-white/55">{stage ? (actions.find((row) => row.section === "program")?.title || "Откройте этап и продолжите обучение.") : data.progress.total_stages ? "Новые этапы появятся после публикации организатором." : "Организатор пока не опубликовал этапы."}</p>
        </div>
        {stage && <button type="button" onClick={() => onNavigate("program", actions.find((row) => row.section === "program")?.target_id || stage.id)} className="workspace-button shrink-0">Продолжить обучение <ArrowRight size={16} /></button>}
      </div>
    </section>

    <div className="grid gap-5 border-y border-white/15 py-4 sm:grid-cols-2">
      <div className="flex flex-wrap items-center gap-4"><div><p className="text-sm text-white/55">Программа</p><p className="text-3xl font-semibold">{data.progress.total_stages ? data.progress.percent + "%" : "—"}</p></div><div className="min-w-32 flex-1"><div className="h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-white/85" style={{ width: data.progress.percent + "%" }} /></div><p className="mt-2 text-xs text-white/55">{data.progress.total_stages ? data.progress.completed_stages + " из " + data.progress.total_stages + " этапов завершены" : "Нет опубликованных этапов"}</p></div></div>
      {membership.modules.attendance && <div className="flex flex-wrap items-center gap-4 sm:border-l sm:border-white/15 sm:pl-6"><div><p className="text-sm text-white/55">Посещаемость</p><p className="text-3xl font-semibold">{attendance?.percent == null ? "—" : attendance.percent + "%"}</p></div><div className="min-w-32 flex-1"><div className="h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-white/85" style={{ width: (attendance?.percent || 0) + "%" }} /></div><p className="mt-2 text-xs text-white/55">{attendance ? attendance.total ? "Посещено " + attendance.present + " из " + attendance.total + " прошедших мероприятий" : "Пока нет прошедших мероприятий" : "Данные уточняются"}{attendance && attendance.unmarked > 0 ? " · " + attendance.unmarked + " без отметки" : ""}</p></div></div>}
    </div>

    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-white/15 bg-[#1c1b1b] p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Нужно сделать {actions.length > 0 && <span className="ml-2 rounded-full bg-white/10 px-2 py-1 text-sm font-normal">{data.required_actions.length}</span>}</h2>
        {actions.length ? <div className="mt-5 divide-y divide-white/15">{actions.map((action) => <div key={action.key} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"><div><p className="font-medium">{action.title}</p><p className="mt-1 text-sm text-white/55">{action.overdue ? "Просрочено" : action.due_at ? "До " + dateText(action.due_at, timezone) : action.description || "Обязательное действие"}</p></div><button type="button" onClick={() => onNavigate(action.section, action.target_id)} className="rounded-lg border border-white/35 px-4 py-2 text-sm hover:bg-white/10">{action.kind === "homework" ? action.title.startsWith("Доработать:") ? "Исправить" : "Сдать работу" : action.kind === "task" ? "Открыть задачу" : "Продолжить"}</button></div>)}</div> : <p className="mt-5 flex items-center gap-2 text-sm text-white/60"><CheckCircle2 size={17} />На сегодня всё выполнено</p>}
        {data.unread_feedback && data.unread_feedback.length > 0 && <button type="button" onClick={() => void openFeedback()} className="mt-5 text-sm text-white/70 underline">Новая обратная связь · {data.unread_feedback.length}</button>}
        <button type="button" onClick={() => onNavigate(membership.modules.homework ? "homework" : "program")} className="mt-5 flex items-center gap-2 text-sm text-white/80">Все задания <ArrowRight size={15} /></button>
      </section>

      <section className="rounded-xl border border-white/15 bg-[#1c1b1b] p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Ближайшее</h2>
        {upcoming.length ? <div className="mt-5 divide-y divide-white/15">{upcoming.map((row) => <div key={row.key} className="py-4 first:pt-0 last:pb-0"><p className="text-sm text-white/55">{dateText(row.starts_at, timezone)}</p><div className="mt-1 flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{row.title}</p><p className="mt-1 text-sm text-white/55">{row.location || row.description}</p></div>{row.kind === "event" && row.meeting_url ? <a href={row.meeting_url} target="_blank" rel="noreferrer" className="rounded-lg border border-white/35 px-4 py-2 text-sm">Подключиться</a> : <button type="button" onClick={() => onNavigate(row.section, row.target_id)} className="inline-flex items-center gap-1 text-sm">Подробнее <ArrowRight size={15} /></button>}</div></div>)}</div> : <p className="mt-5 text-sm text-white/55">Ближайших событий пока нет.</p>}
        <div className="mt-5 flex flex-wrap justify-between gap-2">{membership.modules.attendance && <button type="button" onClick={() => onNavigate("events")} className="inline-flex items-center gap-2 text-sm">Все мероприятия <ArrowRight size={15} /></button>}<span className="text-xs text-white/50">Время: {timezone}</span></div>
      </section>
    </div>

    <section className="border-t border-white/15 pt-6">
      <h2 className="text-xl font-semibold">Продвиньте свой проект с Pitchy</h2>
      <p className="mt-1 text-sm text-white/55">Инструменты для следующего шага.</p>
      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/dashboard?tab=chat" className="flex items-center gap-3 py-2"><MessageCircle size={20} />Чат с аналитиком <ArrowUpRight size={14} /></Link>
        <Link href="/dashboard?tab=tree" className="flex items-center gap-3 py-2"><GitBranch size={20} />Дорожная карта <ArrowUpRight size={14} /></Link>
        <a href="https://custdev.pitchy.pro/" target="_blank" rel="noreferrer" className="flex items-center gap-3 py-2"><Users size={20} />Кастдев <ArrowUpRight size={14} /></a>
        <Link href="/grants" className="flex items-center gap-3 py-2"><FileText size={20} />Гранты <ArrowUpRight size={14} /></Link>
      </div>
    </section>
  </div>;
}
