"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Loader,
  RotateCcw,
} from "react-feather";
import {
  behaviorLabelsEn,
  domainLabelsEn,
  exclusionLabelsEn,
  groupLabelsEn,
  operatorText,
  personaValueLabelsEn,
  scenarioCardsEn,
  type AudienceLanguage,
} from "../audience-operator-copy";
import "../audience-operator.css";

type CampaignConfig = {
  name: string;
  limits: { min_audience: number; max_audience: number; default_audience: number };
  disclaimer: string;
};
type PersonaTraits = {
  profile_label?: string;
  age_band?: string;
  city?: string;
  city_size?: string;
  region?: string;
  occupation?: string;
  business_role?: string | null;
  income_band?: string;
  household_context?: string;
  current_behaviors?: string[];
  decision_style?: string[];
  domain_familiarity?: Record<string, string>;
  behavior?: Record<string, number>;
};
type Persona = { id: string; market?: string; group: string; profile: string; traits?: PersonaTraits };
type Finding = {
  text: string;
  source_ids: string[];
  claim_type: "sourced_paraphrase" | "hypothesis" | "assumption";
  limitation: string;
  evidence?: Array<{ source_id: string; quote: string }>;
};
type Evidence = { id: string; url: string; domain: string; title: string; fetch_status?: string; page_title?: string; supported_claim_count?: number };
type ResponsePoint = {
  persona_id: string;
  group?: string;
  included?: boolean;
  exclusion_reason?: string | null;
  raw_answer?: Record<string, unknown> | null;
  problem_relevance?: number | null;
  interest?: number | null;
  willingness_to_try?: number | null;
  reaction?: string;
};

const prebuiltScenarios = [
  { id: "calorie-photo", title: "ИИ-трекер калорий", note: "Распознаёт блюдо по фото, оценивает состав и порцию, помогает вести дневник питания и замечать изменения в рационе.", image: "/images/audience-simulation/scenarios/calorie-tracker.png" },
  { id: "english-coach", title: "Тренер разговорного английского", note: "Проводит короткие диалоги голосом, подстраивает сложность и лексику под работу, учёбу и поездки.", image: "/images/audience-simulation/scenarios/english-coach.png" },
  { id: "family-budget", title: "Помощник по личному бюджету", note: "Распределяет доходы и регулярные расходы, показывает остаток до следующей зарплаты и помогает планировать покупки.", image: "/images/audience-simulation/scenarios/personal-budget.png" },
  { id: "weekend-trip", title: "Планировщик поездки", note: "Собирает маршрут выходного дня с учётом бюджета, интересов, времени в пути и предпочтений компании.", image: "/images/audience-simulation/scenarios/trip-planner.png" },
];
type SimRun = {
  id: number;
  status: string;
  revision: number;
  idea: string;
  audience: string | null;
  price: string | null;
  scenario_id?: string | null;
  demo_search_stats?: {
    kind: "illustrative_demo_volume";
    mentions: number;
    bundle_links: number;
    linked_findings: number;
    categories: { reviews: number; communities: number; search_materials: number };
  } | null;
  evidence: Evidence[];
  findings: Finding[];
  selection: {
    version?: number;
    members?: Persona[];
    target_market?: string | null;
    persona_groups?: Array<{ market: string; profile_label: string }>;
    groups?: Array<{ name: string; basis: string }>;
    uncertainty?: string[];
  };
  responses: ResponsePoint[];
  aggregate: {
    error?: string;
    retryable?: boolean;
    valid_responses?: number;
    requested_responses?: number;
    excluded_responses?: number;
    averages?: Record<string, number | null>;
    percent_at_least_7?: Record<string, number | null>;
  } | null;
  summary: {
    headline?: string;
    observations?: string[];
    next_checks?: string[];
    extended_report?: { reference_percent_at_least_7?: Record<string, number> };
  } | null;
  events: Array<{ sequence: number; type: string; payload?: Record<string, unknown> }>;
};

const statusText: Record<string, string> = {
  preparing: "Ищем сигналы и формируем аудиторию",
  awaiting_search_fallback: "Не нашли достаточно проверяемых ссылок",
  awaiting_audience_confirmation: "Аудитория собрана",
  interviewing: "Персоны отвечают на вопросы",
  completed: "Результат готов",
  partial: "Готов частичный результат",
  failed: "Не удалось подготовить запуск",
};
const statusTextEn: Record<string, string> = {
  preparing: "Finding market signals and building the audience",
  awaiting_search_fallback: "Not enough verifiable sources were found",
  awaiting_audience_confirmation: "Audience is ready",
  interviewing: "Personas are responding",
  completed: "Results are ready",
  partial: "Partial results are ready",
  failed: "Could not prepare the run",
};

const palette = ["#7ce6ff", "#b48cff", "#f0bd69", "#9be5ca"];
const behaviorScoreLabels: Record<string, string> = {
  price_sensitivity: "Чувствительность к цене",
  digital_skill: "Цифровая уверенность",
  trust_in_new_services: "Доверие новым сервисам",
  readiness_to_try: "Готовность пробовать новое",
  complexity_tolerance: "Готовность разбираться в сложном",
  information_search_intensity: "Тщательность выбора",
};
const domainLabels: Record<string, string> = {
  ecommerce: "Онлайн-покупки",
  education: "Образование",
  food_delivery: "Доставка еды",
  finance: "Финансы",
  travel: "Путешествия",
};
const exclusionReasonLabels: Record<string, string> = {
  missing_required_score: "нет обязательной оценки",
  invalid_score: "оценка не целая или вне диапазона 0–10",
  response_generation_failed: "ответ не сформирован",
  response_not_received: "ответ не получен",
  persona_mismatch: "профиль ответа не совпал",
  unsupported_assumption_language: "в ответе было неподтверждённое предположение",
};

function getPersonaDetails(persona: Persona, language: AudienceLanguage) {
  const parts = (persona.profile || "").split(" · ").map((part) => part.trim()).filter(Boolean);
  const traits = persona.traits || {};
  const profileBehavior = parts.find((part) => part.startsWith("поведение:"))?.replace(/^поведение:\s*/, "").split(";").map((part) => part.trim()).filter(Boolean) || [];
  const behaviorSummary = traits.current_behaviors?.length ? traits.current_behaviors : profileBehavior.length ? profileBehavior : traits.decision_style || [];
  const localize = (kind: keyof typeof personaValueLabelsEn, value?: string | null) => {
    if (!value) return undefined;
    return language === "en" ? personaValueLabelsEn[kind][value] || value : value;
  };
  const behavior = traits.behavior || {};
  const englishBehaviorSummary = Object.entries(behavior)
    .filter(([key, value]) => behaviorLabelsEn[key] && typeof value === "number")
    .slice(0, 3)
    .map(([key, value]) => `${behaviorLabelsEn[key]}: ${value}/5`);
  return {
    traits,
    name: language === "en"
      ? groupLabelsEn[persona.group] || operatorText.en.profile
      : traits.profile_label || parts[0] || "Синтетическая персона",
    age: traits.age_band || parts[1],
    city: localize("city", traits.city || parts[2]),
    citySize: localize("citySize", traits.city_size),
    region: localize("region", traits.region),
    occupation: localize("occupation", traits.occupation || parts[3]),
    businessRole: traits.business_role,
    income: localize("income", traits.income_band || parts[4]),
    household: localize("household", traits.household_context),
    behaviors: language === "en" ? englishBehaviorSummary : behaviorSummary,
    decisionStyle: language === "en" ? [] : traits.decision_style || [],
  };
}

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function localizedError(reason: unknown, fallback: string, lostConnection: string) {
  if (reason instanceof TypeError) return lostConnection;
  return reason instanceof Error ? reason.message : fallback;
}

function PersonaNetwork({
  members,
  responses,
  mode,
  activeIds,
  litIds,
  onPick,
  onHover,
  language = "ru",
}: {
  members: Persona[];
  responses: ResponsePoint[];
  mode: "crowd" | "map";
  activeIds?: Set<string>;
  litIds?: Set<string>;
  onPick?: (id: string) => void;
  onHover?: (id: string | null) => void;
  language?: AudienceLanguage;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Array<{ x: number; y: number; id: string; color: string; excluded?: boolean }>>([]);
  const redrawRef = useRef<() => void>(() => undefined);
  const activeIdsRef = useRef(activeIds);
  const litIdsRef = useRef(litIds);
  activeIdsRef.current = activeIds;
  litIdsRef.current = litIds;
  const dataKey = useMemo(
    () => members.map((person) => person.id + person.group).join("|") + responses.map((person) => person.persona_id + person.willingness_to_try + person.problem_relevance + person.included + person.exclusion_reason).join("|"),
    [members, responses],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    const validResponses = responses;
    const excludedResponses = responses.filter((item) => item.included === false
      || typeof item.problem_relevance !== "number"
      || typeof item.interest !== "number"
      || typeof item.willingness_to_try !== "number");

    const render = () => {
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(pixelRatio, pixelRatio);
      const mapped: Array<{ x: number; y: number; id: string; color: string; radius: number; person: boolean; excluded?: boolean }> = [];
      const people = mode === "map" ? validResponses : members;
      const groups = Array.from(new Set(people.map((person) => person.group || "Аудитория")));

      if (!people.length) {
        let seed = 5107;
        const random = () => {
          seed = (Math.imul(seed, 16807) + 19) % 2147483647;
          return (seed - 1) / 2147483646;
        };
        for (let index = 0; index < 105; index += 1) {
          const angle = random() * Math.PI * 2;
          const radius = Math.sqrt(random());
          mapped.push({
            x: width / 2 + Math.cos(angle) * radius * width * 0.48,
            y: height * 0.52 + Math.sin(angle) * radius * height * 0.36,
            id: "",
            color: palette[index % palette.length],
            radius: 2.3 + random() * 1.2,
            person: false,
          });
        }
      } else if (mode === "map") {
        // Scores are integers, so many personas can share the exact same pixel.
        // A small deterministic jitter exposes overlapping answers; selected details retain exact scores.
        const stackRanks = new Map<string, number>();
        const orderedResponses = [...validResponses].sort((first, second) => first.persona_id.localeCompare(second.persona_id));
        let excludedIndex = 0;
        for (const person of orderedResponses) {
          const groupIndex = Math.max(0, groups.indexOf(person.group || "Аудитория"));
          const excluded = person.included === false
            || typeof person.problem_relevance !== "number"
            || typeof person.interest !== "number"
            || typeof person.willingness_to_try !== "number";
          if (excluded) {
            const laneIndex = excludedIndex++;
            mapped.push({
              x: 18 + ((laneIndex + 0.5) / Math.max(1, excludedResponses.length)) * (width - 36),
              y: height * (laneIndex % 2 === 0 ? 0.88 : 0.83),
              id: person.persona_id,
              color: palette[groupIndex % palette.length],
              radius: 4,
              person: true,
              excluded: true,
            });
            continue;
          }
          const scoreKey = `${person.interest}:${person.problem_relevance}`;
          const rank = stackRanks.get(scoreKey) || 0;
          stackRanks.set(scoreKey, rank + 1);
          const angle = (rank * 2.399963) + (hashSeed(person.persona_id) % 6283) / 1000;
          const spread = rank ? Math.min(12, 3.2 * Math.sqrt(rank)) : 0;
          mapped.push({
            x: width * (0.1 + (person.willingness_to_try || 0) * 0.08) + Math.cos(angle) * spread,
            y: height * (0.78 - (person.problem_relevance || 0) * 0.068) + Math.sin(angle) * spread,
            id: person.persona_id,
            color: palette[groupIndex % palette.length],
            radius: 3.4,
            person: true,
            excluded: false,
          });
        }
      } else {
        const groupCenters = groups.map((_, index) => {
          const angle = (Math.PI * 2 * index) / Math.max(groups.length, 1) - Math.PI / 2;
          return {
            x: width * (0.5 + Math.cos(angle) * (groups.length > 1 ? 0.19 : 0)),
            y: height * (0.49 + Math.sin(angle) * (groups.length > 1 ? 0.18 : 0)),
          };
        });
        members.forEach((person, index) => {
          const groupIndex = Math.max(0, groups.indexOf(person.group || "Аудитория"));
          const center = groupCenters[groupIndex] || { x: width / 2, y: height / 2 };
          let seed = hashSeed(person.id + person.profile);
          const random = () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
          };
          mapped.push({
            x: center.x + (random() - 0.5) * width * 0.21 + (index % 2 ? width * 0.012 : 0),
            y: center.y + (random() - 0.5) * height * 0.32,
            id: person.id,
            color: palette[groupIndex % palette.length],
            radius: 3.1,
            person: true,
          });
        });
      }

      pointsRef.current = mapped;
      if (mode === "map") {
        context.strokeStyle = "rgba(255,255,255,.08)";
        context.lineWidth = 1;
        context.setLineDash([3, 7]);
        context.beginPath();
        context.moveTo(width / 2, 0);
        context.lineTo(width / 2, height);
        context.moveTo(0, height / 2);
        context.lineTo(width, height / 2);
        context.stroke();
        context.setLineDash([]);
        context.strokeStyle = "rgba(255,255,255,.12)";
        context.setLineDash([2, 5]);
        context.beginPath();
        context.moveTo(0, height * 0.81);
        context.lineTo(width, height * 0.81);
        context.stroke();
        context.setLineDash([]);
      } else if (mapped.length > 12) {
        context.strokeStyle = "rgba(156,207,255,.17)";
        context.lineWidth = 0.7;
        for (let index = 0; index < mapped.length; index += 1) {
          const point = mapped[index];
          let nearest: { candidate: typeof point; distanceSquared: number } | null = null;
          for (let candidateIndex = index + 1; candidateIndex < mapped.length; candidateIndex += 1) {
            const candidate = mapped[candidateIndex];
            const dx = candidate.x - point.x;
            const dy = candidate.y - point.y;
            const distanceSquared = dx * dx + dy * dy;
            if (!nearest || distanceSquared < nearest.distanceSquared) nearest = { candidate, distanceSquared };
          }
          if (!nearest || nearest.distanceSquared > Math.pow(Math.min(width, height) * 0.22, 2)) continue;
          context.beginPath();
          context.moveTo(point.x, point.y);
          context.lineTo(nearest.candidate.x, nearest.candidate.y);
          context.stroke();
        }
      }

      for (const point of mapped) {
        const selected = Boolean(point.id && activeIdsRef.current?.has(point.id));
        if (mode === "map") {
          if (point.excluded) {
            context.beginPath();
            context.strokeStyle = selected ? "#ffffff" : "#ff777e";
            context.lineWidth = selected ? 1.7 : 1.35;
            context.shadowColor = "#ff777e";
            context.shadowBlur = selected ? 2 : 0;
            context.moveTo(point.x - 3.2, point.y - 3.2);
            context.lineTo(point.x + 3.2, point.y + 3.2);
            context.moveTo(point.x + 3.2, point.y - 3.2);
            context.lineTo(point.x - 3.2, point.y + 3.2);
            context.stroke();
            context.shadowBlur = 0;
            continue;
          }
          // A faint halo preserves the palette; the crisp center keeps nearby scores distinguishable.
          context.beginPath();
          context.fillStyle = point.color;
          context.shadowColor = point.color;
          context.shadowBlur = 0;
          context.globalAlpha = selected ? 0.22 : 0.1;
          context.arc(point.x, point.y, selected ? 4.1 : 3.1, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.fillStyle = point.color;
          context.shadowBlur = 0;
          context.globalAlpha = 1;
          context.arc(point.x, point.y, selected ? 3 : 2.4, 0, Math.PI * 2);
          context.fill();
        } else {
          context.beginPath();
          const lit = !litIdsRef.current || litIdsRef.current.has(point.id);
          const pointColor = lit ? point.color : "#414348";
          context.fillStyle = pointColor;
          context.shadowColor = pointColor;
          context.shadowBlur = 0;
          context.globalAlpha = lit ? 0.95 : 0.38;
          context.arc(point.x, point.y, Math.max(1.8, point.radius * 0.9), 0, Math.PI * 2);
          context.fill();
        }
        if (selected) {
          context.beginPath();
          context.strokeStyle = "rgba(255,255,255,.85)";
          context.lineWidth = 1;
          context.shadowBlur = 0;
          context.arc(point.x, point.y, 7, 0, Math.PI * 2);
          context.stroke();
        }
      }
      context.restore();
    };
    redrawRef.current = render;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => {
      observer.disconnect();
    };
  }, [dataKey, members, mode, responses]);

  useEffect(() => { redrawRef.current(); }, [activeIds, litIds]);

  const pickNearest = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!onPick) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearest = pointsRef.current
      .filter((point) => point.id)
      .map((point) => ({ point, distance: Math.hypot(point.x - x, point.y - y) }))
      .sort((first, second) => first.distance - second.distance)[0];
    if (nearest && nearest.distance < 22) onPick(nearest.point.id);
  };

  const hoverNearest = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!onHover) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearest = pointsRef.current.filter((point) => point.id)
      .map((point) => ({ point, distance: Math.hypot(point.x - x, point.y - y) }))
      .sort((first, second) => first.distance - second.distance)[0];
    onHover(nearest && nearest.distance < 24 ? nearest.point.id : null);
  };

  const pickWithKeyboard = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (!onPick) return;
    const points = pointsRef.current.filter((point) => point.id);
    if (!points.length || !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = points.findIndex((point) => activeIds?.has(point.id));
    const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const nextIndex = event.key === "Enter" || event.key === " "
      ? (currentIndex < 0 ? 0 : currentIndex)
      : currentIndex < 0
        ? (backwards ? points.length - 1 : 0)
        : (currentIndex + (backwards ? points.length - 1 : 1)) % points.length;
    onPick(points[nextIndex].id);
  };

  return (
    <canvas
      ref={canvasRef}
      className="audience-network"
      onClick={pickNearest}
      onMouseMove={hoverNearest}
      onMouseLeave={() => onHover?.(null)}
      onKeyDown={onPick ? pickWithKeyboard : undefined}
      role={onPick ? "application" : "img"}
      tabIndex={onPick ? 0 : undefined}
      aria-label={language === "en"
        ? onPick ? "Interactive response map. Use the arrow keys to select a persona." : mode === "map" ? "Response map: each dot represents a simulated persona" : "Simulated audience personas"
        : onPick ? "Интерактивная карта ответов. Выбирайте персоны клавишами со стрелками." : mode === "map" ? "Карта ответов: каждая точка — синтетическая персона" : "Облако синтетических персон"}
    />
  );
}

export default function AudienceSimulationOperatorPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const [config, setConfig] = useState<CampaignConfig | null>(null);
  const [language, setLanguage] = useState<AudienceLanguage>("ru");
  const ui = operatorText[language];
  const [run, setRun] = useState<SimRun | null>(null);
  const [runToken, setRunToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [audienceSize, setAudienceSize] = useState(100);
  const [constraints, setConstraints] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [showAudienceControls, setShowAudienceControls] = useState(false);
  const [claimToken, setClaimToken] = useState("");
  const [selectedResponseId, setSelectedResponseId] = useState("");
  const [hoveredResponseId, setHoveredResponseId] = useState("");
  const [expandedPersona, setExpandedPersona] = useState<Persona | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [slideEntranceDone, setSlideEntranceDone] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [demoProgress, setDemoProgress] = useState(0);
  const [audienceReveal, setAudienceReveal] = useState(0);
  const lastAutoStatusRef = useRef("");

  useEffect(() => {
    const queryLanguage = new URLSearchParams(window.location.search).get("lang");
    const savedLanguage = localStorage.getItem("audience-simulation-language");
    const nextLanguage = queryLanguage === "en" || queryLanguage === "ru"
      ? queryLanguage
      : savedLanguage === "en" || savedLanguage === "ru"
        ? savedLanguage
        : null;
    if (nextLanguage) {
      setLanguage(nextLanguage);
      localStorage.setItem("audience-simulation-language", nextLanguage);
    }
  }, []);

  useEffect(() => {
    const previousLanguage = document.documentElement.lang || "ru";
    document.documentElement.lang = language;
    return () => { document.documentElement.lang = previousLanguage; };
  }, [language]);

  const switchLanguage = (next: AudienceLanguage) => {
    setLanguage(next);
    localStorage.setItem("audience-simulation-language", next);
    setError("");
  };

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}, token?: string): Promise<T> => {
    const response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Audience-Token": token } : {}), ...init.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof data.detail === "string" ? data.detail : "";
      const translatedErrors: Record<string, string> = {
        "Готовый сценарий не найден": "The selected idea could not be found.",
        "Кампания сейчас недоступна": "This campaign is currently unavailable.",
        "Кампания недоступна": "This campaign is currently unavailable.",
        "В каталоге недостаточно профилей для готового сценария": "There are not enough audience profiles for this idea.",
        "Не удалось выполнить запрос": "Something went wrong. Please try again.",
      };
      throw new Error(language === "en" ? translatedErrors[detail] || "Something went wrong. Please try again." : detail || "Не удалось выполнить запрос");
    }
    return data as T;
  }, [language]);

  useEffect(() => {
    const section = document.querySelectorAll<HTMLElement>(".audience-slide")[activeSlide];
    if (!section) return;
    const frame = window.requestAnimationFrame(() => {
      section.tabIndex = -1;
      section.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSlide, config]);

  useEffect(() => {
    let active = true;
    const openStandHome = new URLSearchParams(window.location.search).get("home") === "1";
    void request<CampaignConfig>("/api/audience-simulations/campaigns/" + encodeURIComponent(code) + "/config")
      .then((data) => {
        if (!active) return;
        setConfig(data);
        const saved = sessionStorage.getItem("audience-simulation:" + code);
        if (!saved || openStandHome) return;
        try {
          const session = JSON.parse(saved) as { runId: number; token: string; language?: AudienceLanguage };
          if ((session.language || "ru") !== language) {
            sessionStorage.removeItem("audience-simulation:" + code);
            return;
          }
          if (!Number.isInteger(session.runId) || !session.token) throw new Error("bad session");
          void request<SimRun>("/api/audience-simulations/runs/" + session.runId, {}, session.token)
            .then((savedRun) => {
              if (!active) return;
              setRun(savedRun);
              setRunToken(session.token);
              setSelectedScenarioId(savedRun.scenario_id || "");
              lastAutoStatusRef.current = savedRun.status;
              const allGroups = Array.from(new Set((savedRun.selection.members || []).map((person) => person.group)));
              setSelectedGroups(allGroups);
              if (savedRun.status === "awaiting_audience_confirmation") setActiveSlide(2);
              else if (savedRun.status === "interviewing") setActiveSlide(4);
              else if (["completed", "partial"].includes(savedRun.status)) setActiveSlide(5);
              else setActiveSlide(2);
            })
            .catch(() => sessionStorage.removeItem("audience-simulation:" + code));
        } catch {
          sessionStorage.removeItem("audience-simulation:" + code);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(localizedError(reason, ui.unavailableCampaign, ui.lostConnection));
      });
    return () => { active = false; };
  }, [code, language, request, ui.lostConnection, ui.unavailableCampaign]);

  useEffect(() => {
    const runId = run?.id;
    const runStatus = run?.status;
    if (!runId || !runToken || !["preparing", "interviewing"].includes(runStatus || "")) return;
    let stopped = false;
    const poll = async () => {
      try {
        const next = await request<SimRun>("/api/audience-simulations/runs/" + runId, {}, runToken);
        if (stopped) return;
        setRun(next);
        if (next.status !== lastAutoStatusRef.current) {
          lastAutoStatusRef.current = next.status;
          if (next.status === "awaiting_audience_confirmation") {
            setSelectedGroups(Array.from(new Set((next.selection.members || []).map((person) => person.group))));
          }
          if (next.status === "interviewing") setActiveSlide(4);
          if (["completed", "partial"].includes(next.status)) setActiveSlide(5);
        }
        if (next.status === "failed") {
          setError(next.evidence.length
            ? (language === "en" ? "Sources were found, but the result could not be processed. You can retry." : "Источники найдены, но не удалось обработать результат. Их можно обработать повторно.")
            : (language === "en" ? "The run could not be prepared. You can try again." : "Не удалось подготовить запуск. Можно повторить попытку."));
        }
      } catch (reason) {
        if (!stopped) setError(localizedError(reason, ui.lostConnection, ui.lostConnection));
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 1500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [language, request, run?.id, run?.status, runToken, ui.lostConnection]);

  const startPrebuilt = async () => {
    if (!selectedScenarioId) return;
    setBusy(true);
    setError("");
    try {
      const created = await request<{ run_id: number; access_token: string }>(
        "/api/audience-simulations/campaigns/" + encodeURIComponent(code) + "/prebuilt-runs",
        { method: "POST", body: JSON.stringify({ scenario_id: selectedScenarioId, language }) },
      );
      sessionStorage.setItem("audience-simulation:" + code, JSON.stringify({ runId: created.run_id, token: created.access_token, language }));
      const ready = await request<SimRun>("/api/audience-simulations/runs/" + created.run_id, {}, created.access_token);
      setRun(ready);
      setRunToken(created.access_token);
      setSelectedGroups(Array.from(new Set((ready.selection.members || []).map((person) => person.group))));
      setAudienceSize(ready.selection.members?.length || 100);
      setActiveSlide(2);
    } catch (reason) {
      setError(localizedError(reason, ui.openReadyScenarioError, ui.lostConnection));
    } finally {
      setBusy(false);
    }
  };

  const confirmAudience = async () => {
    if (!run) return;
    setBusy(true);
    setError("");
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    // Show the next stage immediately; request latency should not leave the button spinning on this screen.
    setActiveSlide(4);
    try {
      // Audience confirmation is not polled while the user is reviewing it. Refresh the run
      // first so a stale selection version cannot trigger a 409 on the start request.
      let latest = await request<SimRun>("/api/audience-simulations/runs/" + run.id, {}, runToken);
      setRun(latest);
      if (latest.status === "interviewing") {
        lastAutoStatusRef.current = latest.status;
        return;
      }
      if (["completed", "partial"].includes(latest.status)) {
        setActiveSlide(5);
        return;
      }
      if (latest.status !== "awaiting_audience_confirmation") {
        throw new Error(language === "en" ? ui.audienceChanged : "Состав аудитории уже изменился. Вернитесь к его просмотру и запустите исследование ещё раз.");
      }
      const latestMembers = latest.selection.members || [];
      const currentGroups = selectedGroups.filter((group) => latestMembers.some((person) => person.group === group));
      const included = latestMembers.filter((person) => currentGroups.includes(person.group));
      const safeSize = Math.min(audienceSize, included.length);
      if (safeSize < (config?.limits.min_audience || 5)) {
        setActiveSlide(3);
        setSelectedGroups(Array.from(new Set(latestMembers.map((person) => person.group))));
        throw new Error(language === "en" ? ui.audienceUpdated : "Состав аудитории обновился. Проверьте выбранные группы и запустите исследование ещё раз.");
      }
      if (selectedScenarioId) {
        const completed = await request<SimRun>(
          "/api/audience-simulations/runs/" + latest.id + "/start?selection_version=" + latest.selection.version,
          { method: "POST" },
          runToken,
        );
        setRun(completed);
        setDemoProgress(0);
        lastAutoStatusRef.current = completed.status;
      } else {
        const selection = await request<SimRun["selection"]>("/api/audience-simulations/runs/" + latest.id + "/selection", {
          method: "PATCH",
          body: JSON.stringify({
            selection_version: latest.selection.version,
            size: safeSize,
            include_groups: currentGroups,
            constraints: constraints.trim() || null,
          }),
        }, runToken);
        const response = await request<{ status: string }>(
          "/api/audience-simulations/runs/" + latest.id + "/start?selection_version=" + selection.version,
          { method: "POST" },
          runToken,
        );
        setRun({ ...latest, selection, status: response.status });
        lastAutoStatusRef.current = response.status;
      }
      setAudienceSize(safeSize);
    } catch (reason) {
      const message = localizedError(reason, ui.confirmAudienceError, ui.lostConnection);
      setError(message);
      try {
        const latest = await request<SimRun>("/api/audience-simulations/runs/" + run.id, {}, runToken);
        setRun(latest);
        if (latest.status === "awaiting_audience_confirmation") {
          setSelectedGroups(Array.from(new Set((latest.selection.members || []).map((person) => person.group))));
          setActiveSlide(3);
        } else if (["completed", "partial"].includes(latest.status)) setActiveSlide(5);
        else if (latest.status === "interviewing") setActiveSlide(4);
      } catch {
        setActiveSlide(3);
      }
    } finally {
      setBusy(false);
    }
  };

  const continueWithoutSearch = async () => {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/audience-simulations/runs/" + run.id + "/continue-without-search", { method: "POST" }, runToken);
      lastAutoStatusRef.current = "preparing";
      setRun({ ...run, status: "preparing" });
    } catch (reason) {
      setError(localizedError(reason, ui.continueError, ui.lostConnection));
    } finally {
      setBusy(false);
    }
  };

  const retryPreparation = async () => {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      const response = await request<{ status: string }>(
        "/api/audience-simulations/runs/" + run.id + "/retry-preparation",
        { method: "POST" },
        runToken,
      );
      lastAutoStatusRef.current = response.status;
      setRun({ ...run, status: response.status, aggregate: null });
    } catch (reason) {
      setError(localizedError(reason, ui.retryError, ui.lostConnection));
    } finally {
      setBusy(false);
    }
  };

  const reviseIdea = async () => {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/audience-simulations/runs/" + run.id + "/cancel", { method: "POST" }, runToken);
      sessionStorage.removeItem("audience-simulation:" + code);
      setRun(null);
      setRunToken("");
      setActiveSlide(1);
    } catch (reason) {
      setError(localizedError(reason, ui.cancelError, ui.lostConnection));
    } finally {
      setBusy(false);
    }
  };

  const makeClaimLink = useCallback(async () => {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ token: string }>("/api/audience-simulations/runs/" + run.id + "/claim-links", { method: "POST" }, runToken);
      setClaimToken(result.token);
    } catch (reason) {
      setError(localizedError(reason, ui.qrError, ui.lostConnection));
    } finally {
      setBusy(false);
    }
  }, [language, request, run, runToken, ui.qrError]);

  const reset = () => {
    sessionStorage.removeItem("audience-simulation:" + code);
    setRun(null);
    setRunToken("");
    setClaimToken("");
    setSelectedResponseId("");
    setSelectedGroups([]);
    setExpandedPersona(null);
    setShowAudienceControls(false);
    setConstraints("");
    setAudienceSize(100);
    setError("");
    setActiveSlide(0);
    setSelectedScenarioId("");
    setDemoProgress(0);
    setAudienceReveal(0);
  };

  const personas = useMemo(() => run?.selection.members || [], [run?.selection.members]);
  const progress = selectedScenarioId && activeSlide === 4 && run?.status === "completed"
    ? demoProgress
    : run?.aggregate?.valid_responses ?? run?.responses.length ?? 0;
  const groups = useMemo(() => Array.from(new Set(personas.map((persona) => persona.group))), [personas]);
  const chosenCount = personas.filter((person) => selectedGroups.includes(person.group)).length;
  const isFinished = Boolean(run && ["completed", "partial"].includes(run.status));
  const maxSlide = !run
    ? 1
    : run.status === "awaiting_audience_confirmation"
      ? 3
      : run.status === "interviewing"
        ? 4
        : isFinished
          ? 7
          : 2;
  const referenceRates = run?.scenario_id ? run.summary?.extended_report?.reference_percent_at_least_7 : undefined;
  const validRate = referenceRates?.problem_relevance ?? run?.aggregate?.percent_at_least_7?.problem_relevance;
  const interestRate = referenceRates?.interest ?? run?.aggregate?.percent_at_least_7?.interest;
  const tryRate = referenceRates?.willingness_to_try ?? run?.aggregate?.percent_at_least_7?.willingness_to_try;
  const activeResponse = run?.responses.find((response) => response.persona_id === (hoveredResponseId || selectedResponseId));
  const reactionActiveIds = useMemo(() => activeResponse ? new Set([activeResponse.persona_id]) : undefined, [activeResponse?.persona_id]);
  const plottedResponseCount = run?.responses.filter((response) => response.included !== false && typeof response.interest === "number" && typeof response.problem_relevance === "number" && typeof response.willingness_to_try === "number").length || 0;
  const excludedResponseCount = run?.responses.filter((response) => response.included === false || typeof response.interest !== "number" || typeof response.problem_relevance !== "number" || typeof response.willingness_to_try !== "number").length || 0;
  const selectedMarkets = new Set((run?.selection.members || []).map((person) => person.market).filter(Boolean));
  const consumerIdeaWithBusinessPanel = Boolean(run && (run.scenario_id === "calorie-photo" || /калор|питан|похуд|рацион|фитнес|трениров|сон|здоров/i.test(run.idea)) && selectedMarkets.has("business") && !selectedMarkets.has("consumer"));
  const sourcedCount = run?.findings.filter((finding) => finding.source_ids.length > 0).length || 0;
  const searchingLabel = run?.status === "awaiting_search_fallback"
    ? ui.searchNotFound
    : run?.status === "awaiting_audience_confirmation"
      ? ui.searchReady
      : run?.status === "failed"
        ? ui.searchStopped
        : run?.evidence.length
          ? (run.evidence.some((source) => source.fetch_status === "opened") && !selectedScenarioId
              ? `${language === "en" ? "Pages opened" : "Открыто страниц"}: ${run.evidence.filter((source) => source.fetch_status === "opened").length} · ${ui.checkingQuotes}`
              : ui.linkingSignals)
          : ui.connectingSearch;

  const goToSlide = useCallback((index: number) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setExpandedPersona(null);
    setActiveSlide(Math.max(0, Math.min(maxSlide, index)));
    setError("");
  }, [maxSlide]);

  useEffect(() => {
    setSlideEntranceDone(false);
    const timer = window.setTimeout(() => setSlideEntranceDone(true), 600);
    return () => window.clearTimeout(timer);
  }, [activeSlide]);

  useEffect(() => {
    if (!expandedPersona) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedPersona(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expandedPersona]);

  useEffect(() => {
    if (activeSlide === 7 && isFinished && !claimToken && !busy) void makeClaimLink();
  }, [activeSlide, busy, claimToken, isFinished, makeClaimLink]);

  useEffect(() => {
    if (activeSlide !== 3) return;
    setAudienceReveal(0);
    const total = run?.selection.members?.length || 100;
    const revealStep = Math.max(1, Math.ceil(total / 30));
    let current = 0;
    let tick = 0;
    let timer = 0;
    const reveal = () => {
      current = Math.min(total, current + revealStep);
      tick += 1;
      setAudienceReveal(current);
      if (current < total) timer = window.setTimeout(reveal, tick % 5 === 0 ? 600 + Math.floor(Math.random() * 801) : 160 + Math.floor(Math.random() * 161));
    };
    timer = window.setTimeout(reveal, 3000);
    return () => window.clearTimeout(timer);
  }, [activeSlide, run?.selection.members?.length]);

  useEffect(() => {
    if (activeSlide !== 4 || !isFinished || !selectedScenarioId) return;
    setDemoProgress(0);
    const total = run?.responses.length || 100;
    let current = 0;
    let answersInBatch = 0;
    let batchSize = 1 + Math.floor(Math.random() * 7);
    let timer = 0;
    const answerNext = () => {
      current = Math.min(total, current + 1);
      setDemoProgress(current);
      if (current >= total) {
        timer = window.setTimeout(() => setActiveSlide(5), 900);
        return;
      }
      answersInBatch += 1;
      if (answersInBatch >= batchSize) {
        answersInBatch = 0;
        batchSize = 1 + Math.floor(Math.random() * 7);
        timer = window.setTimeout(answerNext, 1000 + Math.floor(Math.random() * 4001));
      } else {
        timer = window.setTimeout(answerNext, 125);
      }
    };
    timer = window.setTimeout(answerNext, 500);
    return () => window.clearTimeout(timer);
  }, [activeSlide, isFinished, run?.responses.length, selectedScenarioId]);

  const openedSourceCount = run?.evidence.filter((source) => source.fetch_status === "opened").length || 0;
  const demoSearchStats = selectedScenarioId ? run?.demo_search_stats : null;
  const sourceCategories = [
    { title: ui.reviews, note: demoSearchStats ? ui.reviewsScenario : ui.reviewsFound, color: "cyan", count: demoSearchStats?.categories.reviews ?? run?.evidence.filter((source) => /market|ozon|wildberries|otzovik/i.test(source.domain)).length ?? 0 },
    { title: ui.communities, note: demoSearchStats ? ui.reviewsScenario : ui.reviewsFound, color: "violet", count: demoSearchStats?.categories.communities ?? run?.evidence.filter((source) => /habr|vc\.ru|reddit|forum|community/i.test(source.domain)).length ?? 0 },
    { title: ui.searchMaterials, note: demoSearchStats ? ui.reviewsScenario : ui.reviewsFound, color: "gold", count: demoSearchStats?.categories.search_materials ?? run?.evidence.filter((source) => !/market|ozon|wildberries|otzovik|habr|vc\.ru|reddit|forum|community/i.test(source.domain)).length ?? 0 },
    { title: ui.recurringSignals, note: demoSearchStats ? ui.linkedFindings : ui.linkedToSources, color: "mint", count: demoSearchStats?.linked_findings ?? sourcedCount },
  ];
  const [sourceCounterProgress, setSourceCounterProgress] = useState(0);
  const sourceCountsKey = sourceCategories.map((category) => category.count).join(":");
  useEffect(() => {
    if (activeSlide !== 2 || !selectedScenarioId) {
      setSourceCounterProgress(1);
      return;
    }
    setSourceCounterProgress(0);
    const started = performance.now();
    let frame = 0;
    const activeDuration = 18000;
    const activeBeforePause = 1800;
    const pauseDuration = 800;
    const animate = (now: number) => {
      // Let the source-search screen settle before any counters begin moving.
      const elapsed = Math.max(0, now - started - 3000);
      const cycle = activeBeforePause + pauseDuration;
      const completedCycles = Math.floor(elapsed / cycle);
      const currentCycleElapsed = elapsed % cycle;
      const activeElapsed = completedCycles * activeBeforePause + Math.min(currentCycleElapsed, activeBeforePause);
      const progress = Math.min(1, activeElapsed / activeDuration);
      setSourceCounterProgress(progress);
      if (progress < 1) frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [activeSlide, selectedScenarioId, sourceCountsKey]);
  const displayCount = (count: number) => Math.max(0, Math.floor(count * sourceCounterProgress));
  const sourceStageReady = Boolean(run?.status === "awaiting_audience_confirmation" && slideEntranceDone && (!selectedScenarioId || sourceCounterProgress >= 1));
  const audienceStageReady = Boolean(slideEntranceDone && audienceReveal >= personas.length);
  const nextEnabled = activeSlide === 1
    ? (run ? !busy : Boolean(selectedScenarioId) && !busy)
    : activeSlide === 2 ? sourceStageReady || (run?.status === "awaiting_search_fallback" && slideEntranceDone && !busy)
      : activeSlide === 3 ? audienceStageReady && !busy && chosenCount >= 5
        : activeSlide === 4 ? Boolean(isFinished && slideEntranceDone && (selectedScenarioId ? progress >= (run?.responses.length || 0) : true))
          : activeSlide === 5 || activeSlide === 6 ? slideEntranceDone
            : activeSlide === 7 ? !claimToken && !busy : false;
  const nextLabel = activeSlide === 1
    ? (run ? ui.toSources : ui.startScenario)
    : activeSlide === 2 ? (run?.status === "awaiting_search_fallback" ? ui.continueWithoutSources : ui.toAudience)
      : activeSlide === 3 ? (busy ? ui.prepareResearch : ui.launchResearch)
        : activeSlide === 4 ? (isFinished && (selectedScenarioId ? progress >= (run?.responses.length || 0) : true) ? ui.toResponseMap : ui.collectingResponses)
          : activeSlide === 5 ? ui.toInsights
            : activeSlide === 6 ? ui.openResult
                : ui.createQr;
  const handleNext = () => {
    if (!nextEnabled) return;
    if (activeSlide === 1) {
      if (run) goToSlide(2);
      else void startPrebuilt();
    } else if (activeSlide === 2) {
      if (run?.status === "awaiting_search_fallback") void continueWithoutSearch();
      else goToSlide(3);
    } else if (activeSlide === 3) void confirmAudience();
    else if (activeSlide === 4) goToSlide(5);
    else if (activeSlide === 5) goToSlide(6);
    else if (activeSlide === 6) goToSlide(7);
    else if (activeSlide === 7) void makeClaimLink();
  };
  const handleBack = () => goToSlide(activeSlide - 1);

  return (
    <main className="audience-stage">
      <div className="audience-screen">
        <div className="audience-scene" aria-hidden="true" />
        <header className="audience-topbar">
          <div className="audience-brand">Pitchy<i>.pro</i></div>
          <div className="audience-topnote">{ui.topNote}</div>
        </header>

        {error && (
          <div className="audience-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} aria-label={ui.closeError}>×</button>
          </div>
        )}

        {!config && !error && (
          <div className="audience-loading" aria-label={ui.loadingCampaign}><Loader size={18} className="audience-spin" /></div>
        )}

        {config && <div className="audience-slides">
          <section className={"audience-slide hero-slide" + (activeSlide === 0 ? " is-active" : "")} inert={activeSlide !== 0}>
            <div className="hero-art-frame" aria-hidden="true">
              <Image
                src="/images/audience-simulation/hero-scene.png"
                alt=""
                fill
                preload
                sizes="100vw"
                className="hero-art"
              />
            </div>
            <div className="hero-art-shade" aria-hidden="true" />
            <h1 className="audience-title hero-title">{language === "en" ? <>{ui.heroLineOne}<br />{ui.heroLineTwo}<br /><span className="audience-shine">{ui.heroLineThree}</span></> : <>Как люди<br />отреагируют<br />на <span className="audience-shine">вашу идею?</span></>}</h1>
            <p className="audience-lead hero-lead">{ui.heroLead}</p>
            <div className="audience-glowline" />
            <button type="button" className="language-toggle" onClick={() => switchLanguage(language === "ru" ? "en" : "ru")} aria-label={ui.languageButtonLabel}>{ui.languageButton}</button>
            <button type="button" className="slide-hit-target" onClick={() => goToSlide(1)} aria-label={ui.beginLabel} />
          </section>

          <section className={"audience-slide idea-slide" + (activeSlide === 1 ? " is-active" : "")} inert={activeSlide !== 1}>
            <p className="audience-eyebrow">{ui.ideaEyebrow}</p>
            <h2 className="audience-title">{language === "ru" ? <>Что<br />проверяем?</> : ui.ideaTitle}</h2>
            <div className="prebuilt-picker">
              <div className="prebuilt-list">
                {prebuiltScenarios.map((scenario) => <button type="button" key={scenario.id} className={"prebuilt-option" + (selectedScenarioId === scenario.id ? " is-selected" : "")} onClick={() => setSelectedScenarioId(scenario.id)} aria-pressed={selectedScenarioId === scenario.id}>
                  <Image src={scenario.image} alt="" fill sizes="(max-width: 600px) 42vw, 250px" className="prebuilt-option-image" />
                  <strong>{language === "en" ? scenarioCardsEn[scenario.id]?.title || scenario.title : scenario.title}</strong><span>{language === "en" ? scenarioCardsEn[scenario.id]?.note || scenario.note : scenario.note}</span>
                </button>)}
              </div>
            </div>
          </section>

          <section className={"audience-slide sources-slide" + (activeSlide === 2 ? " is-active" : "")} inert={activeSlide !== 2}>
            <p className="audience-eyebrow">{ui.sourceEyebrow}</p>
            <h2 className="audience-title">{language === "en" ? <>{ui.sourceTitleOne}<br /><span className="audience-shine">{ui.sourceTitleTwo}</span></> : <>Сначала слушаем<br /><span className="audience-shine">рынок</span></>}</h2>
            <p className="audience-lead">{ui.sourceLead}</p>
            <div className="source-stats">
              <div className="audience-card"><strong>{displayCount(demoSearchStats?.mentions ?? run?.evidence.length ?? 0)}</strong><span>{demoSearchStats ? ui.scenarioSources : ui.sourcesFound}</span></div>
              <div className="audience-card"><strong>{displayCount(demoSearchStats?.bundle_links ?? (selectedScenarioId ? run?.evidence.length || 0 : openedSourceCount))}</strong><span>{selectedScenarioId ? ui.bundleLinks : ui.pagesOpened}</span></div>
              <div className="audience-card"><strong>{displayCount(demoSearchStats?.linked_findings ?? sourcedCount)}</strong><span>{selectedScenarioId ? ui.linkedSignals : ui.signalsConfirmed}</span></div>
            </div>
            <div className="source-grid">
              {sourceCategories.map((category) => (
                <div className={"source-card source-" + category.color} key={category.title}>
                  <i className="source-mark" />
                  <span>{category.title}<small>{category.note} · {displayCount(category.count)}</small></span>
                </div>
              ))}
            </div>
            <p className="search-readout">{searchingLabel}{run?.status === "preparing" ? <span className="typing-dots">...</span> : null}</p>
            <div className={"signal-sweep" + (sourceStageReady ? " is-complete" : "")}><i /></div>
            {run?.evidence.length ? (
              <details className="source-disclosure">
                <summary>{ui.sourceList} · {run.evidence.length}</summary>
                <div className="source-links">
                  {run.evidence.slice(0, 20).map((source) => (
                    <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="source-link">
                      <span>{source.domain} · {source.fetch_status === "opened" ? ui.pageOpened : source.fetch_status === "blocked" ? ui.addressBlocked : source.fetch_status === "referenced" ? ui.sourceReference : source.fetch_status || ui.notChecked}</span>{source.page_title || source.title || source.url}
                    </a>
                  ))}
                </div>
              </details>
            ) : null}
            {run?.findings.some((finding) => finding.evidence?.length) && (
              <details className="source-disclosure verified-disclosures">
                <summary>{ui.verifiedQuotes} · {sourcedCount}</summary>
                <div className="source-links">
                  {run.findings.filter((finding) => finding.evidence?.length).slice(0, 8).map((finding, index) => (
                    <div className="verified-quote" key={`${finding.source_ids.join(",")}-${index}`}>
                      <strong>{finding.text}</strong>
                      {finding.evidence?.map((item) => {
                        const source = run.evidence.find((entry) => entry.id === item.source_id);
                        return <blockquote key={`${item.source_id}-${item.quote}`}><q>{item.quote}</q>{source && <a href={source.url} target="_blank" rel="noreferrer">{source.domain} ↗</a>}</blockquote>;
                      })}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {run?.status === "awaiting_search_fallback" && (
              <div className="fallback-actions">
                <p>{ui.fallbackText}</p>
                <button type="button" className="text-action" disabled={busy} onClick={() => void reviseIdea()}>{ui.chooseAnotherScenario}</button>
              </div>
            )}
            {run?.status === "failed" && (
              <div className="fallback-actions">
                {run.aggregate?.retryable && (
                  <button type="button" className="audience-cta" disabled={busy} onClick={() => void retryPreparation()}>
                    {busy ? <Loader size={14} className="audience-spin" /> : <RotateCcw size={14} />}
                    {run.evidence.length ? ui.retrySourceProcessing : ui.retryPreparation}
                  </button>
                )}
                <button type="button" className="text-action" onClick={reset}>{ui.restart}</button>
              </div>
            )}
            <p className="source-foot">{demoSearchStats ? ui.demoSourceFoot : ui.sourceFoot}</p>
          </section>

          <section className={"audience-slide audience-build-slide" + (activeSlide === 3 ? " is-active" : "")} inert={activeSlide !== 3}>
            <p className="audience-eyebrow">{ui.audienceEyebrow}</p>
            <h2 className="audience-title">{language === "en" ? <>{ui.audienceTitleOne}<br /><span className="audience-shine">{ui.audienceTitleTwo}</span></> : <>Персоны<br /><span className="audience-shine">под вашу идею</span></>}</h2>
            <p className="audience-lead">{ui.audienceLead}</p>
            <div className="candidate-label"><span>{audienceReveal >= personas.length ? (language === "en" ? statusTextEn : statusText)[run?.status || "preparing"] : ui.buildingProfiles}</span><span>{audienceReveal} / {personas.length} · {chosenCount} {ui.selected}</span></div>
            <div className="persona-card-list" aria-live="polite">
              {personas.slice(0, audienceReveal).map((person, index) => {
                const details = getPersonaDetails(person, language);
                const facts = [
                  [ui.age, details.age],
                  [ui.city, details.city],
                  [ui.occupation, details.occupation],
                  [ui.income, details.income],
                ].filter((fact): fact is [string, string] => Boolean(fact[1]));
                const groupLabel = language === "en" ? groupLabelsEn[person.group] || ui.profile : person.group;
                return <button type="button" className="persona-card" key={person.id} onClick={() => setExpandedPersona(person)} aria-label={`${ui.personaAria}: ${details.name}`} style={{ animationDelay: `${Math.min(index * 25, 400)}ms` }}>
                  <div className="persona-avatar" aria-hidden="true"><i /></div>
                  <div className="persona-card-copy">
                    <div className="persona-card-meta"><span>ID {person.id.slice(-6).toUpperCase()}</span><b style={{ color: palette[Math.max(0, groups.indexOf(person.group)) % palette.length] }}>{groupLabel}</b></div>
                    <strong>{details.name}</strong>
                    <div className="persona-facts">{facts.map(([label, value]) => <span key={label}><b>{label}</b>{value}</span>)}</div>
                    {details.behaviors.length > 0 && <p className="persona-behavior"><b>{ui.habits}</b>{details.behaviors.slice(0, 2).join(" · ")}</p>}
                  </div>
                </button>;
              })}
              {!audienceReveal && <p className="persona-card-empty">{ui.matchingAudience}</p>}
            </div>
            <p className="audience-helper"><span>{ui.clickForProfile}</span> <button type="button" className="audience-edit-link" onClick={() => setShowAudienceControls((value) => !value)} aria-expanded={showAudienceControls}>{ui.configureAudience}</button></p>
            <div className={"audience-editor" + (showAudienceControls ? " is-open" : "")} inert={!showAudienceControls}>
              <div className="editor-heading"><strong>{ui.audienceComposition}</strong><button type="button" onClick={(event) => { event.currentTarget.blur(); setShowAudienceControls(false); }}>{ui.done}</button></div>
              <div className="group-picker">
              {groups.map((group, index) => {
                const count = personas.filter((person) => person.group === group).length;
                const active = selectedGroups.includes(group);
                return (
                  <button type="button" disabled={Boolean(selectedScenarioId)} className={"group-toggle " + (active ? "selected" : "")} key={group} onClick={() => {
                    const next = active ? selectedGroups.filter((item) => item !== group) : [...selectedGroups, group];
                    if (!next.length || personas.filter((person) => next.includes(person.group)).length < (config?.limits.min_audience || 5)) {
                      setError(ui.minimumProfiles);
                      return;
                    }
                    setSelectedGroups(next);
                    setAudienceSize((current) => Math.min(current, personas.filter((person) => next.includes(person.group)).length));
                    setError("");
                  }}>
                    <i style={{ backgroundColor: palette[index % palette.length] }} />{language === "en" ? groupLabelsEn[group] || ui.profile : group}<small>{count}</small>
                  </button>
                );
              })}
              </div>
              <div className="preview-controls">
                {selectedScenarioId
                  ? <p className="fixed-panel-note">{ui.readyScenarioNote.replace("{count}", String(personas.length))}</p>
                  : <label>{ui.panelSize}
                    <select value={Math.min(audienceSize, Math.max(chosenCount, 5))} onChange={(event) => setAudienceSize(Number(event.target.value))}>
                      {[5, 8, 12, 25, 50, 75, 100].filter((value) => value <= chosenCount).map((value) => <option key={value} value={value}>{value} {ui.people}</option>)}
                    </select>
                  </label>}
                {!selectedScenarioId && <label className="constraints-field">{ui.constraints}
                  <input value={constraints} onChange={(event) => setConstraints(event.target.value)} maxLength={1200} placeholder={ui.optional} />
                </label>}
              </div>
            </div>
          </section>

          <section className={"audience-slide interview-slide" + (activeSlide === 4 ? " is-active" : "")} inert={activeSlide !== 4}>
            <p className="audience-eyebrow">{ui.interviewEyebrow}</p>
            <h2 className="audience-title">{language === "en" ? <>{ui.interviewTitleOne}<br /><span className="audience-shine">{ui.interviewTitleTwo}</span></> : <>Собираем<br /><span className="audience-shine">реакции аудитории</span></>}</h2>
            <div className="candidate-label"><span>{busy ? ui.startingResearch : progress ? ui.respondingInGroups : ui.connectingPersonas}</span><span>{progress} / {personas.length || audienceSize}</span></div>
            <div className="interview-network">
              <PersonaNetwork members={personas} responses={[]} mode="crowd" language={language} litIds={new Set((run?.responses || []).slice(0, progress).map((response) => response.persona_id))} activeIds={progress ? new Set([(run?.responses || [])[Math.min(progress, (run?.responses.length || 1)) - 1]?.persona_id || ""]) : undefined} />
            </div>
            <div className="people-count"><strong>{progress}</strong><span>/ {personas.length || audienceSize} {ui.answers}</span></div>
            <div className="audience-meter"><i style={{ width: (personas.length ? Math.min(100, (progress / personas.length) * 100) : 0) + "%" }} /></div>
          </section>

          <section className={"audience-slide reaction-slide" + (activeSlide === 5 ? " is-active" : "")} inert={activeSlide !== 5}>
            <p className="audience-eyebrow">{ui.mapEyebrow}</p>
            <h2 className="audience-title">{language === "en" ? <>{ui.mapTitleOne}<br /><span className="audience-shine">{ui.mapTitleTwo}</span></> : <>Реакция<br /><span className="audience-shine">аудитории</span></>}</h2>
            <div className="reaction-map">
              <PersonaNetwork members={personas} responses={run?.responses || []} mode="map" language={language} activeIds={reactionActiveIds} onPick={(id) => setSelectedResponseId(id)} onHover={(id) => setHoveredResponseId(id || "")} />
              <span className="map-axis-y">{ui.problemAxis}</span>
              <span className="map-axis-x">{ui.tryAxis}</span>
              {excludedResponseCount > 0 && <span className="map-excluded-key">× {ui.excluded} · {excludedResponseCount}</span>}
              <div className="reaction-hover-card" aria-live="polite">{activeResponse && <><span>{language === "en" ? groupLabelsEn[activeResponse.group || ""] || ui.profile : activeResponse.group || "Персона"} · {activeResponse.included === false ? ui.excludedShort : ui.included}</span><div className="reaction-scores"><b>{ui.problem} {activeResponse.problem_relevance ?? "—"}</b><b>{ui.interest} {activeResponse.interest ?? "—"}</b><b>{ui.tryIt} {activeResponse.willingness_to_try ?? "—"}</b></div><p>{activeResponse.reaction || (activeResponse.exclusion_reason ? (language === "en" ? exclusionLabelsEn[activeResponse.exclusion_reason] : exclusionReasonLabels[activeResponse.exclusion_reason]) || activeResponse.exclusion_reason : ui.noShortAnswer)}</p></>}</div>
            </div>
            <p className="reaction-validity">{ui.accounted} {plottedResponseCount} · {ui.excludedCount} {excludedResponseCount}</p>
            <div className="group-counts">
              {groups.map((group, index) => <span key={group}><b style={{ color: palette[index % palette.length] }}>{run?.responses.filter((response) => response.group === group).length || 0}</b>{language === "en" ? groupLabelsEn[group] || ui.profile : group}</span>)}
              {!groups.length && <span><b>{run?.responses.length || 0}</b>{ui.answers}</span>}
            </div>
          </section>

          <section className={"audience-slide insights-slide" + (activeSlide === 6 ? " is-active" : "")} inert={activeSlide !== 6}>
            <p className="audience-eyebrow">{ui.insightsEyebrow}</p>
            <h2 className="audience-title">{language === "en" ? <>{ui.insightsTitleOne}<br /><span className="audience-shine">{ui.insightsTitleTwo}</span></> : <>Что говорит<br /><span className="audience-shine">аудитория</span></>}</h2>
            <div className="primary-result">{typeof validRate === "number" ? validRate + "%" : "—"}</div>
            <div className="result-label">{ui.problemThreshold}</div>
            <p className="result-validity">{ui.accounted} {run?.aggregate?.valid_responses ?? progress} · {ui.excludedCount} {run?.aggregate?.excluded_responses ?? excludedResponseCount}</p>
            {consumerIdeaWithBusinessPanel && <div className="audience-mismatch-note">{ui.businessMismatch}</div>}
            <div className="audience-meter"><i style={{ width: (typeof validRate === "number" ? validRate : 0) + "%" }} /></div>
            <div className="result-row">
              <div className="audience-card result-card"><strong>{typeof interestRate === "number" ? interestRate + "%" : "—"}</strong><span>{ui.interestSeven}</span></div>
              <div className="audience-card result-card"><strong>{typeof tryRate === "number" ? tryRate + "%" : "—"}</strong><span>{ui.trySeven}</span></div>
            </div>
            <div className="insight-list">
              {(run?.summary?.observations || []).filter((item) => !/фото не гарантирует точный размер порции/i.test(item)).slice(0, 2).map((item, index) => <div className="insight-item" key={item}><i style={{ backgroundColor: palette[index % palette.length], color: palette[index % palette.length] }} /><span>{item}</span></div>)}
              {!(run?.summary?.observations || []).some((item) => !/фото не гарантирует точный размер порции/i.test(item)) && <div className="insight-item"><i /><span>{ui.responseCount.replace("{count}", String(progress))}</span></div>}
            </div>
          </section>

          <section className={"audience-slide result-slide" + (activeSlide === 7 ? " is-active" : "")} inert={activeSlide !== 7}>
            <p className="audience-eyebrow">{ui.resultReady}</p>
            <h2 className="audience-title">{language === "en" ? <>{ui.continueStudying}<br /><span className="audience-shine">{ui.yourIdea}</span></> : <>Продолжите<br />изучать свою<br /><span className="audience-shine">идею</span></>}</h2>
            <p className="audience-lead">{ui.scanQr}</p>
            {claimToken ? (
              <div className="qr-layout">
                <Image className="qr-image" src={"/api/audience-simulations/claims/" + encodeURIComponent(claimToken) + "/qr" + (language === "en" ? "?lang=en" : "")} width={144} height={144} unoptimized alt={ui.qrAlt} />
                <div className="qr-caption"><strong>{language === "en" ? <>Open your result<br />on your phone</> : <>Откройте результат<br />на телефоне</>}</strong><a href={"/audience-simulation/claim/" + encodeURIComponent(claimToken) + (language === "en" ? "?lang=en" : "")}>{typeof window !== "undefined" ? window.location.host : "pitchy.pro"}/audience-simulation/claim/…</a></div>
              </div>
            ) : (
              <div className="qr-create-prompt">{ui.createQrPrompt}</div>
            )}
            <div className="audience-glowline result-glowline" />
            {claimToken && <button type="button" onClick={reset} className="reset-run"><RotateCcw size={14} /> {ui.newRun}</button>}
          </section>
        </div>}

        {expandedPersona && activeSlide === 3 && (() => {
          const details = getPersonaDetails(expandedPersona, language);
          const location = [details.city, details.region].filter(Boolean).join(", ");
          const facts = [
            [ui.age, details.age],
            [ui.cityAndRegion, [location, details.citySize].filter(Boolean).join(" · ")],
            [ui.occupation, details.occupation],
            [ui.professionalRole, details.businessRole || undefined],
            [ui.income, details.income],
            [ui.household, details.household],
          ].filter((fact): fact is [string, string] => Boolean(fact[1]));
          const familiarityLabels: Record<string, string> = { high: ui.confidently, medium: ui.familiar, low: ui.beginner };
          const familiarity = Object.entries(details.traits.domain_familiarity || {});
          const scoreLabels = language === "en" ? behaviorLabelsEn : behaviorScoreLabels;
          const domains = language === "en" ? domainLabelsEn : domainLabels;
          const scores = Object.entries(details.traits.behavior || {}).filter(([key]) => scoreLabels[key]);
          const groupLabel = language === "en" ? groupLabelsEn[expandedPersona.group] || ui.profile : expandedPersona.group;
          return <div className="persona-modal-backdrop">
            <section className="persona-modal" role="dialog" aria-modal="true" aria-labelledby="persona-modal-title" tabIndex={-1}>
              <header className="persona-modal-header">
                <div><span>ID {expandedPersona.id.slice(-6).toUpperCase()} · {ui.profileDetails}</span><h2 id="persona-modal-title">{details.name}</h2><p>{groupLabel}</p></div>
                <button type="button" className="persona-modal-close" autoFocus onClick={() => setExpandedPersona(null)} aria-label={ui.closeError}>×</button>
              </header>
              {facts.length > 0 && <div className="persona-modal-facts">{facts.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
              {details.behaviors.length > 0 && <section className="persona-modal-section"><h3>{ui.everydayHabits}</h3><ul>{details.behaviors.map((behavior) => <li key={behavior}>{behavior}</li>)}</ul></section>}
              {details.decisionStyle.length > 0 && <section className="persona-modal-section"><h3>{ui.decisionStyle}</h3><ul>{details.decisionStyle.map((item) => <li key={item}>{item}</li>)}</ul></section>}
              {familiarity.length > 0 && <section className="persona-modal-section"><h3>{ui.digitalFamiliarity}</h3><div className="persona-modal-tags">{familiarity.map(([domain, value]) => <span key={domain}><b>{domains[domain] || domain.replaceAll("_", " ")}</b>{familiarityLabels[value] || value}</span>)}</div></section>}
              {scores.length > 0 && <section className="persona-modal-section"><h3>{ui.choiceStyle}</h3><div className="persona-score-list">{scores.map(([key, value]) => <div key={key}><span>{scoreLabels[key]}</span><b>{value} {ui.outOfFive}</b></div>)}</div></section>}
            </section>
          </div>;
        })()}

        {activeSlide > 0 && <nav className="audience-step-nav" aria-label={ui.stages}>
          <button type="button" className="step-back" onClick={handleBack} aria-label={ui.back}><ArrowLeft size={18} /></button>
          {activeSlide < 7 || !claimToken ? <button type="button" className="step-next" disabled={!nextEnabled} onClick={handleNext}>
            {busy && [1, 3, 7].includes(activeSlide) ? <Loader size={15} className="audience-spin" /> : null}{nextLabel}<ArrowRight size={17} />
          </button> : null}
        </nav>}
        <div className="audience-progress"><i style={{ width: ((activeSlide + 1) / 8) * 100 + "%" }} /></div>

      </div>
    </main>
  );
}
