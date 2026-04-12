
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, 
  BookOpen, 
  Trash2, 
  Clock, 
  Plus, 
  Loader, 
  Globe, 
  FileText, 
  ChevronRight,
  ExternalLink,
  Zap,
  Shield,
  ArrowRight
} from "react-feather";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { 
  getToolsHistory, 
  deleteToolResult, 
  toolQuickSearch, 
  toolDeepResearch, 
  ToolResultResponse 
} from "@/lib/api";
import { getToken } from "@/lib/auth";
import dayjs from "dayjs";
import "dayjs/locale/ru";

export function ToolsView() {
  const [history, setHistory] = useState<ToolResultResponse[]>([]);
  const [activeResult, setActiveResult] = useState<ToolResultResponse | null>(null);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"search" | "research">("search");
  const [historyLoading, setHistoryLoading] = useState(true);

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const token = getToken();
      if (!token) return;
      const data = await getToolsHistory(token);
      setHistory(data);
    } catch (e) {
      console.error(e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleAction = async () => {
    if (!query.trim() || isLoading) return;
    setIsLoading(true);
    
    try {
      const token = getToken();
      if (!token) throw new Error("Unauthorized");

      let result: ToolResultResponse;
      if (mode === "search") {
        result = await toolQuickSearch(query, token);
      } else {
        result = await toolDeepResearch(query, token);
      }

      setHistory(prev => [result, ...prev]);
      setActiveResult(result);
      setQuery("");
    } catch (e) {
      console.error(e);
      alert("Ошибка при выполнении запроса");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm("Удалить этот результат из истории?")) return;

    try {
      const token = getToken();
      if (!token) return;
      await deleteToolResult(id, token);
      setHistory(prev => prev.filter(item => item.id !== id));
      if (activeResult?.id === id) setActiveResult(null);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex h-full bg-[#131313] rounded-2xl border border-white/10 overflow-hidden relative">
      <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />

      {/* Sidebar: History */}
      <div className="w-64 sm:w-80 border-r border-white/10 flex flex-col bg-black/20 z-10">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-pitchy-violet" />
            <h3 className="font-bold text-white text-sm">История</h3>
          </div>
          <button 
            onClick={() => setActiveResult(null)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 transition-colors"
            title="Новый запрос"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {historyLoading ? (
            <div className="flex justify-center p-8">
              <Loader className="w-5 h-5 animate-spin text-white/20" />
            </div>
          ) : history.length === 0 ? (
            <div className="p-8 text-center text-white/20 text-xs">
              История пуста
            </div>
          ) : (
            history.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => setActiveResult(item)}
                className={`
                  group p-3 rounded-xl cursor-pointer transition-all duration-200 relative
                  ${activeResult?.id === item.id 
                    ? "bg-pitchy-violet/20 border border-pitchy-violet/30" 
                    : "bg-transparent border border-transparent hover:bg-white/5"}
                `}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${item.tool_type === "deep-research" ? "text-pitchy-violet" : "text-pitchy-cyan"}`}>
                      {item.tool_type === "deep-research" ? "Research" : "Search"}
                    </span>
                    <span className="text-[10px] text-white/30">
                      {dayjs(item.created_at).format("D MMM")}
                    </span>
                  </div>
                  <p className="text-sm text-white/80 font-medium line-clamp-2 leading-relaxed">
                    {item.query}
                  </p>
                </div>
                
                <button
                  onClick={(e) => handleDelete(e, item.id)}
                  className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-red-500/0 group-hover:bg-red-500/10 text-red-500/0 group-hover:text-red-500/60 transition-all hover:!text-red-500 hover:!bg-red-500/20"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            ))
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 z-10 relative">
        <AnimatePresence mode="wait">
          {!activeResult ? (
            /* New Request View */
            <motion.div 
              key="new"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 text-center"
            >
              <div className="max-w-2xl w-full">
                <div className="mb-8 inline-flex p-3 rounded-2xl bg-pitchy-violet/10 border border-pitchy-violet/20">
                  <BookOpen className="w-8 h-8 text-pitchy-violet" />
                </div>
                <h1 className="text-3xl font-bold text-white mb-4">Инструменты Анализа</h1>
                <p className="text-white/50 mb-12 leading-relaxed">
                  Используйте агентов для быстрого поиска новостей или запуска глубокого многоэтапного исследования рынков и конкурентов.
                </p>

                {/* Mode Selector */}
                <div className="flex p-1 bg-white/5 rounded-2xl border border-white/10 mb-8 max-w-sm mx-auto">
                  <button 
                    onClick={() => setMode("search")}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl transition-all font-medium text-sm ${mode === "search" ? "bg-pitchy-violet text-white shadow-lg" : "text-white/40 hover:text-white/60"}`}
                  >
                    <Search className="w-4 h-4" />
                    Быстрый поиск
                  </button>
                  <button 
                    onClick={() => setMode("research")}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl transition-all font-medium text-sm ${mode === "research" ? "bg-pitchy-violet text-white shadow-lg" : "text-white/40 hover:text-white/60"}`}
                  >
                    <Zap className="w-4 h-4" />
                    Исследование
                  </button>
                </div>

                {/* Main Input */}
                <div className="relative group">
                  <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={mode === "search" ? "Что нужно найти?" : "Опишите тему для глубокого исследования..."}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-6 pr-16 text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-pitchy-violet/40 focus:border-pitchy-violet/60 transition-all min-h-[140px] resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleAction();
                      }
                    }}
                  />
                  <div className="absolute bottom-4 right-4 flex items-center gap-3">
                     <button
                        onClick={handleAction}
                        disabled={!query.trim() || isLoading}
                        className={`p-3 rounded-xl transition-all ${!query.trim() || isLoading ? "bg-white/5 text-white/20" : "bg-pitchy-violet text-white hover:scale-105 active:scale-95 shadow-xl shadow-pitchy-violet/20"}`}
                      >
                        {isLoading ? <Loader className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                      </button>
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2 mb-2 text-pitchy-cyan text-sm font-bold">
                      <Globe className="w-4 h-4" />
                      <span>ЛОКАЛЬНОСТЬ</span>
                    </div>
                    <p className="text-xs text-white/40 leading-relaxed">Результаты фильтруются с учетом специфики российского рынка и актуальных данных.</p>
                  </div>
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2 mb-2 text-pitchy-violet text-sm font-bold">
                      <Shield className="w-4 h-4" />
                      <span>АГЕНТНОСТЬ</span>
                    </div>
                    <p className="text-xs text-white/40 leading-relaxed">Режим исследования запускает цепочку действий: поиск -> анализ -> синтез отчета.</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            /* Results View */
            <motion.div 
              key={activeResult.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 flex flex-col min-h-0 bg-black/10"
            >
              {/* Header */}
              <div className="p-6 border-b border-white/10 bg-[#131313] backdrop-blur-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    {activeResult.tool_type === "deep-research" ? <Zap className="w-5 h-5 text-pitchy-violet" /> : <Search className="w-5 h-5 text-pitchy-cyan" />}
                    <h2 className="text-xl font-bold text-white line-clamp-1">{activeResult.query}</h2>
                  </div>
                  <div className="text-xs text-white/30 flex items-center gap-2">
                    <span className="uppercase tracking-widest font-bold text-pitchy-violet/60">{activeResult.tool_type}</span>
                    <span>•</span>
                    <span>{dayjs(activeResult.created_at).format("D MMMM YYYY, HH:mm")}</span>
                  </div>
                </div>
                <button 
                  onClick={() => setActiveResult(null)}
                  className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 text-sm font-medium transition-all"
                >
                  Новый поиск
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-6 sm:p-10 custom-scrollbar">
                <div className="max-w-4xl mx-auto">
                  {/* Results Text */}
                  <div className="prose prose-invert prose-pitchy max-w-none mb-12 text-white/90 leading-relaxed">
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({...props}) => <h1 className="text-3xl font-bold text-white mt-8 mb-4 border-b border-white/10 pb-4" {...props} />,
                        h2: ({...props}) => <h2 className="text-2xl font-bold text-pitchy-cyan mt-8 mb-4" {...props} />,
                        h3: ({...props}) => <h3 className="text-xl font-bold text-white mt-6 mb-3" {...props} />,
                        p: ({...props}) => <p className="mb-6 opacity-90" {...props} />,
                        ul: ({...props}) => <ul className="list-disc pl-6 mb-6 space-y-2 opacity-90" {...props} />,
                        li: ({...props}) => <li className="pl-1" {...props} />,
                        table: ({...props}) => (
                          <div className="my-8 overflow-x-auto rounded-xl border border-white/10 bg-white/5">
                            <table className="w-full text-left border-collapse" {...props} />
                          </div>
                        ),
                        thead: ({...props}) => <thead className="bg-white/10" {...props} />,
                        th: ({...props}) => <th className="p-4 text-sm font-bold text-pitchy-cyan-light border-b border-white/10" {...props} />,
                        td: ({...props}) => <td className="p-4 text-sm text-white/80 border-b border-white/5 last:border-0" {...props} />,
                      }}
                    >
                      {activeResult.content}
                    </ReactMarkdown>
                  </div>

                  {/* Sources Section */}
                  {activeResult.sources && activeResult.sources.length > 0 && (
                    <div className="mt-12 pt-12 border-t border-white/10">
                      <div className="flex items-center gap-3 mb-8">
                        <div className="w-10 h-10 rounded-xl bg-pitchy-violet/10 flex items-center justify-center">
                          <Globe className="w-5 h-5 text-pitchy-violet" />
                        </div>
                        <h3 className="text-2xl font-bold text-white">Использованные источники</h3>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {activeResult.sources.map((source, i) => (
                          <a 
                            key={i}
                            href={source.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all group relative overflow-hidden"
                          >
                            <div className="flex items-start gap-4 mb-2">
                              <div className="shrink-0 p-2 rounded-lg bg-black/40 text-pitchy-cyan group-hover:scale-110 transition-transform">
                                <FileText className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-sm font-bold text-white group-hover:text-pitchy-cyan transition-colors line-clamp-1">
                                  {source.title || "Источник данных"}
                                </h4>
                                <p className="text-[10px] text-white/30 truncate mt-1">{source.url}</p>
                              </div>
                            </div>
                            <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <ExternalLink className="w-3.5 h-3.5 text-white/30" />
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        .prose-pitchy {
          font-size: 1rem;
        }
        @media (min-width: 640px) {
          .prose-pitchy {
            font-size: 1.05rem;
          }
        }
      `}</style>
    </div>
  );
}
