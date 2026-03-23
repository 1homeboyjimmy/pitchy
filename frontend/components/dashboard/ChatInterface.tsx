
import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Send, User, Bot, Loader2, Sparkles, Lightbulb, Users, Calculator, HelpCircle, ThumbsUp, ThumbsDown, Square, ChevronDown, ChevronUp, Atom } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
// Button unused
import { ChatMessageResponse, ChatSessionDetailResponse, sendChatMessageFeedback } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { AnalysisCard } from "@/components/dashboard/AnalysisCard";
import dayjs from "dayjs";
import "dayjs/locale/ru";

interface ChatInterfaceProps {
    session: ChatSessionDetailResponse;
    onUpdate: (updatedSession: ChatSessionDetailResponse) => void;
}

export function ChatInterface({ session, onUpdate }: ChatInterfaceProps) {
    const [messages, setMessages] = useState<ChatMessageResponse[]>(session.messages || []);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const scrollViewportRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const [thoughtLines, setThoughtLines] = useState<Record<number, string>>({});
    const [thoughtExpanded, setThoughtExpanded] = useState<Record<number, boolean>>({});
    const [thoughtTime, setThoughtTime] = useState<Record<number, number>>({});

    // Typewriter animation state
    const [typingMessageId, setTypingMessageId] = useState<number | null>(null);
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

    useEffect(() => {
        setMessages(session.messages || []);
    }, [session]);

    const scrollToBottom = () => {
        if (scrollViewportRef.current) {
            scrollViewportRef.current.scrollTop = scrollViewportRef.current.scrollHeight;
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading, session.analysis, displayedLength]);

    // Typewriter effect: reveal characters progressively
    useEffect(() => {
        if (typingMessageId === null) return;
        const msg = messages.find((m) => m.id === typingMessageId);
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
    }, [typingMessageId, displayedLength, messages]);

    const getDisplayContent = useCallback((msg: ChatMessageResponse) => {
        if (msg.id === typingMessageId) {
            return msg.content.slice(0, displayedLength);
        }
        return msg.content;
    }, [typingMessageId, displayedLength]);

    const handleSendMessage = async (text?: string) => {
        const content = typeof text === 'string' ? text : inputValue.trim();
        if (!content || isLoading) return;

        if (typeof text !== 'string') setInputValue("");
        setIsLoading(true);

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const tempUserMsg: ChatMessageResponse = {
            id: -1,
            role: "user",
            content,
            created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, tempUserMsg]);

        try {
            const token = getToken();
            if (!token) throw new Error("No token");

            // Add placeholder assistant message
            const now = new Date();
            const tempAssistantId = now.getTime();
            setMessages((prev) => [...prev, {
                id: tempAssistantId,
                role: "assistant",
                content: "",
                created_at: now.toISOString(),
            }]);

            let fullAssistantContent = "";
            let fullThoughtContent = "";
            const startTime = Date.now();
            const { sendChatMessageStream, getChatSession } = await import("@/lib/api");

            try {
                for await (const data of sendChatMessageStream(session.id, content, token, abortController.signal)) {
                    // Use a stable key based on the assistant message's created_at timestamp
                    const stableKey = new Date(now).getTime();

                    if (data.type === "thought") {
                        fullThoughtContent += data.content;
                        setThoughtLines(prev => ({ ...prev, [stableKey]: fullThoughtContent }));
                        setThoughtExpanded(prev => ({ ...prev, [stableKey]: true }));
                    } else if (data.type === "chunk") {
                        if (!thoughtTime[stableKey] && fullThoughtContent) {
                            const duration = Math.round((Date.now() - startTime) / 1000);
                            setThoughtTime(prev => ({ ...prev, [stableKey]: duration }));
                        }
                        fullAssistantContent += data.content;
                        setMessages((prev) => 
                            prev.map(m => m.id === tempAssistantId ? { ...m, content: fullAssistantContent } : m)
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

            // Fetch updated session to check for analysis or new message IDs
            const updatedSession = await getChatSession(session.id, token);
            onUpdate(updatedSession);

            // Reconcile: Don't lose the streamed content or thoughts
            setMessages((prev) => {
                const dbMsgs = updatedSession.messages;
                // Check if the DB already has our last assistant message
                const lastLocal = prev[prev.length - 1];
                const hasLastAssistantInDb = dbMsgs.some(m => m.role === "assistant" && (m.content === fullAssistantContent || (fullAssistantContent.length > 0 && m.content.length > 0)));

                if (!hasLastAssistantInDb && lastLocal && lastLocal.role === "assistant") {
                    // DB is definitely lagging, keep our local version
                    return [...dbMsgs, lastLocal];
                }
                
                // If DB has it but content is shorter, fix it
                const lastDb = dbMsgs[dbMsgs.length - 1];
                if (lastLocal && lastLocal.role === "assistant" && lastDb?.role === "assistant") {
                    if (fullAssistantContent.length > lastDb.content.length) {
                        return [...dbMsgs.slice(0, -1), { ...lastDb, content: fullAssistantContent }];
                    }
                }
                return dbMsgs;
            });

        } catch (error) {
            console.error(error);
            alert("Ошибка отправки сообщения");
            setMessages((prev) => prev.filter(m => m.id !== -1));
        } finally {
            setIsLoading(false);
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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-12rem)] bg-white/5 rounded-2xl border border-white/10 overflow-hidden relative">
            <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />

            {/* Messages Area */}
            <div ref={scrollViewportRef} className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-white/30 text-center p-8">
                        <Sparkles className="w-12 h-12 mb-4 opacity-50" />
                        <p>Начните диалог с описания вашего стартапа.</p>
                    </div>
                )}

                {messages.map((msg, idx) => {
                    const stableKey = new Date(msg.created_at).getTime();
                    const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1;
                    const hasThoughts = thoughtLines[stableKey] !== undefined;
                    const isThinkingOnly = msg.role === "assistant" && msg.content === "" && hasThoughts;

                    return (
                        <motion.div
                            key={msg.id === -1 ? `temp-${idx}` : msg.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                        >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === "user" ? "bg-white/10" : "bg-pitchy-violet"}`}>
                                {msg.role === "user" ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
                            </div>

                            <div className={`max-w-[85%] flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                                {hasThoughts && (
                                    <div className="w-full max-w-[600px] bg-white/[0.03] rounded-xl border border-white/10 overflow-hidden self-start">
                                        <button 
                                            onClick={() => setThoughtExpanded(prev => ({ ...prev, [stableKey]: !prev[stableKey] }))}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-white/40 hover:text-white/60 transition-colors bg-white/[0.02] border-b border-white/5"
                                        >
                                            <Atom className={`w-3.5 h-3.5 ${isLoading && isLastAssistant && !thoughtTime[stableKey] ? "animate-spin" : "text-pitchy-violet"}`} />
                                            <span className="font-medium">
                                                {thoughtTime[stableKey] ? `Размышления (${thoughtTime[stableKey]} сек)` : "Pitchy рассуждает..."}
                                            </span>
                                            {thoughtExpanded[stableKey] ? <ChevronUp className="w-3.5 h-3.5 ml-auto opacity-50" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto opacity-50" />}
                                        </button>
                                        <motion.div
                                            initial={false}
                                            animate={{ height: thoughtExpanded[stableKey] ? "auto" : 0 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="p-3 text-[13px] leading-relaxed text-white/50 italic border-l-2 border-pitchy-violet/30 ml-2 my-2 bg-white/[0.01]">
                                                {thoughtLines[stableKey]}
                                            </div>
                                        </motion.div>
                                    </div>
                                )}

                                {!isThinkingOnly && (
                                    <div className={`p-4 rounded-2xl ${msg.role === "user"
                                        ? "bg-white/10 text-white rounded-tr-sm"
                                        : "bg-pitchy-violet/10 border border-pitchy-violet/20 text-white rounded-tl-sm"
                                        }`}>
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
                                        <Lightbulb className="w-5 h-5" />
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
                                        <Calculator className="w-5 h-5" />
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
                                <Loader2 className="w-5 h-5 text-white animate-spin" />
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
                                    <Sparkles className="w-4 h-4" />
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
            </div >

            {/* Input Area */}
            < div className="p-4 bg-white/5 border-t border-white/10 backdrop-blur-md" >
                <div className="relative flex items-center">
                    <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={session.analysis ? "Диалог завершен" : "Отправьте сообщение..."}
                        disabled={!!session.analysis}
                        className="w-full bg-black/20 text-white placeholder-white/30 rounded-xl leading-[24px] pl-4 pr-14 py-3 min-h-[50px] max-h-[150px] border border-white/10 focus:border-pitchy-violet/50 focus:outline-none focus:ring-1 focus:ring-pitchy-violet/50 resize-none scrollbar-thin disabled:opacity-50 disabled:cursor-not-allowed"
                        rows={1}
                    />
                    <button
                        onClick={() => isLoading ? stopGeneration() : handleSendMessage()}
                        disabled={(!inputValue.trim() && !isLoading) || !!session.analysis}
                        className={`absolute right-3 p-2 rounded-lg text-white transition-colors ${isLoading ? 'bg-red-500/80 hover:bg-red-500' : 'bg-pitchy-violet hover:bg-pitchy-violet/80'}`}
                    >
                        {isLoading ? <Square className="w-4 h-4 fill-white" /> : <Send className="w-4 h-4" />}
                    </button>
                </div>
            </div >
        </div >
    );
}
