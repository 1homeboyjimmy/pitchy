"use client";

import React, { useRef, useEffect } from "react";
import { Send, Square, Globe, Activity, FileText, DownloadCloud, Paperclip, Database, Mic, ArrowUp, X, Sparkles } from "lucide-react";
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
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 56), 192)}px`;
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim() && !isLoading) {
        onSend();
      }
    }
  };

  return (
    <div className="relative w-full max-w-4xl mx-auto">
      {/* Agent Mode Banner */}
      <AnimatePresence>
        {isPresentationMode && (
          <motion.div
            initial={{ opacity: 0, y: 20, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 10, height: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="mb-4 sm:mb-6 overflow-hidden px-3 sm:px-6"
          >
            <div className="relative rounded-2xl sm:rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 sm:p-6 backdrop-blur-2xl group overflow-hidden shadow-2xl shadow-white/5">
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
              <div className="absolute -top-24 -right-24 w-48 h-48 bg-white/5 blur-[60px] rounded-full group-hover:bg-white/10 transition-colors duration-700" />

              {/* Close button — always positioned at the top-right, regardless of layout */}
              <button
                onClick={() => onCancelPresentationMode?.()}
                className="absolute top-3 right-3 sm:top-4 sm:right-4 z-20 p-2 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all active:scale-90"
                title="Отменить"
                aria-label="Отменить"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.5} />
              </button>

              <div className="flex items-start gap-3 sm:gap-5 relative z-10 pr-8">
                <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-[1.25rem] bg-white text-black flex items-center justify-center flex-shrink-0 shadow-xl shadow-white/10">
                  <Sparkles className="w-4 h-4 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-sans text-[15px] sm:text-xl text-white font-semibold flex flex-wrap items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2 tracking-tight leading-tight">
                    <span>Режим генерации презентации</span>
                    <span className="text-[8px] sm:text-[9px] font-mono uppercase px-1.5 sm:px-2 py-0.5 rounded-full bg-white/10 text-white/60 tracking-[0.2em] font-bold border border-white/5 whitespace-nowrap">Agent v1</span>
                  </h4>
                  <p className="text-[12px] sm:text-[14px] text-white/40 leading-relaxed font-light">
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
            <div className="absolute -inset-[1px] bg-white/10 rounded-3xl sm:rounded-[2rem] blur-sm opacity-0 group-focus-within:opacity-100 transition duration-700 pointer-events-none"></div>
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
                className="flex-1 min-w-0 bg-transparent border-none py-3 sm:py-4 px-3 sm:px-6 text-white focus:outline-none focus:ring-0 resize-none font-sans text-[15px] sm:text-[16px] min-h-[52px] sm:min-h-[60px] max-h-48 placeholder:text-white/20 leading-relaxed selection:bg-white/20"
                rows={1}
            ></textarea>
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

        <div className="flex flex-nowrap sm:flex-wrap gap-2 mt-3 sm:mt-4 sm:ml-4 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              onClick={onOpenImportModal}
              className="lovable-glass-strong border border-white/5 px-4 py-1.5 rounded-full text-[10px] font-mono text-white/30 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2 uppercase tracking-[0.2em] font-bold active:scale-95 whitespace-nowrap shrink-0"
            >
              <Paperclip className="w-3.5 h-3.5" strokeWidth={1.5} /> Контекст
            </button>
            <button
              onClick={onToggleDeepSearch}
              className={`lovable-glass-strong border px-4 py-1.5 rounded-full text-[10px] font-mono transition-all flex items-center gap-2 uppercase tracking-[0.2em] font-bold active:scale-95 whitespace-nowrap shrink-0 ${
                useDeepSearch ? "text-white border-white/20 bg-white/10" : "text-white/30 border-white/5 hover:text-white hover:bg-white/5"
              }`}
            >
              <Database className="w-3.5 h-3.5" strokeWidth={1.5} /> Web-поиск
            </button>
            <button
              onClick={onToggleResearchMode}
              className={`lovable-glass-strong border px-4 py-1.5 rounded-full text-[10px] font-mono transition-all flex items-center gap-2 uppercase tracking-[0.2em] font-bold active:scale-95 whitespace-nowrap shrink-0 ${
                isResearchMode ? "text-white border-white/20 bg-white/10 shadow-[0_0_15px_rgba(255,255,255,0.05)]" : "text-white/30 border-white/5 hover:text-white hover:bg-white/5"
              }`}
            >
              <Activity className="w-3.5 h-3.5" strokeWidth={1.5} /> Deep Research
            </button>
            {!isPresentationMode && (
                <button
                    onClick={onTogglePresentationMode}
                    className="lovable-glass-strong border border-white/5 px-4 py-1.5 rounded-full text-[10px] font-mono text-white/30 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2 uppercase tracking-[0.2em] font-bold active:scale-95 whitespace-nowrap shrink-0"
                >
                    <FileText className="w-3.5 h-3.5" strokeWidth={1.5} /> Слайды
                </button>
            )}
        </div>
      </div>
    </div>
  );
}
