"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, Loader2, Key } from "lucide-react";
import { useRouter } from "next/navigation";
import { createGuestIntent } from "@/lib/api";

const QUICK_ACTIONS = [
    "Оценить идею стартапа",
    "Составить план запуска",
    "Как найти первых клиентов?",
];

interface Message {
    id: string;
    type: "ai" | "user";
    content: string;
}

export function IntentChat() {
    const router = useRouter();
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            type: "ai",
            content: "Привет! Я Pitchy — твой AI-кофайундер. Напиши мне коротко суть своего проекта, и я покажу, как могу помочь с его запуском.",
        },
    ]);
    const [inputValue, setInputValue] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const [isRedirecting, setIsRedirecting] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = "auto";
            inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
        }
    }, [inputValue]);

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping]);

    const handleSend = async (text: string = inputValue) => {
        if (!text.trim() || isRedirecting) return;

        // 1. Add user message
        const messageId = crypto.randomUUID();
        const userMsg: Message = {
            id: messageId,
            type: "user",
            content: text,
        };
        setMessages((prev) => [...prev, userMsg]);
        setInputValue("");
        setIsTyping(true);

        try {
            // 2. Call API to save intent in Redis
            const { intent_id } = await createGuestIntent(text);

            // 3. Save intent_id to localStorage
            localStorage.setItem("pitchy_intent_id", intent_id);

            // 4. Show AI "thinking" -> "done"
            setTimeout(() => {
                setIsTyping(false);
                setIsRedirecting(true);

                const aiMsg: Message = {
                    id: crypto.randomUUID(),
                    type: "ai",
                    content: "Отлично! Я сохранил ваш профиль отрасли и начал подбирать инструменты. Чтобы увидеть результат и продолжить работу, пожалуйста, войдите или зарегистрируйтесь.",
                };
                setMessages((prev) => [...prev, aiMsg]);

                // No automatic redirect, wait for user to click
            }, 1000);

        } catch (e) {
            console.error(e);
            setIsTyping(false);
            setMessages((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    type: "ai",
                    content: "Произошла ошибка при сохранении запроса. Пожалуйста, попробуйте позже.",
                }
            ]);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="w-full max-w-3xl mx-auto">
            <div className="glass-panel rounded-3xl overflow-hidden shadow-glow-primary/30">
                {/* Messages Area */}
                <div className="h-[350px] sm:h-[400px] overflow-y-auto p-4 sm:p-6 space-y-4">
                    <AnimatePresence mode="popLayout">
                        {messages.map((message) => (
                            <motion.div
                                key={message.id}
                                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
                            >
                                <div
                                    className={`max-w-[85%] sm:max-w-[75%] ${message.type === "user"
                                        ? "bg-pitchy-violet/20 border border-pitchy-violet/30 rounded-2xl rounded-tr-sm"
                                        : "glass-card rounded-2xl rounded-tl-sm"
                                        } px-4 py-3`}
                                >
                                    {message.type === "ai" && (
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-pitchy-violet to-pitchy-cyan flex items-center justify-center">
                                                <Sparkles className="w-3 h-3 text-white" />
                                            </div>
                                            <span className="text-xs font-medium text-white/60">
                                                Pitchy Copilot
                                            </span>
                                        </div>
                                    )}
                                    <p className="text-sm sm:text-base text-white/90 leading-relaxed break-words whitespace-pre-wrap">
                                        {message.content}
                                    </p>

                                    {isRedirecting && message.id !== "welcome" && message.type === "ai" && (
                                        <div className="mt-4 flex flex-col sm:flex-row items-center gap-3">
                                            <button
                                                onClick={() => router.push("/signup")}
                                                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-pitchy-violet text-white rounded-xl text-sm font-medium hover:bg-pitchy-violet/80 transition-colors"
                                            >
                                                Зарегистрироваться
                                            </button>
                                            <button
                                                onClick={() => router.push("/login")}
                                                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-medium hover:bg-white/10 transition-colors"
                                            >
                                                <Key className="w-4 h-4" />
                                                Войти
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>

                    {/* Typing Indicator */}
                    {isTyping && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex justify-start"
                        >
                            <div className="glass-card rounded-2xl rounded-tl-sm px-4 py-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-pitchy-violet to-pitchy-cyan flex items-center justify-center">
                                        <Sparkles className="w-3 h-3 text-white" />
                                    </div>
                                    <span className="text-xs font-medium text-white/60">
                                        Pitchy Copilot
                                    </span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity }} className="w-2 h-2 rounded-full bg-pitchy-violet" />
                                    <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.15 }} className="w-2 h-2 rounded-full bg-pitchy-violet" />
                                    <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.3 }} className="w-2 h-2 rounded-full bg-pitchy-violet" />
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {!isRedirecting && messages.length === 1 && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.5 }}
                            className="flex flex-wrap gap-2 pt-2 justify-end"
                        >
                            {QUICK_ACTIONS.map((action, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => handleSend(action)}
                                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors text-left"
                                >
                                    {action}
                                </button>
                            ))}
                        </motion.div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 sm:p-6 border-t border-white/8 bg-black/20">
                    <div className="relative w-full cursor-text rounded-[14px] border border-white/10 bg-white/5 transition-all duration-200 flex items-end gap-2 p-1.5">
                        <textarea
                            ref={inputRef}
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Опишите вашу идею или задайте вопрос..."
                            rows={1}
                            className="flex-1 bg-transparent border-none !outline-none resize-none overflow-y-auto min-h-[40px] max-h-[150px] py-2.5 pl-3 text-white placeholder-white/40 text-sm focus:!outline-none focus:!ring-0 scrollbar-none"
                            disabled={isTyping || isRedirecting}
                        />
                        <button
                            onClick={() => handleSend()}
                            disabled={!inputValue.trim() || isTyping || isRedirecting}
                            className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-pitchy-violet text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                            {isTyping || isRedirecting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Send className="w-4 h-4 -ml-0.5 mt-0.5" />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default IntentChat;
