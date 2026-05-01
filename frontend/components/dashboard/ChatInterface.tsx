import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, Loader, Star, Zap, Users, Grid, HelpCircle, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp, Activity, Globe, Link2, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessageResponse, ChatSessionDetailResponse, sendChatMessageFeedback } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { AnalysisCard } from "@/components/dashboard/AnalysisCard";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import { ChatInput } from "@/components/chat/ChatInput";
import { CollapsibleUserMessage } from "@/components/chat/CollapsibleUserMessage";
import { PresentationDrawer } from "./PresentationDrawer";
import { PresentationSlide, importContext } from "@/lib/api";
import { ContextImportModal } from "@/components/chat/ContextImportModal";
import { UpgradeModal } from "@/components/chat/UpgradeModal";
import { stripThoughts } from "@/lib/utils";

interface ExtendedChatMessage extends ChatMessageResponse {
    thoughts?: string;
    thoughtTime?: number;
    thoughtExpanded?: boolean;
    client_id?: string;
    sources?: { title: string; url: string }[];
    sourcesExpanded?: boolean;
    isResearch?: boolean;
    model_used?: string;
}

interface ChatInterfaceProps {
    session: ChatSessionDetailResponse;
    onUpdate: (updatedSession: ChatSessionDetailResponse) => void;
}

export function ChatInterface({ session, onUpdate }: ChatInterfaceProps) {
    const [messages, setMessages] = useState<ExtendedChatMessage[]>(session.messages || []);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
    const [useDeepSearch, setUseDeepSearch] = useState(false);
    const [isResearchMode, setIsResearchMode] = useState(false);
    const [isPresentationMode, setIsPresentationMode] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const scrollViewportRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Presentation state
    const [presentationSlides, setPresentationSlides] = useState<PresentationSlide[] | null>(null);
    const [isPresentationOpen, setIsPresentationOpen] = useState(false);
    const [isGeneratingSlides, setIsGeneratingSlides] = useState(false);
    const [generationStatus, setGenerationStatus] = useState<string | null>(null);

    // Import Modal state
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);

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
            setMessages(prev => mergeMessages(prev, session.messages));
        }
    }, [session.messages, mergeMessages]);

    const scrollToBottom = (force = false) => {
        if (scrollViewportRef.current) {
            const container = scrollViewportRef.current;
            const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
            
            if (isNearBottom || force) {
                container.scrollTo({
                    top: container.scrollHeight,
                    behavior: "smooth"
                });
            }
        }
    };

    useEffect(() => {
        if (messages.length > 0 && isLoading && displayedLength === 0) {
            scrollToBottom(true);
        } else {
            scrollToBottom();
        }
    }, [messages.length, isLoading, session.analysis, displayedLength]);

    useEffect(() => {
        if (typingMessageId === null) return;
        const msg = messages.find((m) => getSafeKey(m) === typingMessageId.toString());
        if (!msg) { setTypingMessageId(null); return; }
        const fullLen = msg.content.length;
        if (displayedLength >= fullLen) {
            setTypingMessageId(null);
            return;
        }
        const nextChar = msg.content[displayedLength];
        const speed = /[|\-#*\n\r]/.test(nextChar) ? 2 : typingSpeed;
        const timer = setTimeout(() => {
            const chunk = Math.min(3, fullLen - displayedLength);
            setDisplayedLength((prev) => prev + chunk);
        }, speed);
        return () => clearTimeout(timer);
    }, [typingMessageId, displayedLength, messages, getSafeKey]);

    const getDisplayContent = useCallback((msg: ChatMessageResponse) => {
        const rawContent = getSafeKey(msg) === typingMessageId?.toString()
            ? msg.content.slice(0, displayedLength)
            : msg.content;
        const safeContent = rawContent.replace(/\n\|[ \-|]*$/g, "\n");
        return stripThoughts(safeContent);
    }, [typingMessageId, displayedLength, getSafeKey]);

    const handleSendMessage = async (text?: string, forceIntent?: string, silent: boolean = false) => {
        const content = typeof text === 'string' ? text : inputValue.trim();
        if (!content || isLoading) return;

        if (typeof text !== 'string') setInputValue("");
        setIsLoading(true);

        const isPresentationRequest = forceIntent === 'presentation' || isPresentationMode;

        if (isPresentationRequest) {
            setPresentationSlides(null); 
            setGenerationStatus(null);
            setIsGeneratingSlides(true);
            setIsPresentationOpen(true);
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
                        client_id: userClientId
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

            setTypingMessageId(assistantClientId);
            setDisplayedLength(0);

            let assistantContent = "";
            let fullThoughtContent = "";
            const startTime = now.getTime();
            const { sendChatMessageStream, getChatSession } = await import("@/lib/api");

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
                    isPresentationRequest ? 'presentation' : (forceIntent || undefined)
                )) {
                    if (chunk.type === "thought") {
                        fullThoughtContent += chunk.content;
                        setMessages(prev => prev.map(m =>
                            m.client_id === assistantClientId ? { ...m, thoughts: fullThoughtContent, isResearch: true, thoughtExpanded: true } : m
                        ));
                    } else if (chunk.type === "chunk") {
                        let thoughtUpdate = {};
                        if (!assistantContent && fullThoughtContent) {
                            const duration = Math.round((Date.now() - startTime) / 1000);
                            thoughtUpdate = { thoughtTime: duration };
                        }
                        if (!assistantContent) setStreamingStatus(null);
                        assistantContent += chunk.content;
                        setMessages((prev) =>
                            prev.map(m => m.client_id === assistantClientId ? { ...m, content: assistantContent, isResearch: isResearchMode || useDeepSearch, ...thoughtUpdate } : m)
                        );
                    } else if (chunk.type === "sources") {
                        setMessages((prev) =>
                            prev.map(m => m.client_id === assistantClientId ? { ...m, sources: chunk.data, isResearch: true } : m)
                        );
                    } else if (chunk.type === "presentation") {
                        setPresentationSlides(chunk.data);
                        setIsGeneratingSlides(false);
                    } else if (chunk.type === "status") {
                        setStreamingStatus(chunk.content);
                        setGenerationStatus(chunk.content);
                    } else if (chunk.type === "metadata") {
                        setMessages((prev) =>
                            prev.map(m => m.client_id === assistantClientId ? { ...m, model_used: chunk.model } : m)
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
            }

            await new Promise(resolve => setTimeout(resolve, 400));
            const updatedSession = await getChatSession(session.id, token);
            onUpdate(updatedSession);
            setMessages((prev) => mergeMessages(prev, updatedSession.messages || []));

        } catch (error) {
            console.error(error);
            if (error instanceof Error && error.message.includes("API_ERROR:")) {
                const detail = error.message.split("API_ERROR:")[1] || "";
                if (detail.includes("Лимит") || detail.includes("лимит") || detail.includes("исчерпан")) {
                    setUpgradeModalMessage(detail);
                    setIsUpgradeModalOpen(true);
                } else {
                    alert(detail || "Ошибка отправки сообщения (отказано в доступе)");
                }
            } else {
                alert("Ошибка отправки сообщения");
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

    return (
        <div className="flex flex-col flex-1 h-full min-h-0 bg-[#0A0A0A] relative overflow-hidden">
            {/* Messages Area */}
            <div ref={scrollViewportRef} className="flex-1 overflow-y-auto px-6 lg:px-10 pt-6 pb-64 thin-scrollbar">
                <div className="max-w-4xl mx-auto w-full space-y-6">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-[50vh] text-white/30 text-center p-8">
                        <Star className="w-12 h-12 mb-4 opacity-50" />
                        <p className="font-body-lg">Начните диалог с описания вашего стартапа.</p>
                    </div>
                )}

                {messages.map((msg, idx) => {
            const messageKey = msg.client_id || msg.id;

            let derivedThoughts = msg.thoughts;
            const rawContentText = msg.content || "";
            if (!derivedThoughts && rawContentText.includes("<think>")) {
                const match = rawContentText.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
                if (match) derivedThoughts = match[1];
            }

            const cleanContent = stripThoughts(rawContentText);
            const hasThoughts = derivedThoughts !== undefined && derivedThoughts !== null && derivedThoughts.length > 0;
            const showThoughts = hasThoughts;
            
            const hasContent = cleanContent.trim().length > 0;
            const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1;
            const shouldRenderMainBubble = msg.role === "user" || hasContent;

            return (
                <div key={msg.client_id || msg.id.toString()}>
                    {msg.role === "user" ? (
                        <div className="mb-10 flex flex-col items-end">
                            <div className="max-w-[85%]">
                                <div className="flex items-center justify-end gap-3 mb-2 px-1">
                                    <span className="font-code text-[10px] text-neutral-500 uppercase tracking-widest">User</span>
                                </div>
                                <div className="bg-white/[0.03] border border-white/10 p-5 rounded-2xl rounded-tr-none">
                                    <div className="text-on-surface font-body-lg leading-relaxed whitespace-pre-wrap">
                                        {getDisplayContent(msg)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="mb-12 flex flex-col items-start w-full">
                            <div className="w-full">
                                <div className="flex items-center gap-3 mb-4 px-1">
                                    <div className="w-5 h-5 flex items-center justify-center">
                                        <img src="/icons/logotip.png" alt="Pitchy" className="w-full h-full object-contain" />
                                    </div>
                                    <span className="font-mono-label uppercase tracking-widest text-[11px] text-white">pitchy</span>
                                    <span className="text-[10px] text-white/30 ml-auto mr-1 font-code">
                                        {dayjs(msg.created_at).format("HH:mm")}
                                    </span>
                                </div>

                                {/* Thought Process */}
                                {showThoughts && (
                                    <div className="mb-6 ml-1">
                                        <details className="group" open={msg.thoughtExpanded}>
                                            <summary 
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    setMessages(prev => prev.map(m => (m.client_id || m.id) === messageKey ? { ...m, thoughtExpanded: !m.thoughtExpanded } : m));
                                                }}
                                                className="list-none cursor-pointer flex items-center gap-2 text-neutral-500 hover:text-white transition-colors py-1 px-2 hover:bg-white/5 rounded w-fit"
                                            >
                                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${msg.thoughtExpanded ? '' : '-rotate-90'}`} />
                                                <span className="font-code text-[10px] uppercase tracking-wider flex items-center gap-2">
                                                    {isLoading && isLastAssistant && !msg.thoughtTime ? <Activity className="w-3 h-3 animate-pulse" /> : null}
                                                    {msg.thoughtTime ? `Логи анализа (${msg.thoughtTime} сек)` : "Логи анализа..."}
                                                </span>
                                            </summary>
                                            <motion.div
                                                initial={false}
                                                animate={{ height: msg.thoughtExpanded ? "auto" : 0, opacity: msg.thoughtExpanded ? 1 : 0 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="mt-2 ml-2 pl-4 border-l border-white/10 space-y-1 font-code text-[11px] text-neutral-600 whitespace-pre-wrap leading-relaxed py-2">
                                                    {derivedThoughts}
                                                </div>
                                            </motion.div>
                                        </details>
                                    </div>
                                )}

                                {/* Loading state placeholder with smooth fade */}
                                <AnimatePresence mode="wait">
                                    {!hasContent && !showThoughts && isLoading && isLastAssistant && (
                                        <motion.div
                                            key="status-pill"
                                            initial={{ opacity: 0, y: 6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -4, filter: "blur(6px)", scale: 0.97 }}
                                            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                                            className="flex items-center gap-3 py-2 px-1 text-white/60"
                                        >
                                            <Loader className="animate-spin h-4 w-4 flex-shrink-0" />
                                            <AnimatePresence mode="wait">
                                                <motion.span
                                                    key={streamingStatus || "default"}
                                                    initial={{ opacity: 0, x: 8 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0, x: -8 }}
                                                    transition={{ duration: 0.2 }}
                                                    className="font-code text-[12px]"
                                                >
                                                    {streamingStatus || "Pitchy анализирует данные и ищет информацию..."}
                                                </motion.span>
                                            </AnimatePresence>
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                {/* Main Analysis Content */}
                                {shouldRenderMainBubble && (
                                <div className="space-y-8 pl-1">
                                    <div className="bg-white/[0.03] border border-white/10 p-6 rounded-2xl rounded-tl-none space-y-6">
                                        <div className="text-on-surface font-body-lg leading-[1.7] md:leading-[1.8] [&_p]:mb-4 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_ul>li]:mb-2 [&_ul>li]:pl-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4 [&_ol>li]:mb-2 [&_ol>li]:pl-1 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_h2]:mt-8 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-white [&_h3]:mt-6 [&_h3]:mb-3 [&_strong]:text-white [&_strong]:font-semibold break-words">
                                            <ReactMarkdown 
                                                remarkPlugins={[remarkGfm]}
                                                components={{
                                                    table: ({...props}) => (
                                                        <div className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-white/5">
                                                            <table className="w-full text-left border-collapse font-code text-[13px]" {...props} />
                                                        </div>
                                                    ),
                                                    thead: ({...props}) => <thead className="bg-white/10" {...props} />,
                                                    th: ({...props}) => <th className="p-3 font-bold text-white border-b border-white/10" {...props} />,
                                                    td: ({...props}) => <td className="p-3 text-neutral-400 border-b border-white/5 last:border-0" {...props} />,
                                                }}
                                            >
                                                {getDisplayContent(msg)}
                                            </ReactMarkdown>
                                            {msg.id === typingMessageId && (
                                                <span className="inline-block w-0.5 h-4 bg-white animate-pulse ml-0.5 align-text-bottom" />
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/10 w-full">
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => handleFeedback(msg.id, msg.feedback === 1 ? 0 : 1)}
                                                    className={`p-1.5 rounded-md transition-colors ${msg.feedback === 1 ? 'text-white bg-white/10' : 'text-neutral-500 hover:text-white hover:bg-white/5'}`}
                                                    title="Хороший ответ"
                                                >
                                                    <ThumbsUp className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleFeedback(msg.id, msg.feedback === -1 ? 0 : -1)}
                                                    className={`p-1.5 rounded-md transition-colors ${msg.feedback === -1 ? 'text-red-400 bg-red-400/10' : 'text-neutral-500 hover:text-white hover:bg-white/5'}`}
                                                    title="Плохой ответ"
                                                >
                                                    <ThumbsDown className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Qwen-Style Sources Rendering */}
                                    {msg.sources && msg.sources.length > 0 && (
                                    <div className="w-full mt-2">
                                        <button
                                        onClick={() => setMessages(prev => prev.map(m => (m.client_id || m.id) === messageKey ? { ...m, sourcesExpanded: !m.sourcesExpanded } : m))}
                                        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-[11px] font-mono-label uppercase text-white/60 hover:text-white transition-all w-fit"
                                        >
                                        <Globe className="w-3.5 h-3.5 text-white" />
                                        <span className="font-semibold">{msg.sources.length} ИСТОЧНИКОВ</span>
                                        {msg.sourcesExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                        </button>
                                        
                                        {msg.sourcesExpanded && (
                                            <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            className="overflow-hidden mt-2"
                                            >
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 bg-[#111111] border border-white/10 rounded-xl">
                                                {msg.sources.map((s, i) => (
                                                <a
                                                    key={i}
                                                    href={s.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex flex-col p-3 rounded-lg bg-black/20 hover:bg-white/5 border border-transparent hover:border-white/10 transition-all group"
                                                >
                                                    <div className="flex items-center gap-2 mb-1">
                                                    <div className="w-5 h-5 rounded bg-white/10 flex items-center justify-center shrink-0">
                                                        <Link2 className="w-3 h-3 text-white/50 group-hover:text-white" />
                                                    </div>
                                                    <span className="text-[12px] text-white/80 font-medium line-clamp-1">{s.title || "Источник"}</span>
                                                    </div>
                                                    <span className="text-[10px] text-neutral-500 line-clamp-1 truncate block ml-7 font-code">{s.url}</span>
                                                </a>
                                                ))}
                                            </div>
                                            </motion.div>
                                        )}
                                    </div>
                                    )}
                                </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            );
        })}

                {
                    messages.length <= 2 && !session.analysis && !isLoading && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex flex-col gap-3 mt-4"
                        >
                            <p className="font-mono-label text-[11px] uppercase tracking-widest text-neutral-500 text-center mb-2">Выберите тему для продолжения:</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto w-full">
                                <button onClick={() => handleSendMessage("Анализ идеи")} className="flex items-center gap-4 p-5 rounded-2xl bg-[#111111] hover:bg-white/5 border border-white/10 transition-all text-left group hover:border-white/20">
                                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                                        <Zap className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="text-white font-medium text-[14px]">Анализ идеи</div>
                                        <div className="text-neutral-500 text-[12px] mt-0.5">Получить оценку 0-100</div>
                                    </div>
                                </button>

                                <button onClick={() => handleSendMessage("Анализ ЦА")} className="flex items-center gap-4 p-5 rounded-2xl bg-[#111111] hover:bg-white/5 border border-white/10 transition-all text-left group hover:border-white/20">
                                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                                        <Users className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="text-white font-medium text-[14px]">Анализ ЦА</div>
                                        <div className="text-neutral-500 text-[12px] mt-0.5">Сегментация аудитории</div>
                                    </div>
                                </button>

                                <button onClick={() => handleSendMessage("Посчитать экономику проекта")} className="flex items-center gap-4 p-5 rounded-2xl bg-[#111111] hover:bg-white/5 border border-white/10 transition-all text-left group hover:border-white/20">
                                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                                        <Grid className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="text-white font-medium text-[14px]">Юнит-экономика</div>
                                        <div className="text-neutral-500 text-[12px] mt-0.5">САР, LTV, метрики</div>
                                    </div>
                                </button>

                                <button onClick={() => handleSendMessage("Другой вопрос")} className="flex items-center gap-4 p-5 rounded-2xl bg-[#111111] hover:bg-white/5 border border-white/10 transition-all text-left group hover:border-white/20">
                                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                                        <HelpCircle className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="text-white font-medium text-[14px]">Другой вопрос</div>
                                        <div className="text-neutral-500 text-[12px] mt-0.5">Свободный диалог</div>
                                    </div>
                                </button>
                            </div>
                        </motion.div>
                    )
                }

                {
                    session.analysis && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-8 border-t border-white/10 pt-8 pb-4"
                        >
                            <div className="text-center mb-6">
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-mono-label uppercase tracking-widest mb-4">
                                    <Star className="w-3 h-3" />
                                    <span>Анализ готов</span>
                                </div>
                                <h3 className="font-display text-[24px] font-medium text-white">Результаты оценки</h3>
                            </div>

                            <div className="max-w-md mx-auto">
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
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A] to-transparent pt-12 pb-8 z-40">
                <ChatInput
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onSend={() => handleSendMessage()}
                  isLoading={isLoading}
                  onStop={stopGeneration}
                  useDeepSearch={useDeepSearch}
                  onToggleDeepSearch={() => setUseDeepSearch(!useDeepSearch)}
                  isResearchMode={isResearchMode}
                  onToggleResearchMode={() => setIsResearchMode(!isResearchMode)}
                  isPresentationMode={isPresentationMode}
                  onTogglePresentationMode={() => setIsPresentationMode(!isPresentationMode)}
                  onCancelPresentationMode={() => setIsPresentationMode(false)}
                  onOpenImportModal={() => setIsImportModalOpen(true)}
                  disabled={!!session.analysis}
                  placeholder={isPresentationMode ? "Опишите идею для вашей презентации..." : (session.analysis ? "Диалог завершен" : "Задайте вопрос Pitchy...")}
                />
                
                {presentationSlides && presentationSlides.length > 0 && (
                    <div className="mt-4 flex justify-center">
                        <button
                            onClick={() => setIsPresentationOpen(true)}
                            className="flex items-center gap-2 px-6 py-2.5 bg-white text-black text-[12px] font-mono-label uppercase tracking-widest rounded hover:opacity-90 transition-opacity"
                        >
                            <FileText className="w-4 h-4" />
                            Открыть презентацию
                        </button>
                    </div>
                )}
            </div>

            <PresentationDrawer 
                isOpen={isPresentationOpen} 
                onClose={() => setIsPresentationOpen(false)} 
                slides={presentationSlides || []} 
                isLoading={isGeneratingSlides}
                statusText={generationStatus}
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
