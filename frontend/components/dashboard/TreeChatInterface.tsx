"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, Sparkles, X, Square, ChevronDown, ChevronUp, Atom, FileText, MessageSquare, CheckCircle2, AlertTriangle, Edit3 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getToken } from "@/lib/auth";
import { getTreeChatHistory, evaluateNode, type TreeNodeResponse, type TreeEdgeResponse } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";

interface Message {
  role: "user" | "assistant";
  content: string;
  model_used?: string;
  timestamp: string;
  thoughts?: string;
  thoughtTime?: number;
  thoughtExpanded?: boolean;
  client_id?: string;
}

interface TreeChatInterfaceProps {
  treeId: number;
  activeNode: TreeNodeResponse | null;
  onUpdateTree: (nodes: TreeNodeResponse[], readiness: number, edges?: TreeEdgeResponse[]) => void;
  onClose: () => void;
}

export function TreeChatInterface({ treeId, activeNode, onUpdateTree, onClose }: TreeChatInterfaceProps) {
  const [activeTab, setActiveTab] = useState<"analysis" | "chat">("analysis");
  const [messages, setMessages] = useState<Message[]>([]);
  const [hints, setHints] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize form data when node changes
  useEffect(() => {
    if (activeNode?.data?.form_data) {
      setFormData(activeNode.data.form_data);
    } else {
      setFormData({});
    }
    // Switch to analysis if node is selected
    if (activeNode) setActiveTab("analysis");
  }, [activeNode]);

  const handleFormChange = (id: string, value: string) => {
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleEvaluate = async () => {
    if (!activeNode || isEvaluating) return;
    setIsEvaluating(true);
    try {
      const token = getToken();
      if (!token) return;
      const res = await evaluateNode(treeId, activeNode.id, formData, token);
      onUpdateTree(res.tree_data.nodes, res.readiness_index, res.tree_data.edges);
      // Stay on analysis to show the feedback
    } catch (err) {
      console.error("Evaluation failed:", err);
    } finally {
      setIsEvaluating(false);
    }
  };

  // ——— Existing Chat Logic ———
  const getMsgKey = useCallback((m: Message) => {
    return (m.client_id || (m.timestamp ? new Date(m.timestamp).toISOString() : "no-time"));
  }, []);

  const mergeMessages = useCallback((current: Message[], incoming: Message[]) => {
    const map = new Map();
    incoming.forEach(inc => {
        const key = getMsgKey(inc);
        if (key) map.set(key, inc);
    });
    current.forEach(loc => {
        const key = getMsgKey(loc);
        if (!key) return;
        const serverMatch = map.get(key);
        if (serverMatch) {
            map.set(key, {
                ...serverMatch,
                content: (loc.content?.length || 0) > (serverMatch.content?.length || 0) ? loc.content : serverMatch.content,
                thoughts: loc.thoughts || serverMatch.thoughts,
                thoughtTime: loc.thoughtTime || serverMatch.thoughtTime,
                thoughtExpanded: loc.thoughtExpanded ?? serverMatch.thoughtExpanded
            });
        } else if (isLoading) {
            map.set(key, loc);
        }
    });
    return Array.from(map.values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [getMsgKey, isLoading]);

  useEffect(() => {
    const loadHistory = async () => {
      if (isLoading) return;
      try {
        const token = getToken();
        if (!token) return;
        const res = await getTreeChatHistory(treeId, token, activeNode?.id);
        if (res.history) {
          setMessages(prev => mergeMessages(prev, res.history as Message[]));
        } else if (activeNode) {
          setMessages(prev => {
            if (prev.length > 0) return prev;
            return [{
              role: "assistant",
              content: `Привет! Я Pitchy AI. Я готов помочь с разделом **"${activeNode.label}"**. Что именно мы хотим уточнить или рассчитать?`,
              timestamp: new Date().toISOString()
            }];
          });
        }
      } catch (err) { console.error(err); }
    };
    loadHistory();
  }, [treeId, activeNode, isLoading, mergeMessages]);

  const scrollToBottom = useCallback((force = false) => {
    if (scrollRef.current) {
        const container = scrollRef.current;
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
        if (isNearBottom || force) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    const isNewMessage = messages.length > 0 && isLoading && messages[messages.length - 1].content === "";
    if (isNewMessage) {
      scrollToBottom(true);
    } else {
      scrollToBottom();
    }
  }, [messages, isLoading, scrollToBottom]);

  const handleSend = useCallback(async (overrideMessage?: string) => {
    const messageToSend = overrideMessage || input;
    if (!messageToSend.trim() || isLoading) return;

    const userClientId = crypto.randomUUID();
    const assistantClientId = crypto.randomUUID();

    const userMsg: Message = { role: "user", content: messageToSend, timestamp: new Date().toISOString(), client_id: userClientId };
    setMessages((prev) => [...prev, userMsg]);
    if (!overrideMessage) setInput("");
    setIsLoading(true);

    try {
      const token = getToken();
      if (!token) throw new Error("Unauthorized");
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      let assistantContent = "";
      let fullThoughtContent = "";
      const now = new Date();
      
      setMessages((prev) => [...prev, { role: "assistant", content: "", timestamp: now.toISOString(), client_id: assistantClientId, thoughtExpanded: true }]);

      const { postTreeChatStream } = await import("@/lib/api");
      const stableKey = now.getTime();
      
      for await (const chunk of postTreeChatStream(treeId, messageToSend, token, activeNode?.id, abortController.signal, userClientId, assistantClientId)) {
        if (chunk.type === "thought") {
          fullThoughtContent += chunk.content;
          setMessages(prev => prev.map(m => m.client_id === assistantClientId ? { ...m, thoughts: fullThoughtContent } : m));
        } else if (chunk.type === "chunk") {
          let durationUpdate = {};
          if (!assistantContent && fullThoughtContent) {
              durationUpdate = { thoughtTime: Math.round((Date.now() - stableKey) / 1000) };
          }
          assistantContent += chunk.content;
          setMessages((prev) => prev.map(m => m.client_id === assistantClientId ? { ...m, content: assistantContent, ...durationUpdate } : m));
        } else if (chunk.type === "metadata") {
          setMessages((prev) => prev.map(m => m.client_id === assistantClientId ? { ...m, model_used: chunk.model } : m));
        } else if (chunk.type === "tree_update") {
          onUpdateTree(chunk.data.nodes, chunk.data.readiness_index, chunk.data.edges);
        } else if (chunk.type === "final") {
          if (chunk.hints) setHints(chunk.hints);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 400));
      const res = await getTreeChatHistory(treeId, token, activeNode?.id);
      if (res.history) setMessages((prev) => mergeMessages(prev, res.history as Message[]));
    } catch (error) {
      console.error(error);
      setMessages((prev) => [...prev, { role: "assistant", content: "Ошибка. Попробуйте позже.", timestamp: new Date().toISOString() }]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [input, isLoading, treeId, activeNode, onUpdateTree, mergeMessages]);

  const stopGeneration = () => { if (abortControllerRef.current) { abortControllerRef.current.abort(); setIsLoading(false); abortControllerRef.current = null; } };

  return (
    <div className="flex flex-col h-full bg-[#0c0a1a]/95 backdrop-blur-2xl border-l border-white/10 w-[400px] shadow-2xl relative overflow-hidden">
      
      {/* Header & Tabs */}
      <div className="pt-5 px-4 pb-0 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-pitchy-violet/20 flex items-center justify-center text-pitchy-violet">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white leading-none">Управление узлом</h3>
              <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold mt-1 truncate max-w-[180px]">
                {activeNode?.label || "Выберите узел"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex p-1 bg-black/40 rounded-xl mb-4 border border-white/5">
          <button 
            onClick={() => setActiveTab("analysis")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all ${activeTab === "analysis" ? "bg-pitchy-violet text-white shadow-lg" : "text-white/40 hover:text-white/70"}`}
          >
            <FileText className="w-3.5 h-3.5" />
            Анализ
          </button>
          <button 
            onClick={() => setActiveTab("chat")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all ${activeTab === "chat" ? "bg-white/10 text-white shadow-lg" : "text-white/40 hover:text-white/70"}`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Помощник
          </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === "analysis" ? (
            /* ANALYSIS TAB */
            <motion.div 
              key="analysis"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full flex flex-col p-5 overflow-y-auto space-y-6 scrollbar-thin scrollbar-thumb-white/10"
            >
              {activeNode ? (
                <>
                  {activeNode.status === "completed" ? (
                    /* Completed State View */
                    <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
                      <div className="p-4 rounded-2xl bg-[#10B981]/10 border border-[#10B981]/20">
                         <h4 className="flex items-center gap-2 text-[#10B981] font-bold text-sm mb-3">
                           <CheckCircle2 className="w-4 h-4" /> Узел проанализирован
                         </h4>
                         {activeNode.data.feedback && (
                           <p className="text-sm text-white/80 leading-relaxed italic border-l-2 border-[#10B981]/40 pl-3">
                             {activeNode.data.feedback}
                           </p>
                         )}
                      </div>

                      {activeNode.data.summary && (
                        <div className="space-y-3">
                          <h5 className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Результаты анализа</h5>
                          <div className="grid grid-cols-1 gap-2">
                             {Object.entries(activeNode.data.summary).map(([key, val]) => (
                               <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                                 <span className="text-xs text-white/40">{key}</span>
                                 <span className="text-xs text-white font-medium">{val}</span>
                               </div>
                             ))}
                          </div>
                        </div>
                      )}

                      <button 
                        onClick={() => {
                          // Locally reset status to allow editing
                        }}
                        className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-white/60 text-xs font-semibold hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                      >
                        <Edit3 className="w-3.5 h-3.5" /> Редактировать данные
                      </button>
                    </div>
                  ) : (
                    /* Active/Empty State - Form Entry */
                    <div className="space-y-6">
                      <div className="space-y-1">
                        <p className="text-sm text-white/70 leading-relaxed">
                          {activeNode.data.description || "Заполните данные для анализа этого этапа."}
                        </p>
                      </div>

                      {/* Dynamic Form */}
                      <div className="space-y-5">
                        {activeNode.data.form_schema?.map((field) => (
                          <div key={field.id} className="space-y-2">
                            <label className="text-[11px] font-bold uppercase tracking-wider text-white/40 flex items-center gap-1.5">
                              {field.label}
                              {field.required && <span className="text-red-500">*</span>}
                            </label>
                            {field.type === "textarea" ? (
                              <textarea 
                                value={formData[field.id] || ""}
                                onChange={(e) => handleFormChange(field.id, e.target.value)}
                                placeholder={field.placeholder}
                                className="w-full min-h-[100px] bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-pitchy-violet/50 transition-all resize-none"
                              />
                            ) : (
                              <input 
                                type={field.type}
                                value={formData[field.id] || ""}
                                onChange={(e) => handleFormChange(field.id, e.target.value)}
                                placeholder={field.placeholder}
                                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-pitchy-violet/50 transition-all"
                              />
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="pt-4 flex flex-col gap-3">
                        <button 
                          onClick={handleEvaluate}
                          disabled={isEvaluating}
                          className="w-full py-4 rounded-2xl bg-gradient-to-r from-pitchy-violet to-purple-600 text-white font-bold text-sm shadow-[0_4px_15px_rgba(168,85,247,0.3)] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                        >
                          {isEvaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                          Проанализировать узел
                        </button>
                        <button 
                          onClick={() => setActiveTab("chat")}
                          className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-white/40 text-xs font-semibold hover:text-white hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          Помоги мне заполнить (Чат)
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-white/20">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <p className="text-sm text-white/30">Выберите узел на карте,<br/>чтобы начать работу.</p>
                </div>
              )}
            </motion.div>
          ) : (
            /* CHAT TAB */
            <motion.div 
              key="chat"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="h-full flex flex-col overflow-hidden"
            >
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-white/10">
                {messages.map((msg, idx) => {
                  const hasThoughts = msg.thoughts !== undefined;
                  const userMessagesBefore = messages.slice(0, idx).filter(m => m.role === "user").length;
                  const showThoughts = hasThoughts && userMessagesBefore > 1;
                  const hasContent = msg.content && msg.content.length > 0;
                  const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1;
                  const shouldRenderMainBubble = msg.role === "user" || hasContent;

                  return (
                    <div key={getMsgKey(msg)} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-white/10" : "bg-pitchy-violet"}`}>
                        {msg.role === "user" ? <User className="w-4 h-4 text-white/70" /> : <Bot className="w-4 h-4 text-white" />}
                      </div>
                      <div className={`max-w-[90%] flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                        {msg.role === "assistant" && showThoughts && (
                          <div className="w-full bg-transparent overflow-hidden self-start">
                            <button onClick={() => setMessages(prev => prev.map((m, i) => (m.client_id || i) === (msg.client_id || idx) ? { ...m, thoughtExpanded: !m.thoughtExpanded } : m))} className="flex items-center gap-2 px-1 py-1 text-[10px] text-white/40 hover:text-white/60 transition-colors">
                                <Atom className={`w-3.5 h-3.5 ${isLoading && isLastAssistant && !msg.thoughtTime ? "animate-spin" : "text-pitchy-violet"}`} />
                                <span className="font-medium uppercase tracking-wider">{msg.thoughtTime ? `Размышления (${msg.thoughtTime} сек)` : "Pitchy рассуждает..."}</span>
                                {msg.thoughtExpanded ? <ChevronUp className="w-3.5 h-3.5 ml-auto text-white/20" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto text-white/20" />}
                            </button>
                            <motion.div initial={false} animate={{ height: msg.thoughtExpanded ? "auto" : 0, opacity: msg.thoughtExpanded ? 1 : 0 }} className="overflow-hidden">
                                <div className="mt-1 mb-2 p-3 bg-white/5 rounded-xl border border-white/10 text-[12px] leading-relaxed text-white/50 italic whitespace-pre-wrap">{msg.thoughts}</div>
                            </motion.div>
                          </div>
                        )}
                        {msg.role === "assistant" && !hasContent && !showThoughts && isLoading && isLastAssistant && (
                          <div className="flex items-center gap-3 p-3 bg-white/5 rounded-2xl border border-white/10 text-white/50 italic animate-pulse">
                            <Loader2 className="animate-spin h-3.5 w-3.5 text-pitchy-violet" />
                            <span className="text-[12px]">Я анализирую ситуацию...</span>
                          </div>
                        )}
                        {shouldRenderMainBubble && (
                          <div className={`p-3 rounded-2xl text-sm leading-relaxed ${msg.role === "user" ? "bg-white/5 text-white/90 border border-white/10 rounded-tr-sm" : "bg-pitchy-violet/5 text-white/90 border border-pitchy-violet/20 rounded-tl-sm relative"}`}>
                            <div className="prose prose-invert prose-sm max-w-none text-white/80">
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                                table: ({...props}) => (<div className="my-3 overflow-x-auto rounded-xl border border-white/10 bg-white/5"><table className="w-full text-left border-collapse" {...props} /></div>),
                                thead: ({...props}) => <thead className="bg-white/10" {...props} />,
                                th: ({...props}) => <th className="p-2 text-[11px] font-bold text-pitchy-cyan-light border-b border-white/10 uppercase tracking-wider" {...props} />,
                                td: ({...props}) => <td className="p-2 text-[12px] text-white/80 border-b border-white/5 last:border-0" {...props} />,
                              }}>
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Hints */}
              {!isLoading && hints.length > 0 && (
                <div className="px-4 py-2 flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-2">
                   {hints.map((hint, i) => (
                     <button key={i} onClick={() => handleSend(hint)} className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-white/60 hover:text-white hover:bg-white/10 transition-all font-medium">{hint}</button>
                   ))}
                </div>
              )}

              {/* Input Area */}
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
