"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Banknote, CalendarDays, Check, Clock3, ExternalLink, FileText, GitBranch, History, Loader2, LockKeyhole, MapPin, MessageSquare, Paperclip, Rocket, Send, Sparkles, Users, X } from "lucide-react";

import { describeApiError, getAuthJson, postAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { ResidentTracking } from "@/components/accelerator/ResidentTracking";
import { MatchmakingWorkspace } from "@/components/accelerator/MatchmakingWorkspace";
import { ProjectAuditWorkspace } from "@/components/accelerator/ProjectAuditWorkspace";
import { DemoDayWorkspace } from "@/components/accelerator/DemoDayWorkspace";
import { ResidentArtifacts } from "@/components/accelerator/ResidentArtifacts";
import { AlumniWorkspace } from "@/components/accelerator/AlumniWorkspace";
import { ResidentToday } from "@/components/accelerator/ResidentToday";

export type ResidentQuota = {
  membership_id: number;
  limit: number;
  used: number;
  remaining: number | null;
  source: "cohort" | "individual";
  starts_at: string;
  ends_at?: string | null;
};

export type ResidentMembership = {
  membership_id: number;
  application_id: number;
  status: string;
  accepted_at: string;
  enrolled_at?: string | null;
  ended_at?: string | null;
  accelerator: { id: number; name: string; description?: string | null; status: string };
  cohort: { id: number; name: string; status: string; timezone: string; starts_at?: string | null; ends_at?: string | null };
  project?: { id: number; name: string; readiness_index: number; status: string } | null;
  modules: Record<string, boolean>;
};

export type ResidentWorkspaceData = {
  memberships: ResidentMembership[];
  effective_quotas: Record<string, ResidentQuota>;
};

type ResidentSection = "today" | "program" | "homework" | "events" | "tracking" | "matching" | "project_audit" | "demo_day" | "tools";
type ResidentNavigationGroup = { key: string; label: string; sections: Array<{ id: ResidentSection; label: string }> };

const QUOTA_META = {
  messages: { label: "Сообщения", icon: MessageSquare },
  roadmaps: { label: "Дорожные карты", icon: GitBranch },
  custdev: { label: "Кастдевы", icon: Users },
  grants: { label: "Заявки на гранты", icon: Banknote },
} as const;

function formatDate(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}

export function ResidentWorkspace({ acceleratorId, data, onChanged }: { acceleratorId: number; data: ResidentWorkspaceData | null; onChanged: () => Promise<void> }) {
  const memberships = (data?.memberships || []).filter((membership) => membership.accelerator.id === acceleratorId);
  if (!memberships.length) {
    return <section className="workspace-card py-12 text-center"><Rocket className="mx-auto mb-4 text-white/30" /><h2 className="text-2xl">Участие не найдено</h2><p className="mt-3 text-white/40">Обновите страницу или обратитесь к организатору потока.</p></section>;
  }

  return <div className="space-y-7">{memberships.map((membership) => <ResidentMembershipView key={membership.membership_id} membership={membership} quotas={data?.effective_quotas || {}} onChanged={onChanged} />)}</div>;
}

export function ResidentMembershipView({ membership, quotas, onChanged }: { membership: ResidentMembership; quotas: Record<string, ResidentQuota>; onChanged: () => Promise<void> }) {
  const { token } = useAuth();
  const enrolled = membership.status === "enrolled";
  const completed = membership.status === "completed";
  const [section, setSection] = useState<ResidentSection>("today");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const startsAt = formatDate(membership.cohort.starts_at);
  const endsAt = formatDate(membership.cohort.ends_at);
  const navigationGroups: ResidentNavigationGroup[] = [
    { key: "today", label: "Сегодня", sections: [{ id: "today" as const, label: "Сегодня" }] },
    { key: "path", label: "Мой путь", sections: [
      { id: "program" as const, label: "Программа" },
      ...(membership.modules.homework ? [{ id: "homework" as const, label: "Домашние задания" }] : []),
      ...(membership.modules.attendance ? [{ id: "events" as const, label: "Календарь" }] : []),
    ] },
    { key: "project", label: membership.project ? "Мой проект" : "Мой профиль", sections: [
      { id: "tools" as const, label: membership.project ? "Проект и инструменты" : "Инструменты" },
      ...(membership.modules.project_audit ? [{ id: "project_audit" as const, label: "Аудит проекта" }] : []),
    ] },
    { key: "support", label: "Поддержка", sections: [
      ...(membership.modules.progress_tracking ? [{ id: "tracking" as const, label: "Трекинг" }] : []),
      ...(membership.modules.matchmaking ? [{ id: "matching" as const, label: "Команда и эксперты" }] : []),
    ] },
    { key: "results", label: "Результаты", sections: [
      ...(membership.modules.demo_day ? [{ id: "demo_day" as const, label: "Демо-день" }] : []),
    ] },
  ].filter((group) => group.sections.length > 0);
  const activeGroup = navigationGroups.find((group) => group.sections.some((item) => item.id === section)) || navigationGroups[0];
  const join = async () => {
    if (!token) return;
    setJoining(true); setJoinError("");
    try {
      await postAuthJson(`/api/accelerators/applications/${membership.application_id}/enroll`, {}, token);
      await onChanged();
    } catch (reason) { setJoinError(describeApiError(reason, "Не удалось подтвердить участие")); }
    finally { setJoining(false); }
  };

  return (
    <>
      <section className="workspace-card overflow-hidden !p-0">
        <div className="border-b border-white/8 bg-gradient-to-br from-white/[0.07] to-transparent p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="mb-2 text-xs uppercase tracking-[.18em] text-white/35">{membership.accelerator.name}</p><h2 className="text-3xl sm:text-4xl">{membership.cohort.name}</h2><p className="mt-3 text-sm text-white/45">{startsAt && endsAt ? `${startsAt} — ${endsAt}` : startsAt ? `Начало ${startsAt}` : "Даты уточняются организатором"}</p></div>
            <span className={`rounded-full px-3 py-1.5 text-sm ${enrolled || completed ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}>{enrolled ? "Зачислен" : completed ? "Выпускник" : membership.status === "accepted" ? "Принят" : membership.status}</span>
          </div>
        </div>
        {membership.status === "accepted" && <div className="p-6"><div className="flex gap-3 text-sm text-white/55"><Clock3 className="mt-0.5 shrink-0 text-amber-300" size={19} /><div><h3 className="mb-1 text-white">Вас приняли в программу</h3><p>Подтвердите участие, чтобы открыть программу и получить назначенные лимиты Pitchy.</p></div></div><button type="button" onClick={() => void join()} disabled={joining} className="workspace-button mt-5">{joining && <Loader2 size={15} className="animate-spin" />} Начать участие</button>{joinError && <p role="alert" className="mt-4 text-sm text-red-200">{joinError}</p>}</div>}
        {membership.status === "suspended" && <div className="flex gap-3 p-6 text-sm text-white/55"><Clock3 className="mt-0.5 shrink-0 text-amber-300" size={19} /><div><h3 className="mb-1 text-white">Участие приостановлено</h3><p>Для восстановления доступа обратитесь к организатору потока.</p></div></div>}
        {membership.status === "withdrawn" && <div className="flex gap-3 p-6 text-sm text-white/55"><Clock3 className="mt-0.5 shrink-0 text-white/35" size={19} /><div><h3 className="mb-1 text-white">Участие завершено</h3><p>Рабочие разделы этого потока больше недоступны.</p></div></div>}
        {completed && <div className="flex gap-3 p-6 text-sm text-white/55"><Check className="mt-0.5 shrink-0 text-emerald-300" size={19} /><div><h3 className="mb-1 text-white">Программа завершена</h3><p>Итоговый снимок результатов сохранён. Публикация профиля выпускника остаётся полностью добровольной.</p></div></div>}
      </section>

      {enrolled && <div className="space-y-3">
        <nav className="grid grid-cols-2 gap-2 sm:flex sm:overflow-x-auto" aria-label="Основные разделы кабинета участника">{navigationGroups.map((group) => <ResidentTab key={group.key} active={activeGroup.key === group.key} onClick={() => setSection(group.sections[0].id)}>{group.label}</ResidentTab>)}</nav>
        {activeGroup.sections.length > 1 && <nav className="flex gap-2 overflow-x-auto pb-1" aria-label={`Подразделы: ${activeGroup.label}`}>{activeGroup.sections.map((item) => <ResidentSubTab key={item.id} active={section === item.id} onClick={() => setSection(item.id)}>{item.label}</ResidentSubTab>)}</nav>}
      </div>}

      {enrolled && section === "today" && <ResidentToday membership={membership} onNavigate={setSection} />}

      {enrolled && section === "tools" && membership.project && <section className="workspace-card"><div className="flex flex-wrap items-center justify-between gap-5"><div className="min-w-0"><p className="mb-2 text-xs uppercase tracking-[.18em] text-white/35">Проект резидента</p><h2 className="truncate text-2xl">{membership.project.name}</h2><div className="mt-4 h-2 w-full max-w-sm overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.max(0, Math.min(100, membership.project.readiness_index))}%` }} /></div><p className="mt-2 text-xs text-white/40">Паспорт заполнен на {membership.project.readiness_index}%</p></div><Link href={`/passport/${membership.project.id}`} className="workspace-button"><FileText size={16} /> Открыть паспорт</Link></div></section>}

      {enrolled && section === "tools" && <section className="workspace-card"><h2 className="mb-5 text-xl">Лимиты Pitchy</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(QUOTA_META).map(([resource, meta]) => { const quota = quotas[resource]; const Icon = meta.icon; const appliesHere = quota?.membership_id === membership.membership_id; return <article key={resource} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4"><Icon size={18} className="mb-4 text-white/40" /><p className="text-sm text-white/45">{meta.label}</p><p className="mt-1 text-2xl">{appliesHere ? quota.limit === -1 ? "∞" : quota.remaining : "—"}</p><p className="mt-1 text-xs text-white/30">{appliesHere ? quota.limit === -1 ? "Без ограничений" : `из ${quota.limit}, использовано ${quota.used}` : "Не назначено этому потоку"}</p></article>; })}</div></section>}

      {enrolled && section === "program" && <div className="space-y-6"><ResidentProgram membershipId={membership.membership_id} />{membership.modules.pitchy_artifacts && <ResidentArtifacts membershipId={membership.membership_id} />}</div>}

      {enrolled && section === "homework" && membership.modules.homework && <ResidentHomework membershipId={membership.membership_id} />}

      {enrolled && section === "events" && membership.modules.attendance && <ResidentEvents membershipId={membership.membership_id} />}

      {enrolled && section === "tracking" && membership.modules.progress_tracking && <ResidentTracking membershipId={membership.membership_id} />}

      {enrolled && section === "matching" && membership.modules.matchmaking && <MatchmakingWorkspace cohortId={membership.cohort.id} membershipId={membership.membership_id} project={membership.project} />}

      {enrolled && section === "project_audit" && membership.modules.project_audit && <ProjectAuditWorkspace cohortId={membership.cohort.id} membershipId={membership.membership_id} />}

      {enrolled && section === "demo_day" && membership.modules.demo_day && <DemoDayWorkspace cohortId={membership.cohort.id} membershipId={membership.membership_id} />}

      {enrolled && section === "tools" && <section className="workspace-card"><h2 className="mb-5 text-xl">Инструменты проекта</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Action href="/dashboard?tab=chat" label="Чат с аналитиком" icon={MessageSquare} /><Action href="/dashboard?tab=tree" label="Дорожная карта" icon={GitBranch} /><Action href="https://custdev.pitchy.pro/" label="Кастдев" icon={Users} external /><Action href="/grants" label="Гранты" icon={Banknote} /></div></section>}

      {completed && membership.modules.alumni && <AlumniWorkspace membershipId={membership.membership_id} cohortId={membership.cohort.id} />}
    </>
  );
}

function ResidentTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`min-h-11 shrink-0 rounded-2xl border px-5 py-2.5 text-sm transition ${active ? "border-white bg-white text-black" : "border-white/10 bg-white/[0.015] text-white/50 hover:border-white/20 hover:text-white"}`}>{children}</button>;
}

function ResidentSubTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`shrink-0 rounded-full border px-4 py-2 text-sm transition ${active ? "border-white/30 bg-white/10 text-white" : "border-white/8 text-white/40 hover:text-white/70"}`}>{children}</button>;
}

function Action({ href, label, icon: Icon, external }: { href: string; label: string; icon: typeof Rocket; external?: boolean }) {
  const className = "group flex items-center justify-between rounded-2xl border border-white/10 p-4 text-white/65 hover:border-white/25 hover:text-white";
  const content = <><span className="flex items-center gap-3"><Icon size={18} />{label}</span><ArrowUpRight size={16} className="text-white/25 group-hover:text-white/70" /></>;
  return external ? <a href={href} target="_blank" rel="noreferrer" className={className}>{content}</a> : <Link href={href} className={className}>{content}</Link>;
}

type ResidentMaterial = { id: number; title: string; kind: "link" | "video" | "text"; url?: string | null; content?: string | null; required: boolean; completed: boolean };
type ResidentStage = { id: number; title: string; description?: string | null; unlock_at?: string | null; required: boolean; state: "locked" | "available" | "completed"; materials: ResidentMaterial[] };

function ResidentProgram({ membershipId }: { membershipId: number }) {
  const { token } = useAuth();
  const [stages, setStages] = useState<ResidentStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!token) return;
    try { setStages(await getAuthJson<ResidentStage[]>(`/api/accelerators/memberships/${membershipId}/program-stages`, token)); }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить программу")); }
    finally { setLoading(false); }
  }, [membershipId, token]);
  useEffect(() => { void load(); }, [load]);
  const completeMaterial = async (id: number) => { if (!token) return; setBusy(`material-${id}`); try { await postAuthJson(`/api/accelerators/program/materials/${id}/complete`, {}, token); await load(); } catch (reason) { setError(describeApiError(reason, "Не удалось отметить материал")); } finally { setBusy(""); } };
  const completeStage = async (id: number) => { if (!token) return; setBusy(`stage-${id}`); try { await postAuthJson(`/api/accelerators/program/stages/${id}/complete`, {}, token); await load(); } catch (reason) { setError(describeApiError(reason, "Этап пока нельзя завершить")); } finally { setBusy(""); } };
  return <section className="workspace-card"><div className="mb-5"><h2 className="text-xl">Путь по программе</h2><p className="mt-1 text-sm text-white/40">Обязательные этапы открываются последовательно.</p></div>{error && <p role="alert" className="mb-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}{loading ? <Loader2 className="mx-auto animate-spin text-white/40" /> : !stages.length ? <p className="py-5 text-center text-sm text-white/35">Организатор ещё не опубликовал этапы.</p> : <div className="space-y-3">{stages.map((stage, index) => <article key={stage.id} className={`rounded-2xl border p-4 sm:p-5 ${stage.state === "completed" ? "border-emerald-400/20 bg-emerald-400/[0.04]" : stage.state === "locked" ? "border-white/6 bg-white/[0.01] opacity-60" : "border-white/10 bg-white/[0.025]"}`}><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/8 text-sm">{stage.state === "completed" ? <Check size={15} className="text-emerald-300" /> : stage.state === "locked" ? <LockKeyhole size={14} /> : index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg">{stage.title}</h3><span className="text-xs text-white/35">{stage.state === "completed" ? "Завершён" : stage.state === "locked" ? "Закрыт" : "Доступен"}</span></div>{stage.description && <p className="mt-2 whitespace-pre-wrap text-sm text-white/45">{stage.description}</p>}{stage.state === "locked" && stage.unlock_at && <p className="mt-3 text-xs text-white/35">Не раньше {new Date(stage.unlock_at).toLocaleString("ru-RU")}</p>}{stage.state !== "locked" && stage.materials.length > 0 && <div className="mt-4 space-y-2">{stage.materials.map((material) => <div key={material.id} className="rounded-xl border border-white/7 p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm">{material.title}{material.required && <span className="ml-2 text-xs text-white/30">обязательный</span>}</p>{material.kind === "text" && material.content && <details className="mt-2 text-sm text-white/45"><summary className="cursor-pointer">Открыть материал</summary><p className="mt-2 whitespace-pre-wrap">{material.content}</p></details>}{material.url && <a href={material.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-blue-300 underline">Открыть <ExternalLink size={12} /></a>}</div><button onClick={() => void completeMaterial(material.id)} disabled={material.completed || busy === `material-${material.id}`} className={`rounded-full px-3 py-2 text-xs ${material.completed ? "bg-emerald-400/10 text-emerald-300" : "border border-white/10 text-white/55"}`}>{material.completed ? "Изучено" : "Отметить"}</button></div></div>)}</div>}{stage.state === "available" && <div className="mt-4 flex justify-end"><button onClick={() => void completeStage(stage.id)} disabled={busy === `stage-${stage.id}`} className="workspace-button">Завершить этап</button></div>}</div></div></article>)}</div>}</section>;
}

type ResidentEvent = { id: number; title: string; description?: string | null; starts_at: string; ends_at: string; event_format: string; location?: string | null; meeting_url?: string | null; attendance?: { status: string; checked_in_at?: string | null } | null };
function ResidentEvents({ membershipId }: { membershipId: number }) {
  const { token } = useAuth(); const [events, setEvents] = useState<ResidentEvent[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { if (!token) return; getAuthJson<ResidentEvent[]>(`/api/accelerators/memberships/${membershipId}/events`, token).then(setEvents).catch((reason) => setError(describeApiError(reason, "Не удалось загрузить мероприятия"))).finally(() => setLoading(false)); }, [membershipId, token]);
  return <section className="workspace-card"><h2 className="text-xl">Мероприятия</h2><p className="mt-1 text-sm text-white/40">Для отметки посещения отсканируйте QR-код организатора.</p>{error && <p role="alert" className="mt-4 text-sm text-red-200">{error}</p>}{loading ? <Loader2 className="mx-auto mt-5 animate-spin text-white/40" /> : !events.length ? <p className="py-5 text-sm text-white/35">Опубликованных мероприятий пока нет.</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2">{events.map((event) => <article key={event.id} className="rounded-2xl border border-white/9 bg-white/[0.02] p-4"><div className="flex items-start justify-between gap-3"><CalendarDays size={18} className="text-white/40" />{event.attendance && <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300">{event.attendance.status === "present" ? "Посещение отмечено" : event.attendance.status}</span>}</div><h3 className="mt-4">{event.title}</h3><p className="mt-2 text-sm text-white/45">{new Date(event.starts_at).toLocaleString("ru-RU")}</p>{event.location && <p className="mt-2 text-sm text-white/40"><MapPin size={13} className="mr-1 inline" />{event.location}</p>}{event.meeting_url && <a href={event.meeting_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-blue-300 underline">Подключиться <ExternalLink size={13} /></a>}</article>)}</div>}</section>;
}

type HomeworkSubmission = {
  id: number;
  answer_text?: string | null;
  attachments: string[];
  status: "submitted" | "needs_revision" | "accepted";
  attempt_count: number;
  submitted_at: string;
  review_comment?: string | null;
  is_late: boolean;
  score?: number | null;
  passed?: boolean | null;
};
type HomeworkAssignment = {
  id: number;
  cohort_id: number;
  title: string;
  description: string;
  due_at?: string | null;
  allow_resubmit: boolean;
  is_overdue: boolean;
  submission?: HomeworkSubmission | null;
  assignment_type: "text_files" | "quiz";
  submission_mode: "individual" | "team";
  quiz_questions: Array<{ id: string; prompt: string; options: Array<{ id: string; label: string }> }>;
  passing_score?: number | null;
  max_attempts: number;
  display_status: "not_started" | "review_pending" | "needs_revision" | "accepted" | "overdue";
  pitchy_enabled: boolean;
  pitchy_tools: PitchyTool[];
};
type PitchyTool = "chat" | "research" | "roadmap" | "custdev" | "grants" | "presentation";
type HomeworkAttempt = { id: number; attempt_number: number; score?: number | null; passed?: boolean | null; review_status?: string | null; review_comment?: string | null; created_at: string; quiz_results: Array<{ question_id: string; prompt: string; selected_option_label?: string | null; correct_option_label?: string | null; correct: boolean }> };
const HOMEWORK_STATUS: Record<HomeworkAssignment["display_status"], string> = { not_started: "Не начато", review_pending: "На проверке", needs_revision: "На доработке", accepted: "Принято", overdue: "Просрочено" };
const HOMEWORK_STATUS_STYLE: Record<HomeworkAssignment["display_status"], string> = { not_started: "bg-white/7 text-white/50", review_pending: "bg-blue-400/10 text-blue-200", needs_revision: "bg-amber-400/10 text-amber-200", accepted: "bg-emerald-400/10 text-emerald-300", overdue: "bg-red-400/10 text-red-200" };
const PITCHY_TOOL_LINKS: Record<PitchyTool, { label: string; href: string }> = {
  chat: { label: "Чат", href: "/dashboard?tab=chat" },
  research: { label: "Исследование", href: "/dashboard?tab=chat&mode=research" },
  roadmap: { label: "Дорожная карта", href: "/dashboard?tab=tree" },
  custdev: { label: "CustDev", href: "https://custdev.pitchy.pro/" },
  grants: { label: "Гранты", href: "/grants" },
  presentation: { label: "Презентация", href: "/dashboard?tab=chat" },
};

function ResidentHomework({ membershipId }: { membershipId: number }) {
  const { token } = useAuth();
  const [assignments, setAssignments] = useState<HomeworkAssignment[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [files, setFiles] = useState<Record<number, string[]>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<number, Record<string, string>>>({});
  const [attempts, setAttempts] = useState<Record<number, HomeworkAttempt[]>>({});
  const [openHistory, setOpenHistory] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const rows = await getAuthJson<HomeworkAssignment[]>(`/api/accelerators/memberships/${membershipId}/homework`, token);
      setAssignments(rows);
      setAnswers(Object.fromEntries(rows.map((row) => [row.id, row.submission?.answer_text || ""])));
      setFiles(Object.fromEntries(rows.map((row) => [row.id, row.submission?.attachments || []])));
    } catch (reason) { setError(describeApiError(reason, "Не удалось загрузить домашние задания")); }
    finally { setLoading(false); }
  }, [membershipId, token]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (assignmentId: number) => {
    if (!token) return;
    setBusy(assignmentId); setError("");
    try {
      await postAuthJson(`/api/accelerators/homework/${assignmentId}/submission`, {
        answer_text: answers[assignmentId] || null,
        attachments: files[assignmentId] || [],
        quiz_answers: quizAnswers[assignmentId] || {},
      }, token);
      await load();
    } catch (reason) { setError(describeApiError(reason, "Не удалось отправить ответ")); }
    finally { setBusy(null); }
  };

  const upload = async (assignment: HomeworkAssignment, selected: FileList | null) => {
    if (!token || !selected?.length) return;
    setBusy(assignment.id); setError("");
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(selected)) {
        const body = new FormData(); body.append("file", file);
        const response = await fetch(`/api/accelerators/cohorts/${assignment.cohort_id}/homework-files`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Не удалось загрузить файл");
        uploaded.push(data.url);
      }
      setFiles((current) => ({ ...current, [assignment.id]: [...(current[assignment.id] || []), ...uploaded].slice(0, 10) }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить файл"); }
    finally { setBusy(null); }
  };

  const toggleHistory = async (submissionId: number) => {
    if (!token) return;
    if (openHistory === submissionId) { setOpenHistory(null); return; }
    setOpenHistory(submissionId); setError("");
    try {
      const rows = await getAuthJson<HomeworkAttempt[]>(`/api/accelerators/homework/submissions/${submissionId}/attempts`, token);
      setAttempts((current) => ({ ...current, [submissionId]: rows }));
    }
    catch (reason) { setError(describeApiError(reason, "Не удалось загрузить историю попыток")); }
  };

  return (
    <section className="workspace-card"><div className="mb-5"><h2 className="text-xl">Домашние задания</h2><p className="mt-1 text-sm text-white/40">Ответ можно дополнять после комментария организатора.</p></div>{error && <p role="alert" className="mb-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}{loading ? <Loader2 className="mx-auto animate-spin text-white/40" /> : !assignments.length ? <p className="py-5 text-center text-sm text-white/35">Опубликованных заданий пока нет.</p> : <div className="space-y-4">{assignments.map((assignment) => {
      const submission = assignment.submission;
      const canSubmit = !submission || submission.status === "needs_revision" || (assignment.allow_resubmit && submission.status !== "accepted" && (assignment.assignment_type !== "quiz" || submission.attempt_count < assignment.max_attempts));
      return <article key={assignment.id} className="rounded-2xl border border-white/9 bg-white/[0.02] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-2 flex flex-wrap gap-2"><span className="rounded-full bg-white/7 px-2 py-1 text-xs text-white/45">{assignment.assignment_type === "quiz" ? "Тест" : "Текст или файлы"}</span>{assignment.submission_mode === "team" && <span className="rounded-full bg-blue-400/10 px-2 py-1 text-xs text-blue-200">Командное</span>}{assignment.pitchy_enabled && <span className="rounded-full bg-violet-400/10 px-2 py-1 text-xs text-violet-200"><Sparkles size={11} className="mr-1 inline" />Можно выполнить в Pitchy</span>}</div><h3 className="text-lg">{assignment.title}</h3>{assignment.due_at && <p className={`mt-1 text-xs ${assignment.is_overdue ? "text-red-300" : "text-white/35"}`}><Clock3 size={12} className="mr-1 inline" />До {new Date(assignment.due_at).toLocaleString("ru-RU")}</p>}</div><span className={`rounded-full px-2 py-1 text-xs ${HOMEWORK_STATUS_STYLE[assignment.display_status]}`}>{HOMEWORK_STATUS[assignment.display_status]}</span></div><p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-white/55">{assignment.description}</p>{assignment.pitchy_enabled && <div className="mt-4 flex flex-wrap gap-2">{assignment.pitchy_tools.map((tool) => <Link key={tool} href={PITCHY_TOOL_LINKS[tool].href} target={tool === "custdev" ? "_blank" : undefined} className="rounded-full border border-violet-300/20 px-3 py-1.5 text-xs text-violet-200">Открыть: {PITCHY_TOOL_LINKS[tool].label} <ArrowUpRight size={11} className="inline" /></Link>)}</div>}{submission?.review_comment && <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-4"><p className="text-xs uppercase tracking-[.14em] text-amber-200/60">Комментарий трекера</p><p className="mt-2 text-sm text-white/60">{submission.review_comment}</p></div>}{submission && <div className="mt-3"><p className="text-xs text-white/30">Попытка {submission.attempt_count}{submission.score != null ? ` · результат ${submission.score}%` : ""}{submission.is_late ? " · отправлено после дедлайна" : ""}</p><button type="button" onClick={() => void toggleHistory(submission.id)} className="mt-2 inline-flex items-center gap-1 text-xs text-white/45"><History size={12} />История попыток</button>{openHistory === submission.id && <div className="mt-3 space-y-2">{(attempts[submission.id] || []).map((attempt) => <div key={attempt.id} className="rounded-xl bg-black/25 p-3"><p className="text-xs text-white/55">Попытка {attempt.attempt_number}{attempt.score != null ? ` · ${attempt.score}%` : ""}</p>{attempt.review_comment && <p className="mt-1 text-xs text-white/40">Комментарий: {attempt.review_comment}</p>}{attempt.quiz_results.map((result) => <p key={result.question_id} className={`mt-1 text-xs ${result.correct ? "text-emerald-300" : "text-amber-200"}`}>{result.correct ? "✓" : "×"} {result.prompt}: {result.selected_option_label || "нет ответа"}{!result.correct && result.correct_option_label ? ` · верно: ${result.correct_option_label}` : ""}</p>)}</div>)}</div>}</div>}{canSubmit && <div className="mt-5 space-y-3">{assignment.assignment_type === "quiz" ? <div className="space-y-4">{assignment.quiz_questions.map((question, index) => <fieldset key={question.id} className="rounded-2xl border border-white/8 p-4"><legend className="px-2 text-sm text-white/70">{index + 1}. {question.prompt}</legend><div className="mt-2 space-y-2">{question.options.map((option) => <label key={option.id} className="flex items-center gap-3 rounded-xl bg-white/[0.025] p-3 text-sm text-white/60"><input type="radio" name={`answer-${assignment.id}-${question.id}`} checked={quizAnswers[assignment.id]?.[question.id] === option.id} onChange={() => setQuizAnswers((current) => ({ ...current, [assignment.id]: { ...(current[assignment.id] || {}), [question.id]: option.id } }))} />{option.label}</label>)}</div></fieldset>)}</div> : <><textarea value={answers[assignment.id] || ""} onChange={(event) => setAnswers({ ...answers, [assignment.id]: event.target.value })} rows={5} placeholder="Ваш ответ и основные выводы" className="workspace-input resize-y" /><div className="rounded-2xl border border-dashed border-white/15 p-4"><label className="inline-flex cursor-pointer items-center gap-2 text-sm text-white/65"><Paperclip size={15} />Прикрепить файлы<input type="file" multiple className="sr-only" onChange={(event) => void upload(assignment, event.target.files)} /></label>{(files[assignment.id] || []).map((url, index) => <div key={url} className="mt-2 flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-white/50"><a href={url} target="_blank">Файл {index + 1}</a><button type="button" onClick={() => setFiles((current) => ({ ...current, [assignment.id]: current[assignment.id].filter((item) => item !== url) }))}><X size={13} /></button></div>)}</div></>}<div className="flex justify-end"><button onClick={() => void submit(assignment.id)} disabled={busy === assignment.id} className="workspace-button">{busy === assignment.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {submission ? "Отправить повторно" : "Отправить ответ"}</button></div></div>}</article>;
    })}</div>}</section>
  );
}
