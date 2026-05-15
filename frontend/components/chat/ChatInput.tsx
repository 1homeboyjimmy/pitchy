"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  Square, Globe, Activity, FileText, Paperclip,
  ArrowUp, X, Sparkles, Wrench, Check, ChevronDown, Lock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ChatInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  isLoading: boolean;
  onStop?: () => void;
  placeholder?: string;
  disabled?: boolean;
  useDeepSearch?: boolean;
  onToggleDeepSearch?: () => void;
  isResearchMode?: boolean;
  onToggleResearchMode?: () => void;
  onOpenImportModal?: () => void;
  isPresentationMode?: boolean;
  onTogglePresentationMode?: () => void;
  onCancelPresentationMode?: () => void;
  // Tools that are visible but locked behind a paid tier. Clicking a
  // locked tool calls `onLockedTool` instead of running the action.
  lockedTools?: {
    deepSearch?: boolean;
    research?: boolean;
    presentation?: boolean;
    importContext?: boolean;
  };
  onLockedTool?: (toolKey: "deepSearch" | "research" | "presentation" | "importContext") => void;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  isLoading,
  onStop,
  placeholder = "Задайте вопрос Pitchy...",
  disabled = false,
  useDeepSearch = false,
  onToggleDeepSearch,
  isResearchMode = false,
  onToggleResearchMode,
  onOpenImportModal,
  isPresentationMode = false,
  onTogglePresentationMode,
  onCancelPresentationMode,
  lockedTools = {},
  onLockedTool,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const [toolsOpen, setToolsOpen] = useState(false);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 56), 192)}px`;
    }
  }, [value]);

  // Close tools menu on outside click / escape
  useEffect(() => {
    if (!toolsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setToolsOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [toolsOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim() && !isLoading) {
        onSend();
      }
    }
  };

  const activeToolsCount = [useDeepSearch, isResearchMode, isPresentationMode].filter(Boolean).length;

  const runHandler = useCallback((fn?: () => void) => {
    if (fn) fn();
    setToolsOpen(false);
  }, []);

  type ToolKey = "deepSearch" | "research" | "presentation" | "importContext";
  type ToolEntry = {
    key: string;
    lockKey: ToolKey;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    title: string;
    subtitle: string;
    active: boolean;
    locked: boolean;
    onClick?: () => void;
  };

  const tools: ToolEntry[] = [
    {
      key: "context",
      lockKey: "importContext",
      icon: Paperclip,
      title: "Импорт контекста",
      subtitle: "Загрузить описание проекта или прошлый питч-дек",
      active: false,
      locked: !!lockedTools.importContext,
      onClick: onOpenImportModal,
    },
    {
      key: "web",
      lockKey: "deepSearch",
      icon: Globe,
      title: "Поиск в интернете",
      subtitle: "Подтянуть свежие данные и источники из сети",
      active: useDeepSearch,
      locked: !!lockedTools.deepSearch,
      onClick: onToggleDeepSearch,
    },
    {
      key: "research",
      lockKey: "research",
      icon: Activity,
      title: "Глубокое исследование",
      subtitle: "Развёрнутый отчёт с многошаговым анализом",
      active: isResearchMode,
      locked: !!lockedTools.research,
      onClick: onToggleResearchMode,
    },
    {
      key: "slides",
      lockKey: "presentation",
      icon: FileText,
      title: "Сгенерировать слайды",
      subtitle: "Собрать инвестиционную презентацию",
      active: isPresentationMode,
      locked: !!lockedTools.presentation,
      onClick: onTogglePresentationMode,
    },
  ];

  return (
    <div className="relative w-full max-w-5xl mx-auto">
      {/* Agent Mode Banner */}
      <AnimatePresence>
        {isPresentationMode && (
          <motion.div
            initial={{ opacity: 0, y: 20, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: 10, height: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="mb-4 sm:mb-6 overflow-hidden px-3 sm:px-6"
          >
            <div className="relative rounded-2xl sm:rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 sm:p-6 backdrop-blur-2xl group overflow-hidden shadow-2xl shadow-white/5">
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
              <div className="absolute -top-24 -right-24 w-48 h-48 bg-white/5 blur-[60px] rounded-full group-hover:bg-white/10 transition-colors duration-700" />

              <button
                onClick={() => onCancelPresentationMode?.()}
                className="absolute top-3 right-3 sm:top-4 sm:right-4 z-20 p-2 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all active:scale-90"
                title="Отменить"
                aria-label="Отменить"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.5} />
              </button>

              <div className="flex items-start gap-3 sm:gap-5 relative z-10 pr-8">
                <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-xl sm:rounded-[1.1rem] bg-white text-black flex items-center justify-center flex-shrink-0 shadow-xl shadow-white/10">
                  <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-sans text-[14px] sm:text-lg text-white font-semibold flex flex-wrap items-center gap-2 sm:gap-3 mb-1 sm:mb-1.5 tracking-tight leading-tight">
                    <span>Режим генерации презентации</span>
                    <span className="text-[8px] sm:text-[9px] font-mono uppercase px-1.5 sm:px-2 py-0.5 rounded-full bg-white/10 text-white/60 tracking-[0.2em] font-bold border border-white/5 whitespace-nowrap">Agent v1</span>
                  </h4>
                  <p className="text-[11px] sm:text-[13px] text-white/40 leading-relaxed font-light">
                    Опишите тему, ключевые тезисы и стиль вашей презентации.
                    Pitchy автоматически спроектирует структуру и наполнит слайды контентом.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-3 sm:px-6">
        <div className="relative group">
          <div className="absolute -inset-[1px] bg-white/10 rounded-3xl sm:rounded-[2rem] blur-sm opacity-0 group-focus-within:opacity-100 transition duration-700 pointer-events-none" />
          <div className={`relative bg-black/40 backdrop-blur-3xl border rounded-3xl sm:rounded-[2rem] p-2 sm:p-3 flex items-end gap-2 sm:gap-3 transition-all duration-500 shadow-2xl ${
            isPresentationMode ? "border-white/30 bg-white/[0.02]" : "border-white/5 focus-within:border-white/20"
          } ${disabled ? "opacity-40" : ""}`}>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={onChange}
              onKeyDown={handleKeyDown}
              placeholder={isPresentationMode ? "Опишите идею для вашей презентации..." : placeholder}
              disabled={disabled}
              className="flex-1 min-w-0 bg-transparent border-none py-3 sm:py-4 px-3 sm:px-5 text-white focus:outline-none focus:ring-0 resize-none font-sans text-[15px] sm:text-[16px] min-h-[52px] sm:min-h-[60px] max-h-48 placeholder:text-white/20 leading-relaxed selection:bg-white/20"
              rows={1}
            />
            <div className="flex items-center gap-2 mb-1.5 sm:mb-2 mr-1 sm:mr-2 shrink-0">
              {isLoading ? (
                <button
                  onClick={onStop}
                  className="bg-white/10 text-white border border-white/20 h-10 w-10 sm:h-12 sm:w-12 flex items-center justify-center rounded-xl sm:rounded-2xl hover:bg-white/20 active:scale-90 transition-all shadow-lg shadow-black/20"
                >
                  <Square className="w-4 h-4 fill-white" />
                </button>
              ) : (
                <button
                  onClick={onSend}
                  disabled={disabled || !value.trim()}
                  className={`h-10 w-10 sm:h-12 sm:w-12 flex items-center justify-center rounded-xl sm:rounded-2xl transition-all shadow-lg ${
                    value.trim() && !disabled
                      ? "bg-white text-black hover:scale-105 active:scale-90 shadow-white/5"
                      : "bg-white/5 text-white/10 cursor-not-allowed border border-white/5"
                  }`}
                >
                  <ArrowUp className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tools row — below the input. Keeps textarea full-width in
            narrow containers (tree drawer, mobile). Dropdown opens upward. */}
        <div ref={toolsRef} className="relative mt-2 sm:mt-3 ml-1">
          <button
            type="button"
            onClick={() => setToolsOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={toolsOpen}
            className={`h-9 px-3 flex items-center gap-2 rounded-full border transition-all active:scale-95 ${
              activeToolsCount > 0 || toolsOpen
                ? "bg-white/10 text-white border-white/20"
                : "bg-white/[0.03] text-white/60 border-white/5 hover:bg-white/5 hover:text-white"
            }`}
            title="Инструменты"
          >
            <Wrench className="w-3.5 h-3.5" strokeWidth={1.8} />
            <span className="text-[12px] font-medium tracking-tight">Инструменты</span>
            {activeToolsCount > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-white text-black font-bold leading-none">
                {activeToolsCount}
              </span>
            )}
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${toolsOpen ? "rotate-180" : ""}`} strokeWidth={2} />
          </button>

          <AnimatePresence>
            {toolsOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                role="menu"
                className="absolute left-0 bottom-full mb-2 w-[min(380px,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#0e0e0e]/95 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden z-30"
              >
                <div className="p-1.5">
                  {tools.map(({ key, lockKey, icon: Icon, title, subtitle, active, locked, onClick }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        if (locked) {
                          setToolsOpen(false);
                          onLockedTool?.(lockKey);
                          return;
                        }
                        runHandler(onClick);
                      }}
                      role="menuitemcheckbox"
                      aria-checked={active}
                      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                        locked
                          ? "hover:bg-amber-500/[0.06]"
                          : active
                            ? "bg-white/[0.08]"
                            : "hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        locked
                          ? "bg-amber-500/[0.08] text-amber-400/70"
                          : active
                            ? "bg-white text-black"
                            : "bg-white/[0.06] text-white/70"
                      }`}>
                        <Icon className="w-4 h-4" strokeWidth={1.8} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[13px] font-medium tracking-tight ${
                            locked ? "text-white/55" : active ? "text-white" : "text-white/85"
                          }`}>
                            {title}
                          </span>
                          {locked
                            ? <Lock className="w-3 h-3 text-amber-400/70" strokeWidth={2.4} />
                            : active
                              ? <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                              : null}
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-white/40">
                          {locked ? "Доступно на тарифах Starter и Pro" : subtitle}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
