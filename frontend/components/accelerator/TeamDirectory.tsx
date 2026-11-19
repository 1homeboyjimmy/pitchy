"use client";

import { useState, type FormEvent } from "react";
import { ChevronDown, Mail, Search, Send } from "lucide-react";
import { describeApiError, postAuthJson } from "@/lib/api";
import { ResultPages } from "./ResultPages";

export type PoolContact = {
  name: string;
  email: string | null;
  telegram?: string | null;
  profile_id?: number | null;
  bio?: string | null;
  competencies: string[];
  needs?: string[];
  industries?: string[];
  goals?: string[];
};

export type PoolCandidate = PoolContact & {
  membership_id: number;
  institute?: string | null;
  education_course?: string | null;
  current_team?: { id: number; name: string; action: string } | null;
};

export type PoolTeam = {
  id: number;
  name: string;
  max_members: number;
  member_count: number;
  recruiting_open: boolean;
  captain: PoolContact;
  summary: string;
  details: Array<{ label: string; value: string }>;
};

const PAGE_SIZE = 12;
const FILTERS = [["all", "Все"], ["without", "Без команды"], ["with", "В команде"]] as const;
type Filter = typeof FILTERS[number][0];
const SUMMARY = "flex min-w-0 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 focus-visible:outline-2 focus-visible:outline-blue-300 [&::-webkit-details-marker]:hidden";
const CHEVRON = "shrink-0 text-white/50 group-open:rotate-180";

const normalize = (text: string) => text.trim().toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ");
const looksLikeEmail = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());

function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="relative block min-w-0 flex-1">
    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
    <input type="search" aria-label={label} placeholder={label} value={value} onChange={event => onChange(event.target.value)}
      className="workspace-input !py-2 !pl-9" />
  </label>;
}

function ContactLinks({ contact }: { contact: PoolContact }) {
  const telegram = contact.telegram?.replace(/^@/, "");
  return <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-blue-200">
    {contact.email && <a className="inline-flex items-center gap-1.5" href={`mailto:${contact.email}`}><Mail size={13} /> Написать на почту</a>}
    {telegram && /^[A-Za-z0-9_]+$/.test(telegram) && <a href={`https://t.me/${telegram}`} target="_blank" rel="noreferrer">Написать в Telegram</a>}
  </div>;
}

function educationLabel(candidate: PoolCandidate) {
  const course = candidate.education_course?.trim();
  const match = course?.match(/^(БАК|МАГ|СПЕЦ|АСП)-(\d+)$/);
  return [match ? `${match[1]} ${match[2]} курс` : course, candidate.institute?.trim()].filter(Boolean).join(" · ");
}

function CandidateProfileDetails({ candidate }: { candidate: PoolCandidate }) {
  const competencies = Array.isArray(candidate.competencies)
    ? candidate.competencies.filter(value => typeof value === "string").map(value => value.trim()).filter(Boolean)
    : [];
  return <>
    {candidate.current_team && <p>Команда «{candidate.current_team.name}»</p>}
    {candidate.bio && <p className="whitespace-pre-wrap">{candidate.bio}</p>}
    {competencies.length > 0 && <section className="space-y-1" aria-label="Компетенции">
      <h3 className="text-xs font-medium text-white/55">Компетенции</h3>
      <p>{competencies.join(", ")}</p>
    </section>}
    {[["Ищет помощь", candidate.needs], ["Отрасли", candidate.industries], ["Цели", candidate.goals]].map(([label, values]) =>
      Array.isArray(values) && values.length > 0 && <p key={String(label)}><span className="text-white/45">{label}</span> · {values.join(", ")}</p>)}
  </>;
}

export function CandidateDirectory({ candidates, membershipId, token, busy, teamIsFull, invitedIds, onInvite }: {
  candidates: PoolCandidate[];
  membershipId: number;
  token: string | null;
  busy: boolean;
  teamIsFull: boolean;
  invitedIds: Set<number>;
  onInvite: (candidate: PoolCandidate, message: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [lookup, setLookup] = useState<{ email: string; id: number | null } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState("");
  const needle = normalize(query);
  const emailQuery = looksLikeEmail(query);
  const filtered = candidates.filter(candidate => {
    if (filter === "with" && !candidate.current_team || filter === "without" && candidate.current_team) return false;
    return !needle || normalize(candidate.name).includes(needle) || normalize(candidate.email || "").includes(needle)
      || (lookup?.email === needle && lookup.id === candidate.membership_id);
  });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));

  const findEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !emailQuery || lookingUp) return;
    setLookingUp(true);
    setError("");
    try {
      const result = await postAuthJson<{ membership_id: number | null }>(
        `/api/accelerators/memberships/${membershipId}/team-pool/find-by-email`, { email: query.trim() }, token,
      );
      setLookup({ email: needle, id: result.membership_id });
    } catch (reason) {
      setError(describeApiError(reason, "Не удалось выполнить поиск по почте"));
    } finally {
      setLookingUp(false);
    }
  };

  return <section className="workspace-card min-w-0" aria-label="Участники потока">
    <h2 className="text-lg font-medium">Участники потока</h2>
    <form onSubmit={findEmail} className="mt-3 flex flex-wrap gap-2">
      <SearchField label="Имя или email участника" value={query} onChange={value => { setQuery(value); setPage(0); setError(""); }} />
      {emailQuery && <button type="submit" className="workspace-button" disabled={lookingUp}>{lookingUp ? "Ищем…" : "Найти"}</button>}
    </form>
    <div className="mb-3 mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Фильтр по команде">
      {FILTERS.map(([value, label]) => <button type="button" key={value} aria-pressed={value === filter} onClick={() => { setFilter(value); setPage(0); }}
        className={`rounded-full px-3 py-1.5 text-xs ${value === filter ? "bg-white/12 text-white" : "text-white/55 hover:bg-white/6"}`}>{label}</button>)}
    </div>
    {error && <p className="mb-2 text-sm text-red-200" role="alert">{error}</p>}
    {filtered.length ? <div className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/10">
      {filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(candidate => <details className="group" key={candidate.membership_id}>
        <summary className={SUMMARY} aria-label={`Подробнее об участнике ${candidate.name}`}>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="block text-sm font-medium">{candidate.name}</span>
            {educationLabel(candidate) && <span className="mt-0.5 block text-xs text-white/50">{educationLabel(candidate)}</span>}
          </span>
          <ChevronDown size={15} className={CHEVRON} />
        </summary>
        <div className="space-y-2 border-t border-white/8 bg-white/[.025] px-3.5 py-3 text-sm text-white/65 [overflow-wrap:anywhere]">
          <CandidateProfileDetails candidate={candidate} />
          <ContactLinks contact={candidate} />
          {invitedIds.has(candidate.membership_id) ? <p className="text-xs text-emerald-200">Приглашение отправлено</p> : <>
            <textarea aria-label={`Сообщение участнику ${candidate.name}`} value={messages[candidate.membership_id] || ""}
              onChange={event => setMessages(current => ({ ...current, [candidate.membership_id]: event.target.value }))}
              rows={2} maxLength={1000} placeholder="Сообщение к приглашению" className="workspace-input resize-y" />
            <button type="button" onClick={() => void onInvite(candidate, messages[candidate.membership_id] || "")}
              disabled={busy || teamIsFull} className="workspace-button"><Send size={14} /> Пригласить в проект</button>
            {teamIsFull && <p className="text-xs text-white/50">В команде нет свободных мест.</p>}
          </>}
        </div>
      </details>)}
    </div> : <p className="py-3 text-sm text-white/50">{emailQuery && lookup?.email !== needle ? "Нажмите «Найти», чтобы проверить полный email." : "Участники не найдены."}</p>}
    <ResultPages page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
  </section>;
}

export function OpenTeamDirectory({ teams, pendingIds, busy, blocked, messages, onMessageChange, onApply }: {
  teams: PoolTeam[]; pendingIds: Set<number>; busy: boolean; blocked: boolean;
  messages: Record<number, string>; onMessageChange: (teamId: number, value: string) => void; onApply: (teamId: number) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const needle = normalize(query);
  const filtered = teams.filter(team => normalize(`${team.name} ${team.captain.name}`).includes(needle));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  return <div className="mt-3 min-w-0">
    {teams.length > 0 && <SearchField label="Название команды или имя капитана" value={query} onChange={value => { setQuery(value); setPage(0); }} />}
    {filtered.length ? <div className="mt-3 divide-y divide-white/8 overflow-hidden rounded-xl border border-white/10">
      {filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(team => <details className="group" key={team.id}>
        <summary className={SUMMARY} aria-label={`Подробнее о команде ${team.name}`}>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="block text-sm font-medium">{team.name}</span>
            <span className="mt-0.5 block text-xs text-white/50">{team.captain.name}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-white/60">{team.member_count}/{team.max_members}<ChevronDown size={15} className={CHEVRON} /></span>
        </summary>
        <div className="space-y-2.5 border-t border-white/8 bg-white/[.025] px-3.5 py-3 text-sm text-white/65 [overflow-wrap:anywhere]">
          {team.details.length ? team.details.map(item => <p key={item.label}><span className="text-white/45">{item.label}</span> · {item.value}</p>) : team.summary && <p>{team.summary}</p>}
          {!!team.captain.competencies.length && <p><span className="text-white/45">Компетенции капитана</span> · {team.captain.competencies.join(", ")}</p>}
          <ContactLinks contact={team.captain} />
          <textarea value={messages[team.id] || ""} onChange={event => onMessageChange(team.id, event.target.value)}
            rows={2} maxLength={1000} placeholder="Почему хотите присоединиться" className="workspace-input resize-y" />
          <button type="button" onClick={() => void onApply(team.id)} disabled={busy || blocked || pendingIds.has(team.id)} className="workspace-button">
            <Send size={14} />{pendingIds.has(team.id) ? "Заявка отправлена" : "Подать заявку"}
          </button>
        </div>
      </details>)}
    </div> : <p className="py-3 text-sm text-white/50">{teams.length ? "Команды не найдены." : "Открытых команд пока нет."}</p>}
    <ResultPages page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
  </div>;
}
