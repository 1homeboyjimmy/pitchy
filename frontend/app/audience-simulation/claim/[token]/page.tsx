"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { useAuth } from "@/lib/hooks/useAuth";
import AudienceSimulationReport, { type AudienceReport } from "@/components/audience-simulation/AudienceSimulationReport";
import type { AudienceLanguage } from "@/app/audience-simulation/operator/audience-operator-copy";

type ClaimPreview = {
  campaign_name: string;
  campaign_code: string;
  badge: string;
  competition_enabled: boolean;
  min_valid_responses: number;
  run_id: number;
  idea: string;
  status: string;
  summary: { headline?: string; observations?: string[]; next_checks?: string[]; extended_report?: AudienceReport } | null;
  evidence: Array<{ url: string; title: string; domain: string }>;
};

export default function AudienceSimulationClaimPage() {
  const { token } = useParams<{ token: string }>();
  const auth = useAuth();
  const [preview, setPreview] = useState<ClaimPreview | null>(null);
  const [consented, setConsented] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState<AudienceLanguage>("ru");
  const english = language === "en";
  const next = `/audience-simulation/claim/${encodeURIComponent(token)}${english ? "?lang=en" : ""}`;

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("lang") === "en") setLanguage("en");
  }, []);

  useEffect(() => {
    const previousLanguage = document.documentElement.lang || "ru";
    document.documentElement.lang = language;
    return () => { document.documentElement.lang = previousLanguage; };
  }, [language]);

  useEffect(() => {
    let live = true;
    void fetch(`/api/audience-simulations/claims/${encodeURIComponent(token)}/preview`, { credentials: "include" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(english ? "This report link is unavailable." : typeof data.detail === "string" ? data.detail : "Ссылка недоступна");
        if (live) setPreview(data as ClaimPreview);
      })
      .catch((reason: unknown) => { if (live) setError(english ? "Could not open the report. Please try again." : reason instanceof Error ? reason.message : "Не удалось открыть результат"); });
    return () => { live = false; };
  }, [english, token]);

  const accept = async () => {
    if (!consented || !auth.isAuthenticated) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/audience-simulations/claims/${encodeURIComponent(token)}/accept`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, consent_version: "forum-2026-v1" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(english ? "Could not save the result. Please try again." : typeof data.detail === "string" ? data.detail : "Не удалось сохранить результат");
      setClaimed(true);
    } catch (reason) { setError(english ? "Could not save the result. Please try again." : reason instanceof Error ? reason.message : "Не удалось сохранить результат"); }
    finally { setBusy(false); }
  };

  return <main className="min-h-[100dvh] bg-[#09090c] px-5 py-10 text-white"><div className="mx-auto max-w-2xl">
    <p className="text-xs uppercase tracking-[.2em] text-white/35">Pitchy.pro · {english ? "Audience simulation report" : preview?.badge || "Результат исследования"}</p>
    {error && <p role="alert" className="mt-6 rounded-xl border border-rose-200/20 bg-rose-200/5 p-4 text-sm text-rose-100">{error}</p>}
    {!preview && !error && <div className="grid min-h-[50vh] place-items-center"><LoaderCircle className="animate-spin text-sky-100" /></div>}
    {preview && <Link href={`/audience-simulation/operator/${encodeURIComponent(preview.campaign_code)}?home=1${english ? "&lang=en" : ""}`} className="mt-6 inline-flex items-center rounded-full border border-white/15 px-5 py-3 text-sm text-white/75 transition hover:border-white/35 hover:text-white">{english ? "Back to the stand home" : "Вернуться на главный экран стенда"}</Link>}
    {preview && !claimed && <>
      <p className="mt-10 text-xs uppercase tracking-[.2em] text-sky-200/65">{english ? "Your audience simulation" : preview.campaign_name}</p>
      <h1 className="mt-4 text-4xl tracking-tight">{preview.summary?.headline || (english ? "Your results are ready" : "Ваш результат готов")}</h1>
      <p className="mt-5 rounded-2xl border border-white/10 bg-white/[.025] p-5 text-sm leading-6 text-white/65">{preview.idea}</p>
      <div className="mt-6 space-y-2">{(preview.summary?.observations || []).map((item) => <p key={item} className="border-l-2 border-sky-200/50 px-4 py-2 text-sm leading-6 text-white/65">{item}</p>)}</div>
      <AudienceSimulationReport report={preview.summary?.extended_report} language={language} />
      <div className="mt-8 rounded-2xl border border-white/10 p-5"><label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-white/65"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} className="mt-1 accent-sky-200" /><span>{english ? <>I agree to save this run to my account and link it to the forum campaign{preview.competition_enabled ? `; at least ${preview.min_valid_responses} valid responses are required for campaign eligibility` : ""}. I understand that the responses are simulated.</> : <>Согласен(на) сохранить этот прогон в аккаунте и связать его с кампанией форума{preview.competition_enabled ? `; для зачёта результата кампании требуется не менее ${preview.min_valid_responses} валидных ответов` : ""}. Понимаю, что ответы синтетические.</>}</span></label>
        {auth.isLoaded && auth.isAuthenticated ? <button disabled={!consented || busy} onClick={() => void accept()} className="mt-5 inline-flex w-full items-center justify-center gap-3 rounded-full bg-white px-6 py-4 text-sm font-medium text-black disabled:opacity-40">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />} {english ? "Save to my account" : "Сохранить в аккаунте"}</button> : <Link href={`/login?next=${encodeURIComponent(next)}`} className="mt-5 inline-flex w-full items-center justify-center gap-3 rounded-full bg-white px-6 py-4 text-sm font-medium text-black">{english ? "Sign in or create an account" : "Войти или зарегистрироваться"} <ArrowRight size={16} /></Link>}
      </div>
    </>}
    {claimed && <div className="mt-14 rounded-3xl border border-emerald-200/20 bg-emerald-200/[.04] p-8"><p className="text-xs uppercase tracking-[.18em] text-emerald-100/55">{english ? "Saved" : "Сохранено"}</p><h1 className="mt-3 text-3xl">{english ? "The result is linked to your account" : "Результат связан с вашим аккаунтом"}</h1><p className="mt-3 text-sm text-white/50">{english ? "Your campaign score will appear after eligibility is checked." : `${preview?.badge}. Ваш конкурсный балл появится после проверки условий допуска кампании.`}</p><Link href={`/audience-simulation/events/${encodeURIComponent(preview?.campaign_code || "")}${english ? "?lang=en" : ""}`} className="mt-6 inline-block rounded-full bg-white px-6 py-3 text-sm text-black">{english ? "Open my result" : "Открыть результат в аккаунте"}</Link></div>}
    <p className="mt-10 text-xs leading-5 text-white/30">{english ? "This report and analysis were created with artificial intelligence for informational purposes only. They are not investment advice or a call to action." : "Отчёт и аналитика созданы с помощью искусственного интеллекта, носят информационный характер и не являются инвестиционной рекомендацией или призывом к действию."}</p>
  </div></main>;
}
