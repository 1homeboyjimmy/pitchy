"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { getToken } from "@/lib/auth";
import { postTreeChat, type TreeNodeResponse, type TreeEdgeResponse } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";

interface Message {
  role: "user" | "assistant";
  content: string;
  model?: string;
  timestamp: string;
}

interface TreeChatInterfaceProps {
  treeId: number;
  activeNode: TreeNodeResponse | null;
  onUpdateTree: (nodes: TreeNodeResponse[], readiness: number) => void;
  onClose: () => void;
}

export function TreeChatInterface({ treeId, activeNode, onUpdateTree, onClose }: TreeChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeNode && messages.length === 0) {
        setMessages([{
            role: "assistant",
            content: `Привет! Я Pitchy AI. Я готов помочь с узлом **"${activeNode.label}"**. Что именно мы хотим уточнить или рассчитать?`,
            timestamp: new Date().toISOString()
        }]);
    }
  }, [activeNode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: Message = {
      role: "user",
      content: input,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const token = getToken();
      if (!token) throw new Error("Unauthorized");

      const res = await postTreeChat(treeId, input, token, activeNode?.id);
      
      const assistantMsg: Message = {
        role: "assistant",
        content: res.reply,
        timestamp: new Date().toISOString(),
      };
      
      setMessages((prev) => [...prev, assistantMsg]);

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
  };

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
                : "bg-pitchy-violet/5 text-white/90 border border-pitchy-violet/20 rounded-tl-sm"
            }`}>
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown>
                  {msg.content}
                </ReactMarkdown>
              </div>
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
            onClick={handleSend}
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
