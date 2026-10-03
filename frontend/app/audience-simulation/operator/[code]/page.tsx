"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, RotateCcw, Search, Sparkles } from "lucide-react";

type CampaignConfig = { name: string; limits: { min_audience: number; max_audience: number; default_audience: number }; disclaimer: string };
type Persona = { id: string; group: string; profile: string; selection_reason: string };
type Finding = { text: string; source_ids: string[]; claim_type: "sourced_paraphrase" | "hypothesis" | "assumption"; limitation: string };
type SimRun = {
  id: number; status: string; revision: number; idea: string; audience: string | null; price: string | null;
  evidence: Array<{ id: string; url: string; domain: string; title: string }>;
  findings: Finding[];
  selection: { version?: number; members?: Persona[]; groups?: Array<{ name: string; basis: string }>; uncertainty?: string[] };
  responses: Array<{ persona_id: string; group?: string; problem_relevance?: number | null; interest?: number | null; willingness_to_try?: number | null; reaction?: string }>;
  aggregate: { valid_responses?: number; requested_responses?: number; averages?: Record<string, number | null>; percent_at_least_7?: Record<string, number | null> } | null;
  summary: { headline?: string; observations?: string[]; next_checks?: string[] } | null;
  events: Array<{ sequence: number; type: string; payload?: Record<string, unknown> }>;
};

const label: Record<string, string> = {
  preparing: "Ищем сигналы и формируем аудиторию",
  awaiting_search_fallback: "Ничего с проверяемыми ссылками не найдено",
  awaiting_audience_confirmation: "Проверьте аудиторию",
  interviewing: "Собираем ответы виртуальных персон",
  completed: "Результат готов",
  partial: "Готов частичный результат",
  failed: "Не удалось подготовить запуск",
};

export default function AudienceSimulationOperatorPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const [config, setConfig] = useState<CampaignConfig | null>(null);
  const [idea, setIdea] = useState("");
  const [audience, setAudience] = useState("");
  const [price, setPrice] = useState("");
  const [run, setRun] = useState<SimRun | null>(null);
  const [runToken, setRunToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [audienceSize, setAudienceSize] = useState(12);
  const [constraints, setConstraints] = useState("");
  const [claimToken, setClaimToken] = useState("");
  const [selectedResponseId, setSelectedResponseId] = useState("");
  const [step, setStep] = useState<"welcome" | "idea" | "processing" | "audience" | "interview" | "result">("welcome");

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}, token?: string): Promise<T> => {
    const response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Audience-Token": token } : {}), ...init.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Не удалось выполнить запрос");
    return data as T;
  }, []);

  useEffect(() => {
    let active = true;
    void request<CampaignConfig>(`/api/audience-simulations/campaigns/${encodeURIComponent(code)}/config`)
      .then((data) => {
        if (!active) return;
        setConfig(data);
        const saved = sessionStorage.getItem(`audience-simulation:${code}`);
        if (!saved) return;
        try {
          const { runId, token } = JSON.parse(saved) as { runId: number; token: string };
          if (!Number.isInteger(runId) || !token) throw new Error("bad session");
          void request<SimRun>(`/api/audience-simulations/runs/${runId}`, {}, token)
            .then((savedRun) => {
              if (!active) return;
              setRun(savedRun); setRunToken(token);
              if (savedRun.status === "awaiting_audience_confirmation") setStep("audience");
              else if (savedRun.status === "interviewing") setStep("interview");
              else if (["completed", "partial"].includes(savedRun.status)) setStep("result");
              else setStep("processing");
            })
            .catch(() => sessionStorage.removeItem(`audience-simulation:${code}`));
        } catch { sessionStorage.removeItem(`audience-simulation:${code}`); }
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Кампания недоступна"); });
    return () => { active = false; };
  }, [code, request]);

  useEffect(() => {
    if (!run || !runToken || !["preparing", "interviewing"].includes(run.status)) return;
    let stopped = false;
    const poll = async () => {
      try {
        const next = await request<SimRun>(`/api/audience-simulations/runs/${run.id}`, {}, runToken);
        if (!stopped) {
          setRun(next);
          if (next.status === "awaiting_audience_confirmation") setStep("audience");
          if (next.status === "interviewing") setStep("interview");
          if (["completed", "partial", "failed"].includes(next.status)) setStep(next.status === "failed" ? "processing" : "result");
        }
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : "Потеряно соединение");
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 1500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [request, run?.id, run?.status, runToken]);

  const start = async () => {
    setBusy(true); setError("");
    try {
      const created = await request<{ run_id: number; access_token: string; status: SimRun["status"] }>(`/api/audience-simulations/campaigns/${encodeURIComponent(code)}/runs`, {
        method: "POST", body: JSON.stringify({ idea: idea.trim(), audience: audience.trim() || null, price: price.trim() || null }),
      });
      sessionStorage.setItem(`audience-simulation:${code}`, JSON.stringify({ runId: created.run_id, token: created.access_token }));
      setRunToken(created.access_token);
      setRun({ id: created.run_id, status: created.status, revision: 1, idea, audience: audience || null, price: price || null, evidence: [], findings: [], selection: {}, responses: [], aggregate: null, summary: null, events: [] });
      setStep("processing");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось запустить проверку"); }
    finally { setBusy(false); }
  };

  const confirmAudience = async () => {
    if (!run) return;
    setBusy(true); setError("");
    try {
      const selection = await request<SimRun["selection"]>(`/api/audience-simulations/runs/${run.id}/selection`, {
        method: "PATCH", body: JSON.stringify({ selection_version: run.selection.version, size: audienceSize, include_groups: [], constraints: constraints.trim() || null }),
      }, runToken);
      setRun({ ...run, selection });
      const response = await request<{ status: string }>(`/api/audience-simulations/runs/${run.id}/start?selection_version=${selection.version}`, { method: "POST" }, runToken);
      setRun({ ...run, selection, status: response.status });
      setStep("interview");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось подтвердить аудиторию"); }
    finally { setBusy(false); }
  };
  const continueWithoutSearch = async () => {
    if (!run) return;
    setBusy(true); setError("");
    try {
      await request(`/api/audience-simulations/runs/${run.id}/continue-without-search`, { method: "POST" }, runToken);
      setRun({ ...run, status: "preparing" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось продолжить запуск"); }
    finally { setBusy(false); }
  };
  const reviseIdea = async () => {
    if (!run) return;
    setBusy(true); setError("");
    try {
      await request(`/api/audience-simulations/runs/${run.id}/cancel`, { method: "POST" }, runToken);
      sessionStorage.removeItem(`audience-simulation:${code}`);
      setRun(null); setRunToken(""); setStep("idea");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось остановить проверку"); }
    finally { setBusy(false); }
  };

  const makeClaimLink = async () => {
    if (!run) return;
    setBusy(true); setError("");
    try {
      const result = await request<{ token: string }>(`/api/audience-simulations/runs/${run.id}/claim-links`, { method: "POST" }, runToken);
      setClaimToken(result.token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось подготовить ссылку"); }
    finally { setBusy(false); }
  };
  const reset = () => { sessionStorage.removeItem(`audience-simulation:${code}`); setRun(null); setRunToken(""); setClaimToken(""); setSelectedResponseId(""); setIdea(""); setAudience(""); setPrice(""); setConstraints(""); setAudienceSize(12); setError(""); setStep("welcome"); };
  const personas = run?.selection.members || [];
  const progress = run?.aggregate?.valid_responses ?? run?.responses.length ?? 0;
  const groups = useMemo(() => [...new Set(personas.map((persona) => persona.group))], [personas]);

  return (
    <main className="min-h-[100dvh] bg-[#09090c] text-white antialiased">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[min(100vw,56.25vh)] flex-col px-5 py-6 sm:px-10">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <div><span className="text-lg font-semibold tracking-tight">Pitchy<span className="text-sky-300">.pro</span></span><span className="ml-3 text-xs text-white/40">Симуляция аудитории</span></div>
          {run && <button type="button" onClick={reset} className="flex items-center gap-2 text-xs text-white/50 hover:text-white"><RotateCcw size={14} /> Следующий участник</button>}
        </header>

        {!config && !error && <div className="grid flex-1 place-items-center"><LoaderCircle className="animate-spin text-sky-200" /></div>}
        {error && <div role="alert" className="mt-8 rounded-2xl border border-rose-300/20 bg-rose-300/5 p-4 text-sm text-rose-100">{error}</div>}

        {config && step === "welcome" && <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <div className="mb-8 grid h-28 w-28 place-items-center rounded-full border border-sky-200/20 bg-sky-200/5 text-sky-100 shadow-[0_0_70px_#7ce6ff15]"><Sparkles size={38} /></div>
          <p className="text-xs uppercase tracking-[.24em] text-white/40">{config.name}</p>
          <h1 className="mt-5 max-w-xl text-4xl font-medium leading-tight tracking-tight sm:text-6xl">Как люди отреагируют на вашу идею?</h1>
          <p className="mt-6 max-w-md text-sm leading-6 text-white/55">Сначала реальные сигналы из открытых источников. Затем — виртуальная аудитория и смоделированные ответы.</p>
          <button onClick={() => { setError(""); setStep("idea"); }} className="mt-10 inline-flex items-center gap-3 rounded-full bg-white px-7 py-4 text-sm font-medium text-black hover:bg-sky-100">Начать проверку <ArrowRight size={16} /></button>
          <p className="mt-8 max-w-md text-xs leading-5 text-white/30">{config.disclaimer}</p>
        </section>}

        {config && step === "idea" && <section className="flex flex-1 flex-col py-12">
          <button onClick={() => setStep("welcome")} className="mb-8 inline-flex w-fit items-center gap-2 text-xs text-white/40 hover:text-white"><ArrowLeft size={14} /> Назад</button>
          <p className="text-xs uppercase tracking-[.2em] text-sky-200/65">01 / Начало проверки</p>
          <h1 className="mt-4 text-4xl tracking-tight sm:text-5xl">Что проверяем?</h1>
          <label className="mt-8 text-sm text-white/70">Опишите идею продукта или услуги
            <textarea value={idea} onChange={(event) => setIdea(event.target.value)} rows={6} maxLength={6000} placeholder="Какую проблему решает продукт и как он работает?" className="mt-3 w-full resize-y rounded-2xl border border-white/10 bg-white/[.035] p-4 text-base leading-6 text-white outline-none placeholder:text-white/25 focus:border-sky-200/40" />
          </label>
          <label className="mt-5 text-sm text-white/70">Кого хотите проверить? <span className="text-white/30">Необязательно</span>
            <textarea value={audience} onChange={(event) => setAudience(event.target.value)} rows={2} maxLength={1200} placeholder="Например: небольшие интернет-магазины" className="mt-3 w-full resize-y rounded-2xl border border-white/10 bg-white/[.035] p-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-sky-200/40" />
          </label>
          <label className="mt-5 text-sm text-white/70">Цена или бизнес-модель <span className="text-white/30">Необязательно</span>
            <input value={price} onChange={(event) => setPrice(event.target.value)} maxLength={300} placeholder="Например: 990 ₽ в месяц" className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[.035] p-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-sky-200/40" />
          </label>
          <button disabled={busy || idea.trim().length < 20} onClick={() => void start()} className="mt-auto inline-flex items-center justify-center gap-3 rounded-full bg-white px-7 py-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Search size={16} />} Запустить поиск</button>
        </section>}

        {run && step === "processing" && <section className="flex flex-1 flex-col items-center justify-center py-14 text-center">
          <div className="mb-7 grid h-24 w-24 place-items-center rounded-full border border-violet-200/20 bg-violet-200/5 text-violet-100"><Search size={30} /></div>
          <p className="text-xs uppercase tracking-[.2em] text-sky-200/65">02 / Открытые источники</p>
          <h1 className="mt-4 text-3xl tracking-tight">Слушаем рынок</h1>
          <p className="mt-3 max-w-sm text-sm leading-6 text-white/45">{label[run.status] || label.preparing}. Счётчики появятся по мере поступления данных.</p>
          <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><span className="text-2xl font-light">{run.evidence.length}</span><p className="mt-1 text-xs text-white/40">источников с ссылками</p></div>
            <div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><span className="text-2xl font-light">{run.findings.length}</span><p className="mt-1 text-xs text-white/40">тем, выделенных в материалах</p></div>
          </div>
          {run.evidence.slice(0, 4).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="mt-3 w-full rounded-xl border border-white/8 p-3 text-left text-xs text-white/65 hover:border-sky-200/30"><span className="block text-white/35">{source.domain}</span>{source.title}</a>)}
          {run.status === "awaiting_search_fallback" && <div className="mt-8 rounded-2xl border border-amber-100/15 bg-amber-100/[.035] p-5 text-left"><p className="text-sm text-white/75">Поиск не вернул проверяемых ссылок. Можно изменить формулировку или продолжить без найденных сигналов.</p><div className="mt-4 flex flex-wrap gap-3"><button disabled={busy} onClick={() => void continueWithoutSearch()} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm text-black disabled:opacity-40">Продолжить без источников <ArrowRight size={15} /></button><button disabled={busy} onClick={() => void reviseIdea()} className="rounded-full border border-white/15 px-5 py-3 text-sm text-white/70 disabled:opacity-40">Изменить идею</button></div></div>}
          {run.status === "failed" && <button onClick={reset} className="mt-8 rounded-full border border-white/15 px-5 py-3 text-sm">Начать заново</button>}
        </section>}

        {run && step === "audience" && <section className="flex flex-1 flex-col py-12">
          <p className="text-xs uppercase tracking-[.2em] text-sky-200/65">03 / Предпросмотр аудитории</p>
          <h1 className="mt-4 text-4xl tracking-tight">Кто будет отвечать?</h1>
          <p className="mt-3 text-sm leading-6 text-white/45">Профили созданы для этой идеи. Это вымышленные персонажи, а не цифровые копии людей из источников.</p>
          {run.findings.length > 0 && <div className="mt-6 space-y-2">{run.findings.slice(0, 5).map((finding, index) => { const linked = run.evidence.filter((source) => finding.source_ids.includes(source.id)); return <article key={`${finding.text}-${index}`} className="rounded-xl border border-white/8 bg-white/[.02] p-3"><p className="text-sm text-white/75">{finding.text}</p><p className="mt-2 text-[10px] uppercase tracking-[.12em] text-white/35">{finding.claim_type === "sourced_paraphrase" ? "Пересказ источников" : finding.claim_type === "hypothesis" ? "Гипотеза" : "Предположение"}{finding.limitation ? ` · ${finding.limitation}` : ""}</p>{linked.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="mt-2 mr-3 inline-block text-xs text-sky-200/70 underline decoration-white/15 underline-offset-4">{source.domain}</a>)}</article>; })}</div>}
          <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-white/10 p-4"><div><p className="text-sm">Размер панели</p><p className="mt-1 text-xs text-white/35">Модельный тест, не статистическая выборка</p></div><select value={audienceSize} onChange={(event) => setAudienceSize(Number(event.target.value))} className="rounded-xl border border-white/15 bg-[#131319] px-3 py-2 text-sm">{[5, 8, 12].map((value) => <option key={value} value={value}>{value} персон</option>)}</select></div>
          <label className="mt-4 text-sm text-white/65">Ограничения или правки состава <span className="text-white/30">Необязательно</span><textarea value={constraints} onChange={(event) => setConstraints(event.target.value)} rows={2} placeholder="Например: исключить тех, кто уже использует такое решение" className="mt-3 w-full resize-y rounded-2xl border border-white/10 bg-white/[.035] p-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-sky-200/40" /></label>
          <div className="mt-5 flex flex-wrap gap-2">{groups.map((group) => <span key={group} className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/55">{group}</span>)}</div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">{personas.slice(0, 4).map((persona) => <article key={persona.id} className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><p className="text-xs text-violet-200/75">{persona.group}</p><p className="mt-2 text-sm leading-5 text-white/75">{persona.profile}</p><p className="mt-3 text-xs leading-5 text-white/35">{persona.selection_reason}</p></article>)}</div>
          {run.selection.uncertainty?.map((item) => <p key={item} className="mt-3 text-xs text-amber-100/65">Неопределённость: {item}</p>)}
          <button disabled={busy || personas.length < 5} onClick={() => void confirmAudience()} className="mt-auto inline-flex items-center justify-center gap-3 rounded-full bg-white px-7 py-4 text-sm font-medium text-black disabled:opacity-40">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />} Подтвердить и начать интервью</button>
        </section>}

        {run && step === "interview" && <section className="flex flex-1 flex-col items-center justify-center py-14 text-center">
          <div className="mb-7 grid h-24 w-24 place-items-center rounded-full border border-emerald-200/20 bg-emerald-200/5 text-emerald-100"><Sparkles size={30} /></div>
          <p className="text-xs uppercase tracking-[.2em] text-sky-200/65">04 / Синтетическое исследование</p>
          <h1 className="mt-4 text-3xl tracking-tight">Аудитория отвечает</h1>
          <p className="mt-3 text-sm text-white/45">Каждый ответ — модельная реакция отдельного синтетического профиля.</p>
          <p className="mt-10 text-6xl font-light tracking-tight">{progress}<span className="text-white/30"> / {personas.length}</span></p>
          <div className="mt-5 h-1 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-sky-200 to-violet-300 transition-all" style={{ width: `${personas.length ? Math.min(100, progress / personas.length * 100) : 0}%` }} /></div>
          <p className="mt-5 text-xs text-white/35">{label[run.status]}</p>
        </section>}

        {run && step === "result" && <section className="flex flex-1 flex-col py-12">
          <p className="text-xs uppercase tracking-[.2em] text-sky-200/65">Результат проверки</p>
          <h1 className="mt-4 text-4xl tracking-tight">{run.summary?.headline || "Реакция виртуальной аудитории"}</h1>
          <p className="mt-3 text-sm text-white/45">Валидных ответов: {run.aggregate?.valid_responses ?? 0} из {run.aggregate?.requested_responses ?? personas.length}</p>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">{[
            ["Актуальность проблемы", run.aggregate?.averages?.problem_relevance],
            ["Интерес к решению", run.aggregate?.averages?.interest],
            ["Готовность попробовать", run.aggregate?.averages?.willingness_to_try],
          ].map(([title, value]) => <div key={String(title)} className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><p className="text-xs text-white/40">{title}</p><p className="mt-3 text-4xl font-light">{typeof value === "number" ? `${value.toFixed(1)}` : "—"}<span className="text-base text-white/30"> / 10</span></p></div>)}</div>
          <p className="mt-7 text-sm text-white/40">Доля ответов с оценкой 7–10 (собственный знаменатель для каждого вопроса)</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">{Object.entries(run.aggregate?.percent_at_least_7 || {}).map(([key, value]) => <div key={key} className="rounded-2xl bg-white/[.025] p-4"><p className="text-xs text-white/35">{key === "problem_relevance" ? "Проблема актуальна" : key === "interest" ? "Интересно решение" : "Готовы попробовать"}</p><p className="mt-2 text-2xl">{value == null ? "—" : `${value}%`}</p></div>)}</div>
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[.02] p-4">
            <p className="text-xs uppercase tracking-[.16em] text-white/35">Карта ответов</p>
            <div className="relative mt-4 aspect-[1.55] border-b border-l border-white/20 bg-[linear-gradient(90deg,transparent_49.8%,#ffffff12_50%,transparent_50.2%),linear-gradient(0deg,transparent_49.8%,#ffffff12_50%,transparent_50.2%)]">
              {run.responses.filter((item) => typeof item.interest === "number" && typeof item.problem_relevance === "number").map((item) => <button key={item.persona_id} type="button" title={`${item.group || "Персона"}: интерес ${item.interest}/10, актуальность ${item.problem_relevance}/10`} aria-label={`Персона ${item.persona_id}`} onClick={() => setSelectedResponseId(selectedResponseId === item.persona_id ? "" : item.persona_id)} className={`absolute h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full border border-white/70 transition-transform hover:scale-150 ${item.interest! >= 7 ? "bg-emerald-200 shadow-[0_0_14px_#9be5ca80]" : item.interest! >= 4 ? "bg-amber-200 shadow-[0_0_14px_#f0bd6980]" : "bg-violet-300 shadow-[0_0_14px_#b48cff80]"}`} style={{ left: `${item.interest! * 10}%`, bottom: `${item.problem_relevance! * 10}%` }} />)}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-white/35"><span>Актуальность проблемы</span><span>Интерес к решению →</span></div>
            {run.responses.filter((item) => item.persona_id === selectedResponseId).map((item) => <div key={item.persona_id} className="mt-4 border-l-2 border-violet-200/50 pl-3"><p className="text-[10px] uppercase tracking-[.14em] text-violet-100/55">Ответ виртуального респондента · синтетический профиль</p><p className="mt-2 text-sm leading-6 text-white/75">{item.reaction || "Персона не оставила короткую реплику."}</p></div>)}
            <p className="mt-3 text-[10px] leading-4 text-white/30">Каждая точка — ответ отдельной синтетической персоны. Цвет не заменяет оценки по осям.</p>
          </div>
          <div className="mt-7 space-y-3">{(run.summary?.observations || []).map((item) => <p key={item} className="rounded-xl border-l-2 border-sky-200/60 bg-white/[.025] px-4 py-3 text-sm leading-6 text-white/70">{item}</p>)}</div>
          {run.summary?.next_checks?.length ? <div className="mt-6 rounded-2xl border border-violet-200/15 bg-violet-200/[.04] p-5"><p className="text-xs uppercase tracking-[.15em] text-violet-100/55">Что проверить дальше</p><ul className="mt-3 space-y-2 text-sm text-white/70">{run.summary.next_checks.map((item) => <li key={item}>· {item}</li>)}</ul></div> : null}
          <div className="mt-auto pt-8"><p className="text-xs leading-5 text-white/35">Ответы смоделированы. Результат помогает сформулировать следующие проверки, но не прогнозирует продажи и не является статистически репрезентативной выборкой.</p>
            {!claimToken ? <button disabled={busy} onClick={() => void makeClaimLink()} className="mt-6 inline-flex w-full items-center justify-center gap-3 rounded-full border border-white/15 px-7 py-4 text-sm font-medium disabled:opacity-40">{busy ? <LoaderCircle size={16} className="animate-spin" /> : null} Подготовить QR для сохранения результата</button> : <div className="mt-6 flex items-center gap-5 rounded-2xl border border-white/10 p-4"><img src={`/api/audience-simulations/claims/${encodeURIComponent(claimToken)}/qr`} alt="QR-код для сохранения результата" className="h-28 w-28 rounded bg-white p-2" /><div className="min-w-0"><p className="text-sm text-white/80">Откройте результат на телефоне</p><a className="mt-2 block break-all text-xs text-sky-200/60" href={`/audience-simulation/claim/${encodeURIComponent(claimToken)}`}>{window.location.origin}/audience-simulation/claim/…</a><p className="mt-2 text-xs text-white/35">Ссылка одноразовая и действует 7 дней</p></div></div>}
            <button onClick={reset} className="mt-4 inline-flex w-full items-center justify-center gap-3 rounded-full bg-white px-7 py-4 text-sm font-medium text-black">Завершить и очистить экран <RotateCcw size={15} /></button></div>
        </section>}

        <footer className="mt-5 flex items-center justify-between border-t border-white/8 pt-4 text-[10px] uppercase tracking-[.16em] text-white/25"><span>{step === "result" ? "ИТОГ" : "ИДЕЯ → АУДИТОРИЯ"}</span><span>{step !== "welcome" ? step.toUpperCase() : "ФОРУМНЫЙ СТЕНД"}</span></footer>
      </div>
    </main>
  );
}
