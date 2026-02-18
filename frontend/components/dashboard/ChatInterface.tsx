
import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Send, User, Bot, Loader2, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
// Button unused
import { ChatMessageResponse, ChatSessionDetailResponse, sendChatMessage, getChatSession } from "@/lib/api";
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

    useEffect(() => {
        setMessages(session.messages || []);
    }, [session]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading, session.analysis]);

    const handleSendMessage = async () => {
        if (!inputValue.trim() || isLoading) return;

        const content = inputValue.trim();
        setInputValue("");
        setIsLoading(true);

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

            await sendChatMessage(session.id, content, token);

            // Fetch updated session to check for analysis
            const updatedSession = await getChatSession(session.id, token);
            onUpdate(updatedSession);
            setMessages(updatedSession.messages);

        } catch (error) {
            console.error(error);
            alert("Ошибка отправки сообщения");
            setMessages((prev) => prev.filter(m => m.id !== -1));
        } finally {
            setIsLoading(false);
            setTimeout(() => textareaRef.current?.focus(), 100);
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
            <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-white/30 text-center p-8">
                        <Sparkles className="w-12 h-12 mb-4 opacity-50" />
                        <p>Начните диалог с описания вашего стартапа.</p>
                    </div>
                )}

                {messages.map((msg, idx) => (
                    <motion.div
                        key={msg.id === -1 ? `temp-${idx}` : msg.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                    >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === "user" ? "bg-white/10" : "bg-pitchy-violet"
                            }`}>
                            {msg.role === "user" ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
                        </div>

                        <div className={`max-w-[80%] rounded-2xl p-4 ${msg.role === "user"
                            ? "bg-white/10 text-white rounded-tr-sm"
                            : "bg-pitchy-violet/10 border border-pitchy-violet/20 text-white rounded-tl-sm"
                            }`}>
                            <div className="prose prose-invert prose-sm max-w-none">
                                <ReactMarkdown>
                                    {msg.content}
                                </ReactMarkdown>
                            </div>
                            <span className="text-[10px] text-white/30 mt-2 block w-full text-right">
                                {dayjs(msg.created_at).format("HH:mm")}
                            </span>
                        </div>
                    </motion.div>
                ))}

                {isLoading && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-pitchy-violet flex items-center justify-center flex-shrink-0">
                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                        </div>
                        <div className="bg-pitchy-violet/10 border border-pitchy-violet/20 text-white rounded-2xl rounded-tl-sm p-4 flex items-center">
                            <span className="animate-pulse">Анализирую...</span>
                        </div>
                    </motion.div>
                )}

                {session.analysis && (
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
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white/5 border-t border-white/10 backdrop-blur-md">
                <div className="relative">
                    <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={session.analysis ? "Диалог завершен" : "Отправьте сообщение..."}
                        disabled={!!session.analysis}
                        className="w-full bg-black/20 text-white placeholder-white/30 rounded-xl pl-4 pr-14 py-3 min-h-[50px] max-h-[150px] border border-white/10 focus:border-pitchy-violet/50 focus:outline-none focus:ring-1 focus:ring-pitchy-violet/50 resize-none scrollbar-thin disabled:opacity-50 disabled:cursor-not-allowed"
                        rows={1}
                    />
                    <button
                        onClick={handleSendMessage}
                        disabled={!inputValue.trim() || isLoading || !!session.analysis}
                        className="absolute right-2 bottom-2 p-2 rounded-lg bg-pitchy-violet text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-pitchy-violet/80 transition-colors"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
