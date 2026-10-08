"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "@/lib/hooks/useAuth";
import AudienceSimulationReport, { type AudienceReport } from "@/components/audience-simulation/AudienceSimulationReport";
import type { AudienceLanguage } from "@/app/audience-simulation/operator/audience-operator-copy";

type Participant = { campaign_name: string; campaign_badge: string; run_id: number; event_score: number | null; score_version: string | null; reward_status: string; competition_enabled: boolean; score_status: "not_in_competition" | "eligible" | "insufficient_answers"; min_valid_responses: number };
type OwnResult = { idea: string; aggregate: { valid_responses?: number; averages?: Record<string, number | null> } | null; summary: { headline?: string; observations?: string[]; next_checks?: string[]; extended_report?: AudienceReport } | null; evidence: Array<{ url: string; title: string; domain: string }> };

export default function AudienceCampaignResultPage() {
  const { code } = useParams<{ code: string }>();
  const auth = useAuth();
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [result, setResult] = useState<OwnResult | null>(null);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState<AudienceLanguage>("ru");
  const english = language === "en";

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("lang") === "en") setLanguage("en");
  }, []);

  useEffect(() => {
    const previousLanguage = document.documentElement.lang || "ru";
    document.documentElement.lang = language;
    return () => { document.documentElement.lang = previousLanguage; };
  }, [language]);

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    let active = true;
    void Promise.all([
        fetch(`/api/audience-simulations/events/${encodeURIComponent(code)}/me`, { credentials: "include" }).then(async (response) => {
        const data = await response.json(); if (!response.ok) throw new Error(english ? "Could not open campaign details." : data.detail || "Не удалось открыть отметку кампании"); return data as Participant;
      }),
      fetch(`/api/audience-simulations/events/${encodeURIComponent(code)}/me/result`, { credentials: "include" }).then(async (response) => {
        const data = await response.json(); if (!response.ok) throw new Error(english ? "Could not open the result." : data.detail || "Не удалось открыть результат"); return data as OwnResult;
      }),
    ]).then(([who, report]) => { if (active) { setParticipant(who); setResult(report); } })
      .catch((reason: unknown) => { if (active) setError(english ? "Could not open the result. Please try again." : reason instanceof Error ? reason.message : "Не удалось открыть результат"); });
    return () => { active = false; };
  }, [auth.isAuthenticated, code, english]);

  if (!auth.isLoaded) return <main className="grid min-h-[100dvh] place-items-center bg-[#09090c] text-white"><LoaderCircle className="animate-spin" /></main>;
  if (!auth.isAuthenticated) return <main className="grid min-h-[100dvh] place-items-center bg-[#09090c] px-5 text-white"><section className="max-w-md text-center"><h1 className="text-3xl">{english ? "Sign in to view your result" : "Войдите, чтобы открыть свой результат"}</h1><Link className="mt-6 inline-block rounded-full bg-white px-6 py-3 text-sm text-black" href={`/login?next=${encodeURIComponent(`/audience-simulation/events/${code}${english ? "?lang=en" : ""}`)}`}>{english ? "Sign in to Pitchy" : "Войти в Pitchy"}</Link></section></main>;

  return <main className="min-h-[100dvh] bg-[#09090c] px-5 py-10 text-white"><div className="mx-auto max-w-3xl">
    <p className="text-xs uppercase tracking-[.2em] text-sky-200/60">{english ? "Audience simulation" : participant?.campaign_badge || "Форумная кампания"}</p>
    <h1 className="mt-4 text-4xl tracking-tight">{english ? "Your result" : participant?.campaign_name || "Ваш результат"}</h1>
    <Link href={`/audience-simulation/operator/${encodeURIComponent(code)}?home=1${english ? "&lang=en" : ""}`} className="mt-6 inline-flex items-center rounded-full border border-white/15 px-5 py-3 text-sm text-white/75 transition hover:border-white/35 hover:text-white">{english ? "Back to the stand home" : "Вернуться на главный экран стенда"}</Link>
    {error && <p role="alert" className="mt-6 rounded-xl border border-rose-200/20 bg-rose-200/5 p-4 text-sm text-rose-100">{error}</p>}
    {!result && !error && <div className="grid min-h-[40vh] place-items-center"><LoaderCircle className="animate-spin text-sky-100" /></div>}
    {result && <>
      <p className="mt-5 rounded-2xl border border-white/10 bg-white/[.025] p-5 text-sm leading-6 text-white/65">{result.idea}</p>
      {participant && <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-white/10 p-5"><p className="text-xs text-white/35">{english ? "Competition score" : "Балл конкурса"}</p><p className="mt-2 text-4xl">{!participant.competition_enabled ? (english ? "Not in competition" : "Без конкурса") : participant.event_score == null ? (english ? "Not eligible" : "Не допущен") : `${participant.event_score} / 100`}</p>{participant.score_version && <p className="mt-2 text-xs text-white/30">{english ? "Scoring formula" : "Формула"} {participant.score_version}</p>}{participant.competition_enabled && participant.score_status === "insufficient_answers" && <p className="mt-2 text-xs text-white/45">{english ? `At least ${participant.min_valid_responses} valid responses are required` : `Нужно не менее ${participant.min_valid_responses} валидных ответов`}</p>}</div><div className="rounded-2xl border border-white/10 p-5"><p className="text-xs text-white/35">{english ? "Gift subscription" : "Подарочная подписка"}</p><p className="mt-2 text-lg">{participant.reward_status === "issued" ? (english ? "Issued" : "Выдана") : participant.reward_status === "selected" ? (english ? "Pending confirmation" : "Ожидает подтверждения") : (english ? "The organizers have not decided yet" : "Решение организаторов ещё не принято")}</p></div></div>}
      {result.summary?.headline && <h2 className="mt-8 text-2xl">{result.summary.headline}</h2>}
      <p className="mt-3 text-sm text-white/35">{english ? "Valid responses" : "Валидных ответов"}: {result.aggregate?.valid_responses ?? 0}.</p>
      <div className="mt-6 space-y-3">{(result.summary?.observations || []).map((item) => <p key={item} className="border-l-2 border-sky-200/50 px-4 py-2 text-sm leading-6 text-white/65">{item}</p>)}</div>
      <AudienceSimulationReport report={result.summary?.extended_report} language={language} />
      <p className="mt-8 text-xs leading-5 text-white/30">{english ? "This report and analysis were created with artificial intelligence for informational purposes only. They are not investment advice or a call to action." : "Отчёт и аналитика созданы с помощью искусственного интеллекта, носят информационный характер и не являются инвестиционной рекомендацией или призывом к действию."}</p>
    </>}
  </div></main>;
}
