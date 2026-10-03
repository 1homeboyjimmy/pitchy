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
type Persona = { id: string; group: string; profile: string; selection_reason: string };
type Finding = {
  text: string;
  source_ids: string[];
  claim_type: "sourced_paraphrase" | "hypothesis" | "assumption";
  limitation: string;
};
type Evidence = { id: string; url: string; domain: string; title: string };
type ResponsePoint = {
  persona_id: string;
  group?: string;
  problem_relevance?: number | null;
  interest?: number | null;
  willingness_to_try?: number | null;
  reaction?: string;
};
type SimRun = {
  id: number;
  status: string;
  revision: number;
  idea: string;
  audience: string | null;
  price: string | null;
  evidence: Evidence[];
  findings: Finding[];
  selection: {
    version?: number;
    members?: Persona[];
    groups?: Array<{ name: string; basis: string }>;
    uncertainty?: string[];
  };
  responses: ResponsePoint[];
  aggregate: {
    valid_responses?: number;
    requested_responses?: number;
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
  onPick,
}: {
  members: Persona[];
  responses: ResponsePoint[];
  mode: "crowd" | "map";
  activeIds?: Set<string>;
  onPick?: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Array<{ x: number; y: number; id: string; color: string }>>([]);
  const dataKey = useMemo(
    () => members.map((person) => person.id + person.group).join("|") + responses.map((person) => person.persona_id + person.interest + person.problem_relevance).join("|"),
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
    const validResponses = responses.filter(
      (person) => typeof person.interest === "number" && typeof person.problem_relevance === "number",
    );

    const render = (time = 0) => {
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(pixelRatio, pixelRatio);
      const mapped: Array<{ x: number; y: number; id: string; color: string; radius: number; person: boolean }> = [];
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
        for (const person of validResponses) {
          const groupIndex = Math.max(0, groups.indexOf(person.group || "Аудитория"));
          mapped.push({
            x: width * (0.1 + (person.interest || 0) * 0.08),
            y: height * (0.9 - (person.problem_relevance || 0) * 0.08),
            id: person.persona_id,
            color: palette[groupIndex % palette.length],
            radius: 3.4,
            person: true,
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

      const pulse = reducedMotion ? 0 : Math.sin(time / 950) * 0.7;
      for (const point of mapped) {
        const selected = Boolean(point.id && activeIds?.has(point.id));
        const glow = point.person ? 10 + (selected ? 14 : 0) : 4;
        context.beginPath();
        context.fillStyle = point.color;
        context.shadowColor = point.color;
        context.shadowBlur = glow;
        context.globalAlpha = point.person ? 0.92 : 0.86;
        context.arc(point.x, point.y, Math.max(1.2, point.radius + pulse * 0.18), 0, Math.PI * 2);
        context.fill();
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
  }, [activeIds, dataKey, members, mode, responses]);

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
  const [audienceSize, setAudienceSize] = useState(12);
  const [constraints, setConstraints] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [showAudienceControls, setShowAudienceControls] = useState(false);
  const [claimToken, setClaimToken] = useState("");
  const [selectedResponseId, setSelectedResponseId] = useState("");
  const [activeSlide, setActiveSlide] = useState(0);
  const [showAudienceField, setShowAudienceField] = useState(false);
  const [showPriceField, setShowPriceField] = useState(false);
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
        if (next.status === "failed") setError("Не удалось подготовить запуск. Можно начать проверку заново.");
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
    setAudienceSize(12);
    setError("");
    setActiveSlide(0);
  };

  const personas = useMemo(() => run?.selection.members || [], [run?.selection.members]);
  const progress = run?.aggregate?.valid_responses ?? run?.responses.length ?? 0;
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
  const activeResponse = run?.responses.find((response) => response.persona_id === selectedResponseId);
  const sourcedCount = run?.findings.filter((finding) => finding.source_ids.length > 0).length || 0;
  const searchingLabel = run?.status === "awaiting_search_fallback"
    ? "Проверяем другие формулировки"
    : run?.status === "awaiting_audience_confirmation"
      ? "Источники изучены"
      : run?.status === "failed"
        ? "Поиск остановился"
        : run?.evidence.length
          ? "Связываем сигналы с источниками"
          : "Подключаем источники поиска";

  const goToSlide = useCallback((index: number) => {
    setActiveSlide(Math.max(0, Math.min(maxSlide, index)));
    setError("");
  }, [maxSlide]);

  useEffect(() => {
    if (activeSlide === 8 && isFinished && !claimToken && !busy) void makeClaimLink();
  }, [activeSlide, busy, claimToken, isFinished, makeClaimLink]);

  const sourceCategories = [
    { title: "Отзывы покупателей", note: "маркетплейсы · отзывы", color: "cyan", count: run?.evidence.filter((source) => /market|ozon|wildberries|otzovik/i.test(source.domain)).length || 0 },
    { title: "Профессиональные сообщества", note: "Хабр · VC.ru · форумы", color: "violet", count: run?.evidence.filter((source) => /habr|vc\.ru|reddit|forum|community/i.test(source.domain)).length || 0 },
    { title: "Поисковые материалы", note: "статьи · обсуждения", color: "gold", count: run?.evidence.filter((source) => !/market|ozon|wildberries|otzovik|habr|vc\.ru|reddit|forum|community/i.test(source.domain)).length || 0 },
    { title: "Повторяющиеся сигналы", note: "связаны с источниками", color: "mint", count: sourcedCount },
  ];

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
          <section className={"audience-slide hero-slide" + (activeSlide === 0 ? " is-active" : "")} aria-hidden={activeSlide !== 0}>
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

          <section className={"audience-slide idea-slide" + (activeSlide === 1 ? " is-active" : "")} aria-hidden={activeSlide !== 1}>
            <p className="audience-eyebrow">01 / Начало проверки</p>
            <h2 className="audience-title">Что<br />проверяем?</h2>
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
          </section>

          <section className={"audience-slide sources-slide" + (activeSlide === 2 ? " is-active" : "")} aria-hidden={activeSlide !== 2}>
            <p className="audience-eyebrow">02 / Открытые источники</p>
            <h2 className="audience-title">Сначала слушаем<br /><span className="audience-shine">рынок</span></h2>
            <p className="audience-lead">Ищем, кто и как уже говорит об этой проблеме.</p>
            <div className="source-stats">
              <div className="audience-card"><strong>{run?.evidence.length || 0}</strong><span>источников с ссылками</span></div>
              <div className="audience-card"><strong>{run?.findings.length || 0}</strong><span>сигналов отобрано</span></div>
            </div>
            <div className="source-grid">
              {sourceCategories.map((category) => (
                <div className={"source-card source-" + category.color} key={category.title}>
                  <i className="source-mark" />
                  <span>{category.title}<small>{category.note} · {category.count}</small></span>
                </div>
              ))}
            </div>
            <p className="search-readout">{searchingLabel}{run?.status === "preparing" ? <span className="typing-dots">...</span> : null}</p>
            <div className="signal-sweep"><i /></div>
            {run?.evidence.length ? (
              <details className="source-disclosure">
                <summary>Показать источники · {run.evidence.length}</summary>
                <div className="source-links">
                  {run.evidence.slice(0, 3).map((source) => (
                    <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="source-link">
                      <span>{source.domain}</span>{source.title || source.url}
                    </a>
                  ))}
                </div>
              </details>
            ) : null}
            {run?.status === "awaiting_search_fallback" && (
              <div className="fallback-actions">
                <p>Не нашли достаточно проверяемых ссылок. Можно продолжить без открытых сигналов или уточнить идею.</p>
                <button type="button" className="audience-cta" disabled={busy} onClick={() => void continueWithoutSearch()}><ArrowRight size={14} /> Продолжить без источников</button>
                <button type="button" className="text-action" disabled={busy} onClick={() => void reviseIdea()}>Изменить идею</button>
              </div>
            )}
            {run?.status === "failed" && <button type="button" className="text-action" onClick={reset}>Начать заново</button>}
            {run?.status === "awaiting_audience_confirmation" && (
              <button type="button" className="audience-cta source-continue" onClick={() => goToSlide(3)}>
                Перейти к аудитории <ArrowRight size={14} />
              </button>
            )}
            <p className="source-foot">Найденные упоминания связываем с источниками и повторяющимися темами.</p>
          </section>

          <section className={"audience-slide audience-build-slide" + (activeSlide === 3 ? " is-active" : "")} aria-hidden={activeSlide !== 3}>
            <p className="audience-eyebrow">03 / Формируем аудиторию</p>
            <h2 className="audience-title">Персоны<br /><span className="audience-shine">под вашу идею</span></h2>
            <p className="audience-lead">Генерируем виртуальное общество и отбираем тех, кому может быть близка проблема.</p>
            <div className="candidate-label"><span>{statusText[run?.status || "preparing"]}</span><span>{personas.length} профилей</span></div>
            <div className="persona-cloud">
              <PersonaNetwork members={personas} responses={[]} mode="crowd" />
            </div>
            <div className="audience-card audience-build-note">
              <p>Сначала широкий круг профилей. После отбора остаются персоны, связанные с вашей гипотезой.</p>
              <div className="audience-chips">
                {groups.slice(0, 3).map((group) => <span key={group} className="audience-chip">{group}</span>)}
                {!groups.length && <span className="audience-chip">Формируем группы</span>}
              </div>
              {run?.status === "awaiting_audience_confirmation" && (
                <button type="button" className="audience-cta build-continue" onClick={() => goToSlide(4)}>
                  Посмотреть аудиторию <ArrowRight size={14} />
                </button>
              )}
            </div>
          </section>

          <section className={"audience-slide preview-slide" + (activeSlide === 4 ? " is-active" : "")} aria-hidden={activeSlide !== 4}>
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
            <div className={"audience-editor" + (showAudienceControls ? " is-open" : "")} aria-hidden={!showAudienceControls}>
              <div className="editor-heading"><strong>Состав аудитории</strong><button type="button" onClick={() => setShowAudienceControls(false)}>Готово</button></div>
              <div className="group-picker">
              {groups.map((group, index) => {
                const count = personas.filter((person) => person.group === group).length;
                const active = selectedGroups.includes(group);
                return (
                  <button type="button" className={"group-toggle " + (active ? "selected" : "")} key={group} onClick={() => {
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
                <label>Размер панели
                  <select value={Math.min(audienceSize, Math.max(chosenCount, 5))} onChange={(event) => setAudienceSize(Number(event.target.value))}>
                    {[5, 8, 12].filter((value) => value <= chosenCount).map((value) => <option key={value} value={value}>{value} персон</option>)}
                  </select>
                </label>
                <label className="constraints-field">Ограничения
                  <input value={constraints} onChange={(event) => setConstraints(event.target.value)} maxLength={1200} placeholder="Необязательно" />
                </label>
              </div>
            </div>
            <button type="button" disabled={busy || chosenCount < 5} onClick={() => void confirmAudience()} className="audience-cta preview-cta">
              {busy ? <Loader size={14} className="audience-spin" /> : <Check size={14} />}{busy ? "Готовим исследование" : "Запустить исследование"}<ArrowRight size={14} />
            </button>
          </section>

          <section className={"audience-slide interview-slide" + (activeSlide === 5 ? " is-active" : "")} aria-hidden={activeSlide !== 5}>
            <p className="audience-eyebrow">05 / Синтетическое исследование</p>
            <h2 className="audience-title">Идея проходит<br />через общество</h2>
            <p className="audience-lead">Каждая персона отвечает с учётом своего профиля и найденных сигналов.</p>
            <div className="candidate-label"><span>{progress ? "Персоны отвечают в группах" : "Подключаем персоны"}</span><span>{progress} / {personas.length || audienceSize}</span></div>
            <div className="interview-network">
              <PersonaNetwork members={personas} responses={[]} mode="crowd" activeIds={new Set((run?.responses || []).map((response) => response.persona_id))} />
              <div className="idea-signal">ИДЕЯ</div>
            </div>
            <div className="people-count"><strong>{progress}</strong><span>/ {personas.length || audienceSize} ответов</span></div>
            <div className="audience-meter"><i style={{ width: (personas.length ? Math.min(100, (progress / personas.length) * 100) : 0) + "%" }} /></div>
            <p className="audience-helper center">Синтетические персоны обмениваются сигналами. Это не прогноз продаж.</p>
          </section>

          <section className={"audience-slide reaction-slide" + (activeSlide === 6 ? " is-active" : "")} aria-hidden={activeSlide !== 6}>
            <p className="audience-eyebrow">06 / Карта реакции</p>
            <h2 className="audience-title">Реакция<br /><span className="audience-shine">разделилась</span></h2>
            <p className="audience-lead">Каждая точка — отдельная синтетическая персона.</p>
            <div className="reaction-map">
              <PersonaNetwork members={personas} responses={run?.responses || []} mode="map" activeIds={selectedResponseId ? new Set([selectedResponseId]) : undefined} onPick={(id) => setSelectedResponseId((current) => current === id ? "" : id)} />
              <span className="map-axis-y">АКТУАЛЬНОСТЬ ПРОБЛЕМЫ</span>
              <span className="map-axis-x">ИНТЕРЕС К РЕШЕНИЮ →</span>
            </div>
            {activeResponse && <div className="reaction-detail"><span>{activeResponse.group || "Синтетическая персона"}</span><p>{activeResponse.reaction || "Для этой персоны нет короткой реплики."}</p></div>}
            <div className="group-counts">
              {groups.slice(0, 3).map((group, index) => <span key={group}><b style={{ color: palette[index % palette.length] }}>{run?.responses.filter((response) => response.group === group).length || 0}</b>{group}</span>)}
              {!groups.length && <span><b>{run?.responses.length || 0}</b>ответов</span>}
            </div>
            <p className="audience-helper">Нажмите на точку или выберите её клавишами со стрелками.</p>
            <button type="button" className="slide-next-cta reaction-continue" onClick={() => goToSlide(7)}>
              Перейти к выводам <ArrowRight size={15} />
            </button>
          </section>

          <section className={"audience-slide insights-slide" + (activeSlide === 7 ? " is-active" : "")} aria-hidden={activeSlide !== 7}>
            <p className="audience-eyebrow">07 / Выводы</p>
            <h2 className="audience-title">Что говорит<br /><span className="audience-shine">аудитория</span></h2>
            <div className="primary-result">{typeof validRate === "number" ? validRate + "%" : "—"}</div>
            <div className="result-label">отметили проблему в своём опыте</div>
            <div className="audience-meter"><i style={{ width: (typeof validRate === "number" ? validRate : 0) + "%" }} /></div>
            <div className="result-row">
              <div className="audience-card result-card"><strong>{typeof interestRate === "number" ? interestRate + "%" : "—"}</strong><span>заинтересованы</span></div>
              <div className="audience-card result-card"><strong>{typeof tryRate === "number" ? tryRate + "%" : "—"}</strong><span>готовы попробовать</span></div>
            </div>
            <div className="insight-list">
              {(run?.summary?.observations || []).slice(0, 3).map((item, index) => <div className="insight-item" key={item}><i style={{ backgroundColor: palette[index % palette.length] }} /><span>{item}</span></div>)}
              {!run?.summary?.observations?.length && <div className="insight-item"><i /><span>Собрано ответов: {progress}</span></div>}
            </div>
            {run?.summary?.next_checks?.length ? <div className="next-step"><small>СЛЕДУЮЩАЯ ПРОВЕРКА</small>{run.summary.next_checks[0]}</div> : null}
            <button type="button" className="slide-next-cta insights-continue" onClick={() => goToSlide(8)}>
              Открыть результат <ArrowRight size={15} />
            </button>
            <p className="audience-disclaimer">Ответы смоделированы. Они помогают сформулировать следующие проверки, но не прогнозируют продажи.</p>
          </section>

          <section className={"audience-slide result-slide" + (activeSlide === 8 ? " is-active" : "")} aria-hidden={activeSlide !== 8}>
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
