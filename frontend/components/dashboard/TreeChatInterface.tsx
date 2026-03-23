"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { getToken } from "@/lib/auth";
import { postTreeChat, getTreeChatHistory, type TreeNodeResponse } from "@/lib/api";
import { motion } from "framer-motion";

interface Message {
  role: "user" | "assistant";
  content: string;
  model_used?: string;
  timestamp: string;
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

  // Load history on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const token = getToken();
        if (!token) return;
        const res = await getTreeChatHistory(treeId, token);
        if (res.history && res.history.length > 0) {
          setMessages(res.history as Message[]);
        } else if (activeNode) {
          // Welcome message if no history
          setMessages([{
            role: "assistant",
            content: `Привет! Я Pitchy AI. Я готов помочь с узлом **"${activeNode.label}"**. Что именно мы хотим уточнить или рассчитать?`,
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

      const res = await postTreeChat(treeId, messageToSend, token, activeNode?.id);
      
      const assistantMsg: Message = {
        role: "assistant",
        content: res.reply,
        model_used: res.model,
        timestamp: new Date().toISOString(),
      };
      
      setMessages((prev) => [...prev, assistantMsg]);
      if (res.hints) setHints(res.hints);

      if (res.tree_data) {
        onUpdateTree(res.tree_data.nodes, res.readiness_index);
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
    }
  }, [input, isLoading, treeId, activeNode, onUpdateTree]);

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
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-white/10" : "bg-pitchy-violet"}`}>
              {msg.role === "user" ? <User className="w-4 h-4 text-white/70" /> : <Bot className="w-4 h-4 text-white" />}
            </div>
            <div className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed ${
              msg.role === "user" 
                ? "bg-white/5 text-white/90 border border-white/10 rounded-tr-sm" 
                : "bg-pitchy-violet/5 text-white/90 border border-pitchy-violet/20 rounded-tl-sm relative"
            }`}>
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown>
                  {msg.content}
                </ReactMarkdown>
              </div>
              {msg.role === "assistant" && msg.model_used && (
                <div className="mt-2 pt-2 border-t border-white/5 flex items-center gap-1.5 opacity-40 hover:opacity-100 transition-opacity">
                   <div className="w-1.5 h-1.5 rounded-full bg-pitchy-cyan animate-pulse" />
                   <span className="text-[9px] uppercase tracking-tighter font-bold">Processed by {msg.model_used}</span>
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
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
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="absolute right-1 top-1 p-2 bg-pitchy-violet rounded-lg text-white hover:opacity-90 disabled:opacity-30 transition-all"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
