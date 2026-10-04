"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowRight,
  Check,
  Loader,
  RotateCcw,
  Search,
} from "react-feather";
import "../audience-operator.css";

type CampaignConfig = {
  name: string;
  limits: { min_audience: number; max_audience: number; default_audience: number };
  disclaimer: string;
};
type Persona = { id: string; market?: string; group: string; profile: string; selection_reason: string };
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
  { id: "calorie-photo", title: "ИИ-трекер калорий", note: "Фото блюда → состав, порция и калорийность" },
  { id: "english-coach", title: "Тренер разговорного английского", note: "Практика под работу, учёбу и поездки" },
  { id: "family-budget", title: "Помощник по личному бюджету", note: "План расходов до следующего дохода" },
  { id: "weekend-trip", title: "Планировщик поездки", note: "Маршрут выходного дня под ваши условия" },
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
  summary: { headline?: string; observations?: string[]; next_checks?: string[] } | null;
  events: Array<{ sequence: number; type: string; payload?: Record<string, unknown> }>;
};

const stageNames = [
  "ИДЕЯ → АУДИТОРИЯ",
  "ВАША ГИПОТЕЗА",
  "РЕАЛЬНЫЕ СИГНАЛЫ",
  "ОТБОР ПЕРСОН",
  "ПРОСМОТР АУДИТОРИИ",
  "СИМУЛЯЦИЯ",
  "КАРТА РЕАКЦИЙ",
  "ВЫВОДЫ",
  "ИТОГ → QR",
];

const statusText: Record<string, string> = {
  preparing: "Ищем сигналы и формируем аудиторию",
  awaiting_search_fallback: "Не нашли достаточно проверяемых ссылок",
  awaiting_audience_confirmation: "Аудитория собрана",
  interviewing: "Персоны отвечают на вопросы",
  completed: "Результат готов",
  partial: "Готов частичный результат",
  failed: "Не удалось подготовить запуск",
};

const palette = ["#7ce6ff", "#b48cff", "#f0bd69", "#9be5ca"];
const exclusionReasonLabels: Record<string, string> = {
  missing_required_score: "нет обязательной оценки",
  invalid_score: "оценка не целая или вне диапазона 0–10",
  response_generation_failed: "ответ не сформирован",
  response_not_received: "ответ не получен",
  persona_mismatch: "профиль ответа не совпал",
};

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function PersonaNetwork({
  members,
  responses,
  mode,
  activeIds,
  litIds,
  onPick,
}: {
  members: Persona[];
  responses: ResponsePoint[];
  mode: "crowd" | "map";
  activeIds?: Set<string>;
  litIds?: Set<string>;
  onPick?: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Array<{ x: number; y: number; id: string; color: string; excluded?: boolean }>>([]);
  const dataKey = useMemo(
    () => members.map((person) => person.id + person.group).join("|") + responses.map((person) => person.persona_id + person.willingness_to_try + person.problem_relevance + person.included + person.exclusion_reason).join("|"),
    [members, responses],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const validResponses = responses;
    const excludedResponses = responses.filter((item) => item.included === false
      || typeof item.problem_relevance !== "number"
      || typeof item.interest !== "number"
      || typeof item.willingness_to_try !== "number");

    const render = (time = 0) => {
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
          const nearest = mapped
            .map((candidate, candidateIndex) => ({
              candidate,
              candidateIndex,
              distance: Math.hypot(candidate.x - point.x, candidate.y - point.y),
            }))
            .filter((candidate) => candidate.candidateIndex > index)
            .sort((first, second) => first.distance - second.distance)
            .slice(0, 1);
          for (const neighbor of nearest) {
            if (neighbor.distance > Math.min(width, height) * 0.22) continue;
            context.beginPath();
            context.moveTo(point.x, point.y);
            context.lineTo(neighbor.candidate.x, neighbor.candidate.y);
            context.stroke();
          }
        }
      }

      const pulse = reducedMotion ? 0 : Math.sin(time / 950) * 0.18;
      for (const point of mapped) {
        const selected = Boolean(point.id && activeIds?.has(point.id));
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
          context.shadowBlur = selected ? 1.5 : 0.7;
          context.globalAlpha = selected ? 0.22 : 0.1;
          context.arc(point.x, point.y, selected ? 4.6 : 3.5, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.fillStyle = point.color;
          context.shadowBlur = 0;
          context.globalAlpha = 1;
          context.arc(point.x, point.y, selected ? 3 : 2.5, 0, Math.PI * 2);
          context.fill();
        } else {
          const glow = point.person ? 2.5 + (selected ? 2.5 : 0) : 1.5;
          context.beginPath();
          const lit = !litIds || litIds.has(point.id);
          const pointColor = lit ? point.color : "#414348";
          context.fillStyle = pointColor;
          context.shadowColor = pointColor;
          context.shadowBlur = lit ? glow : 0;
          context.globalAlpha = lit ? 0.95 : 0.38;
          context.arc(point.x, point.y, Math.max(1.4, point.radius + pulse), 0, Math.PI * 2);
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
      if (!reducedMotion) frame = window.requestAnimationFrame(render);
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [activeIds, dataKey, litIds, members, mode, responses]);

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
      onKeyDown={onPick ? pickWithKeyboard : undefined}
      role={onPick ? "application" : "img"}
      tabIndex={onPick ? 0 : undefined}
      aria-label={onPick ? "Интерактивная карта ответов. Выбирайте персоны клавишами со стрелками." : mode === "map" ? "Карта ответов: каждая точка — синтетическая персона" : "Облако синтетических персон"}
    />
  );
}

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
  const [audienceSize, setAudienceSize] = useState(100);
  const [constraints, setConstraints] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [showAudienceControls, setShowAudienceControls] = useState(false);
  const [claimToken, setClaimToken] = useState("");
  const [selectedResponseId, setSelectedResponseId] = useState("");
  const [activeSlide, setActiveSlide] = useState(0);
  const [slideEntranceDone, setSlideEntranceDone] = useState(false);
  const [showAudienceField, setShowAudienceField] = useState(false);
  const [showPriceField, setShowPriceField] = useState(false);
  const [ideaMode, setIdeaMode] = useState<"choose" | "custom" | "prebuilt">("choose");
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [demoProgress, setDemoProgress] = useState(0);
  const [audienceReveal, setAudienceReveal] = useState(0);
  const lastAutoStatusRef = useRef("");

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
    void request<CampaignConfig>("/api/audience-simulations/campaigns/" + encodeURIComponent(code) + "/config")
      .then((data) => {
        if (!active) return;
        setConfig(data);
        const saved = sessionStorage.getItem("audience-simulation:" + code);
        if (!saved) return;
        try {
          const session = JSON.parse(saved) as { runId: number; token: string };
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
              else if (savedRun.status === "interviewing") setActiveSlide(5);
              else if (["completed", "partial"].includes(savedRun.status)) setActiveSlide(6);
              else setActiveSlide(2);
            })
            .catch(() => sessionStorage.removeItem("audience-simulation:" + code));
        } catch {
          sessionStorage.removeItem("audience-simulation:" + code);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Кампания недоступна");
      });
    return () => { active = false; };
  }, [code, request]);

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
          if (next.status === "interviewing") setActiveSlide(5);
          if (["completed", "partial"].includes(next.status)) setActiveSlide(6);
        }
        if (next.status === "failed") {
          setError(next.evidence.length
            ? "Источники найдены, но не удалось обработать результат. Их можно обработать повторно."
            : "Не удалось подготовить запуск. Можно повторить попытку.");
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
    if (idea.trim().length < 20) {
      setError("Опишите идею подробнее: нужно не меньше 20 символов.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await request<{ run_id: number; access_token: string; status: string }>(
        "/api/audience-simulations/campaigns/" + encodeURIComponent(code) + "/runs",
        { method: "POST", body: JSON.stringify({ idea: idea.trim(), audience: audience.trim() || null, price: price.trim() || null }) },
      );
      sessionStorage.setItem("audience-simulation:" + code, JSON.stringify({ runId: created.run_id, token: created.access_token }));
      lastAutoStatusRef.current = created.status;
      setRunToken(created.access_token);
      setRun({
        id: created.run_id,
        status: created.status,
        revision: 1,
        idea: idea.trim(),
        audience: audience.trim() || null,
        price: price.trim() || null,
        evidence: [],
        findings: [],
        selection: {},
        responses: [],
        aggregate: null,
        summary: null,
        events: [],
      });
      setActiveSlide(2);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось запустить проверку");
    } finally {
      setBusy(false);
    }
  };

  const startPrebuilt = async () => {
    if (!selectedScenarioId) return;
    setBusy(true);
    setError("");
    try {
      const created = await request<{ run_id: number; access_token: string }>(
        "/api/audience-simulations/campaigns/" + encodeURIComponent(code) + "/prebuilt-runs",
        { method: "POST", body: JSON.stringify({ scenario_id: selectedScenarioId }) },
      );
      sessionStorage.setItem("audience-simulation:" + code, JSON.stringify({ runId: created.run_id, token: created.access_token }));
      const ready = await request<SimRun>("/api/audience-simulations/runs/" + created.run_id, {}, created.access_token);
      setRun(ready);
      setRunToken(created.access_token);
      setSelectedGroups(Array.from(new Set((ready.selection.members || []).map((person) => person.group))));
      setAudienceSize(ready.selection.members?.length || 100);
      setIdea(ready.idea);
      setAudience(ready.audience || "");
      setActiveSlide(2);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось открыть готовый сценарий");
    } finally {
      setBusy(false);
    }
  };

  const confirmAudience = async () => {
    if (!run) return;
    const included = personas.filter((person) => selectedGroups.includes(person.group));
    const safeSize = Math.min(audienceSize, included.length);
    if (safeSize < (config?.limits.min_audience || 5)) {
      setError("Выберите группы, в которых останется не меньше пяти профилей.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (selectedScenarioId) {
        const completed = await request<SimRun>(
          "/api/audience-simulations/runs/" + run.id + "/start?selection_version=" + run.selection.version,
          { method: "POST" },
          runToken,
        );
        setRun(completed);
        setDemoProgress(0);
        lastAutoStatusRef.current = completed.status;
      } else {
        const selection = await request<SimRun["selection"]>("/api/audience-simulations/runs/" + run.id + "/selection", {
          method: "PATCH",
          body: JSON.stringify({
            selection_version: run.selection.version,
            size: safeSize,
            include_groups: selectedGroups,
            constraints: constraints.trim() || null,
          }),
        }, runToken);
        const response = await request<{ status: string }>(
          "/api/audience-simulations/runs/" + run.id + "/start?selection_version=" + selection.version,
          { method: "POST" },
          runToken,
        );
        setRun({ ...run, selection, status: response.status });
        lastAutoStatusRef.current = response.status;
      }
      setAudienceSize(safeSize);
      setActiveSlide(5);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось подтвердить аудиторию");
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
      setError(reason instanceof Error ? reason.message : "Не удалось продолжить запуск");
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
      setError(reason instanceof Error ? reason.message : "Не удалось повторить подготовку");
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
      setError(reason instanceof Error ? reason.message : "Не удалось остановить проверку");
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
      setError(reason instanceof Error ? reason.message : "Не удалось подготовить ссылку");
    } finally {
      setBusy(false);
    }
  }, [request, run, runToken]);

  const reset = () => {
    sessionStorage.removeItem("audience-simulation:" + code);
    setRun(null);
    setRunToken("");
    setClaimToken("");
    setSelectedResponseId("");
    setSelectedGroups([]);
    setShowAudienceControls(false);
    setIdea("");
    setAudience("");
    setPrice("");
    setConstraints("");
    setAudienceSize(100);
    setError("");
    setActiveSlide(0);
    setIdeaMode("choose");
    setSelectedScenarioId("");
    setDemoProgress(0);
    setAudienceReveal(0);
  };

  const personas = useMemo(() => run?.selection.members || [], [run?.selection.members]);
  const progress = selectedScenarioId && activeSlide === 5 && run?.status === "completed"
    ? demoProgress
    : run?.aggregate?.valid_responses ?? run?.responses.length ?? 0;
  const groups = useMemo(() => Array.from(new Set(personas.map((persona) => persona.group))), [personas]);
  const chosenCount = personas.filter((person) => selectedGroups.includes(person.group)).length;
  const isFinished = Boolean(run && ["completed", "partial"].includes(run.status));
  const maxSlide = !run
    ? 1
    : run.status === "awaiting_audience_confirmation"
      ? 4
      : run.status === "interviewing"
        ? 5
        : isFinished
          ? 8
          : 2;
  const validRate = run?.aggregate?.percent_at_least_7?.problem_relevance;
  const interestRate = run?.aggregate?.percent_at_least_7?.interest;
  const tryRate = run?.aggregate?.percent_at_least_7?.willingness_to_try;
  const activeResponse = run?.responses.find((response) => response.persona_id === selectedResponseId) || run?.responses[0];
  const activePersona = activeResponse ? personas.find((persona) => persona.id === activeResponse.persona_id) : undefined;
  const plottedResponseCount = run?.responses.filter((response) => response.included !== false && typeof response.interest === "number" && typeof response.problem_relevance === "number" && typeof response.willingness_to_try === "number").length || 0;
  const excludedResponseCount = run?.responses.filter((response) => response.included === false || typeof response.interest !== "number" || typeof response.problem_relevance !== "number" || typeof response.willingness_to_try !== "number").length || 0;
  const selectedMarkets = new Set((run?.selection.members || []).map((person) => person.market).filter(Boolean));
  const consumerIdeaWithBusinessPanel = Boolean(run && /калор|питан|похуд|рацион|фитнес|трениров|сон|здоров/i.test(run.idea) && selectedMarkets.has("business") && !selectedMarkets.has("consumer"));
  const sourcedCount = run?.findings.filter((finding) => finding.source_ids.length > 0).length || 0;
  const searchingLabel = run?.status === "awaiting_search_fallback"
    ? "Источники не найдены"
    : run?.status === "awaiting_audience_confirmation"
      ? "Источники изучены"
      : run?.status === "failed"
        ? "Поиск остановился"
        : run?.evidence.length
          ? (run.evidence.some((source) => source.fetch_status === "opened") && !selectedScenarioId
              ? `Открыто страниц: ${run.evidence.filter((source) => source.fetch_status === "opened").length} · проверяем цитаты`
              : "Связываем сигналы с источниками")
          : "Подключаем источники поиска";

  const goToSlide = useCallback((index: number) => {
    setActiveSlide(Math.max(0, Math.min(maxSlide, index)));
    setError("");
  }, [maxSlide]);

  useEffect(() => {
    setSlideEntranceDone(false);
    const timer = window.setTimeout(() => setSlideEntranceDone(true), 600);
    return () => window.clearTimeout(timer);
  }, [activeSlide]);

  useEffect(() => {
    if (activeSlide === 8 && isFinished && !claimToken && !busy) void makeClaimLink();
  }, [activeSlide, busy, claimToken, isFinished, makeClaimLink]);

  useEffect(() => {
    if (activeSlide !== 3 || !selectedScenarioId) return;
    setAudienceReveal(0);
    const total = run?.selection.members?.length || 100;
    let current = 0;
    let timer = 0;
    const reveal = () => {
      current = Math.min(total, current + Math.max(1, Math.ceil(total / 52)));
      setAudienceReveal(current);
      if (current < total) timer = window.setTimeout(reveal, 75);
    };
    timer = window.setTimeout(reveal, 250);
    return () => window.clearTimeout(timer);
  }, [activeSlide, run?.selection.members?.length, selectedScenarioId]);

  useEffect(() => {
    if (activeSlide !== 5 || !isFinished || !selectedScenarioId) return;
    setDemoProgress(0);
    const total = run?.responses.length || 100;
    let current = 0;
    let timer = 0;
    const answerNext = () => {
      current = Math.min(total, current + 1);
      setDemoProgress(current);
      if (current >= total) {
        timer = window.setTimeout(() => setActiveSlide(6), 900);
        return;
      }
      // Brief pauses make the response sequence readable instead of racing to 100%.
      timer = window.setTimeout(answerNext, current % 12 === 0 ? 720 : 125);
    };
    timer = window.setTimeout(answerNext, 500);
    return () => window.clearTimeout(timer);
  }, [activeSlide, isFinished, run?.responses.length, selectedScenarioId]);

  const openedSourceCount = run?.evidence.filter((source) => source.fetch_status === "opened").length || 0;
  const demoSearchStats = selectedScenarioId ? run?.demo_search_stats : null;
  const sourceCategories = [
    { title: "Отзывы покупателей", note: demoSearchStats ? "источники в сценарии" : "найденные страницы", color: "cyan", count: demoSearchStats?.categories.reviews ?? run?.evidence.filter((source) => /market|ozon|wildberries|otzovik/i.test(source.domain)).length ?? 0 },
    { title: "Профессиональные сообщества", note: demoSearchStats ? "источники в сценарии" : "найденные страницы", color: "violet", count: demoSearchStats?.categories.communities ?? run?.evidence.filter((source) => /habr|vc\.ru|reddit|forum|community/i.test(source.domain)).length ?? 0 },
    { title: "Поисковые материалы", note: demoSearchStats ? "источники в сценарии" : "найденные страницы", color: "gold", count: demoSearchStats?.categories.search_materials ?? run?.evidence.filter((source) => !/market|ozon|wildberries|otzovik|habr|vc\.ru|reddit|forum|community/i.test(source.domain)).length ?? 0 },
    { title: "Повторяющиеся сигналы", note: demoSearchStats ? "выводы в сценарии" : "связаны с источниками", color: "mint", count: demoSearchStats?.linked_findings ?? sourcedCount },
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
  const audienceStageReady = Boolean(slideEntranceDone && (!selectedScenarioId || audienceReveal >= personas.length));

  return (
    <main className="audience-stage">
      <div className="audience-screen">
        <div className="audience-scene" aria-hidden="true" />
        <header className="audience-topbar">
          <div className="audience-brand">Pitchy<i>.pro</i></div>
          <div className="audience-topnote">Симуляция аудитории</div>
        </header>

        {error && (
          <div className="audience-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} aria-label="Закрыть сообщение">×</button>
          </div>
        )}

        {!config && !error && (
          <div className="audience-loading" aria-label="Загружаем кампанию"><Loader size={18} className="audience-spin" /></div>
        )}

        {config && <div className="audience-slides">
          <section className={"audience-slide hero-slide" + (activeSlide === 0 ? " is-active" : "")} inert={activeSlide !== 0}>
            <div className="hero-art-frame" aria-hidden="true">
              <Image
                src="/images/audience-simulation/hero-scene.png"
                alt=""
                fill
                priority
                sizes="(max-width: 600px) 100vw, 56.25vh"
                className="hero-art"
              />
            </div>
            <div className="hero-art-shade" aria-hidden="true" />
            <p className="audience-eyebrow">Проверьте идею до запуска</p>
            <h1 className="audience-title hero-title">Как люди<br />отреагируют<br />на <span className="audience-shine">вашу идею?</span></h1>
            <p className="audience-lead hero-lead">Сначала реальные сигналы. Затем виртуальная аудитория. Потом — реакция на продукт.</p>
            <div className="audience-glowline" />
            <div className="intro-label"><i className="signal-dot" />Реальные боли → релевантные персоны → реакция</div>
            <button type="button" className="slide-hit-target" onClick={() => goToSlide(1)} aria-label="Начать проверку идеи" />
          </section>

          <section className={"audience-slide idea-slide" + (activeSlide === 1 ? " is-active" : "")} inert={activeSlide !== 1}>
            <p className="audience-eyebrow">01 / Начало проверки</p>
            <h2 className="audience-title">Что<br />проверяем?</h2>
            {ideaMode === "choose" && <div className="idea-mode-picker">
              <button type="button" className="idea-mode-card" onClick={() => setIdeaMode("custom")}><strong>Своя идея</strong><span>Запустить поиск и текущую проверку</span><ArrowRight size={16} /></button>
              <button type="button" className="idea-mode-card" onClick={() => setIdeaMode("prebuilt")}><strong>Готовая идея</strong><span>Выбрать исследованный сценарий</span><ArrowRight size={16} /></button>
            </div>}
            {ideaMode === "prebuilt" && <div className="prebuilt-picker">
              <button type="button" className="text-action prebuilt-back" onClick={() => { setIdeaMode("choose"); setSelectedScenarioId(""); }}>← Назад</button>
              <div className="prebuilt-list">
                {prebuiltScenarios.map((scenario) => <button type="button" key={scenario.id} className={"prebuilt-option" + (selectedScenarioId === scenario.id ? " is-selected" : "")} onClick={() => setSelectedScenarioId(scenario.id)} aria-pressed={selectedScenarioId === scenario.id}>
                  <strong>{scenario.title}</strong><span>{scenario.note}</span>
                </button>)}
              </div>
              {selectedScenarioId && <button type="button" disabled={busy} onClick={() => void startPrebuilt()} className="audience-cta preset-cta">
                {busy ? <Loader size={14} className="audience-spin" /> : <Search size={14} />}{busy ? "Загружаем сценарий" : "Запустить готовую проверку"}{!busy && <ArrowRight size={14} />}
              </button>}
            </div>}
            {ideaMode === "custom" && <>
            <button type="button" className="text-action custom-back" onClick={() => setIdeaMode("choose")}>← Выбрать готовую идею</button>
            <label className="idea-box">
              <span className="sr-only">Опишите идею продукта или услуги</span>
              <textarea value={idea} onChange={(event) => setIdea(event.target.value)} rows={4} maxLength={6000} placeholder="Опишите идею продукта или услуги..." />
            </label>
            <div className="input-options">
              <button type="button" className="input-option" onClick={() => setShowAudienceField((value) => !value)} aria-expanded={showAudienceField}>
                <span>Аудитория</span><i>{showAudienceField ? "скрыть" : "добавить, если уже определили"}</i>
              </button>
              {showAudienceField && <input className="audience-compact-input" value={audience} onChange={(event) => setAudience(event.target.value)} maxLength={1200} placeholder="Например: небольшие интернет-магазины" />}
              <button type="button" className="input-option" onClick={() => setShowPriceField((value) => !value)} aria-expanded={showPriceField}>
                <span>Цена</span><i>{showPriceField ? "скрыть" : "необязательно"}</i>
              </button>
              {showPriceField && <input className="audience-compact-input" value={price} onChange={(event) => setPrice(event.target.value)} maxLength={300} placeholder="Например: 990 ₽ в месяц" />}
            </div>
            <div className="idea-action">
              <p className={idea.trim().length >= 20 ? "field-hint is-ready" : "field-hint"}>
                {idea.trim().length >= 20 ? "Описание готово к проверке" : "Добавьте подробностей: от 20 символов"}
              </p>
            <button type="button" disabled={busy} onClick={() => void start()} className="audience-cta">
                {busy ? <Loader size={14} className="audience-spin" /> : <Search size={14} />}
                {busy ? "Запускаем проверку" : "Запустить проверку"}
                {!busy && <ArrowRight size={14} />}
              </button>
            </div>
            </>}
          </section>

          <section className={"audience-slide sources-slide" + (activeSlide === 2 ? " is-active" : "")} inert={activeSlide !== 2}>
            <p className="audience-eyebrow">02 / Открытые источники</p>
            <h2 className="audience-title">Сначала слушаем<br /><span className="audience-shine">рынок</span></h2>
            <p className="audience-lead">Ищем, кто и как уже говорит об этой проблеме.</p>
            <div className="source-stats">
              <div className="audience-card"><strong>{displayCount(demoSearchStats?.mentions ?? run?.evidence.length ?? 0)}</strong><span>{demoSearchStats ? "найденных источников · сценарий" : "ссылок найдено"}</span></div>
              <div className="audience-card"><strong>{displayCount(demoSearchStats?.bundle_links ?? (selectedScenarioId ? run?.evidence.length || 0 : openedSourceCount))}</strong><span>{selectedScenarioId ? "ссылок в сценарной подборке" : "страниц открыто"}</span></div>
              <div className="audience-card"><strong>{displayCount(demoSearchStats?.linked_findings ?? sourcedCount)}</strong><span>{selectedScenarioId ? "выводов со ссылками · сценарий" : "сигналов подтверждено"}</span></div>
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
                <summary>Ссылки и статус страниц · {run.evidence.length}</summary>
                <div className="source-links">
                  {run.evidence.slice(0, 20).map((source) => (
                    <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="source-link">
                      <span>{source.domain} · {source.fetch_status === "opened" ? "страница открыта" : source.fetch_status === "blocked" ? "адрес заблокирован" : source.fetch_status === "referenced" ? "источник аналитического обзора" : source.fetch_status || "не проверена"}</span>{source.page_title || source.title || source.url}
                    </a>
                  ))}
                </div>
              </details>
            ) : null}
            {run?.findings.some((finding) => finding.evidence?.length) && (
              <details className="source-disclosure verified-disclosures">
                <summary>Подтверждённые цитаты · {sourcedCount}</summary>
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
                <p>Sonar не вернул проверяемые ссылки. Можно продолжить без открытых сигналов или уточнить идею.</p>
                <button type="button" className="audience-cta" disabled={busy} onClick={() => void continueWithoutSearch()}><ArrowRight size={14} /> Продолжить без источников</button>
                <button type="button" className="text-action" disabled={busy} onClick={() => void reviseIdea()}>Изменить идею</button>
              </div>
            )}
            {run?.status === "failed" && (
              <div className="fallback-actions">
                {run.aggregate?.retryable && (
                  <button type="button" className="audience-cta" disabled={busy} onClick={() => void retryPreparation()}>
                    {busy ? <Loader size={14} className="audience-spin" /> : <RotateCcw size={14} />}
                    {run.evidence.length ? "Повторить обработку источников" : "Повторить подготовку"}
                  </button>
                )}
                <button type="button" className="text-action" onClick={reset}>Начать заново</button>
              </div>
            )}
            {run?.status === "awaiting_audience_confirmation" && (
              <button type="button" disabled={!sourceStageReady} className="audience-cta source-continue" onClick={() => goToSlide(3)}>
                Перейти к аудитории <ArrowRight size={14} />
              </button>
            )}
            <p className="source-foot">{demoSearchStats ? "Счётчики объёма и выводов заданы для демо-сценария; ниже показаны ссылки из реальной аналитической подборки." : "Найденные упоминания связываем с источниками и повторяющимися темами."}</p>
          </section>

          <section className={"audience-slide audience-build-slide" + (activeSlide === 3 ? " is-active" : "")} inert={activeSlide !== 3}>
            <p className="audience-eyebrow">03 / Формируем аудиторию</p>
            <h2 className="audience-title">Персоны<br /><span className="audience-shine">под вашу идею</span></h2>
            <p className="audience-lead">Подбираем персоны из каталога и отбираем тех, кому может быть близка проблема.</p>
            <div className="candidate-label"><span>{statusText[run?.status || "preparing"]}</span><span>{personas.length} профилей</span></div>
            <div className="persona-cloud">
              <PersonaNetwork members={personas} responses={[]} mode="crowd" litIds={selectedScenarioId ? new Set(personas.slice(0, audienceReveal).map((person) => person.id)) : undefined} />
            </div>
            <div className="audience-card audience-build-note">
              <p>Сначала широкий круг профилей. После отбора остаются персоны, связанные с вашей гипотезой.</p>
              <div className="audience-chips">
                {groups.slice(0, 3).map((group) => <span key={group} className="audience-chip">{group}</span>)}
                {!groups.length && <span className="audience-chip">Формируем группы</span>}
              </div>
              {run?.status === "awaiting_audience_confirmation" && (
                <button type="button" disabled={!audienceStageReady} className="audience-cta build-continue" onClick={() => goToSlide(4)}>
                  Посмотреть аудиторию <ArrowRight size={14} />
                </button>
              )}
            </div>
          </section>

          <section className={"audience-slide preview-slide" + (activeSlide === 4 ? " is-active" : "")} inert={activeSlide !== 4}>
            <p className="audience-eyebrow">04 / Предпросмотр аудитории</p>
            <h2 className="audience-title">Кто будет<br />отвечать</h2>
            <div className="candidate-label"><span>Состав аудитории</span><span>{chosenCount || personas.length} персон · {selectedGroups.length} групп</span></div>
            <div className="preview-map"><PersonaNetwork members={personas} responses={[]} mode="crowd" /></div>
            <div className="profile-strip">
              <span>Профили<b>{chosenCount || personas.length}</b></span>
              <span>Группы<b>{groups.length}</b></span>
              <span>Цена<b>{price.trim() || "не задана"}</b></span>
            </div>
            <p className="audience-helper">Синтетические профили по сигналам. <button type="button" className="audience-edit-link" onClick={() => setShowAudienceControls((value) => !value)} aria-expanded={showAudienceControls}>Настроить состав</button></p>
            <div className={"audience-editor" + (showAudienceControls ? " is-open" : "")} inert={!showAudienceControls}>
              <div className="editor-heading"><strong>Состав аудитории</strong><button type="button" onClick={(event) => { event.currentTarget.blur(); setShowAudienceControls(false); }}>Готово</button></div>
              <div className="group-picker">
              {groups.map((group, index) => {
                const count = personas.filter((person) => person.group === group).length;
                const active = selectedGroups.includes(group);
                return (
                  <button type="button" disabled={Boolean(selectedScenarioId)} className={"group-toggle " + (active ? "selected" : "")} key={group} onClick={() => {
                    const next = active ? selectedGroups.filter((item) => item !== group) : [...selectedGroups, group];
                    if (!next.length || personas.filter((person) => next.includes(person.group)).length < (config?.limits.min_audience || 5)) {
                      setError("Оставьте в аудитории не меньше пяти профилей.");
                      return;
                    }
                    setSelectedGroups(next);
                    setAudienceSize((current) => Math.min(current, personas.filter((person) => next.includes(person.group)).length));
                    setError("");
                  }}>
                    <i style={{ backgroundColor: palette[index % palette.length] }} />{group}<small>{count}</small>
                  </button>
                );
              })}
              </div>
              <div className="preview-controls">
                {selectedScenarioId
                  ? <p className="fixed-panel-note">Готовый сценарий · {personas.length} персон · состав подобран из каталога 1 500 профилей</p>
                  : <label>Размер панели
                    <select value={Math.min(audienceSize, Math.max(chosenCount, 5))} onChange={(event) => setAudienceSize(Number(event.target.value))}>
                      {[5, 8, 12, 25, 50, 75, 100].filter((value) => value <= chosenCount).map((value) => <option key={value} value={value}>{value} персон</option>)}
                    </select>
                  </label>}
                {!selectedScenarioId && <label className="constraints-field">Ограничения
                  <input value={constraints} onChange={(event) => setConstraints(event.target.value)} maxLength={1200} placeholder="Необязательно" />
                </label>}
              </div>
            </div>
            <button type="button" disabled={busy || chosenCount < 5 || !slideEntranceDone} onClick={() => void confirmAudience()} className="audience-cta preview-cta">
              {busy ? <Loader size={14} className="audience-spin" /> : <Check size={14} />}{busy ? "Готовим исследование" : "Запустить исследование"}<ArrowRight size={14} />
            </button>
          </section>

          <section className={"audience-slide interview-slide" + (activeSlide === 5 ? " is-active" : "")} inert={activeSlide !== 5}>
            <p className="audience-eyebrow">05 / Синтетическое исследование</p>
            <h2 className="audience-title">Идея проходит<br />через общество</h2>
            <p className="audience-lead">Каждая персона оценивает идею отдельно с учётом своего профиля.</p>
            <div className="candidate-label"><span>{progress ? "Персоны отвечают в группах" : "Подключаем персоны"}</span><span>{progress} / {personas.length || audienceSize}</span></div>
            <div className="interview-network">
              <PersonaNetwork members={personas} responses={[]} mode="crowd" litIds={new Set((run?.responses || []).slice(0, progress).map((response) => response.persona_id))} activeIds={progress ? new Set([(run?.responses || [])[Math.min(progress, (run?.responses.length || 1)) - 1]?.persona_id || ""]) : undefined} />
              <div className="idea-signal">ИДЕЯ</div>
            </div>
            <div className="people-count"><strong>{progress}</strong><span>/ {personas.length || audienceSize} ответов</span></div>
            <div className="audience-meter"><i style={{ width: (personas.length ? Math.min(100, (progress / personas.length) * 100) : 0) + "%" }} /></div>
            <p className="audience-helper center">Синтетические ответы появляются по одному. Это не прогноз продаж.</p>
          </section>

          <section className={"audience-slide reaction-slide" + (activeSlide === 6 ? " is-active" : "")} inert={activeSlide !== 6}>
            <p className="audience-eyebrow">06 / Карта реакции</p>
            <h2 className="audience-title">Реакция<br /><span className="audience-shine">разделилась</span></h2>
            <p className="audience-lead">Каждая точка — персона: проблема по вертикали, готовность попробовать по горизонтали.</p>
            <div className="reaction-map">
              <PersonaNetwork members={personas} responses={run?.responses || []} mode="map" activeIds={activeResponse ? new Set([activeResponse.persona_id]) : undefined} onPick={(id) => setSelectedResponseId(id)} />
              <span className="map-axis-y">АКТУАЛЬНОСТЬ ПРОБЛЕМЫ</span>
              <span className="map-axis-x">ГОТОВНОСТЬ ПОПРОБОВАТЬ →</span>
              {excludedResponseCount > 0 && <span className="map-excluded-key">× НЕ УЧТЁН · {excludedResponseCount}</span>}
            </div>
            <p className="audience-helper">Учтено {plottedResponseCount}; не учтено {excludedResponseCount} из {run?.responses.length || 0}. Крестики вынесены в отдельную полосу: {excludedResponseCount > 0 ? "выберите крестик, чтобы увидеть причину" : "все ответы прошли проверку"}.</p>
            {activeResponse && <div className="reaction-detail"><span>{activeResponse.group || "Синтетическая персона"}{activeResponse.included === false ? " · НЕ УЧТЁН" : " · УЧТЁН"}</span><small>{activePersona?.profile ? activePersona.profile.split(" · ").slice(1, 4).join(" · ") + " · " : ""}проблема {activeResponse.problem_relevance ?? "—"}/10 · готовность попробовать {activeResponse.willingness_to_try ?? "—"}/10 · интерес {activeResponse.interest ?? "—"}/10{activeResponse.exclusion_reason ? ` · причина: ${exclusionReasonLabels[activeResponse.exclusion_reason] || activeResponse.exclusion_reason}` : ""}</small><p>{activeResponse.reaction || (activeResponse.included === false ? "Этот ответ сохранён, но не вошёл в расчёты." : "Для этой персоны нет короткой реплики.")}</p>{activeResponse.raw_answer && <details className="raw-answer"><summary>Исходный ответ модели</summary><pre>{JSON.stringify(activeResponse.raw_answer, null, 2)}</pre></details>}</div>}
            <div className="group-counts">
              {groups.map((group, index) => <span key={group}><b style={{ color: palette[index % palette.length] }}>{run?.responses.filter((response) => response.group === group).length || 0}</b>{group}</span>)}
              {!groups.length && <span><b>{run?.responses.length || 0}</b>ответов</span>}
            </div>
            <p className="audience-helper">Совпавшие оценки слегка разнесены; при выборе показаны точные баллы. Точку можно выбрать мышью или клавишами со стрелками.</p>
            <button type="button" disabled={!slideEntranceDone} className="slide-next-cta reaction-continue" onClick={() => goToSlide(7)}>
              Перейти к выводам <ArrowRight size={15} />
            </button>
          </section>

          <section className={"audience-slide insights-slide" + (activeSlide === 7 ? " is-active" : "")} inert={activeSlide !== 7}>
            <p className="audience-eyebrow">07 / Выводы</p>
            <h2 className="audience-title">Что говорит<br /><span className="audience-shine">аудитория</span></h2>
            <div className="primary-result">{typeof validRate === "number" ? validRate + "%" : "—"}</div>
            <div className="result-label">оценили актуальность проблемы на 7/10 или выше</div>
            <div className="result-average">Средняя оценка актуальности: {run?.aggregate?.averages?.problem_relevance ?? "—"}/10</div>
            <p className="audience-helper">В расчётах учтено {run?.aggregate?.valid_responses ?? progress} из {run?.aggregate?.requested_responses ?? personas.length}; исключено {run?.aggregate?.excluded_responses ?? excludedResponseCount} ответов по правилам полноты и проверки оценок.</p>
            {consumerIdeaWithBusinessPanel && <div className="audience-mismatch-note">В этой проверке выбраны B2B-профили, а идея похожа на потребительский продукт. Этот результат не показывает интерес конечных пользователей.</div>}
            <div className="audience-meter"><i style={{ width: (typeof validRate === "number" ? validRate : 0) + "%" }} /></div>
            <div className="result-row">
              <div className="audience-card result-card"><strong>{typeof interestRate === "number" ? interestRate + "%" : "—"}</strong><span>интерес 7+/10</span><small>средняя оценка: {run?.aggregate?.averages?.interest ?? "—"}/10</small></div>
              <div className="audience-card result-card"><strong>{typeof tryRate === "number" ? tryRate + "%" : "—"}</strong><span>готовность попробовать 7+/10</span><small>средняя оценка: {run?.aggregate?.averages?.willingness_to_try ?? "—"}/10</small></div>
            </div>
            <div className="insight-list">
              {(run?.summary?.observations || []).slice(0, 3).map((item, index) => <div className="insight-item" key={item}><i style={{ backgroundColor: palette[index % palette.length] }} /><span>{item}</span></div>)}
              {!run?.summary?.observations?.length && <div className="insight-item"><i /><span>Собрано ответов: {progress}</span></div>}
            </div>
            {run?.summary?.next_checks?.length ? <div className="next-step"><small>СЛЕДУЮЩАЯ ПРОВЕРКА</small>{run.summary.next_checks[0]}</div> : null}
            <button type="button" disabled={!slideEntranceDone} className="slide-next-cta insights-continue" onClick={() => goToSlide(8)}>
              Открыть результат <ArrowRight size={15} />
            </button>
            <p className="audience-disclaimer">Ответы смоделированы. Они помогают сформулировать следующие проверки, но не прогнозируют продажи.</p>
          </section>

          <section className={"audience-slide result-slide" + (activeSlide === 8 ? " is-active" : "")} inert={activeSlide !== 8}>
            <p className="audience-eyebrow">Результат готов</p>
            <h2 className="audience-title">Продолжите<br />изучать свою<br /><span className="audience-shine">идею</span></h2>
            <p className="audience-lead">Отсканируйте код, чтобы открыть краткий итог и сохранить проверку.</p>
            {claimToken ? (
              <div className="qr-layout">
                <Image className="qr-image" src={"/api/audience-simulations/claims/" + encodeURIComponent(claimToken) + "/qr"} width={144} height={144} unoptimized alt="QR-код результата исследования" />
                <div className="qr-caption"><strong>Откройте результат<br />на телефоне</strong><a href={"/audience-simulation/claim/" + encodeURIComponent(claimToken)}>{typeof window !== "undefined" ? window.location.host : "pitchy.pro"}/audience-simulation/claim/…</a></div>
              </div>
            ) : (
              <button type="button" disabled={busy} onClick={() => void makeClaimLink()} className="qr-create-button">
                {busy ? <Loader size={14} className="audience-spin" /> : <Search size={14} />}{busy ? "Готовим код" : "Создать QR-код результата"}
              </button>
            )}
            <div className="audience-glowline result-glowline" />
            <div className="audience-card result-card-note"><p>Хотите проверить глубже? Передайте идею и найденные сигналы в полноценный CustDev Pitchy.</p></div>
            <p className="audience-disclaimer">{config.disclaimer}</p>
            {claimToken && <button type="button" onClick={reset} className="reset-run"><RotateCcw size={12} /> Завершить проверку</button>}
          </section>
        </div>}

        <footer className="audience-bottom">
          <span>{stageNames[activeSlide]}</span>
          <span>{String(activeSlide + 1).padStart(2, "0")} / 09</span>
        </footer>
        <div className="audience-progress"><i style={{ width: ((activeSlide + 1) / 9) * 100 + "%" }} /></div>

      </div>
    </main>
  );
}
