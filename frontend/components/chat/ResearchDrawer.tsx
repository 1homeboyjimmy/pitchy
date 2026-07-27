"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
    BookOpen,
    Check,
    ChevronDown,
    ChevronUp,
    Circle,
    ExternalLink,
    FileText,
    Globe,
    Search,
    ShieldCheck,
    X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ResearchJob } from "@/lib/api";
import { hostFromUrl } from "@/lib/utils";
import { ExportMenu } from "./ExportMenu";
import { ResearchActivityOrb } from "./ResearchActivityOrb";

type DrawerTab = "report" | "sources" | "process";

const phaseLabels: Record<string, string> = {
    planning: "Планирование исследования",
    searching: "Поиск по направлениям",
    reranking: "Отбор релевантных источников",
    extracting: "Извлечение фактов",
    verifying: "Проверка утверждений",
    writing: "Подготовка отчёта",
    completed: "Исследование завершено",
    failed: "Исследование остановлено",
    cancelled: "Исследование отменено",
};

function SourceList({
    sources,
    emptyText,
}: {
    sources: ResearchJob["sources"];
    emptyText: string;
}) {
    if (!sources.length) {
        return <p className="rounded-2xl border border-white/5 bg-white/[0.025] px-4 py-5 text-sm text-white/35">{emptyText}</p>;
    }

    return (
        <div className="space-y-1.5">
            {sources.map((source, index) => {
                const host = hostFromUrl(source.url);
                return (
                    <a
                        key={`${source.url}-${source.index ?? index}`}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex min-w-0 items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-white/[0.055]"
                    >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] font-mono text-[10px] text-white/45">
                            {source.index ?? index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 text-[13px] leading-snug text-white/75 group-hover:text-white">
                                {source.title || host || "Источник"}
                            </div>
                            {host && <div className="mt-1 truncate font-mono text-[10px] text-white/30">{host}</div>}
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/15 group-hover:text-white/50" />
                    </a>
                );
            })}
        </div>
    );
}

function SourceGroup({
    title,
    count,
    children,
    defaultOpen = true,
}: {
    title: string;
    count: number;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className="border-b border-white/[0.06] pb-5">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex w-full items-center gap-2 py-3 text-left"
            >
                <span className="text-sm font-medium text-white/85">{title}</span>
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-white/35">{count}</span>
                {open ? <ChevronUp className="ml-auto h-4 w-4 text-white/30" /> : <ChevronDown className="ml-auto h-4 w-4 text-white/30" />}
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        {children}
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
}

export function ResearchDrawer({
    isOpen,
    job,
    messageId,
    onClose,
    onCancel,
}: {
    isOpen: boolean;
    job: ResearchJob | null;
    messageId?: number;
    onClose: () => void;
    onCancel?: () => void;
}) {
    const [tab, setTab] = useState<DrawerTab | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [isOpen, onClose]);

    const [usedSources, readSources] = useMemo(() => {
        const sources = job?.sources || [];
        const hasExplicitUsage = sources.some((source) => typeof source.used_in_report === "boolean");
        if (!hasExplicitUsage) return [sources, []];
        return [
            sources.filter((source) => source.used_in_report),
            sources.filter((source) => !source.used_in_report),
        ];
    }, [job?.sources]);

    const active = !!job && ["queued", "running", "cancelling"].includes(job.status);
    const activeTab: DrawerTab = tab || (job?.status === "completed" ? "report" : "process");
    const title = job?.query || "Полное исследование";

    return (
        <AnimatePresence>
            {isOpen && job && (
                <>
                    <motion.button
                        type="button"
                        aria-label="Закрыть исследование"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[70] cursor-default bg-black/55 backdrop-blur-[2px]"
                    />
                    <motion.aside
                        role="dialog"
                        aria-modal="true"
                        aria-label="Панель исследования"
                        initial={{ opacity: 0, x: 48, scale: 0.985 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 48, scale: 0.985 }}
                        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                        className="fixed inset-y-3 right-3 z-[71] flex w-[min(780px,calc(100vw-24px))] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#151516] shadow-2xl shadow-black/70 sm:inset-y-4 sm:right-4"
                    >
                        <header className="shrink-0 border-b border-white/[0.07] px-4 pb-3 pt-4 sm:px-7 sm:pt-5">
                            <div className="flex min-w-0 items-start gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-white/30">Полное исследование</div>
                                    <h2 className="truncate text-sm font-medium text-white/90" title={title}>{title}</h2>
                                </div>
                                {job.status === "completed" && messageId && (
                                    <ExportMenu
                                        messageId={messageId}
                                        disabled={messageId >= 1_000_000_000_000}
                                        placement="down"
                                        label="Экспорт"
                                    />
                                )}
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="rounded-full p-2 text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white"
                                    aria-label="Закрыть"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <nav className="mt-4 flex gap-1 overflow-x-auto rounded-2xl bg-black/25 p-1">
                                {([
                                    ["report", "Отчёт", FileText],
                                    ["sources", `Источники ${job.sources.length || ""}`, Globe],
                                    ["process", "Процесс", Search],
                                ] as const).map(([value, label, Icon]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setTab(value)}
                                        disabled={value === "report" && !job.report}
                                        className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-[11px] transition-colors ${
                                            activeTab === value ? "bg-white/[0.09] text-white" : "text-white/35 hover:text-white/70"
                                        } disabled:cursor-not-allowed disabled:opacity-30`}
                                    >
                                        <Icon className="h-3.5 w-3.5" />
                                        {label}
                                    </button>
                                ))}
                            </nav>
                        </header>

                        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7">
                            {activeTab === "report" && (
                                <article className="mx-auto max-w-[680px]">
                                    <div className="mb-7 flex items-center gap-3 rounded-2xl border border-emerald-400/10 bg-emerald-400/[0.045] px-4 py-3 text-xs text-emerald-100/70">
                                        <Check className="h-4 w-4 shrink-0 text-emerald-300" />
                                        Отчёт готов. Его можно скачать в PDF, DOCX, Markdown или TXT.
                                    </div>
                                    <div className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-[14px] leading-[1.75] text-white/75 sm:text-[16px] [&_a]:break-all [&_a]:text-white [&_blockquote]:border-l-2 [&_blockquote]:border-white/15 [&_blockquote]:pl-4 [&_h2]:mb-4 [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-white [&_h3]:mb-3 [&_h3]:mt-7 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-white/90 [&_li]:mb-2 [&_ol]:mb-5 [&_ol]:pl-6 [&_ol]:list-decimal [&_p]:mb-5 [&_strong]:text-white [&_table]:w-full [&_td]:border-b [&_td]:border-white/5 [&_td]:p-3 [&_th]:border-b [&_th]:border-white/10 [&_th]:p-3 [&_ul]:mb-5 [&_ul]:list-disc [&_ul]:pl-6">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{job.report || ""}</ReactMarkdown>
                                    </div>
                                </article>
                            )}

                            {activeTab === "sources" && (
                                <div className="mx-auto max-w-[700px] space-y-5">
                                    {active ? (
                                        <SourceGroup title="Найденные и изучаемые источники" count={job.sources.length}>
                                            <SourceList sources={job.sources} emptyText="Источники появятся после этапа поиска и ранжирования." />
                                        </SourceGroup>
                                    ) : (
                                        <>
                                            <SourceGroup title="Источники, использованные в отчёте" count={usedSources.length}>
                                                <SourceList sources={usedSources} emptyText="В отчёте пока нет подтверждённых источников." />
                                            </SourceGroup>
                                            <SourceGroup title="Изученные источники, не вошедшие в отчёт" count={readSources.length} defaultOpen={false}>
                                                <SourceList sources={readSources} emptyText="Все изученные источники были использованы в отчёте." />
                                            </SourceGroup>
                                        </>
                                    )}
                                </div>
                            )}

                            {activeTab === "process" && (
                                <div className="mx-auto max-w-[700px]">
                                    <div className="mb-6 rounded-3xl border border-white/[0.07] bg-white/[0.025] p-5">
                                        <div className="flex items-center gap-3">
                                            {active ? (
                                                <ResearchActivityOrb />
                                            ) : (
                                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300">
                                                    <Check className="h-5 w-5" />
                                                </div>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-medium text-white/90">{phaseLabels[job.phase] || job.phase}</div>
                                                <div className="mt-1 text-xs text-white/35">{job.events.at(-1)?.message || "Ожидание запуска"}</div>
                                            </div>
                                            <span className="font-mono text-xs text-white/35">{job.progress}%</span>
                                        </div>
                                        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                                            <motion.div
                                                animate={{ width: `${job.progress}%` }}
                                                className="h-full rounded-full bg-white"
                                            />
                                        </div>
                                        {active && onCancel && (
                                            <button
                                                type="button"
                                                onClick={onCancel}
                                                className="mt-4 rounded-full border border-white/10 px-4 py-2 text-[11px] text-white/45 hover:bg-white/[0.05] hover:text-white"
                                            >
                                                Остановить исследование
                                            </button>
                                        )}
                                    </div>

                                    {job.blueprint?.questions?.length ? (
                                        <section className="mb-8">
                                            <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white/80">
                                                <BookOpen className="h-4 w-4 text-white/35" />
                                                План исследования
                                            </div>
                                            <ol className="space-y-3">
                                                {job.blueprint.questions.map((question, index) => (
                                                    <li key={question.id} className="flex gap-3 text-[13px] leading-relaxed text-white/55">
                                                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.05] font-mono text-[9px] text-white/35">{index + 1}</span>
                                                        <span>{question.question}</span>
                                                    </li>
                                                ))}
                                            </ol>
                                        </section>
                                    ) : null}

                                    <section>
                                        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white/80">
                                            <ShieldCheck className="h-4 w-4 text-white/35" />
                                            Журнал исследования
                                        </div>
                                        <div className="relative ml-3 border-l border-white/10 pl-6">
                                            {(job.events || []).map((event, index) => {
                                                const isLast = index === job.events.length - 1;
                                                return (
                                                    <div key={`${event.at}-${index}`} className="relative pb-6 last:pb-0">
                                                        <div className={`absolute -left-[31px] top-0 flex h-3 w-3 items-center justify-center rounded-full ring-4 ring-[#151516] ${isLast && active ? "bg-white" : "bg-emerald-400/70"}`}>
                                                            {isLast && active && <Circle className="h-2 w-2 animate-pulse text-black" />}
                                                        </div>
                                                        <div className="flex items-center gap-2 text-[11px] font-medium text-white/70">
                                                            <span>{phaseLabels[event.phase] || event.phase}</span>
                                                            <span className="font-mono text-[9px] text-white/20">{event.progress}%</span>
                                                        </div>
                                                        <div className="mt-1 text-[13px] leading-relaxed text-white/40">{event.message}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </section>

                                    {job.error && (
                                        <div className="mt-6 rounded-2xl border border-red-400/15 bg-red-400/[0.055] p-4 text-sm text-red-200/75">
                                            {job.error}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    );
}
