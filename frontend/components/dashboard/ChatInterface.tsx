
import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { User, Cpu, Loader, Star, Zap, Users, Grid, HelpCircle, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp, Activity, Globe, Link2, FileText } from "react-feather";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
// Button unused
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
    const [useDeepSearch, setUseDeepSearch] = useState(false);
    const [isResearchMode, setIsResearchMode] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const scrollViewportRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Presentation state
    const [presentationSlides, setPresentationSlides] = useState<PresentationSlide[] | null>(null);
    const [isPresentationOpen, setIsPresentationOpen] = useState(false);

    // Import Modal state
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);

    // Typewriter animation state
    const [typingMessageId, setTypingMessageId] = useState<string | number | null>(null);
    const [displayedLength, setDisplayedLength] = useState(0);
    const typingSpeed = 12; // ms per character

    const handleFeedback = async (messageId: number, feedbackValue: number) => {
        // Optimistic UI update
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

    // Unified key getter to prevent mismatches
    const getSafeKey = useCallback((m: ExtendedChatMessage) => {
        return (m.client_id || m.id)?.toString();
    }, []);

    // Shared merge logic to prevent duplicates and data loss
    const mergeMessages = useCallback((current: ExtendedChatMessage[], incoming: ExtendedChatMessage[]) => {
        const map = new Map();

        // 1. Сначала берем всё, что прислал сервер
        incoming.forEach(inc => {
            const key = getSafeKey(inc);
            if (key) map.set(key, inc);
        });

        // 2. Накладываем локальные сообщения сверху
        current.forEach(loc => {
            const key = getSafeKey(loc);
            if (!key) return;

            const serverMatch = map.get(key);
            
            if (serverMatch) {
                // Если сервер уже знает об этом сообщении, берем серверное,
                // НО сохраняем локальный текст, если он длиннее (защита от пустой базы)
                map.set(key, {
                    ...serverMatch,
                    content: (loc.content?.length || 0) > (serverMatch.content?.length || 0) 
                        ? loc.content 
                        : serverMatch.content,
                    // Сохраняем мысли и статус раскрытия
                    thoughts: loc.thoughts || serverMatch.thoughts,
                    thoughtTime: loc.thoughtTime || serverMatch.thoughtTime,
                    thoughtExpanded: loc.thoughtExpanded ?? serverMatch.thoughtExpanded
                });
            } else {
                // КЛЮЧЕВОЙ МОМЕНТ: если сообщения НЕТ на сервере, но оно есть локально —
                // НЕ УДАЛЯЕМ его, пока идет загрузка (isLoading)
                if (isLoading) {
                    map.set(key, loc);
                }
            }
        });
        
        return Array.from(map.values()).sort((a, b) => 
            dayjs(a.created_at).valueOf() - dayjs(b.created_at).valueOf()
        );
    }, [getSafeKey, isLoading]);

    useEffect(() => {
        // Use merge instead of direct replacement to protect streaming state
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
        // Force scroll on initial load or when loading starts (new message)
        if (messages.length > 0 && isLoading && displayedLength === 0) {
            scrollToBottom(true);
        } else {
            scrollToBottom();
        }
    }, [messages.length, isLoading, session.analysis, displayedLength]);

    // Typewriter effect: reveal characters progressively
    useEffect(() => {
        if (typingMessageId === null) return;
        const msg = messages.find((m) => getSafeKey(m) === typingMessageId.toString());
        if (!msg) { setTypingMessageId(null); return; }
        const fullLen = msg.content.length;
        if (displayedLength >= fullLen) {
            setTypingMessageId(null);
            return;
        }
        // Reveal faster for markdown formatting chars
        const nextChar = msg.content[displayedLength];
        const speed = /[|\-#*\n\r]/.test(nextChar) ? 2 : typingSpeed;
        const timer = setTimeout(() => {
            // Reveal in small chunks (3-5 chars) for smoother feel
            const chunk = Math.min(3, fullLen - displayedLength);
            setDisplayedLength((prev) => prev + chunk);
        }, speed);
        return () => clearTimeout(timer);
    }, [typingMessageId, displayedLength, messages, getSafeKey]);

    const getDisplayContent = useCallback((msg: ChatMessageResponse) => {
        if (getSafeKey(msg) === typingMessageId?.toString()) {
            return msg.content.slice(0, displayedLength);
        }
        return msg.content;
    }, [typingMessageId, displayedLength, getSafeKey]);

    const handleSendMessage = async (text?: string) => {
        const content = typeof text === 'string' ? text : inputValue.trim();
        if (!content || isLoading) return;

        if (typeof text !== 'string') setInputValue("");
        setIsLoading(true);

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            const token = getToken();
            if (!token) throw new Error("No token");

            const now = new Date();
            const userClientId = crypto.randomUUID();
            const assistantClientId = crypto.randomUUID();

            // PUSH ONLY ONCE: Both user and assistant placeholder
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
                    isResearchMode
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
                        // Delay opening the drawer slightly so the user sees the "success" message
                        setTimeout(() => setIsPresentationOpen(true), 1500);
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
                }
            }

            // Fetch updated session after a small delay to ensure background tasks finished
            await new Promise(resolve => setTimeout(resolve, 400));
            const updatedSession = await getChatSession(session.id, token);
            onUpdate(updatedSession);

            // Reconcile using our shared merge logic
            setMessages((prev) => mergeMessages(prev, updatedSession.messages || []));

        } catch (error) {
            console.error(error);
            alert("Ошибка отправки сообщения");
            setMessages((prev) => prev.filter(m => m.id !== -1));
        } finally {
            setIsLoading(false);
            setIsResearchMode(false); // Reset research mode after send
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
        <div className="flex flex-col flex-1 h-full min-h-0 bg-[#131313] rounded-2xl border border-white/10 overflow-hidden relative">
            <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />

            {/* Messages Area */}
            <div ref={scrollViewportRef} className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                <div className="max-w-4xl mx-auto w-full space-y-6">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-white/30 text-center p-8">
                        <Star className="w-12 h-12 mb-4 opacity-50" />
                        <p>Начните диалог с описания вашего стартапа.</p>
                    </div>
                )}

                {messages.map((msg, idx) => {
            const messageKey = msg.client_id || msg.id;
            const hasThoughts = msg.thoughts !== undefined && msg.thoughts !== null && msg.thoughts.length > 0;
            const userMessagesBefore = messages.slice(0, idx).filter(m => m.role === "user").length;
            const showThoughts = hasThoughts && (userMessagesBefore > 1 || msg.isResearch);
            const hasContent = msg.content && msg.content.length > 0;
            const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1;
            const shouldRenderMainBubble = msg.role === "user" || hasContent;

            return (
                <motion.div
                    key={msg.client_id || msg.id.toString()}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                        >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === "user" ? "bg-white/10" : "bg-pitchy-violet"}`}>
                                {msg.role === "user" ? <User className="w-5 h-5 text-white" /> : <Cpu className="w-5 h-5 text-white" />}
                            </div>

                            <div className={`flex-1 min-w-0 flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                                {msg.role === "assistant" && showThoughts && (
                                    <div className="w-full max-w-[600px] bg-transparent overflow-hidden self-start">
                                        <button 
                                            onClick={() => {
                                                setMessages(prev => prev.map(m => (m.client_id || m.id) === messageKey ? { ...m, thoughtExpanded: !m.thoughtExpanded } : m));
                                            }}
                                            className="flex items-center gap-2 px-1 py-1 text-[12px] text-white/40 hover:text-white/60 transition-colors"
                                        >
                                            <Activity className={`w-4 h-4 ${isLoading && isLastAssistant && !msg.thoughtTime ? "animate-spin" : "text-pitchy-violet"}`} />
                                            <span className="font-medium">
                                                {msg.thoughtTime ? `Размышления (${msg.thoughtTime} сек)` : "Pitchy рассуждает..."}
                                            </span>
                                            {msg.thoughtExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                        </button>
                                        
                                        <motion.div
                                            initial={false}
                                            animate={{ height: msg.thoughtExpanded ? "auto" : 0, opacity: msg.thoughtExpanded ? 1 : 0 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="mt-1 mb-3 p-3 bg-white/5 rounded-xl border border-white/10 text-[13px] leading-relaxed text-white/50 italic whitespace-pre-wrap">
                                                {msg.thoughts}
                                            </div>
                                        </motion.div>
                                    </div>
                                )}

                                {/* Loading state placeholder */}
                                {msg.role === "assistant" && !hasContent && !showThoughts && isLoading && isLastAssistant && (
                                    <div className="flex items-center gap-3 p-4 bg-white/5 rounded-2xl border border-white/10 text-white/60">
                                        <Loader className="animate-spin h-5 w-5 text-pitchy-violet" />
                                        <span className="text-sm font-medium animate-pulse">
                                            Pitchy анализирует данные и ищет информацию...
                                        </span>
                                    </div>
                                )}

                                {shouldRenderMainBubble && (
                                    msg.role === "user" ? (
                                        <CollapsibleUserMessage content={getDisplayContent(msg)} />
                                    ) : (
                                        <div className="p-4 rounded-2xl bg-pitchy-violet/10 border border-pitchy-violet/20 text-white rounded-tl-sm">
                                            <div className="text-sm sm:text-base leading-[1.7] md:leading-[1.8] text-white/90 [&>p]:mb-4 [&>p:last-child]:mb-0 [&>ul]:list-disc [&>ul]:pl-6 [&>ul]:mb-4 [&>ul>li]:mb-2 [&>ul>li]:pl-1 [&>ol]:list-decimal [&>ol]:pl-6 [&>ol]:mb-4 [&>ol>li]:mb-2 [&>ol>li]:pl-1 [&>h2]:text-xl [&>h2]:font-bold [&>h2]:text-pitchy-cyan-light [&>h2]:mt-8 [&>h2]:mb-4 [&>h3]:text-lg [&>h3]:font-bold [&>h3]:text-white [&>h3]:mt-6 [&>h3]:mb-3 [&>strong]:text-white [&>strong]:font-semibold break-words">
                                                <ReactMarkdown 
                                                    remarkPlugins={[remarkGfm]}
                                                    components={{
                                                        table: ({...props}) => (
                                                            <div className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-white/5">
                                                                <table className="w-full text-left border-collapse" {...props} />
                                                            </div>
                                                        ),
                                                        thead: ({...props}) => <thead className="bg-white/10" {...props} />,
                                                        th: ({...props}) => <th className="p-3 text-sm font-bold text-pitchy-cyan-light border-b border-white/10" {...props} />,
                                                        td: ({...props}) => <td className="p-3 text-sm text-white/80 border-b border-white/5 last:border-0" {...props} />,
                                                    }}
                                                >
                                                    {getDisplayContent(msg)}
                                                </ReactMarkdown>
                                                {msg.id === typingMessageId && (
                                                    <span className="inline-block w-0.5 h-4 bg-pitchy-cyan animate-pulse ml-0.5 align-text-bottom" />
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 mt-2 w-full">
                                            {msg.role === "assistant" && (
                                                <div className="flex items-center gap-1 pl-1">
                                                    <button
                                                        onClick={() => handleFeedback(msg.id, msg.feedback === 1 ? 0 : 1)}
                                                        className={`p-1.5 rounded-md transition-colors ${msg.feedback === 1 ? 'text-pitchy-cyan bg-pitchy-cyan/10' : 'text-white/30 hover:text-white/60 hover:bg-white/5'}`}
                                                        title="Хороший ответ"
                                                    >
                                                        <ThumbsUp className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleFeedback(msg.id, msg.feedback === -1 ? 0 : -1)}
                                                        className={`p-1.5 rounded-md transition-colors ${msg.feedback === -1 ? 'text-red-400 bg-red-400/10' : 'text-white/30 hover:text-white/60 hover:bg-white/5'}`}
                                                        title="Плохой ответ"
                                                    >
                                                        <ThumbsDown className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                            <span className="text-[10px] text-white/30 ml-auto mr-1">
                                                {dayjs(msg.created_at).format("HH:mm")}
                                            </span>
                                        </div>
                                    </div>
                                    )
                                )}

                                {/* Qwen-Style Sources Rendering */}
                                {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                                  <div className="w-full mt-2">
                                    <button
                                      onClick={() => setMessages(prev => prev.map(m => (m.client_id || m.id) === messageKey ? { ...m, sourcesExpanded: !m.sourcesExpanded } : m))}
                                      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-[11px] text-white/60 hover:text-white transition-all w-fit"
                                    >
                                      <Globe className="w-3.5 h-3.5 text-pitchy-violet" />
                                      <span className="font-semibold">{msg.sources.length} ИСТОЧНИКОВ</span>
                                      {msg.sourcesExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                    </button>
                                    
                                    {msg.sourcesExpanded && (
                                        <motion.div
                                          initial={{ height: 0, opacity: 0 }}
                                          animate={{ height: "auto", opacity: 1 }}
                                          className="overflow-hidden mt-2"
                                        >
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 bg-white/5 border border-white/10 rounded-xl">
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
                                                <span className="text-[10px] text-white/40 line-clamp-1 truncate block ml-7">{s.url}</span>
                                              </a>
                                            ))}
                                          </div>
                                        </motion.div>
                                    )}
                                  </div>
                                )}
                            </div>
                        </motion.div>
                    );
                })}

                {
                    messages.length <= 2 && !session.analysis && !isLoading && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex flex-col gap-3 mt-4"
                        >
                            <p className="text-white/50 text-sm text-center mb-2">Выберите тему для продолжения:</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto w-full">
                                <button onClick={() => handleSendMessage("Анализ идеи")} className="flex items-center gap-3 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-left group">
                                    <div className="w-10 h-10 rounded-lg bg-pitchy-violet/20 flex items-center justify-center text-pitchy-violet group-hover:scale-110 transition-transform">
                                        <Zap className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="text-white font-medium">Анализ идеи</div>
                                        <div className="text-white/40 text-xs mt-0.5">Получить оценку 0-100</div>
                                    </div>
                                </button>

                                <button onClick={() => handleSendMessage("Анализ ЦА")} className="flex items-center gap-3 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-left group">
                                    <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                                        <Users className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="text-white font-medium">Анализ ЦА</div>
                                        <div className="text-white/40 text-xs mt-0.5">Сегментация аудитории</div>
                                    </div>
                                </button>

                                <button onClick={() => handleSendMessage("Посчитать экономику проекта")} className="flex items-center gap-3 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-left group">
                                    <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                                        <Grid className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="text-white font-medium">Юнит-экономика</div>
                                        <div className="text-white/40 text-xs mt-0.5">САР, LTV, метрики</div>
                                    </div>
                                </button>

                                <button onClick={() => handleSendMessage("Другой вопрос")} className="flex items-center gap-3 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-left group">
                                    <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center text-orange-400 group-hover:scale-110 transition-transform">
                                        <HelpCircle className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="text-white font-medium">Другой вопрос</div>
                                        <div className="text-white/40 text-xs mt-0.5">Свободный диалог</div>
                                    </div>
                                </button>
                            </div>
                        </motion.div>
                    )
                }

                {
                    isLoading && messages.length <= 1 && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4">
                            <div className="w-8 h-8 rounded-full bg-pitchy-violet flex items-center justify-center flex-shrink-0">
                                <Loader className="w-5 h-5 text-white animate-spin" />
                            </div>
                            <div className="bg-pitchy-violet/10 border border-pitchy-violet/20 text-white rounded-2xl rounded-tl-sm p-4 flex items-center">
                                <span className="animate-pulse">Анализирую...</span>
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
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-medium mb-2">
                                    <Star className="w-4 h-4" />
                                    <span>Анализ готов</span>
                                </div>
                                <h3 className="text-xl font-bold text-white">Результаты оценки</h3>
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

            {/* Input Area */}
            <div className="p-4 bg-[#131313] pb-6 z-10 relative">
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
                  onOpenImportModal={() => setIsImportModalOpen(true)}
                  disabled={!!session.analysis}
                  placeholder={session.analysis ? "Диалог завершен" : "Спросите Pitchy..."}
                />
                
                {presentationSlides && presentationSlides.length > 0 && (
                    <div className="mt-4 flex justify-center">
                        <button
                            onClick={() => setIsPresentationOpen(true)}
                            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-pitchy-violet to-pitchy-cyan text-white text-sm font-bold rounded-xl shadow-[0_0_15px_rgba(168,85,247,0.3)] hover:shadow-[0_0_25px_rgba(168,85,247,0.5)] transition-all"
                        >
                            <FileText className="w-4 h-4" />
                            Открыть презентацию
                        </button>
                    </div>
                )}
            </div>

            {/* Presentation Drawer Overlay */}
            <PresentationDrawer 
                isOpen={isPresentationOpen} 
                onClose={() => setIsPresentationOpen(false)} 
                slides={presentationSlides || []} 
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
        </div >
    );
}
