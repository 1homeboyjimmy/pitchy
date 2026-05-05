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
            className="mb-6 overflow-hidden px-6"
          >
            <div className="relative rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 backdrop-blur-2xl group overflow-hidden shadow-2xl shadow-white/5">
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
              <div className="absolute -top-24 -right-24 w-48 h-48 bg-white/5 blur-[60px] rounded-full group-hover:bg-white/10 transition-colors duration-700" />
              
              <div className="flex items-start justify-between gap-6 relative z-10">
                <div className="flex items-start gap-5">
                  <div className="w-14 h-14 rounded-[1.25rem] bg-white text-black flex items-center justify-center flex-shrink-0 shadow-xl shadow-white/10">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-xl text-white flex items-center gap-3 mb-2 tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>
                      Режим генерации презентации
                      <span className="text-[9px] font-mono uppercase px-2 py-0.5 rounded-full bg-white/10 text-white/60 tracking-[0.2em] font-bold border border-white/5">Agent v1</span>
                    </h4>
                    <p className="text-[14px] text-white/40 leading-relaxed font-light">
                      Опишите тему, ключевые тезисы и стиль вашей презентации.
                      Pitchy автоматически спроектирует структуру и наполнит слайды контентом.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => onCancelPresentationMode?.()}
                  className="p-2 rounded-full text-white/20 hover:text-white hover:bg-white/5 transition-all flex-shrink-0 active:scale-90"
                  title="Отменить"
                >
                  <X className="w-5 h-5" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-6">
        <div className="relative group">
            <div className="absolute -inset-[1px] bg-white/10 rounded-[2rem] blur-sm opacity-0 group-focus-within:opacity-100 transition duration-700 pointer-events-none"></div>
            <div className={`relative bg-black/40 backdrop-blur-3xl border rounded-[2rem] p-3 flex items-end gap-3 transition-all duration-500 shadow-2xl ${
                isPresentationMode ? "border-white/30 bg-white/[0.02]" : "border-white/5 focus-within:border-white/20"
            } ${disabled ? "opacity-40" : ""}`}>
            <textarea
                ref={textareaRef}
                value={value}
                onChange={onChange}
                onKeyDown={handleKeyDown}
                placeholder={isPresentationMode ? "Опишите идею для вашей презентации..." : placeholder}
                disabled={disabled}
                className="flex-1 bg-transparent border-none py-4 px-6 text-white focus:outline-none focus:ring-0 resize-none font-sans text-[16px] min-h-[60px] max-h-48 placeholder:text-white/20 leading-relaxed selection:bg-white/20"
                rows={1}
            ></textarea>
            <div className="flex items-center gap-2 mb-2 mr-2">
                {isLoading ? (
                    <button 
                      onClick={onStop}
                      className="bg-white/10 text-white border border-white/20 h-12 w-12 flex items-center justify-center rounded-2xl hover:bg-white/20 active:scale-90 transition-all shadow-lg shadow-black/20"
                    >
                      <Square className="w-4 h-4 fill-white" />
                    </button>
                ) : (
                    <button 
                      onClick={onSend}
                      disabled={disabled || !value.trim()}
                      className={`h-12 w-12 flex items-center justify-center rounded-2xl transition-all shadow-lg ${
                        value.trim() && !disabled
                        ? "bg-white text-black hover:scale-105 active:scale-90 shadow-white/5"
                        : "bg-white/5 text-white/10 cursor-not-allowed border border-white/5"
                      }`}
                    >
                      <ArrowUp className="w-6 h-6" strokeWidth={2.5} />
                    </button>
                )}
            </div>
            </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4 ml-4">
            <button
              onClick={onOpenImportModal}
              className="lovable-glass-strong border border-white/5 px-4 py-1.5 rounded-full text-[10px] font-mono text-white/30 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2 uppercase tracking-[0.2em] font-bold active:scale-95"
            >
              <Paperclip className="w-3.5 h-3.5" strokeWidth={1.5} /> Контекст
            </button>
            <button
              onClick={onToggleDeepSearch}
              className={`lovable-glass-strong border px-4 py-1.5 rounded-full text-[10px] font-mono transition-all flex items-center gap-2 uppercase tracking-[0.2em] font-bold active:scale-95 ${
                useDeepSearch ? "text-white border-white/20 bg-white/10" : "text-white/30 border-white/5 hover:text-white hover:bg-white/5"
              }`}
            >
              <Database className="w-3.5 h-3.5" strokeWidth={1.5} /> Web-поиск
            </button>
            <button
              onClick={onToggleResearchMode}
              className={`lovable-glass-strong border px-4 py-1.5 rounded-full text-[10px] font-mono transition-all flex items-center gap-2 uppercase tracking-[0.2em] font-bold active:scale-95 ${
                isResearchMode ? "text-white border-white/20 bg-white/10 shadow-[0_0_15px_rgba(255,255,255,0.05)]" : "text-white/30 border-white/5 hover:text-white hover:bg-white/5"
              }`}
            >
              <Activity className="w-3.5 h-3.5" strokeWidth={1.5} /> Deep Research
            </button>
            {!isPresentationMode && (
                <button
                    onClick={onTogglePresentationMode}
                    className="lovable-glass-strong border border-white/5 px-4 py-1.5 rounded-full text-[10px] font-mono text-white/30 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2 uppercase tracking-[0.2em] font-bold active:scale-95"
                >
                    <FileText className="w-3.5 h-3.5" strokeWidth={1.5} /> Слайды
                </button>
            )}
        </div>
      </div>
    </div>
  );
}
