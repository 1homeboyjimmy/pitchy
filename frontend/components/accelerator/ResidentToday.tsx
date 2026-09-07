"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Compass,
  FilePenLine,
  Gauge,
  LifeBuoy,
  Loader2,
  MessageCircle,
  Sparkles,
  Target,
  X,
} from "lucide-react";

import { getAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";

type ResidentSection = "program" | "homework" | "events" | "tracking" | "matching" | "project_audit";

type TodayMembership = {
  membership_id: number;
  cohort: { id: number; name: string; timezone: string };
  project?: { id: number; name: string; readiness_index: number } | null;
  modules: Record<string, boolean>;
};

type Material = { id: number; title: string; required: boolean; completed: boolean };
type Stage = { id: number; title: string; required: boolean; state: "locked" | "available" | "completed"; materials: Material[] };
type Submission = { status: "submitted" | "needs_revision" | "accepted"; review_comment?: string | null };
type Homework = { id: number; title: string; due_at?: string | null; is_overdue: boolean; submission?: Submission | null };
type Event = { id: number; title: string; starts_at: string; location?: string | null; meeting_url?: string | null };
type Tracking = {
  feedback: Array<{ id: number; body: string; created_at: string; author: { name: string } }>;
  tasks: Array<{ id: number; title: string; description?: string | null; status: "open" | "done" | "cancelled"; due_at?: string | null }>;
};

type WorkCard = {
  id: string;
  title: string;
  description?: string;
  meta?: string;
  section: ResidentSection;
  urgency: number;
  tone?: "urgent" | "warning" | "neutral";
};

type Recommendation = {
  id: string;
  title: string;
  description: string;
  source: string;
  section?: ResidentSection;
  href?: string;
};

function safeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value: string, timezone: string) {
  const date = safeDate(value);
  if (!date) return "Дата уточняется";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  }
}

function formatToday(timezone: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: timezone }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  }
}

export function ResidentToday({ membership, onNavigate }: { membership: TodayMembership; onNavigate: (section: ResidentSection) => void }) {
  const { token } = useAuth();
  const [stages, setStages] = useState<Stage[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [tracking, setTracking] = useState<Tracking>({ feedback: [], tasks: [] });
  const [now] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [hiddenRecommendations, setHiddenRecommendations] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    const programRequest = membership.modules.program
      ? getAuthJson<Stage[]>(`/api/accelerators/memberships/${membership.membership_id}/program-stages`, token)
      : Promise.resolve([]);
    const homeworkRequest = membership.modules.homework
      ? getAuthJson<Homework[]>(`/api/accelerators/memberships/${membership.membership_id}/homework`, token)
      : Promise.resolve([]);
    const eventsRequest = membership.modules.attendance
      ? getAuthJson<Event[]>(`/api/accelerators/memberships/${membership.membership_id}/events`, token)
      : Promise.resolve([]);
    const trackingRequest = membership.modules.progress_tracking
      ? getAuthJson<Tracking>(`/api/accelerators/memberships/${membership.membership_id}/tracking`, token)
      : Promise.resolve({ feedback: [], tasks: [] });

    const results = await Promise.allSettled([programRequest, homeworkRequest, eventsRequest, trackingRequest]);
    const failed: string[] = [];
    if (results[0].status === "fulfilled") setStages(results[0].value); else failed.push("программа");
    if (results[1].status === "fulfilled") setHomework(results[1].value); else failed.push("домашние задания");
    if (results[2].status === "fulfilled") setEvents(results[2].value); else failed.push("мероприятия");
    if (results[3].status === "fulfilled") setTracking(results[3].value); else failed.push("трекинг");
    setUnavailable(failed);
    setLoading(false);
  }, [membership.membership_id, membership.modules, token]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const requiredActions = useMemo<WorkCard[]>(() => {
    const cards: WorkCard[] = [];
    for (const task of tracking.tasks.filter((row) => row.status === "open" && safeDate(row.due_at))) {
      const due = safeDate(task.due_at)!;
      const overdue = due.getTime() < now;
      cards.push({
        id: `task-${task.id}`,
        title: task.title,
        description: task.description || "Задача от организатора или трекера.",
        meta: `${overdue ? "Просрочено" : "Срок"}: ${formatDateTime(task.due_at!, membership.cohort.timezone)}`,
        section: "tracking",
        urgency: overdue ? 0 : due?.getTime() || Number.MAX_SAFE_INTEGER,
        tone: overdue ? "urgent" : "neutral",
      });
    }
    for (const assignment of homework) {
      if (assignment.submission?.status === "needs_revision") {
        cards.push({
          id: `homework-revision-${assignment.id}`,
          title: `Доработать: ${assignment.title}`,
          description: assignment.submission.review_comment || "Организатор оставил комментарий к ответу.",
          meta: assignment.due_at ? `Срок: ${formatDateTime(assignment.due_at, membership.cohort.timezone)}` : "Ожидает повторной отправки",
          section: "homework",
          urgency: -1,
          tone: "warning",
        });
      } else if (assignment.is_overdue && !assignment.submission) {
        cards.push({
          id: `homework-overdue-${assignment.id}`,
          title: assignment.title,
          description: "Домашнее задание ещё не отправлено.",
          meta: "Срок прошёл",
          section: "homework",
          urgency: 0,
          tone: "urgent",
        });
      }
    }
    const currentStage = stages.find((stage) => stage.state === "available");
    const requiredMaterial = currentStage?.materials.find((material) => material.required && !material.completed);
    if (currentStage && requiredMaterial) {
      cards.push({
        id: `material-${requiredMaterial.id}`,
        title: requiredMaterial.title,
        description: `Обязательный материал этапа «${currentStage.title}».`,
        meta: "Нужно изучить",
        section: "program",
        urgency: 1,
        tone: "neutral",
      });
    }
    return cards.sort((left, right) => left.urgency - right.urgency);
  }, [homework, membership.cohort.timezone, now, stages, tracking.tasks]);

  const upcoming = useMemo<WorkCard[]>(() => {
    const eventCards = events
      .filter((event) => (safeDate(event.starts_at)?.getTime() || 0) >= now)
      .map((event) => ({
        id: `event-${event.id}`,
        title: event.title,
        description: event.location || (event.meeting_url ? "Онлайн-встреча" : "Место уточняется"),
        meta: formatDateTime(event.starts_at, membership.cohort.timezone),
        section: "events" as const,
        urgency: safeDate(event.starts_at)?.getTime() || Number.MAX_SAFE_INTEGER,
      }));
    const deadlineCards = homework
      .filter((assignment) => assignment.due_at && !assignment.is_overdue && assignment.submission?.status !== "accepted")
      .map((assignment) => ({
        id: `deadline-${assignment.id}`,
        title: assignment.title,
        description: "Ближайший срок домашнего задания",
        meta: formatDateTime(assignment.due_at!, membership.cohort.timezone),
        section: "homework" as const,
        urgency: safeDate(assignment.due_at)?.getTime() || Number.MAX_SAFE_INTEGER,
      }));
    return [...eventCards, ...deadlineCards].sort((left, right) => left.urgency - right.urgency).slice(0, 3);
  }, [events, homework, membership.cohort.timezone, now]);

  const recommendations = useMemo<Recommendation[]>(() => {
    const rows: Recommendation[] = [];
    for (const task of tracking.tasks.filter((row) => row.status === "open" && !safeDate(row.due_at))) {
      rows.push({
        id: `manual-task-${task.id}`,
        title: task.title,
        description: task.description || "Организатор или трекер рекомендует вернуться к этому шагу.",
        source: "От организатора или трекера",
        section: "tracking",
      });
    }
    if (membership.project && membership.project.readiness_index < 100) {
      rows.push({
        id: "passport",
        title: "Дополнить паспорт проекта",
        description: `Сейчас заполнено ${membership.project.readiness_index}%. Полный контекст сделает анализ и следующие шаги точнее.`,
        source: "Рекомендация программы",
        href: `/passport/${membership.project.id}`,
      });
    }
    if (membership.modules.project_audit) rows.push({ id: "audit", title: "Проверить проект аудитом", description: "Получите список сильных сторон, рисков и следующих проверок для текущего этапа.", source: "Рекомендация программы", section: "project_audit" });
    if (membership.modules.matchmaking) rows.push({ id: "matching", title: "Найти подходящего эксперта", description: "Сформулируйте запрос и посмотрите специалистов, которые могут помочь с текущей задачей.", source: "Рекомендация программы", section: "matching" });
    if (membership.modules.pitchy_artifacts) rows.push({ id: "artifact", title: "Подготовить следующий артефакт", description: "Вернитесь к программе и оформите результат текущего этапа в Pitchy.", source: "Рекомендация программы", section: "program" });
    return rows.filter((row) => !hiddenRecommendations.includes(row.id)).slice(0, 3);
  }, [hiddenRecommendations, membership.modules, membership.project, tracking.tasks]);

  const completedStages = stages.filter((stage) => stage.state === "completed").length;
  const progress = stages.length ? Math.round((completedStages / stages.length) * 100) : 0;
  const currentStage = stages.find((stage) => stage.state === "available");
  const latestFeedback = tracking.feedback.slice(0, 2);

  if (loading) return <section className="workspace-card grid min-h-64 place-items-center" aria-label="Загрузка страницы Сегодня"><Loader2 className="animate-spin text-white/35" /></section>;

  return <div className="space-y-5" data-testid="resident-today">
    <section className="workspace-card overflow-hidden !p-0">
      <div className="grid gap-5 bg-gradient-to-br from-white/[0.075] via-white/[0.025] to-transparent p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div><p className="text-xs uppercase tracking-[.18em] text-white/35">{formatToday(membership.cohort.timezone)}</p><h2 className="mt-3 text-3xl sm:text-4xl">Сегодня</h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/45">Главное по потоку «{membership.cohort.name}»: обязательные действия, ближайшие события и следующий шаг проекта.</p></div>
        <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3"><Target size={19} className="text-white/40" /><div><p className="text-xs text-white/35">Обязательных действий</p><p className="text-2xl">{requiredActions.length}</p></div></div>
      </div>
    </section>

    {unavailable.length > 0 && <div role="status" className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] px-4 py-3 text-sm text-amber-100/70"><AlertCircle size={15} className="mr-2 inline" />Часть данных временно недоступна: {unavailable.join(", ")}. Остальные блоки продолжают работать.</div>}

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,.85fr)]">
      <div className="space-y-5">
        <DashboardPanel icon={AlertCircle} title="Требует действия" count={requiredActions.length}>
          {requiredActions.length ? <div className="space-y-3">{requiredActions.map((card) => <TodayActionCard key={card.id} card={card} onOpen={onNavigate} />)}</div> : <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.045] p-5"><CheckCircle2 size={20} className="text-emerald-300" /><p className="mt-3">Обязательные дела выполнены</p><p className="mt-1 text-sm text-white/40">Можно продолжить текущий этап или выбрать рекомендацию ниже.</p>{currentStage && <button type="button" onClick={() => onNavigate("program")} className="mt-4 inline-flex items-center gap-2 text-sm text-white/65 hover:text-white">Продолжить «{currentStage.title}» <ArrowRight size={14} /></button>}</div>}
        </DashboardPanel>

        {latestFeedback.length > 0 && <DashboardPanel icon={MessageCircle} title="Обратная связь">
          <div className="space-y-3">{latestFeedback.map((row) => <button key={row.id} type="button" onClick={() => onNavigate("tracking")} className="block w-full rounded-2xl border border-white/8 bg-black/20 p-4 text-left transition hover:border-white/20"><p className="text-sm leading-relaxed text-white/70">{row.body}</p><p className="mt-3 text-xs text-white/35">{row.author.name} · {formatDateTime(row.created_at, membership.cohort.timezone)}</p></button>)}</div>
        </DashboardPanel>}
      </div>

      <div className="space-y-5">
        <DashboardPanel icon={CalendarClock} title="Ближайшее">
          {upcoming.length ? <div className="space-y-2">{upcoming.map((card) => <button key={card.id} type="button" onClick={() => onNavigate(card.section)} className="flex w-full items-start gap-3 rounded-2xl border border-white/8 p-4 text-left transition hover:border-white/20"><Clock3 size={16} className="mt-0.5 shrink-0 text-white/35" /><span className="min-w-0"><span className="block text-sm">{card.title}</span><span className="mt-1 block text-xs text-white/35">{card.meta}{card.description ? ` · ${card.description}` : ""}</span></span></button>)}</div> : <p className="text-sm text-white/35">Нет ближайших событий и дедлайнов.</p>}
        </DashboardPanel>

        <DashboardPanel icon={Gauge} title="Прогресс">
          <div className="flex items-end justify-between gap-4"><div><p className="text-3xl">{progress}%</p><p className="mt-1 text-xs text-white/35">{completedStages} из {stages.length || 0} этапов</p></div>{membership.project && <div className="text-right"><p className="text-lg">{membership.project.readiness_index}%</p><p className="mt-1 text-xs text-white/35">паспорт проекта</p></div>}</div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${progress}%` }} /></div>
          {currentStage && <button type="button" onClick={() => onNavigate("program")} className="mt-4 flex w-full items-center justify-between text-left text-sm text-white/60 hover:text-white"><span className="truncate">Сейчас: {currentStage.title}</span><ArrowRight size={14} /></button>}
        </DashboardPanel>

        {membership.modules.progress_tracking && <DashboardPanel icon={LifeBuoy} title="Поддержка">
          <p className="text-sm leading-relaxed text-white/45">Расскажите о прогрессе, сложностях или помощи, которая нужна от команды потока.</p><button type="button" onClick={() => onNavigate("tracking")} className="workspace-button mt-4 !bg-transparent !text-white"><MessageCircle size={15} /> Открыть трекинг</button>
        </DashboardPanel>}
      </div>
    </div>

    {recommendations.length > 0 && <DashboardPanel icon={Sparkles} title="Можно улучшить" subtitle="Добровольные шаги для развития проекта — они не влияют на обязательный прогресс.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{recommendations.map((recommendation) => <article key={recommendation.id} className="relative flex min-h-48 flex-col rounded-2xl border border-white/8 bg-white/[0.018] p-5"><button type="button" onClick={() => setHiddenRecommendations((rows) => [...rows, recommendation.id])} className="absolute right-3 top-3 rounded-full p-2 text-white/25 hover:bg-white/5 hover:text-white" aria-label={`Скрыть рекомендацию «${recommendation.title}»`}><X size={14} /></button><Compass size={19} className="text-white/35" /><p className="mt-4 pr-7 text-lg">{recommendation.title}</p><p className="mt-2 flex-1 text-sm leading-relaxed text-white/40">{recommendation.description}</p><p className="mt-4 text-[11px] uppercase tracking-[.12em] text-white/25">{recommendation.source}</p>{recommendation.href ? <Link href={recommendation.href} className="mt-4 inline-flex items-center gap-2 text-sm text-white/65 hover:text-white">Открыть <ArrowRight size={14} /></Link> : recommendation.section ? <button type="button" onClick={() => onNavigate(recommendation.section!)} className="mt-4 inline-flex items-center gap-2 self-start text-sm text-white/65 hover:text-white">Открыть <ArrowRight size={14} /></button> : null}</article>)}</div>
    </DashboardPanel>}
  </div>;
}

function DashboardPanel({ icon: Icon, title, subtitle, count, children }: { icon: typeof BookOpenCheck; title: string; subtitle?: string; count?: number; children: React.ReactNode }) {
  return <section className="workspace-card"><div className="mb-5 flex items-start justify-between gap-4"><div><h3 className="flex items-center gap-2 text-xl"><Icon size={18} className="text-white/40" />{title}</h3>{subtitle && <p className="mt-2 text-sm text-white/35">{subtitle}</p>}</div>{typeof count === "number" && <span className="rounded-full border border-white/8 px-2.5 py-1 text-xs text-white/40">{count}</span>}</div>{children}</section>;
}

function TodayActionCard({ card, onOpen }: { card: WorkCard; onOpen: (section: ResidentSection) => void }) {
  const tone = card.tone === "urgent" ? "border-red-400/20 bg-red-400/[0.045]" : card.tone === "warning" ? "border-amber-300/20 bg-amber-300/[0.045]" : "border-white/9 bg-black/20";
  const Icon = card.section === "homework" ? FilePenLine : card.section === "program" ? BookOpenCheck : Target;
  return <button type="button" onClick={() => onOpen(card.section)} className={`group flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition hover:border-white/25 ${tone}`}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06]"><Icon size={17} className="text-white/55" /></span><span className="min-w-0 flex-1"><span className="block">{card.title}</span>{card.description && <span className="mt-1 block text-sm leading-relaxed text-white/40">{card.description}</span>}{card.meta && <span className={`mt-3 block text-xs ${card.tone === "urgent" ? "text-red-200" : card.tone === "warning" ? "text-amber-200" : "text-white/30"}`}>{card.meta}</span>}</span><ArrowRight size={15} className="mt-2 shrink-0 text-white/25 transition group-hover:translate-x-0.5 group-hover:text-white/70" /></button>;
}
