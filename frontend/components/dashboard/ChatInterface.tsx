import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, Loader, Star, Zap, Users, Grid, HelpCircle, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp, Activity, Globe, FileText, ArrowRight, Lock, Image as ImageIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessageResponse, ChatSessionDetailResponse, sendChatMessageFeedback, uploadChatFile } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { AnalysisCard } from "@/components/dashboard/AnalysisCard";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import { ChatInput, type PendingAttachment } from "@/components/chat/ChatInput";
import { CopyButton, serializeMessageHtml } from "@/components/chat/CopyButton";
import { ExportMenu } from "@/components/chat/ExportMenu";
import { FileCard } from "@/components/chat/FileCard";
import { ResearchProgressCard } from "@/components/chat/ResearchProgressCard";
import { ResearchDrawer } from "@/components/chat/ResearchDrawer";
import { PresentationDrawer } from "./PresentationDrawer";
import { PresentationSlide, importContext, type ResearchJob } from "@/lib/api";
import { ContextImportModal } from "@/components/chat/ContextImportModal";
import { UpgradeModal } from "@/components/chat/UpgradeModal";
import { notifyError } from "@/lib/ui";
import { stripThoughts, hostFromUrl, parseAttachments, parseExports, type MessageAttachment, type MessageExport } from "@/lib/utils";

// Плейсхолдеры названий чата — держать в синхроне с _DEFAULT_CHAT_TITLES
// в main.py. Пока сессия так называется, бэкенд генерирует ей название по
// контексту первой реплики (фоновая задача после отправки сообщения).
const DEFAULT_CHAT_TITLES = new Set(["чат с аналитиком", "новый чат", "новый диалог", "new chat", "чат"]);

export function isDefaultChatTitle(title?: string | null): boolean {
    const t = (title || "").trim().toLowerCase();
    return !t || DEFAULT_CHAT_TITLES.has(t);
}

function CollapsibleUserBubble({ content, attachmentsMeta }: { content: string; attachmentsMeta?: MessageAttachment[] }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const COLLAPSED_PX = 144; // ~5 lines

    // Attached files live inside the stored content between FILE markers.
    // Show them as chips and keep the extracted text out of the bubble.
    const { text, attachments: parsedAttachments } = parseAttachments(content);
    const chips = parsedAttachments.length > 0 ? parsedAttachments : (attachmentsMeta || []);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const next = el.scrollHeight > COLLAPSED_PX + 4;
        if (next !== isOverflowing) setIsOverflowing(next);
    }, [text, isOverflowing]);

    return (
        <div className="lovable-glass-strong border border-white/5 p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] rounded-tr-none bg-gradient-to-br from-white/[0.04] to-transparent">
            {chips.length > 0 && (
                <div className={`flex flex-wrap justify-end gap-2 ${text ? "mb-3" : ""}`}>
                    {chips.map((att, i) => (
                        <div
                            key={`${att.name}-${i}`}
                            title={att.name}
                            className="flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-xl border border-white/10 bg-white/[0.05] max-w-[240px]"
                        >
                            <div className="w-7 h-7 rounded-lg bg-white/[0.07] flex items-center justify-center shrink-0">
                                {att.kind === "image"
                                    ? <ImageIcon className="w-3.5 h-3.5 text-white/50" strokeWidth={1.8} />
                                    : <FileText className="w-3.5 h-3.5 text-white/50" strokeWidth={1.8} />}
                            </div>
                            <span className="text-[12px] text-white/70 font-medium truncate">{att.name}</span>
                        </div>
                    ))}
                </div>
            )}
            {text && (
                <motion.div
                    layout
                    initial={false}
                    animate={{ height: isOverflowing && !isExpanded ? COLLAPSED_PX : "auto" }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className="relative overflow-hidden"
                >
                    <div
                        ref={ref}
                        className="text-white/90 font-sans text-[16px] leading-[1.6] whitespace-pre-wrap selection:bg-white/20"
                        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                    >
                        {text}
                    </div>
                    {isOverflowing && !isExpanded && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 via-black/40 to-transparent" />
                    )}
                </motion.div>
            )}
            {isOverflowing && (
                <div className="mt-3 flex justify-end">
                    <button
                        onClick={() => setIsExpanded((v) => !v)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-white/60 hover:text-white text-[10px] font-mono uppercase tracking-[0.2em] font-bold transition-all active:scale-95"
                    >
                        {isExpanded ? "Свернуть" : "Развернуть"}
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                </div>
            )}
        </div>
    );
}

interface ExtendedChatMessage extends ChatMessageResponse {
    thoughts?: string;
    thoughtTime?: number;
    thoughtExpanded?: boolean;
    client_id?: string;
    sources?: { title: string; url: string }[];
    sourcesExpanded?: boolean;
    isResearch?: boolean;
    model_used?: string;
    research_job_id?: number | null;
    researchJob?: ResearchJob;
    // Client-side chips for the optimistic user message; after the server
    // sync the same data comes embedded in content as FILE markers.
    attachmentsMeta?: MessageAttachment[];
    // Файлы-экспорты из живых SSE-событий `file`; после reconcile те же
    // карточки восстанавливаются из EXPORT-маркеров в content (parseExports).
    exports?: MessageExport[];
}

interface ChatInterfaceProps {
    session: ChatSessionDetailResponse;
    onUpdate: (updatedSession: ChatSessionDetailResponse) => void;
    isSidebarCollapsed?: boolean;
    onImportModalChange?: (open: boolean) => void;
    // Feature gates from /me/usage — when false, the matching tool in
    // the dropdown is rendered as locked and clicks open the upgrade modal.
    canUseDeepSearch?: boolean;
    canUseResearch?: boolean;
    canUsePresentation?: boolean;
    canUseImportContext?: boolean;
    // Used to show the ChatGPT-style upgrade banner when messages run out.
    messagesRemaining?: number | null;
    tierLabel?: string;
}

export function ChatInterface({
    session,
    onUpdate,
    isSidebarCollapsed,
    onImportModalChange,
    canUseDeepSearch = true,
    canUseResearch = true,
    canUsePresentation = true,
    canUseImportContext = true,
    messagesRemaining,
    tierLabel,
}: ChatInterfaceProps) {
    const [messages, setMessages] = useState<ExtendedChatMessage[]>(session.messages || []);
    const [modeHint, setModeHint] = useState<string | null>(null);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
    const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
    const [useDeepSearch, setUseDeepSearch] = useState(false);
    const [isResearchMode, setIsResearchMode] = useState(false);
    const [openResearchMessageKey, setOpenResearchMessageKey] = useState<string | null>(null);
    const [isPresentationMode, setIsPresentationMode] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const scrollViewportRef = useRef<HTMLDivElement>(null);
    const inputBarRef = useRef<HTMLDivElement>(null);
    const [inputBarHeight, setInputBarHeight] = useState(280);
    const abortControllerRef = useRef<AbortController | null>(null);
    useEffect(() => {
        let disposed = false;
        let timer: NodeJS.Timeout | null = null;
        const refresh = async () => {
            const token = getToken();
            if (!token || disposed) return;
            const { getChatSession, getResearchJob, getSessionResearchJob } = await import("@/lib/api");
            const [freshSession, latestJob] = await Promise.all([
                getChatSession(session.id, token).catch(() => null),
                getSessionResearchJob(session.id, token).catch(() => null),
            ]);
            if (disposed) return;
            const serverMessages = freshSession?.messages || session.messages || [];
            const ids = Array.from(new Set(serverMessages.map(m => m.research_job_id).filter((id): id is number => !!id)));
            const jobs = await Promise.all(ids.map(id =>
                latestJob?.id === id ? Promise.resolve(latestJob) : getResearchJob(id, token).catch(() => null)
            ));
            if (disposed) return;
            const byId = new Map(jobs.filter((j): j is ResearchJob => !!j).map(j => [j.id, j]));
            setMessages(prev => {
                const localByKey = new Map(prev.map(message => [(message.client_id || message.id)?.toString(), message]));
                return serverMessages.map(message => {
                    const local = localByKey.get((message.client_id || message.id)?.toString());
                    const researchJob = message.research_job_id ? byId.get(message.research_job_id) : undefined;
                    return {
                        ...message,
                        content: (local?.content?.length || 0) > (message.content?.length || 0) ? local?.content || "" : message.content,
                        thoughts: (local?.thoughts?.length || 0) > (message.thoughts?.length || 0) ? local?.thoughts : message.thoughts,
                        sources: (local?.sources?.length || 0) > (message.sources?.length || 0) ? local?.sources || [] : message.sources,
                        researchJob: researchJob || local?.researchJob,
                    };
                });
            });
            if (jobs.some(j => j && ["queued", "running", "cancelling"].includes(j.status))) timer = setTimeout(refresh, 2500);
        };
        refresh();
        return () => { disposed = true; if (timer) clearTimeout(timer); };
    }, [session.id, session.messages]);

    // Авто-название чата генерирует фоновая задача на бэкенде — к моменту
    // reconcile-а после стрима оно может быть ещё не готово. Пока у сессии
    // плейсхолдер, добираем название отложенными запросами, чтобы список
    // чатов обновился без перезагрузки страницы.
    const sessionIdRef = useRef(session.id);
    useEffect(() => { sessionIdRef.current = session.id; }, [session.id]);
    const titleRefreshTimer = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => () => {
        if (titleRefreshTimer.current) clearTimeout(titleRefreshTimer.current);
    }, []);

    const scheduleTitleRefresh = useCallback((sessionId: number, token: string, attempt = 0) => {
        if (attempt >= 3) return;
        if (titleRefreshTimer.current) clearTimeout(titleRefreshTimer.current);
        titleRefreshTimer.current = setTimeout(async () => {
            try {
                const { getChatSession } = await import("@/lib/api");
                const fresh = await getChatSession(sessionId, token);
                if (sessionIdRef.current !== sessionId) return; // чат переключили
                if (isDefaultChatTitle(fresh.title)) {
                    scheduleTitleRefresh(sessionId, token, attempt + 1);
                } else {
                    onUpdate(fresh);
                }
            } catch {
                // фоновое обновление названия — ошибку пользователю не показываем
            }
        }, 2500);
    }, [onUpdate]);

    // Presentation state
    const [presentationSlides, setPresentationSlides] = useState<PresentationSlide[] | null>(null);
    const [isPresentationOpen, setIsPresentationOpen] = useState(false);
    const [isGeneratingSlides, setIsGeneratingSlides] = useState(false);
    const [slideProvider, setSlideProvider] = useState<string | null>(null);
    // Width of the chat column in % when split-pane is active. Persists
    // across sessions via localStorage so user's preference survives reloads.
    const [chatWidthPct, setChatWidthPct] = useState<number>(() => {
        if (typeof window === "undefined") return 60;
        const saved = parseFloat(window.localStorage.getItem("pitchy_split_pct") || "");
        return Number.isFinite(saved) && saved >= 30 && saved <= 80 ? saved : 60;
    });
    const [generationStatus, setGenerationStatus] = useState<string | null>(null);

    // Import Modal state
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    useEffect(() => {
        onImportModalChange?.(isImportModalOpen);
    }, [isImportModalOpen, onImportModalChange]);

    // Upgrade Modal state (shown on limit errors)
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const [upgradeModalMessage, setUpgradeModalMessage] = useState<string | undefined>(undefined);

    // Typewriter animation state
    const [typingMessageId, setTypingMessageId] = useState<string | number | null>(null);
    const [displayedLength, setDisplayedLength] = useState(0);
    const typingSpeed = 12; // ms per character

    const handleFeedback = async (messageId: number, feedbackValue: number) => {
        setMessages((prev) => prev.map((m) =>
            m.id === messageId ? { ...m, feedback: feedbackValue } : m
        ));

        try {
            const token = getToken();
            if (!token) throw new Error("No token");
            await sendChatMessageFeedback(session.id, messageId, feedbackValue, token);
        } catch (error) {
            console.error("Failed to send feedback:", error);
        }
    };

    const MAX_ATTACHED_FILES = 5;

    const handlePickFiles = (files: File[]) => {
        const token = getToken();
        if (!token) {
            notifyError("Войдите, чтобы прикреплять файлы.");
            return;
        }
        const room = MAX_ATTACHED_FILES - pendingAttachments.length;
        if (room <= 0) {
            notifyError(`Можно прикрепить не более ${MAX_ATTACHED_FILES} файлов к одному сообщению.`);
            return;
        }
        if (files.length > room) {
            notifyError(`Можно прикрепить не более ${MAX_ATTACHED_FILES} файлов — лишние пропущены.`);
        }
        files.slice(0, room).forEach((file) => {
            const isImage = file.type.startsWith("image/");
            const maxBytes = (isImage ? 10 : 15) * 1024 * 1024;
            if (file.size > maxBytes) {
                notifyError(`«${file.name}» больше ${isImage ? 10 : 15} МБ.`);
                return;
            }
            const id = crypto.randomUUID();
            const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
            setPendingAttachments((prev) => [...prev, {
                id,
                name: file.name,
                kind: isImage ? "image" : "file",
                status: "uploading",
                previewUrl,
            }]);
            uploadChatFile(file, token)
                .then((res) => {
                    setPendingAttachments((prev) => prev.map((a) =>
                        a.id === id ? { ...a, name: res.name, kind: res.kind, text: res.text, status: "ready" } : a
                    ));
                })
                .catch((err) => {
                    const message = err instanceof Error ? err.message : "Не удалось обработать файл";
                    notifyError(`${file.name}: ${message}`);
                    setPendingAttachments((prev) => prev.map((a) =>
                        a.id === id ? { ...a, status: "error", error: message } : a
                    ));
                });
        });
    };

    const handleRemoveAttachment = (id: string) => {
        setPendingAttachments((prev) => {
            const target = prev.find((a) => a.id === id);
            if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
            return prev.filter((a) => a.id !== id);
        });
    };

    const getSafeKey = useCallback((m: ExtendedChatMessage) => {
        return (m.client_id || m.id)?.toString();
    }, []);

    const mergeMessages = useCallback((current: ExtendedChatMessage[], incoming: ExtendedChatMessage[]) => {
        const map = new Map();

        incoming.forEach(inc => {
            const key = getSafeKey(inc);
            if (key) map.set(key, inc);
        });

        current.forEach(loc => {
            const key = getSafeKey(loc);
            if (!key) return;

            const serverMatch = map.get(key);
            
            if (serverMatch) {
                map.set(key, {
                    ...serverMatch,
                    content: (loc.content?.length || 0) > (serverMatch.content?.length || 0) 
                        ? loc.content 
                        : serverMatch.content,
                    thoughts: (loc.thoughts?.length || 0) >= (serverMatch.thoughts?.length || 0)
                        ? loc.thoughts
                        : serverMatch.thoughts,
                    thoughtTime: loc.thoughtTime || serverMatch.thoughtTime,
                    thoughtExpanded: loc.thoughtExpanded ?? serverMatch.thoughtExpanded,
                    isResearch: loc.isResearch || serverMatch.isResearch,
                    sources: (loc.sources?.length || 0) > (serverMatch.sources?.length || 0) ? loc.sources : serverMatch.sources,
                    researchJob: loc.researchJob || serverMatch.researchJob,
                });
            } else {
                if (isLoading || (loc.content && loc.content.length > 0)) {
                    map.set(key, loc);
                }
            }
        });
        
        return Array.from(map.values()).sort((a, b) => 
            dayjs(a.created_at).valueOf() - dayjs(b.created_at).valueOf()
        );
    }, [getSafeKey, isLoading]);

    useEffect(() => {
        if (session.messages) {
            setMessages(prev => {
                const merged = mergeMessages(prev, session.messages);
                // We no longer add a fake greeting message here.
                return merged;
            });
            // Show modeHint if chat is almost empty and mode is locked but not active
            if (session.messages.length <= 1 && typeof window !== "undefined") {
                const isActive = localStorage.getItem(`pitchy_is_mode_active_${session.id}`);
                const savedGreeting = localStorage.getItem(`pitchy_chat_greeting_${session.id}`);
                if (!isActive && savedGreeting) {
                    setModeHint(savedGreeting);
                } else {
                    setModeHint(null);
                }
            } else {
                setModeHint(null);
            }
        }
    }, [session.messages, mergeMessages, session.id]);

    // Pause autoscroll while user is interacting with scroll. Cleared once they
    // come back to the bottom of the chat.
    const [userScrolledUp, setUserScrolledUp] = useState(false);
    const lastUserMessageKeyRef = useRef<string | null>(null);

    // Measure the absolute input bar so the scroll viewport reserves exactly
    // the right amount of bottom padding — answer's last line lands above the
    // input bar with no extra empty scroll space below.
    useEffect(() => {
        const el = inputBarRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const apply = () => setInputBarHeight(Math.ceil(el.getBoundingClientRect().height));
        apply();
        const ro = new ResizeObserver(apply);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        const container = scrollViewportRef.current;
        if (!container) return;
        const onScroll = () => {
            const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
            setUserScrolledUp(distance > 80);
        };
        const onWheel = () => {
            const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
            if (distance > 40) setUserScrolledUp(true);
        };
        container.addEventListener("scroll", onScroll, { passive: true });
        container.addEventListener("wheel", onWheel, { passive: true });
        container.addEventListener("touchmove", onWheel, { passive: true });
        return () => {
            container.removeEventListener("scroll", onScroll);
            container.removeEventListener("wheel", onWheel);
            container.removeEventListener("touchmove", onWheel);
        };
    }, []);

    const scrollToBottom = (force = false) => {
        if (!scrollViewportRef.current) return;
        const container = scrollViewportRef.current;
        const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (force || (!userScrolledUp && distance < 200)) {
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        }
    };

    // Anchor the most recently sent user message to the top of the viewport so
    // the user can read it while the assistant is generating. Runs once per
    // new user message; further auto-scrolling is governed by scrollToBottom.
    useEffect(() => {
        const last = messages[messages.length - 1];
        if (!last) return;
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (!lastUser) return;
        const key = (lastUser.client_id || lastUser.id)?.toString();
        if (!key || lastUserMessageKeyRef.current === key) return;
        lastUserMessageKeyRef.current = key;
        setUserScrolledUp(false);
        // wait one frame so the DOM has the new message rendered
        requestAnimationFrame(() => {
            const container = scrollViewportRef.current;
            if (!container) return;
            const node = container.querySelector(
                `[data-message-key="${key}"]`
            ) as HTMLElement | null;
            if (!node) return;
            const containerRect = container.getBoundingClientRect();
            const nodeRect = node.getBoundingClientRect();
            // offsetTop is unreliable here because the message's offsetParent
            // is the positioned ChatInterface root, not the scroll container.
            const target = container.scrollTop + (nodeRect.top - containerRect.top) - 24;
            container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
        });
    }, [messages]);

    useEffect(() => {
        // First time loading a session — drop to the latest reply
        if (!isLoading && messages.length > 0 && lastUserMessageKeyRef.current === null) {
            scrollToBottom(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session.id]);

    // Подсказка режима теперь в потоке сообщений — доводим её до вида.
    // Ждём конца входной анимации: плавный скролл, запущенный раньше,
    // браузер отменяет из-за меняющейся во время анимации высоты.
    useEffect(() => {
        if (!modeHint) return;
        const timer = setTimeout(() => scrollToBottom(true), 420);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modeHint]);

    useEffect(() => {
        // Чат, созданный с initial_message (интент с лендинга), получает
        // авто-название фоном — при открытии с плейсхолдером добираем его.
        // Пустые чаты (только приветствие) не опрашиваем: rename ещё не запущен.
        const hasUserMessage = (session.messages || []).some((m) => m.role === "user");
        if (!hasUserMessage || !isDefaultChatTitle(session.title)) return;
        const token = getToken();
        if (token) scheduleTitleRefresh(session.id, token);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session.id]);

    useEffect(() => {
        if (typingMessageId === null) return;
        const msg = messages.find((m) => getSafeKey(m) === typingMessageId.toString());
        if (!msg) { setTypingMessageId(null); return; }
        const cleanLen = stripThoughts(msg.content || "").length;
        if (displayedLength >= cleanLen) {
            // caught up to currently-streamed content; stop typewriter only when stream is done
            if (!isLoading) {
                setTypingMessageId(null);
            }
            return;
        }
        const nextChar = stripThoughts(msg.content || "")[displayedLength];
        const speed = /[|\-#*\n\r]/.test(nextChar) ? 2 : typingSpeed;
        const timer = setTimeout(() => {
            const chunk = Math.min(3, cleanLen - displayedLength);
            setDisplayedLength((prev) => prev + chunk);
        }, speed);
        return () => clearTimeout(timer);
    }, [typingMessageId, displayedLength, messages, getSafeKey, isLoading]);

    useEffect(() => {
        if (!isLoading && typingMessageId !== null) {
            const msg = messages.find((m) => getSafeKey(m) === typingMessageId.toString());
            if (msg) {
                const cleanLen = stripThoughts(msg.content || "").length;
                if (displayedLength >= cleanLen) setTypingMessageId(null);
            }
        }
    }, [isLoading, typingMessageId, messages, getSafeKey, displayedLength]);

    const getDisplayContent = useCallback((msg: ChatMessageResponse) => {
        // EXPORT-маркеры (карточки файлов) не должны попадать в ReactMarkdown —
        // они рендерятся отдельными FileCard под сообщением.
        const cleaned = parseExports(stripThoughts(msg.content || "")).text;
        const safeFull = cleaned.replace(/\n\|[ \-|]*$/g, "\n");
        if (msg.role === "assistant" && getSafeKey(msg) === typingMessageId?.toString()) {
            return safeFull.slice(0, displayedLength);
        }
        return safeFull;
    }, [typingMessageId, displayedLength, getSafeKey]);

    // Отрендеренные DOM-узлы контента сообщений — для rich-копирования
    // (CopyButton кладёт в буфер text/html из уже отрисованной разметки).
    const messageContentRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    // Карточки файлов сообщения: live SSE-события + персистентные маркеры
    // из content (после перезагрузки/reconcile), с дедупликацией.
    const getMessageExports = useCallback((msg: ExtendedChatMessage): MessageExport[] => {
        const persisted = parseExports(msg.content || "").exports;
        const live = msg.exports || [];
        return [...persisted, ...live].filter((e, i, arr) =>
            arr.findIndex((x) => x.format === e.format && x.name === e.name) === i
        );
    }, []);

    const handleSendMessage = async (text?: string, forceIntent?: string, silent: boolean = false, opts: { regenerateDeck?: boolean } = {}) => {
        const content = typeof text === 'string' ? text : inputValue.trim();
        // Cap defensively: the backend schema rejects payloads with more than 5 files.
        const readyAttachments = pendingAttachments.filter((a) => a.status === "ready" && a.text).slice(0, MAX_ATTACHED_FILES);
        if ((!content && readyAttachments.length === 0) || isLoading) return;
        if (pendingAttachments.some((a) => a.status === "uploading")) return;

        // Mode Selector Logic for Empty Chat
        if (messages.length <= 1 && text && !silent && forceIntent) {
            let greeting = "Я готов помочь с любым вопросом по стартапу: от подготовки к питчу до технической архитектуры. Что вас сейчас беспокоит?";
            if (text.toLowerCase().includes("анализ идеи")) {
                greeting = "Режим анализа идеи активирован. Опишите вашу задумку: какую проблему вы решаете и в чем уникальность вашего продукта? Я помогу оценить потенциал и риски.";
            } else if (text.toLowerCase().includes("ца") || text.toLowerCase().includes("целевой аудитории")) {
                greeting = "Переходим к анализу аудитории. Кто ваш идеальный клиент? Опишите тех, кто первым купит ваш продукт, и я помогу выделить сегменты и боли.";
            } else if (text.toLowerCase().includes("экономик") || text.toLowerCase().includes("посчитай")) {
                greeting = "Режим фин-анализа включен. Пожалуйста, введите данные проекта (CAC, ARPU, Churn Rate) или опишите модель монетизации для примерного расчета.";
            }

            if (typeof window !== "undefined") {
                localStorage.setItem(`pitchy_chat_mode_${session.id}`, forceIntent);
                localStorage.setItem(`pitchy_chat_greeting_${session.id}`, greeting);
            }

            setModeHint(greeting);
            return;
        }

        let intentToSend = forceIntent;
        if (!intentToSend && messages.length <= 2 && typeof window !== "undefined") {
            intentToSend = localStorage.getItem(`pitchy_chat_mode_${session.id}`) || undefined;
        }

        if (typeof text !== 'string') setInputValue("");
        setIsLoading(true);

        const attachmentsPayload = readyAttachments.map((a) => ({ name: a.name, kind: a.kind, text: a.text as string }));
        if (pendingAttachments.length > 0) {
            pendingAttachments.forEach((a) => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
            setPendingAttachments([]);
        }

        // Set flag to prevent greeting duplication on next sync
        if (typeof window !== "undefined") {
            localStorage.setItem(`pitchy_is_mode_active_${session.id}`, "true");
        }
        setModeHint(null);

        const isPresentationRequest = intentToSend === 'presentation' || isPresentationMode;

        if (isPresentationRequest) {
            setPresentationSlides(null);
            setGenerationStatus(null);
            setIsGeneratingSlides(true);
            setIsPresentationOpen(true);
            setSlideProvider(null);
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            const token = getToken();
            if (!token) throw new Error("No token");

            const now = new Date();
            const userClientId = crypto.randomUUID();
            const assistantClientId = crypto.randomUUID();

            if (!silent) {
                setStreamingStatus("Pitchy планирует поиск...");
                setMessages((prev) => [
                    ...prev,
                    {
                        id: Date.now(),
                        role: "user",
                        content,
                        created_at: now.toISOString(),
                        client_id: userClientId,
                        attachmentsMeta: attachmentsPayload.map(({ name, kind }) => ({ name, kind }))
                    },
                    {
                        id: now.getTime() + 1,
                        role: "assistant",
                        content: "",
                        created_at: now.toISOString(),
                        client_id: assistantClientId,
                        thoughtExpanded: true
                    },
                ]);
            } else {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: now.getTime() + 1,
                        role: "assistant",
                        content: "",
                        created_at: now.toISOString(),
                        client_id: assistantClientId,
                        thoughtExpanded: true
                    },
                ]);
            }

            if (isResearchMode) {
                const { createResearchJob, getResearchJob, getChatSession } = await import("@/lib/api");
                let job = await createResearchJob({ session_id: session.id, query: content, client_id: userClientId, assistant_client_id: assistantClientId }, token);
                setMessages(prev => prev.map(m => m.client_id === assistantClientId ? { ...m, research_job_id: job.id, researchJob: job, thoughts: undefined } : m));
                setOpenResearchMessageKey(assistantClientId);
                while (["queued", "running", "cancelling"].includes(job.status)) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    if (abortController.signal.aborted) break;
                    job = await getResearchJob(job.id, token);
                    const trace = job.events.map(e => `› ${e.message}`).join("\n");
                    setStreamingStatus(job.events.at(-1)?.message || "Pitchy проводит исследование");
                    setMessages(prev => prev.map(m => m.client_id === assistantClientId ? { ...m, researchJob: job, thoughts: trace, content: job.report || "", sources: job.sources } : m));
                }
                if (job.status === "failed") throw new Error(job.error || "Исследование завершилось с ошибкой");
                const updatedSession = await getChatSession(session.id, token);
                onUpdate(updatedSession);
                setMessages(prev => mergeMessages(prev, updatedSession.messages || []));
                return;
            }
            setTypingMessageId(assistantClientId);
            setDisplayedLength(0);

            let assistantContent = "";
            let fullThoughtContent = "";
            let statusTrace = "";
            let lastStatusForTrace = "";
            const startTime = now.getTime();
            const { sendChatMessageStream, getChatSession } = await import("@/lib/api");

            // Seed the thinking block immediately so the user sees something
            // alive instead of the bare "planning…" status pill.
            setMessages((prev) => prev.map((m) =>
                m.client_id === assistantClientId
                    ? { ...m, thoughts: "Pitchy анализирует ваш запрос…", thoughtExpanded: true }
                    : m
            ));

            let watchdog: NodeJS.Timeout;
            const resetWatchdog = () => {
                clearTimeout(watchdog);
                // 45s: длинная «мысль» модели (напр. генерация отчёта для экспорта —
                // до ~35s молчания без стрим-событий) не должна обрывать генерацию.
                // При обрыве по 20s стоп-кнопка исчезала, а ответ подтягивался рефетчем.
                watchdog = setTimeout(() => {
                    console.error("Watchdog timeout: no events for 45s");
                    if (abortControllerRef.current) {
                        abortControllerRef.current.abort();
                    }
                    setStreamingStatus("Слишком долгое ожидание ответа от серверов (Таймаут).");
                }, 45000);
            };

            resetWatchdog();

            try {
                for await (const chunk of sendChatMessageStream(
                    session.id,
                    content,
                    token,
                    abortController.signal,
                    userClientId,
                    assistantClientId,
                    useDeepSearch,
                    isResearchMode,
                    isPresentationRequest ? 'presentation' : (intentToSend || undefined),
                    !!opts.regenerateDeck,
                    attachmentsPayload
                )) {
                    resetWatchdog();
                    if (chunk.type === "ping") {
                        continue;
                    }
                    if (chunk.type === "thought") {
                        fullThoughtContent += chunk.content;
                        const merged = (statusTrace ? statusTrace + "\n\n" : "") + fullThoughtContent;
                        setMessages(prev => prev.map(m =>
                            m.client_id === assistantClientId ? { ...m, thoughts: merged, isResearch: true, thoughtExpanded: true } : m
                        ));
                    } else if (chunk.type === "chunk") {
                        let thoughtUpdate: Record<string, unknown> = {};
                        const isFirstChunk = !assistantContent;
                        if (isFirstChunk) {
                            const duration = Math.round((Date.now() - startTime) / 1000);
                            const finalThoughts = fullThoughtContent || statusTrace || "";
                            thoughtUpdate = { thoughtTime: duration, thoughtExpanded: false, thoughts: finalThoughts };
                            setStreamingStatus(null);
                        }
                        assistantContent += chunk.content;
                        setMessages((prev) =>
                            prev.map(m => m.client_id === assistantClientId ? { ...m, content: assistantContent, isResearch: isResearchMode || useDeepSearch, ...thoughtUpdate } : m)
                        );
                    } else if (chunk.type === "sources") {
                        setMessages((prev) =>
                            prev.map(m => m.client_id === assistantClientId ? { ...m, sources: chunk.data, isResearch: true } : m)
                        );
                    } else if (chunk.type === "provider") {
                        // Surface which provider ended up generating the deck —
                        // PresentationDrawer renders it as a small pill.
                        setSlideProvider((chunk as { name?: string }).name || null);
                    } else if (chunk.type === "slide") {
                        // Progressive streaming: each slide appears in the
                        // side-pane as soon as the model finishes it. We
                        // insert at the supplied `position` (1-indexed) so
                        // out-of-order Z.AI events still land correctly.
                        const pos = (chunk as { position?: number }).position;
                        setPresentationSlides((prev) => {
                            const next = (prev ? [...prev] : []) as PresentationSlide[];
                            if (typeof pos === "number" && pos > 0) {
                                while (next.length < pos) next.push(null as unknown as PresentationSlide);
                                next[pos - 1] = chunk.data as PresentationSlide;
                            } else {
                                next.push(chunk.data as PresentationSlide);
                            }
                            return next.filter(Boolean) as PresentationSlide[];
                        });
                        // Keep the loading shimmer until the consolidated
                        // "presentation" event arrives — that signals the deck
                        // is fully built.
                    } else if (chunk.type === "presentation") {
                        setPresentationSlides(chunk.data);
                        setIsGeneratingSlides(false);
                    } else if (chunk.type === "status") {
                        setStreamingStatus(chunk.content);
                        setGenerationStatus(chunk.content);
                        // Append status into the live thinking trace so the
                        // user sees Pitchy's planning steps in the same block
                        // instead of a bare status pill.
                        if (chunk.content && chunk.content !== lastStatusForTrace) {
                            lastStatusForTrace = chunk.content;
                            statusTrace = (statusTrace ? statusTrace + "\n" : "") + "› " + chunk.content;
                            const liveThoughts = fullThoughtContent
                                ? statusTrace + "\n\n" + fullThoughtContent
                                : statusTrace;
                            setMessages((prev) => prev.map((m) =>
                                m.client_id === assistantClientId
                                    ? { ...m, thoughts: liveThoughts, isResearch: true, thoughtExpanded: true }
                                    : m
                            ));
                        }
                    } else if (chunk.type === "metadata") {
                        setMessages((prev) =>
                            prev.map(m => m.client_id === assistantClientId ? { ...m, model_used: chunk.model } : m)
                        );
                    } else if (chunk.type === "file") {
                        // Карточка файла-экспорта («сохрани ответ в pdf»).
                        const fileChunk = chunk as { format: string; name: string; message_id?: number };
                        setMessages((prev) =>
                            prev.map(m => m.client_id === assistantClientId
                                ? { ...m, exports: [...(m.exports || []), { format: fileChunk.format, name: fileChunk.name, message_id: fileChunk.message_id }] }
                                : m)
                        );
                    }
                }
            } catch (err: unknown) {
                if (err instanceof Error && err.name === 'AbortError') {
                    console.log("Generation aborted");
                } else {
                    console.error("Stream error:", err);
                    throw err;
                }
            } finally {
                clearTimeout(watchdog!);
            }

            await new Promise(resolve => setTimeout(resolve, 400));
            const updatedSession = await getChatSession(session.id, token);
            onUpdate(updatedSession);
            setMessages((prev) => mergeMessages(prev, updatedSession.messages || []));
            if (isDefaultChatTitle(updatedSession.title)) {
                scheduleTitleRefresh(session.id, token);
            }

        } catch (error) {
            console.error(error);
            if (error instanceof Error && error.message.includes("API_ERROR:")) {
                const detail = error.message.split("API_ERROR:")[1] || "";
                if (detail.includes("Лимит") || detail.includes("лимит") || detail.includes("исчерпан")) {
                    setUpgradeModalMessage(detail);
                    setIsUpgradeModalOpen(true);
                } else {
                    notifyError(detail || "Отказано в доступе. Сообщение не отправлено.");
                }
            } else {
                notifyError("Не удалось отправить сообщение.");
            }
            setMessages((prev) => {
                const last = prev.length;
                if (last >= 2 && prev[last - 1].role === "assistant" && prev[last - 1].content === "") {
                    return prev.slice(0, -2);
                }
                return prev.filter(m => m.id !== -1);
            });
        } finally {
            setIsLoading(false);
            setStreamingStatus(null);
            setIsGeneratingSlides(false);
            setIsResearchMode(false); 
            if (isPresentationRequest && !isPresentationOpen) {
                setIsPresentationMode(false); 
            }
            abortControllerRef.current = null;
            setTimeout(() => textareaRef.current?.focus(), 100);
        }
    };

    const stopGeneration = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setIsLoading(false);
            abortControllerRef.current = null;
        }
    };

    // Split-pane mode kicks in on md+ as soon as a presentation is in
    // flight OR ready. The chat shrinks left, the preview docks right —
    // both visible at once so the user can iterate on slides without
    // closing/reopening a modal. The "during generation" half is what
    // lets the loading shimmer live in the side pane instead of popping
    // an overlay over the chat first.
    const hasSlides = !!(presentationSlides && presentationSlides.length > 0);
    const useInlinePanel = hasSlides || isGeneratingSlides;
    const openResearchMessage = openResearchMessageKey
        ? messages.find((message) => (message.client_id || message.id).toString() === openResearchMessageKey) || null
        : null;

    // Приветствие платформы — первый ответ ассистента в сессии (его пишет
    // бэкенд при создании чата). Копировать/экспортировать и оценивать там
    // нечего, поэтому панель действий под ним не показываем.
    const firstAssistantIdx = messages.findIndex((m) => m.role === "assistant");

    // Vertical drag-handle that lets the user resize the chat/preview split.
    // mousedown on the divider → listen on document → live-update chatWidthPct
    // while dragging → persist on mouseup.
    const startDrag = (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const root = (e.currentTarget.parentElement as HTMLElement) || document.body;
        const totalWidth = root.getBoundingClientRect().width;
        const startPct = chatWidthPct;
        const onMove = (ev: MouseEvent) => {
            const dx = ev.clientX - startX;
            const next = Math.max(30, Math.min(80, startPct + (dx / totalWidth) * 100));
            setChatWidthPct(next);
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            try { window.localStorage.setItem("pitchy_split_pct", String(chatWidthPct)); } catch {}
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    };

    return (
        <div className="flex flex-1 h-full min-h-0 bg-black relative overflow-hidden">
            <div
                className="flex flex-col h-full min-h-0 relative overflow-hidden flex-1 min-w-0"
                style={useInlinePanel ? { maxWidth: `${chatWidthPct}%` } : undefined}
            >
            {/* Messages Area */}
            <div
                ref={scrollViewportRef}
                style={{ paddingBottom: inputBarHeight + 24 }}
                className="flex-1 overflow-y-auto scroll-smooth pt-24 px-3 sm:px-6 lg:px-12 pitchy-chat-scroll"
            >
                <div className={`mx-auto w-full transition-all duration-500 ease-[0.16,1,0.3,1] ${isSidebarCollapsed ? 'max-w-6xl' : 'max-w-5xl'} space-y-8`}>
                {messages.length === 0 && (
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-col items-center justify-center h-[50vh] text-center p-8"
                    >
                        <div className="w-20 h-20 bg-white/5 flex items-center justify-center rounded-[2.5rem] mb-8">
                            <Star className="w-10 h-10 text-white/20" strokeWidth={1} />
                        </div>
                        <h2 className="text-4xl font-display text-white mb-4">Интеллектуальный анализ</h2>
                        <p className="text-white/40 font-light text-lg leading-relaxed max-w-sm">
                            Начните диалог, описав ваш проект или задав вопрос Pitchy AI.
                        </p>
                    </motion.div>
                )}

                {messages.map((msg, idx) => {
            const messageKey = msg.client_id || msg.id;

            let derivedThoughts = msg.thoughts;
            const rawContentText = msg.content || "";
            if (!derivedThoughts && (rawContentText.includes("<think>") || rawContentText.includes("ǏǏǏ"))) {
                const match = rawContentText.match(/<think>([\s\S]*?)(?:<\/think>|$)/) || rawContentText.match(/ǏǏǏ([\s\S]*?)(?:ǏǏǏ|$)/);
                if (match) derivedThoughts = match[1];
            }

            const cleanContent = stripThoughts(rawContentText);
            const hasThoughts = derivedThoughts !== undefined && derivedThoughts !== null && derivedThoughts.length > 0;
            const showThoughts = hasThoughts;
            
            const hasContent = cleanContent.trim().length > 0;
            const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1;
            const shouldRenderMainBubble = msg.role === "user" || (hasContent && !msg.researchJob);
            const isGreeting = msg.role === "assistant" && idx === firstAssistantIdx;

            return (
                <motion.div 
                    key={msg.client_id || msg.id.toString()}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    {msg.role === "user" ? (
                        <div className="mb-8 flex flex-col items-end" data-message-key={messageKey}>
                            <div className="max-w-[85%] group">
                                <div className="flex items-center justify-end gap-3 mb-3 px-2">
                                    <span className="font-mono text-[9px] text-white/20 uppercase tracking-[0.2em] font-bold group-hover:text-white/40 transition-colors">USER</span>
                                </div>
                                <CollapsibleUserBubble content={getDisplayContent(msg)} attachmentsMeta={msg.attachmentsMeta} />
                            </div>
                        </div>
                    ) : (
                        <div className="mb-10 flex flex-col items-start w-full">
                            <div className="w-full">
                                <div className="flex items-center gap-3 mb-6 px-1">
                                    <div className="w-6 h-6 flex items-center justify-center p-1 bg-white/5 rounded-lg border border-white/5 shadow-inner">
                                        <img src="/icons/logotip.png" alt="Pitchy" className="w-full h-full object-contain brightness-0 invert opacity-80" />
                                    </div>
                                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white font-bold">pitchy</span>
                                    <div className="h-px w-12 bg-white/5 mx-2 hidden sm:block"></div>
                                    <span className="font-mono text-[9px] text-white/20 uppercase tracking-widest font-bold">
                                        {dayjs(msg.created_at).format("HH:mm")}
                                    </span>
                                </div>

                                {msg.researchJob && (
                                    <ResearchProgressCard
                                        job={msg.researchJob}
                                        onOpen={() => setOpenResearchMessageKey(messageKey.toString())}
                                        onCancel={["queued", "running", "cancelling"].includes(msg.researchJob.status) ? async () => {
                                            const token = getToken();
                                            if (!token) return;
                                            const { cancelResearchJob } = await import("@/lib/api");
                                            const job = await cancelResearchJob(msg.researchJob!.id, token);
                                            setMessages(prev => prev.map(m => (m.client_id || m.id) === messageKey ? { ...m, researchJob: job } : m));
                                            abortControllerRef.current?.abort();
                                        } : undefined}
                                    />
                                )}
                                {/* Thought Process */}
                                {showThoughts && !msg.researchJob && (
                                    <div className="mb-8 ml-1">
                                        <details className="group" open={msg.thoughtExpanded}>
                                            <summary 
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    setMessages(prev => prev.map(m => (m.client_id || m.id) === messageKey ? { ...m, thoughtExpanded: !m.thoughtExpanded } : m));
                                                }}
                                                className="list-none cursor-pointer flex items-center gap-2.5 text-white/30 hover:text-white transition-all py-2 px-3 hover:bg-white/[0.03] rounded-full border border-transparent hover:border-white/5 w-fit active:scale-95"
                                            >
                                                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${msg.thoughtExpanded ? '' : '-rotate-90'}`} />
                                                <span className="font-mono text-[9px] uppercase tracking-[0.2em] flex items-center gap-2.5 font-bold">
                                                    {isLoading && isLastAssistant && !msg.thoughtTime ? <Activity className="w-3.5 h-3.5 animate-pulse text-emerald-400" /> : <Cpu className="w-3.5 h-3.5 text-white/20" />}
                                                    {msg.thoughtTime ? `ПРОЦЕСС МЫШЛЕНИЯ (${msg.thoughtTime} СЕК)` : "ПРОЦЕСС МЫШЛЕНИЯ..."}
                                                </span>
                                            </summary>
                                            <motion.div
                                                initial={false}
                                                animate={{ height: msg.thoughtExpanded ? "auto" : 0, opacity: msg.thoughtExpanded ? 1 : 0 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="mt-4 ml-3 pl-6 border-l border-white/5 space-y-2 font-mono text-[12px] text-white/30 whitespace-pre-wrap leading-relaxed py-4 italic selection:bg-white/10">
                                                    {derivedThoughts}
                                                </div>
                                            </motion.div>
                                        </details>
                                    </div>
                                )}

                                {/* Loading state placeholder */}
                                <AnimatePresence mode="wait">
                                    {!hasContent && !showThoughts && isLoading && isLastAssistant && (
                                        <motion.div
                                            key="status-pill"
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -10, filter: "blur(8px)" }}
                                            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                                            className="flex items-center gap-4 py-3 px-5 rounded-full bg-white/[0.03] border border-white/5 text-white/50 shadow-lg shadow-white/5"
                                        >
                                            <div className="w-5 h-5 flex items-center justify-center">
                                                <Loader className="animate-spin h-3.5 w-3.5" strokeWidth={3} />
                                            </div>
                                            <AnimatePresence mode="wait">
                                                <motion.span
                                                    key={streamingStatus || "default"}
                                                    initial={{ opacity: 0, x: 10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0, x: -10 }}
                                                    transition={{ duration: 0.25 }}
                                                    className="font-mono text-[11px] uppercase tracking-widest font-bold"
                                                >
                                                    {streamingStatus || "Pitchy анализирует данные..."}
                                                </motion.span>
                                            </AnimatePresence>
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                {/* Main Analysis Content */}
                                {shouldRenderMainBubble && (
                                <div className="space-y-10 pl-1 group/content">
                                    <div className="lovable-glass-strong border border-white/5 p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-[2.5rem] rounded-tl-none space-y-4 sm:space-y-6 bg-gradient-to-br from-white/[0.03] to-transparent shadow-xl shadow-black/20">
                                        <div
                                            ref={(el) => {
                                                const key = getSafeKey(msg);
                                                if (el) messageContentRefs.current.set(key, el);
                                                else messageContentRefs.current.delete(key);
                                            }}
                                            className="min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] [&_a]:break-all [&_a]:[overflow-wrap:anywhere] text-white/80 font-sans text-[14px] sm:text-[17px] leading-relaxed sm:leading-[1.8] md:leading-[1.9] [&_p]:mb-4 sm:[&_p]:mb-6 [&_p:last-child]:mb-0 [&_ul]:list-none [&_ul]:pl-0 [&_ul]:mb-6 [&_ul>li]:mb-4 [&_ul>li]:pl-6 [&_ul>li]:relative [&_ul>li:before]:content-[''] [&_ul>li:before]:absolute [&_ul>li:before]:left-0 [&_ul>li:before]:top-[0.8em] [&_ul>li:before]:w-1.5 [&_ul>li:before]:h-px [&_ul>li:before]:bg-white/40 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-6 [&_ol>li]:mb-4 [&_ol>li]:pl-2 [&_h2]:text-3xl [&_h2]:text-white [&_h2]:mt-12 [&_h2]:mb-6 [&_h2]:tracking-tight [&_h3]:text-xl [&_h3]:font-bold [&_h3]:text-white [&_h3]:mt-10 [&_h3]:mb-4 [&_strong]:text-white [&_strong]:font-bold selection:bg-white/20">
                                            <ReactMarkdown 
                                                remarkPlugins={[remarkGfm]}
                                                components={{
                                                    h2: ({node, ...props}) => <h2 className="font-display text-3xl mb-4 mt-8" {...props} />,
                                                    h3: ({node, ...props}) => <h3 className="font-display text-xl mb-3 mt-6" {...props} />,
                                                    a: ({node, ...props}) => {
                                                        void node;
                                                        return (
                                                            <a
                                                                className="break-all [overflow-wrap:anywhere] text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                {...props}
                                                            />
                                                        );
                                                    },
                                                    table: ({...props}) => (
                                                        <div className="my-6 sm:my-10 pitchy-table-scroll rounded-[1.5rem] border border-white/10 bg-white/[0.02] shadow-inner">
                                                            <table className="w-max min-w-full text-left border-collapse font-sans text-[14px]" {...props} />
                                                        </div>
                                                    ),
                                                    thead: ({...props}) => <thead className="bg-white/[0.05]" {...props} />,
                                                    th: ({...props}) => <th className="p-3.5 sm:p-5 font-bold text-white border-b border-white/10 uppercase tracking-widest text-[10px] whitespace-nowrap" {...props} />,
                                                    td: ({...props}) => <td className="p-3.5 sm:p-5 text-white/50 border-b border-white/5 last:border-0 align-top min-w-[7.5rem] max-w-[20rem]" {...props} />,
                                                }}
                                            >
                                                {getDisplayContent(msg)}
                                            </ReactMarkdown>
                                            {getSafeKey(msg) === typingMessageId?.toString() && (
                                                <motion.span
                                                    data-export-ignore
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    transition={{ repeat: Infinity, duration: 0.8 }}
                                                    className="inline-block w-1.5 h-5 bg-white/40 ml-1.5 align-text-bottom rounded-full"
                                                />
                                            )}
                                        </div>

                                        {getMessageExports(msg).length > 0 && (
                                            <div className="flex flex-wrap gap-3">
                                                {getMessageExports(msg).map((exp, i) => (
                                                    <FileCard
                                                        key={`${exp.format}-${exp.name}-${i}`}
                                                        format={exp.format}
                                                        name={exp.name}
                                                        // message_id есть у маркеров «экспорт прошлого ответа»;
                                                        // иначе файл лежит в самом сообщении — но только после
                                                        // reconcile, когда у него настоящий DB id (не Date.now()).
                                                        messageId={exp.message_id ?? (msg.id < 1_000_000_000_000 ? msg.id : undefined)}
                                                    />
                                                ))}
                                            </div>
                                        )}

                                        {!isGreeting && (
                                        <div className="flex items-center justify-between mt-8 pt-8 border-t border-white/5 w-full transition-all duration-500">
                                            <div className="flex items-center gap-3">
                                                <CopyButton
                                                    text={parseExports(stripThoughts(msg.content || "")).text}
                                                    getHtml={() => {
                                                        const el = messageContentRefs.current.get(getSafeKey(msg));
                                                        return el ? serializeMessageHtml(el) : null;
                                                    }}
                                                />
                                                {/* Оптимистичные сообщения несут id = Date.now() (эпоха, ~1e12) —
                                                    экспорт доступен после reconcile, когда придёт настоящий DB id. */}
                                                <ExportMenu messageId={msg.id} disabled={msg.id >= 1_000_000_000_000} />
                                                <button
                                                    onClick={() => handleFeedback(msg.id, msg.feedback === 1 ? 0 : 1)}
                                                    className={`p-2.5 rounded-full transition-all active:scale-90 ${msg.feedback === 1 ? 'text-white bg-white/10 shadow-lg shadow-white/5' : 'text-white/20 hover:text-white hover:bg-white/5'}`}
                                                    title="Хороший ответ"
                                                >
                                                    <ThumbsUp className="w-4 h-4" strokeWidth={1.5} />
                                                </button>
                                                <button
                                                    onClick={() => handleFeedback(msg.id, msg.feedback === -1 ? 0 : -1)}
                                                    className={`p-2.5 rounded-full transition-all active:scale-90 ${msg.feedback === -1 ? 'text-red-400 bg-red-400/10 shadow-lg shadow-red-500/5' : 'text-white/20 hover:text-white hover:bg-white/5'}`}
                                                    title="Плохой ответ"
                                                >
                                                    <ThumbsDown className="w-4 h-4" strokeWidth={1.5} />
                                                </button>
                                            </div>
                                            {msg.model_used && (
                                                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/10 font-bold">{msg.model_used}</span>
                                            )}
                                        </div>
                                        )}
                                    </div>

                                    {/* Sources Rendering */}
                                    {msg.sources && msg.sources.length > 0 && (
                                    <div className="w-full mt-4">
                                        <button
                                        onClick={() => setMessages(prev => prev.map(m => (m.client_id || m.id) === messageKey ? { ...m, sourcesExpanded: !m.sourcesExpanded } : m))}
                                        className="flex items-center gap-3 px-5 py-2.5 rounded-full bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 hover:text-white transition-all w-fit group shadow-lg shadow-black/10 active:scale-95"
                                        >
                                        <Globe className="w-4 h-4 text-white/20 group-hover:text-white group-hover:rotate-12 transition-all" strokeWidth={1.5} />
                                        <span className="font-bold">{msg.sources.length} ИСТОЧНИКОВ</span>
                                        {msg.sourcesExpanded ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
                                        </button>
                                        
                                        <AnimatePresence>
                                            {msg.sourcesExpanded && (
                                                <motion.div
                                                initial={{ height: 0, opacity: 0, y: -10 }}
                                                animate={{ height: "auto", opacity: 1, y: 0 }}
                                                exit={{ height: 0, opacity: 0, y: -10 }}
                                                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                                                className="overflow-hidden mt-4"
                                                >
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-white/[0.01] border border-white/5 rounded-3xl">
                                                    {msg.sources.map((s, i) => {
                                                    const host = hostFromUrl(s.url);
                                                    return (
                                                    <a
                                                        key={i}
                                                        href={s.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-start gap-3 p-5 rounded-2xl bg-white/[0.02] hover:bg-white/[0.05] border border-transparent hover:border-white/10 transition-all group/source"
                                                    >
                                                        <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0 font-mono text-[11px] font-bold text-white/30 group-hover/source:text-white group-hover/source:scale-110 transition-all">{i + 1}</div>
                                                        <div className="min-w-0 flex-1">
                                                            <span className="text-[13px] text-white/70 font-medium line-clamp-2 group-hover/source:text-white transition-colors block leading-snug">{s.title || host || "Источник"}</span>
                                                            {host && <span className="text-[10px] text-white/20 line-clamp-1 truncate block mt-1 font-mono tracking-tight group-hover/source:text-white/40 transition-colors">{host}</span>}
                                                        </div>
                                                    </a>
                                                    );
                                                    })}
                                                </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                    )}
                                </div>
                                )}
                            </div>
                        </div>
                    )}
                </motion.div>
            );
        })}

                {
                    messages.length <= 2 && !session.analysis && !isLoading && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4, duration: 0.6 }}
                            className="flex flex-col gap-3 mt-2 max-w-2xl mx-auto w-full"
                        >
                            <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/20 text-center mb-1 font-bold">Выберите направление анализа</p>
                            <div className="grid grid-cols-2 gap-2 sm:gap-3">
                                <button onClick={() => handleSendMessage("Проведи анализ идеи. Используй предоставленный контекст только если он относится к моему проекту. Если данных недостаточно — задай вопросы.", "roadmap")} className="flex items-center gap-2 sm:gap-4 p-3 sm:p-4 rounded-2xl sm:rounded-[1.5rem] bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 transition-all duration-500 text-left group hover:border-white/20 hover:shadow-xl hover:shadow-white/5 active:scale-95">
                                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center text-white shrink-0 group-hover:scale-110 group-hover:bg-white/10 transition-all">
                                        <Zap className="w-4 h-4 sm:w-6 sm:h-6" strokeWidth={1.5} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-white font-medium text-[13px] sm:text-[16px] tracking-tight leading-snug">Анализ идеи</div>
                                        <div className="text-white/30 text-[10px] sm:text-[12px] mt-0.5 sm:mt-1 font-light line-clamp-1">Получить оценку концепции</div>
                                    </div>
                                    <ArrowRight className="hidden sm:block w-5 h-5 text-white/10 group-hover:text-white group-hover:translate-x-1 transition-all shrink-0" strokeWidth={1.5} />
                                </button>

                                <button onClick={() => handleSendMessage("Проведи анализ целевой аудитории (ЦА). Выдели сегменты, боли и JTBD. Выведи результат строго в структурированном виде.", "roadmap")} className="flex items-center gap-2 sm:gap-4 p-3 sm:p-4 rounded-2xl sm:rounded-[1.5rem] bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 transition-all duration-500 text-left group hover:border-white/20 hover:shadow-xl hover:shadow-white/5 active:scale-95">
                                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center text-white shrink-0 group-hover:scale-110 group-hover:bg-white/10 transition-all">
                                        <Users className="w-4 h-4 sm:w-6 sm:h-6" strokeWidth={1.5} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-white font-medium text-[13px] sm:text-[16px] tracking-tight leading-snug">Анализ ЦА</div>
                                        <div className="text-white/30 text-[10px] sm:text-[12px] mt-0.5 sm:mt-1 font-light line-clamp-1">Сегментация и инсайты</div>
                                    </div>
                                    <ArrowRight className="hidden sm:block w-5 h-5 text-white/10 group-hover:text-white group-hover:translate-x-1 transition-all shrink-0" strokeWidth={1.5} />
                                </button>

                                <button onClick={() => handleSendMessage("Посчитай экономику проекта, LTV, CAC и другие метрики. Выведи результат строго в структурированном виде.", "finance")} className="flex items-center gap-2 sm:gap-4 p-3 sm:p-4 rounded-2xl sm:rounded-[1.5rem] bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 transition-all duration-500 text-left group hover:border-white/20 hover:shadow-xl hover:shadow-white/5 active:scale-95">
                                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center text-white shrink-0 group-hover:scale-110 group-hover:bg-white/10 transition-all">
                                        <Grid className="w-4 h-4 sm:w-6 sm:h-6" strokeWidth={1.5} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-white font-medium text-[13px] sm:text-[16px] tracking-tight leading-snug">Экономика</div>
                                        <div className="text-white/30 text-[10px] sm:text-[12px] mt-0.5 sm:mt-1 font-light line-clamp-1">Юнит-метрики и LTV</div>
                                    </div>
                                    <ArrowRight className="hidden sm:block w-5 h-5 text-white/10 group-hover:text-white group-hover:translate-x-1 transition-all shrink-0" strokeWidth={1.5} />
                                </button>

                                <button onClick={() => handleSendMessage("Другой вопрос", "general")} className="flex items-center gap-2 sm:gap-4 p-3 sm:p-4 rounded-2xl sm:rounded-[1.5rem] bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 transition-all duration-500 text-left group hover:border-white/20 hover:shadow-xl hover:shadow-white/5 active:scale-95">
                                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center text-white shrink-0 group-hover:scale-110 group-hover:bg-white/10 transition-all">
                                        <HelpCircle className="w-4 h-4 sm:w-6 sm:h-6" strokeWidth={1.5} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-white font-medium text-[13px] sm:text-[16px] tracking-tight leading-snug">Другой вопрос</div>
                                        <div className="text-white/30 text-[10px] sm:text-[12px] mt-0.5 sm:mt-1 font-light line-clamp-1">Свободная консультация</div>
                                    </div>
                                    <ArrowRight className="hidden sm:block w-5 h-5 text-white/10 group-hover:text-white group-hover:translate-x-1 transition-all shrink-0" strokeWidth={1.5} />
                                </button>
                            </div>
                        </motion.div>
                    )
                }

                {/* Подсказка выбранного режима. Живёт в потоке сообщений, а не в
                    плавающей панели ввода: там она вставала поверх карточек
                    «Выберите направление анализа» и на мобильном текст читался
                    сквозь них. */}
                <AnimatePresence>
                    {modeHint && !isLoading && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                            className="max-w-2xl mx-auto w-full border border-white/10 p-4 sm:p-5 rounded-3xl bg-[#0d0d0d] flex gap-3 sm:gap-4 items-start shadow-2xl shadow-black/50"
                        >
                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 border border-white/5 shadow-inner mt-0.5">
                                <img src="/icons/logotip.png" alt="Pitchy" className="w-4 h-4 object-contain brightness-0 invert opacity-80" />
                            </div>
                            <div className="text-white/90 font-sans text-[14px] sm:text-[15px] leading-relaxed font-medium min-w-0">
                                {modeHint}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {
                    session.analysis && (
                        <motion.div
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8 }}
                            className="mt-16 border-t border-white/5 pt-16 pb-10"
                        >
                            <div className="text-center mb-10">
                                <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-mono-label uppercase tracking-[0.2em] mb-6 font-bold">
                                    <Star className="w-4 h-4 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                                    <span>Анализ готов</span>
                                </div>
                                <h3 className="font-display text-4xl text-white tracking-tight">Результаты оценки</h3>
                            </div>

                            <div className="max-w-md mx-auto relative group">
                                <div className="absolute inset-0 bg-white/5 blur-[40px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700 -z-10" />
                                <AnalysisCard
                                    analysis={{
                                        id: session.analysis.id,
                                        name: session.analysis.name,
                                        score: session.analysis.investment_score,
                                        category: session.analysis.category || "Стартап",
                                        date: dayjs(session.analysis.created_at).format("D MMMM YYYY"),
                                        summary: session.analysis.market_summary,
                                    }}
                                />
                            </div>
                        </motion.div>
                    )
                }

                <div ref={messagesEndRef} />
                </div>
            </div >

            {/* Input Area (Fixed Bottom) */}
            <div ref={inputBarRef} className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/95 to-transparent pt-12 sm:pt-20 pb-5 sm:pb-10 z-40 px-2 sm:px-6 lg:px-12">
                <div className={`mx-auto w-full transition-all duration-500 ease-[0.16,1,0.3,1] ${isSidebarCollapsed ? 'max-w-6xl' : 'max-w-4xl'}`}>

                    {/* Free-tier exhausted banner — ChatGPT-style upsell */}
                    {messagesRemaining === 0 && (
                        // Плашка стоит поверх ленты сообщений, поэтому фон у неё
                        // непрозрачный — на просвечивающем варианте текст читался
                        // вперемешку с последней репликой. На узком экране кнопка
                        // уезжает под текст: в строку она сжимала абзац до ~110px.
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-4 rounded-2xl border border-amber-500/30 bg-[#171310] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
                        >
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                                    <Lock className="w-4 h-4 text-amber-400" strokeWidth={2} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[14px] font-medium text-white mb-1">
                                        Месячный лимит сообщений исчерпан
                                    </div>
                                    <p className="text-[12px] text-white/55 leading-snug">
                                        На тарифе {tierLabel || "Free"} доступно ограниченное число сообщений в месяц.
                                        Обновите тариф, чтобы продолжить диалог с Pitchy.
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsUpgradeModalOpen(true)}
                                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white text-black text-[12px] font-mono uppercase tracking-[0.18em] font-bold hover:bg-neutral-200 active:scale-95 transition-all shrink-0"
                            >
                                Улучшить
                            </button>
                        </motion.div>
                    )}

                    <ChatInput
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onSend={() => handleSendMessage()}
                    isLoading={isLoading}
                    onStop={stopGeneration}
                    attachments={pendingAttachments}
                    onPickFiles={handlePickFiles}
                    onRemoveAttachment={handleRemoveAttachment}
                    useDeepSearch={useDeepSearch}
                    onToggleDeepSearch={() => { setUseDeepSearch(!useDeepSearch); setIsResearchMode(false); }}
                    isResearchMode={isResearchMode}
                    onToggleResearchMode={() => { setIsResearchMode(!isResearchMode); setUseDeepSearch(false); }}
                    isPresentationMode={isPresentationMode}
                    onTogglePresentationMode={() => setIsPresentationMode(!isPresentationMode)}
                    onCancelPresentationMode={() => setIsPresentationMode(false)}
                    onOpenImportModal={() => setIsImportModalOpen(true)}
                    disabled={!!session.analysis || messagesRemaining === 0}
                    placeholder={
                        messagesRemaining === 0
                            ? "Лимит сообщений исчерпан — обновите тариф"
                            : isPresentationMode
                                ? "Опишите идею для вашей презентации..."
                                : session.analysis ? "Диалог завершен" : "Задайте вопрос Pitchy..."
                    }
                    lockedTools={{
                        deepSearch: !canUseDeepSearch,
                        research: !canUseResearch,
                        presentation: !canUsePresentation,
                        importContext: !canUseImportContext,
                    }}
                    onLockedTool={(key) => {
                        const labels: Record<string, string> = {
                            deepSearch: "Поиск в интернете",
                            research: "Полное исследование",
                            presentation: "Сгенерировать слайды",
                            importContext: "Импорт контекста",
                        };
                        setUpgradeModalMessage(`Функция «${labels[key] || key}» доступна на тарифах Starter и Pro.`);
                        setIsUpgradeModalOpen(true);
                    }}
                    />
                    
                    {presentationSlides && presentationSlides.length > 0 && (
                        // Hidden on md+ because the inline preview pane is
                        // already visible there. On mobile the button still
                        // opens the overlay drawer.
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="md:hidden mt-6 flex justify-center"
                        >
                            <button
                                onClick={() => setIsPresentationOpen(true)}
                                className="flex items-center gap-3 px-8 py-4 bg-white text-black text-[11px] font-mono uppercase tracking-[0.2em] font-bold rounded-full hover:bg-neutral-200 transition-all shadow-xl shadow-white/5 active:scale-95"
                            >
                                <FileText className="w-4 h-4" strokeWidth={2.5} />
                                Открыть презентацию
                            </button>
                        </motion.div>
                    )}
                </div>
            </div>
            </div> {/* end of chat column (flex-1 with optional md:max-w-[60%]) */}

            {/* Draggable divider — desktop only. 6px wide hit area with a
                subtle 1px visual line. Cursor + hover state hint that it can
                be dragged. */}
            {useInlinePanel && (
                <div
                    onMouseDown={startDrag}
                    className="hidden md:block w-1.5 cursor-col-resize bg-white/5 hover:bg-white/15 active:bg-white/25 transition-colors relative group"
                    title="Перетащите, чтобы изменить ширину"
                >
                    <div className="absolute inset-y-0 left-1/2 w-px bg-white/10 group-hover:bg-white/30 -translate-x-1/2" />
                </div>
            )}

            {/* Inline preview pane — sits beside the chat on md+ as soon as
                the deck has its first slide. Hidden below md so the legacy
                overlay drawer takes over on mobile. */}
            {useInlinePanel && (
                <div className="hidden md:block flex-1 min-w-0 h-full overflow-hidden">
                    <PresentationDrawer
                        mode="inline"
                        isOpen={true}
                        onClose={() => { setPresentationSlides(null); setSlideProvider(null); }}
                        slides={presentationSlides || []}
                        isLoading={isGeneratingSlides}
                        statusText={generationStatus}
                        provider={slideProvider}
                        onRegenerate={() => {
                            setPresentationSlides(null);
                            setSlideProvider(null);
                            handleSendMessage("Сгенерируй презентацию заново с чистого листа.", "presentation", false, { regenerateDeck: true });
                        }}
                    />
                </div>
            )}

            {/* Overlay drawer kept for mobile and for the "Открыть презентацию"
                button. On desktop with the inline pane already open this is a
                no-op unless the user explicitly toggled isPresentationOpen. */}
            <div className={useInlinePanel ? "md:hidden" : ""}>
                <PresentationDrawer
                    mode="overlay"
                    isOpen={isPresentationOpen}
                    onClose={() => setIsPresentationOpen(false)}
                    slides={presentationSlides || []}
                    isLoading={isGeneratingSlides}
                    statusText={generationStatus}
                    provider={slideProvider}
                    onRegenerate={() => {
                        setPresentationSlides(null);
                        setSlideProvider(null);
                        handleSendMessage("Сгенерируй презентацию заново с чистого листа.", "presentation", false, { regenerateDeck: true });
                    }}
                />
            </div>

            <ResearchDrawer
                key={openResearchMessage?.researchJob?.id || "research-drawer"}
                isOpen={!!openResearchMessage?.researchJob}
                job={openResearchMessage?.researchJob || null}
                messageId={openResearchMessage?.id}
                onClose={() => setOpenResearchMessageKey(null)}
                onCancel={openResearchMessage?.researchJob && ["queued", "running", "cancelling"].includes(openResearchMessage.researchJob.status) ? async () => {
                    const token = getToken();
                    if (!token || !openResearchMessage.researchJob) return;
                    const { cancelResearchJob } = await import("@/lib/api");
                    const job = await cancelResearchJob(openResearchMessage.researchJob.id, token);
                    setMessages(prev => prev.map(message => (message.client_id || message.id).toString() === openResearchMessageKey ? { ...message, researchJob: job } : message));
                    abortControllerRef.current?.abort();
                } : undefined}
            />

            {/* Context Import Modal */}
            <ContextImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onSubmit={async (text) => {
                    const token = getToken();
                    if (!token) return { success: false, message: "No token" };
                    return await importContext({ text, session_id: session.id }, token);
                }}
            />

            {/* Upgrade Modal (limit exhausted) */}
            <UpgradeModal
                isOpen={isUpgradeModalOpen}
                onClose={() => setIsUpgradeModalOpen(false)}
                message={upgradeModalMessage}
            />
        </div >
    );
}
