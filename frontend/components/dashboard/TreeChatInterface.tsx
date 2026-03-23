"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, Sparkles, X, Square, ChevronDown, ChevronUp, Atom } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getToken } from "@/lib/auth";
import { getTreeChatHistory, type TreeNodeResponse } from "@/lib/api";
import { motion } from "framer-motion";

interface Message {
  role: "user" | "assistant";
  content: string;
  model_used?: string;
  timestamp: string;
  thoughts?: string;
  thoughtTime?: number;
  thoughtExpanded?: boolean;
}

interface TreeChatInterfaceProps {
  treeId: number;
  activeNode: TreeNodeResponse | null;
  onUpdateTree: (nodes: TreeNodeResponse[], readiness: number) => void;
  onClose: () => void;
  triggerMessage?: string | null;
}

export function TreeChatInterface({ treeId, activeNode, onUpdateTree, onClose, triggerMessage }: TreeChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hints, setHints] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load history on mount or when activeNode changes
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const token = getToken();
        if (!token) return;
        const res = await getTreeChatHistory(treeId, token, activeNode?.id);
        if (res.history && res.history.length > 0) {
          setMessages(res.history as Message[]);
        } else if (activeNode) {
          // Welcome message if no history for this node
          setMessages([{
            role: "assistant",
            content: `Привет! Я Pitchy AI. Я готов помочь с разделом **"${activeNode.label}"**. Что именно мы хотим уточнить или рассчитать?`,
            timestamp: new Date().toISOString()
          }]);
        }
      } catch (err) {
        console.error("Failed to load chat history:", err);
      }
    };
    loadHistory();
  }, [treeId, activeNode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = useCallback(async (overrideMessage?: string) => {
    const messageToSend = overrideMessage || input;
    if (!messageToSend.trim() || isLoading) return;

    const userMsg: Message = {
      role: "user",
      content: messageToSend,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!overrideMessage) setInput("");
    setIsLoading(true);

    try {
      const token = getToken();
      if (!token) throw new Error("Unauthorized");

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // We'll update the last message in real-time
      let assistantContent = "";
      let fullThoughtContent = "";
      const now = new Date();
      const tempAssistantId = now.getTime();
      
      // Add initial empty assistant message to be populated
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "",
        timestamp: now.toISOString()
      }]);

      const { postTreeChatStream } = await import("@/lib/api");
      
      try {
        const stableKey = now.getTime();
        for await (const chunk of postTreeChatStream(treeId, messageToSend, token, activeNode?.id, abortController.signal)) {
          if (chunk.type === "thought") {
            fullThoughtContent += chunk.content;
            setMessages(prev => prev.map((m, i) => 
               i === prev.length - 1 ? { ...m, thoughts: fullThoughtContent, thoughtExpanded: true } : m
            ));
          } else if (chunk.type === "chunk") {
            let durationUpdate = {};
            if (!assistantContent && fullThoughtContent) {
                const duration = Math.round((Date.now() - stableKey) / 1000);
                durationUpdate = { thoughtTime: duration };
            }
            assistantContent += chunk.content;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last.role === "assistant") {
                return [...prev.slice(0, -1), { ...last, content: assistantContent, ...durationUpdate }];
              }
              return prev;
            });
          }
 else if (chunk.type === "metadata") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last.role === "assistant") {
                return [...prev.slice(0, -1), { ...last, model_used: chunk.model }];
              }
              return prev;
            });
          } else if (chunk.type === "tree_update") {
            onUpdateTree(chunk.data.nodes, chunk.data.readiness_index);
          } else if (chunk.type === "final") {
            if (chunk.hints) setHints(chunk.hints);
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log("Generation aborted");
        } else {
          throw err;
        }
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "Извините, произошла ошибка. Попробуйте еще раз позже.",
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [input, isLoading, treeId, activeNode, onUpdateTree]);

  const stopGeneration = () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        setIsLoading(false);
        abortControllerRef.current = null;
    }
  };

  // Handle external triggers (e.g. from buttons)
  useEffect(() => {
    if (triggerMessage) {
      handleSend(triggerMessage);
    }
  }, [triggerMessage, handleSend]);

  return (
    <div className="flex flex-col h-full bg-[#0c0a1a]/80 backdrop-blur-xl border-l border-white/10 w-[400px] shadow-2xl">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-pitchy-violet/20 flex items-center justify-center text-pitchy-violet">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Умный ассистент</h3>
            <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold">Contextual Orchestrator</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Chat Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        {messages.map((msg, idx) => {
          const hasThoughts = msg.thoughts !== undefined;
          const isThinkingOnly = msg.role === "assistant" && msg.content === "" && hasThoughts;
          const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1;

          return (
            <div key={idx} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-white/10" : "bg-pitchy-violet"}`}>
                {msg.role === "user" ? <User className="w-4 h-4 text-white/70" /> : <Bot className="w-4 h-4 text-white" />}
              </div>
              <div className={`max-w-[90%] flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                {hasThoughts && (
                  <div className="w-full bg-transparent overflow-hidden self-start">
                    <button 
                        onClick={() => {
                          setMessages(prev => prev.map((m, i) => i === idx ? { ...m, thoughtExpanded: !m.thoughtExpanded } : m));
                        }}
                        className="flex items-center gap-2 px-1 py-1 text-[10px] text-white/40 hover:text-white/60 transition-colors"
                    >
                        <Atom className={`w-3.5 h-3.5 ${isLoading && isLastAssistant && !msg.thoughtTime ? "animate-spin" : "text-pitchy-violet"}`} />
                        <span className="font-medium uppercase tracking-wider">
                            {msg.thoughtTime ? `Размышления (${msg.thoughtTime} сек)` : "Pitchy рассуждает..."}
                        </span>
                        {msg.thoughtExpanded ? <ChevronUp className="w-3.5 h-3.5 ml-auto opacity-50" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto opacity-50" />}
                    </button>
                    <motion.div
                        initial={false}
                        animate={{ height: msg.thoughtExpanded ? "auto" : 0 }}
                        className="overflow-hidden"
                    >
                        <div className="p-2.5 text-[12px] leading-relaxed text-white/50 italic border-l-2 border-pitchy-violet/30 ml-2 my-1.5 bg-white/[0.02] rounded-r-lg">
                            {msg.thoughts}
                        </div>
                    </motion.div>
                  </div>
                )}

                {!isThinkingOnly && (
                  <div className={`p-3 rounded-2xl text-sm leading-relaxed ${
                    msg.role === "user" 
                      ? "bg-white/5 text-white/90 border border-white/10 rounded-tr-sm" 
                      : "bg-pitchy-violet/5 text-white/90 border border-pitchy-violet/20 rounded-tl-sm relative"
                  }`}>
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({...props}) => (
                            <div className="my-3 overflow-x-auto rounded-xl border border-white/10 bg-white/5">
                              <table className="w-full text-left border-collapse" {...props} />
                            </div>
                          ),
                          thead: ({...props}) => <thead className="bg-white/10" {...props} />,
                          th: ({...props}) => <th className="p-2 text-[11px] font-bold text-pitchy-cyan-light border-b border-white/10 uppercase tracking-wider" {...props} />,
                          td: ({...props}) => <td className="p-2 text-[12px] text-white/80 border-b border-white/5 last:border-0" {...props} />,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {isLoading && messages.length <= 1 && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-lg bg-pitchy-violet flex items-center justify-center shrink-0">
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            </div>
            <div className="bg-pitchy-violet/5 border border-pitchy-violet/20 text-white/40 rounded-2xl rounded-tl-sm px-4 py-2 text-sm italic animate-pulse">
              Pitchy думает...
            </div>
          </div>
        )}
      </div>

      {/* Hints */}
      {!isLoading && hints.length > 0 && (
        <div className="px-4 py-2 flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-2">
           {hints.map((hint, i) => (
             <button
               key={i}
               onClick={() => handleSend(hint)}
               className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-white/60 hover:text-white hover:bg-white/10 transition-all"
             >
               {hint}
             </button>
           ))}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-white/10 bg-black/20">
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={activeNode ? `Спросить про ${activeNode.label}...` : "Задайте вопрос..."}
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-4 pr-12 text-sm text-white focus:outline-none focus:border-pitchy-violet/50 transition-colors"
          />
          <button 
            onClick={() => isLoading ? stopGeneration() : handleSend()}
            disabled={(!input.trim() && !isLoading)}
            className={`absolute right-1 top-1 p-2 rounded-lg text-white transition-all ${isLoading ? 'bg-red-500 hover:bg-red-600' : 'bg-pitchy-violet hover:opacity-90 disabled:opacity-30'}`}
          >
            {isLoading ? <Square className="w-4 h-4 fill-white" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
