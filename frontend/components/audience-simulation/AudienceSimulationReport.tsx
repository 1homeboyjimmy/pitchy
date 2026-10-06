export type AudienceReportScoreMap = Record<string, number | null | undefined>;

export type AudienceReport = {
  overall_readout?: string;
  idea_analysis?: {
    problem_fit?: string;
    value_proposition?: string;
    differentiation?: string;
    strengths?: string[];
    risks?: string[];
    assumptions_to_test?: string[];
  };
  audience_analysis?: {
    what_resonates?: Array<string | { theme?: string; mentions?: number }>;
    barriers?: Array<string | { theme?: string; mentions?: number }>;
    segment_differences?: Array<string | {
      segment?: string;
      response_count?: number;
      averages?: AudienceReportScoreMap;
      percent_at_least_7?: AudienceReportScoreMap;
    }>;
  };
  market_analysis?: {
    supported_signals?: Array<string | { statement?: string }>;
    alternatives_and_competition?: string[];
    evidence_gaps?: string[];
  };
  recommendations?: string[];
  limitations?: string[];
  analytics?: {
    response_count?: number;
    requested_count?: number;
    excluded_count?: number;
    averages?: AudienceReportScoreMap;
    percent_at_least_7?: AudienceReportScoreMap;
    segments?: Array<{
      segment?: string;
      response_count?: number;
      averages?: AudienceReportScoreMap;
      percent_at_least_7?: AudienceReportScoreMap;
    }>;
    themes?: {
      motivators?: Array<{ theme?: string; mentions?: number }>;
      barriers?: Array<{ theme?: string; mentions?: number }>;
    };
    context_variations?: Array<{
      label?: string;
      values?: string[];
      distribution?: Array<{ value?: string; count?: number }>;
    }>;
    context_variation_note?: string;
  };
  reference_scores?: AudienceReportScoreMap;
  reference_percent_at_least_7?: AudienceReportScoreMap;
  narrative_sections?: Array<{ title?: string; paragraphs?: string[]; items?: string[] }>;
};

type AudienceReportSegment = NonNullable<NonNullable<AudienceReport["analytics"]>["segments"]>[number];

const scoreLabels: Record<string, string> = {
  problem_relevance: "Актуальность проблемы",
  interest: "Интерес к идее",
  willingness_to_try: "Готовность попробовать",
};

function score(value: unknown) {
  return typeof value === "number" ? value.toFixed(1) : "—";
}

function lineText(item: string | { theme?: string; statement?: string; mentions?: number }) {
  if (typeof item === "string") return item;
  const label = item.theme || item.statement || "";
  return item.mentions ? `${label} · упоминаний: ${item.mentions}` : label;
}

function BulletList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <section className="mt-6">
    <h3 className="text-xs font-semibold uppercase tracking-[.14em] text-white/45">{title}</h3>
    <ul className="mt-3 space-y-2">{items.map((item, index) => <li key={`${index}-${item}`} className="flex gap-3 text-sm leading-6 text-white/70"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-200/70" />{item}</li>)}</ul>
  </section>;
}

function ScoreGrid({ scores, positiveRates, title }: { scores?: AudienceReportScoreMap; positiveRates?: AudienceReportScoreMap; title: string }) {
  const entries = Object.entries(scoreLabels).filter(([key]) => typeof scores?.[key] === "number");
  if (!entries.length) return null;
  return <section className="mt-6">
    <h3 className="text-xs font-semibold uppercase tracking-[.14em] text-white/45">{title}</h3>
    <div className="mt-3 grid gap-2 sm:grid-cols-3">{entries.map(([key, label]) => <div key={key} className="rounded-xl border border-white/10 bg-white/[.025] p-3">
      <p className="text-xs text-white/40">{label}</p><p className="mt-1 text-2xl font-semibold">{score(scores?.[key])}<span className="ml-1 text-xs font-normal text-white/35">/ 10</span></p>
      {typeof positiveRates?.[key] === "number" && <p className="mt-1 text-[10px] text-white/35">оценка 7+ · {positiveRates[key]}%</p>}
    </div>)}</div>
  </section>;
}

function RateGrid({ rates, title }: { rates?: AudienceReportScoreMap; title: string }) {
  const entries = Object.entries(scoreLabels).filter(([key]) => typeof rates?.[key] === "number");
  if (!entries.length) return null;
  return <section className="mt-6">
    <h3 className="text-xs font-semibold uppercase tracking-[.14em] text-white/45">{title}</h3>
    <div className="mt-3 grid gap-2 sm:grid-cols-3">{entries.map(([key, label]) => <div key={key} className="rounded-xl border border-white/10 bg-white/[.025] p-3">
      <p className="text-xs text-white/40">{label} · оценка 7+</p><p className="mt-1 text-2xl font-semibold">{rates?.[key]}%</p>
    </div>)}</div>
  </section>;
}

function SegmentCards({ segments, showPositiveRates = true }: { segments?: AudienceReportSegment[]; showPositiveRates?: boolean }) {
  if (!segments?.length) return null;
  return <section className="mt-6">
    <h3 className="text-xs font-semibold uppercase tracking-[.14em] text-white/45">Оценки по сегментам</h3>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">{segments.map((segment, index) => <article key={`${segment.segment || "segment"}-${index}`} className="rounded-xl border border-white/10 bg-white/[.025] p-4">
      <div className="flex items-start justify-between gap-3"><h4 className="text-sm font-semibold leading-5 text-white/85">{segment.segment || "Сегмент"}</h4><span className="shrink-0 text-xs text-white/35">{segment.response_count ?? 0} ответов</span></div>
      <div className="mt-4 grid grid-cols-3 gap-2">{Object.entries(scoreLabels).map(([key, label]) => <div key={key}>
        <p className="text-[10px] leading-4 text-white/35">{label}</p><p className="mt-1 text-sm font-medium text-white/75">{score(segment.averages?.[key])}</p>
        {showPositiveRates && typeof segment.percent_at_least_7?.[key] === "number" && <p className="mt-0.5 text-[10px] text-white/35">7+ · {segment.percent_at_least_7[key]}%</p>}
      </div>)}</div>
    </article>)}</div>
  </section>;
}

export default function AudienceSimulationReport({ report }: { report?: AudienceReport | null }) {
  if (!report) return null;
  const narrative = report.narrative_sections || [];
  const analytics = report.analytics;
  const referenceScores = report.reference_scores && Object.keys(report.reference_scores).length > 0 ? report.reference_scores : undefined;
  const referenceRates = report.reference_percent_at_least_7 && Object.keys(report.reference_percent_at_least_7).length > 0 ? report.reference_percent_at_least_7 : undefined;
  const reportScores = referenceScores || analytics?.averages;
  const reportPositiveRates = referenceRates || analytics?.percent_at_least_7;
  const overallReadout = (report.overall_readout || "")
    .replace(/Эти значения описывают только этот сценарный прогон\.?/gi, "")
    .trim();
  const segmentData = analytics?.segments?.length ? analytics.segments : report.audience_analysis?.segment_differences?.filter((item): item is AudienceReportSegment => typeof item !== "string");
  const motivators = analytics?.themes?.motivators?.length ? analytics.themes.motivators : report.audience_analysis?.what_resonates;
  const barriers = analytics?.themes?.barriers?.length ? analytics.themes.barriers : report.audience_analysis?.barriers;

  return <section className="mt-9 rounded-3xl border border-white/10 bg-white/[.025] p-5 sm:p-7">
    <p className="text-xs font-semibold uppercase tracking-[.18em] text-sky-200/55">Подробный разбор</p>
    <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Идея и результаты прогона</h2>
    {overallReadout && <p className="mt-4 text-sm leading-6 text-white/65">{overallReadout}</p>}

    <div className="mt-5 grid grid-cols-3 gap-2 text-center">
      <div className="rounded-xl border border-white/10 p-3"><p className="text-xl font-semibold">{analytics?.response_count ?? "—"}</p><p className="mt-1 text-[10px] text-white/40">учтено</p></div>
      <div className="rounded-xl border border-white/10 p-3"><p className="text-xl font-semibold">{analytics?.excluded_count ?? "—"}</p><p className="mt-1 text-[10px] text-white/40">исключено</p></div>
      <div className="rounded-xl border border-white/10 p-3"><p className="text-xl font-semibold">{analytics?.requested_count ?? "—"}</p><p className="mt-1 text-[10px] text-white/40">всего в прогоне</p></div>
    </div>

    <ScoreGrid scores={reportScores} positiveRates={referenceRates ? undefined : reportPositiveRates} title="Средние оценки этого прогона" />
    <RateGrid rates={referenceRates} title="Заданные ориентиры доли оценок 7+" />

    {narrative.length > 0 ? <div className="mt-8 space-y-3">{narrative.map((section, index) => <article key={`${section.title || "section"}-${index}`} className="rounded-2xl border border-white/10 bg-[#0c0c10] p-4 sm:p-5">
      <h3 className="text-base font-semibold text-white/90">{section.title}</h3>
      {section.paragraphs?.map((paragraph, paragraphIndex) => <p key={paragraphIndex} className="mt-3 text-sm leading-6 text-white/65">{paragraph}</p>)}
      <ul className="mt-3 space-y-2">{section.items?.map((item, itemIndex) => <li key={itemIndex} className="flex gap-3 text-sm leading-6 text-white/65"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300/70" />{item}</li>)}</ul>
    </article>)}</div> : <>
      {report.idea_analysis && <div className="mt-7 rounded-2xl border border-white/10 bg-[#0c0c10] p-4 sm:p-5">
        <h3 className="text-base font-semibold">Разбор идеи</h3>
        {report.idea_analysis.problem_fit && <p className="mt-3 text-sm leading-6 text-white/65"><b className="text-white/85">Соответствие проблемы:</b> {report.idea_analysis.problem_fit}</p>}
        {report.idea_analysis.value_proposition && <p className="mt-3 text-sm leading-6 text-white/65"><b className="text-white/85">Ценность:</b> {report.idea_analysis.value_proposition}</p>}
        {report.idea_analysis.differentiation && <p className="mt-3 text-sm leading-6 text-white/65"><b className="text-white/85">Отличие:</b> {report.idea_analysis.differentiation}</p>}
        <BulletList title="Сильные стороны" items={report.idea_analysis.strengths} />
        <BulletList title="Риски" items={report.idea_analysis.risks} />
        <BulletList title="Что проверить дальше" items={report.idea_analysis.assumptions_to_test} />
      </div>}
    </>}

    <SegmentCards segments={segmentData} showPositiveRates={!referenceRates} />
    {(motivators?.length || barriers?.length) ? <div className="mt-7 grid gap-4 sm:grid-cols-2">
      {motivators?.length ? <div className="rounded-2xl border border-sky-200/15 bg-sky-200/[.035] p-4"><h3 className="text-sm font-semibold text-sky-100/80">Что привлекало</h3><ul className="mt-3 space-y-2">{motivators.map((item, index) => <li key={index} className="text-sm leading-5 text-white/65">{lineText(item as string | { theme?: string; mentions?: number })}</li>)}</ul></div> : null}
      {barriers?.length ? <div className="rounded-2xl border border-violet-200/15 bg-violet-200/[.035] p-4"><h3 className="text-sm font-semibold text-violet-100/80">Что настораживало</h3><ul className="mt-3 space-y-2">{barriers.map((item, index) => <li key={index} className="text-sm leading-5 text-white/65">{lineText(item as string | { theme?: string; mentions?: number })}</li>)}</ul></div> : null}
    </div> : null}

    {analytics?.context_variations?.length ? <section className="mt-7 rounded-2xl border border-white/10 bg-[#0c0c10] p-4 sm:p-5">
      <h3 className="text-base font-semibold">Разные условия сценария</h3>
      <p className="mt-2 text-xs leading-5 text-white/45">Для неизвестных личных обстоятельств были смоделированы разные варианты. Их доли заданы для сравнения реакций и не показывают распространённость в реальной аудитории.</p>
      <div className="mt-4 space-y-3">{analytics.context_variations.map((factor, index) => <div key={`${factor.label || "factor"}-${index}`}><p className="text-sm font-medium text-white/75">{factor.label}</p><div className="mt-2 flex flex-wrap gap-2">{factor.distribution?.map((entry, entryIndex) => <span key={entryIndex} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/55">{entry.value}: {entry.count}</span>)}</div></div>)}</div>
      {analytics.context_variation_note && <p className="mt-3 text-xs leading-5 text-white/40">{analytics.context_variation_note}</p>}
    </section> : null}

    {report.market_analysis && <div className="mt-7 rounded-2xl border border-white/10 bg-[#0c0c10] p-4 sm:p-5">
      <h3 className="text-base font-semibold">Рынок и альтернативы</h3>
      <BulletList title="Рыночные сигналы" items={report.market_analysis.supported_signals?.map((item) => lineText(item as string | { statement?: string }))} />
      <BulletList title="Альтернативы" items={report.market_analysis.alternatives_and_competition} />
      <BulletList title="Что пока неизвестно" items={report.market_analysis.evidence_gaps} />
    </div>}
    <BulletList title="Рекомендации" items={report.recommendations} />
    <BulletList title="Ограничения результата" items={report.limitations} />
  </section>;
}
