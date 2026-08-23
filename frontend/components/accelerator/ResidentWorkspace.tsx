"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Banknote, CalendarDays, Check, Clock3, ExternalLink, FileText, GitBranch, Loader2, LockKeyhole, MapPin, MessageSquare, Rocket, Send, Users } from "lucide-react";

import { describeApiError, getAuthJson, postAuthJson } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { ResidentTracking } from "@/components/accelerator/ResidentTracking";

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

export function ResidentWorkspace({ acceleratorId, data }: { acceleratorId: number; data: ResidentWorkspaceData | null }) {
  const memberships = (data?.memberships || []).filter((membership) => membership.accelerator.id === acceleratorId);
  if (!memberships.length) {
    return <section className="workspace-card py-12 text-center"><Rocket className="mx-auto mb-4 text-white/30" /><h2 className="text-2xl">Участие не найдено</h2><p className="mt-3 text-white/40">Обновите страницу или обратитесь к организатору потока.</p></section>;
  }

  return <div className="space-y-7">{memberships.map((membership) => <MembershipView key={membership.membership_id} membership={membership} quotas={data?.effective_quotas || {}} />)}</div>;
}

function MembershipView({ membership, quotas }: { membership: ResidentMembership; quotas: Record<string, ResidentQuota> }) {
  const enrolled = membership.status === "enrolled";
  const [section, setSection] = useState<"overview" | "program" | "homework" | "events" | "tracking">("overview");
  const startsAt = formatDate(membership.cohort.starts_at);
  const endsAt = formatDate(membership.cohort.ends_at);

  return (
    <>
      <section className="workspace-card overflow-hidden !p-0">
        <div className="border-b border-white/8 bg-gradient-to-br from-white/[0.07] to-transparent p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="mb-2 text-xs uppercase tracking-[.18em] text-white/35">{membership.accelerator.name}</p><h2 className="text-3xl sm:text-4xl">{membership.cohort.name}</h2><p className="mt-3 text-sm text-white/45">{startsAt && endsAt ? `${startsAt} — ${endsAt}` : startsAt ? `Начало ${startsAt}` : "Даты уточняются организатором"}</p></div>
            <span className={`rounded-full px-3 py-1.5 text-sm ${enrolled ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}>{enrolled ? "Зачислен" : membership.status === "accepted" ? "Принят" : membership.status}</span>
          </div>
        </div>
        {!enrolled && <div className="flex gap-3 p-6 text-sm text-white/55"><Clock3 className="mt-0.5 shrink-0 text-amber-300" size={19} /><div><h3 className="mb-1 text-white">Ожидается зачисление</h3><p>Заявка уже одобрена. Организатор завершит зачисление, после чего здесь появятся программа и лимиты Pitchy.</p></div></div>}
      </section>

      {enrolled && <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Разделы программы резидента"><ResidentTab active={section === "overview"} onClick={() => setSection("overview")}>Обзор</ResidentTab><ResidentTab active={section === "program"} onClick={() => setSection("program")}>Программа</ResidentTab>{membership.modules.homework && <ResidentTab active={section === "homework"} onClick={() => setSection("homework")}>Домашние задания</ResidentTab>}{membership.modules.attendance && <ResidentTab active={section === "events"} onClick={() => setSection("events")}>Мероприятия</ResidentTab>}{membership.modules.progress_tracking && <ResidentTab active={section === "tracking"} onClick={() => setSection("tracking")}>Трекинг</ResidentTab>}</nav>}

      {enrolled && section === "overview" && membership.project && <section className="workspace-card"><div className="flex flex-wrap items-center justify-between gap-5"><div className="min-w-0"><p className="mb-2 text-xs uppercase tracking-[.18em] text-white/35">Проект резидента</p><h2 className="truncate text-2xl">{membership.project.name}</h2><div className="mt-4 h-2 w-full max-w-sm overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.max(0, Math.min(100, membership.project.readiness_index))}%` }} /></div><p className="mt-2 text-xs text-white/40">Паспорт заполнен на {membership.project.readiness_index}%</p></div><Link href={`/passport/${membership.project.id}`} className="workspace-button"><FileText size={16} /> Открыть паспорт</Link></div></section>}

      {enrolled && section === "overview" && <section className="workspace-card"><h2 className="mb-5 text-xl">Лимиты Pitchy</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(QUOTA_META).map(([resource, meta]) => { const quota = quotas[resource]; const Icon = meta.icon; const appliesHere = quota?.membership_id === membership.membership_id; return <article key={resource} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4"><Icon size={18} className="mb-4 text-white/40" /><p className="text-sm text-white/45">{meta.label}</p><p className="mt-1 text-2xl">{appliesHere ? quota.limit === -1 ? "∞" : quota.remaining : "—"}</p><p className="mt-1 text-xs text-white/30">{appliesHere ? quota.limit === -1 ? "Без ограничений" : `из ${quota.limit}, использовано ${quota.used}` : "Не назначено этому потоку"}</p></article>; })}</div></section>}

      {enrolled && section === "program" && <ResidentProgram membershipId={membership.membership_id} />}

      {enrolled && section === "homework" && membership.modules.homework && <ResidentHomework membershipId={membership.membership_id} />}

      {enrolled && section === "events" && membership.modules.attendance && <ResidentEvents membershipId={membership.membership_id} />}

      {enrolled && section === "tracking" && membership.modules.progress_tracking && <ResidentTracking membershipId={membership.membership_id} />}

      {enrolled && section === "overview" && <section className="workspace-card"><h2 className="mb-5 text-xl">Инструменты проекта</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Action href="/dashboard?tab=chat" label="Чат с аналитиком" icon={MessageSquare} /><Action href="/dashboard?tab=tree" label="Дорожная карта" icon={GitBranch} /><Action href="https://custdev.pitchy.pro/" label="Кастдев" icon={Users} external /><Action href="/grants" label="Гранты" icon={Banknote} /></div></section>}
    </>
  );
}

function ResidentTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`shrink-0 rounded-full border px-4 py-2 text-sm ${active ? "border-white bg-white text-black" : "border-white/10 text-white/50"}`}>{children}</button>;
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
};
type HomeworkAssignment = {
  id: number;
  title: string;
  description: string;
  due_at?: string | null;
  allow_resubmit: boolean;
  is_overdue: boolean;
  submission?: HomeworkSubmission | null;
};

function ResidentHomework({ membershipId }: { membershipId: number }) {
  const { token } = useAuth();
  const [assignments, setAssignments] = useState<HomeworkAssignment[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [links, setLinks] = useState<Record<number, string>>({});
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
      setLinks(Object.fromEntries(rows.map((row) => [row.id, (row.submission?.attachments || []).join("\n")])));
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
        attachments: (links[assignmentId] || "").split("\n").map((item) => item.trim()).filter(Boolean),
      }, token);
      await load();
    } catch (reason) { setError(describeApiError(reason, "Не удалось отправить ответ")); }
    finally { setBusy(null); }
  };

  return (
    <section className="workspace-card"><div className="mb-5"><h2 className="text-xl">Домашние задания</h2><p className="mt-1 text-sm text-white/40">Ответ можно дополнять после комментария организатора.</p></div>{error && <p role="alert" className="mb-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}{loading ? <Loader2 className="mx-auto animate-spin text-white/40" /> : !assignments.length ? <p className="py-5 text-center text-sm text-white/35">Опубликованных заданий пока нет.</p> : <div className="space-y-4">{assignments.map((assignment) => {
      const submission = assignment.submission;
      const canSubmit = !submission || submission.status === "needs_revision" || (assignment.allow_resubmit && submission.status !== "accepted");
      return <article key={assignment.id} className="rounded-2xl border border-white/9 bg-white/[0.02] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg">{assignment.title}</h3>{assignment.due_at && <p className={`mt-1 text-xs ${assignment.is_overdue ? "text-red-300" : "text-white/35"}`}><Clock3 size={12} className="mr-1 inline" />До {new Date(assignment.due_at).toLocaleString("ru-RU")}</p>}</div>{submission && <span className={`rounded-full px-2 py-1 text-xs ${submission.status === "accepted" ? "bg-emerald-400/10 text-emerald-300" : submission.status === "needs_revision" ? "bg-amber-400/10 text-amber-200" : "bg-white/7 text-white/50"}`}>{submission.status === "accepted" ? "Зачтено" : submission.status === "needs_revision" ? "На доработке" : "Отправлено"}</span>}</div><p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-white/55">{assignment.description}</p>{submission?.review_comment && <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-4"><p className="text-xs uppercase tracking-[.14em] text-amber-200/60">Комментарий организатора</p><p className="mt-2 text-sm text-white/60">{submission.review_comment}</p></div>}{submission && <p className="mt-3 text-xs text-white/30">Попытка {submission.attempt_count}{submission.is_late ? " · отправлено после дедлайна" : ""}</p>}{canSubmit && <div className="mt-5 space-y-3"><textarea value={answers[assignment.id] || ""} onChange={(event) => setAnswers({ ...answers, [assignment.id]: event.target.value })} rows={5} placeholder="Ваш ответ и основные выводы" className="workspace-input resize-y" /><textarea value={links[assignment.id] || ""} onChange={(event) => setLinks({ ...links, [assignment.id]: event.target.value })} rows={2} placeholder={"Ссылки на материалы — по одной на строку"} className="workspace-input resize-y" /><div className="flex justify-end"><button onClick={() => void submit(assignment.id)} disabled={busy === assignment.id} className="workspace-button">{busy === assignment.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {submission ? "Отправить повторно" : "Отправить ответ"}</button></div></div>}</article>;
    })}</div>}</section>
  );
}
