"use client";

import React, { useRef, useEffect, useState } from "react";
import { Send, Square, Globe, Activity, FileText, DownloadCloud, Paperclip, Database, Mic, ArrowUp, X } from "lucide-react";
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
    <div className="relative w-full max-w-3xl mx-auto">
      {/* Agent Mode Banner */}
      <AnimatePresence>
        {isPresentationMode && (
          <motion.div
            initial={{ opacity: 0, y: 20, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 10, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="mb-3 overflow-hidden px-6"
          >
            <div className="relative rounded-2xl border border-white/10 bg-[#111111] p-4 backdrop-blur-xl group">
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
              <div className="flex items-start justify-between gap-3 relative z-10">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="text-[14px] font-bold text-white flex items-center gap-2 font-display">
                      Режим генерации презентации
                      <span className="text-[9px] font-mono-label px-1.5 py-0.5 rounded bg-white/10 text-white uppercase tracking-wider">Agent</span>
                    </h4>
                    <p className="text-[13px] text-neutral-400 mt-1 leading-relaxed font-code">
                      Опишите тему, ключевые тезисы и стиль вашей презентации.
                      <br />
                      Pitchy создаст питч-дек на 6–10 слайдов.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => onCancelPresentationMode?.()}
                  className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                  title="Отменить режим презентации"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-6">
        <div className="flex flex-wrap gap-2 mb-3 ml-2">
            <button 
            onClick={onOpenImportModal}
            className="bg-[#111111] border border-white/10 px-2.5 py-1 rounded-md text-[9px] font-mono-label text-neutral-500 hover:text-white hover:border-white/20 transition-all flex items-center gap-1.5 uppercase tracking-wider"
            >
            <Paperclip className="w-3.5 h-3.5" /> Контекст
            </button>
            <button 
            onClick={onToggleDeepSearch}
            className={`bg-[#111111] border border-white/10 px-2.5 py-1 rounded-md text-[9px] font-mono-label transition-all flex items-center gap-1.5 uppercase tracking-wider ${
                useDeepSearch ? "text-white border-white/30" : "text-neutral-500 hover:text-white hover:border-white/20"
            }`}
            >
            <Database className="w-3.5 h-3.5" /> Web-поиск
            </button>
            <button 
            onClick={onToggleResearchMode}
            className={`bg-[#111111] border border-white/10 px-2.5 py-1 rounded-md text-[9px] font-mono-label transition-all flex items-center gap-1.5 uppercase tracking-wider ${
                isResearchMode ? "text-white border-white/30" : "text-neutral-500 hover:text-white hover:border-white/20"
            }`}
            >
            <Activity className="w-3.5 h-3.5" /> Deep Research
            </button>
            {!isPresentationMode && (
                <button 
                    onClick={onTogglePresentationMode}
                    className="bg-[#111111] border border-white/10 px-2.5 py-1 rounded-md text-[9px] font-mono-label text-neutral-500 hover:text-white hover:border-white/20 transition-all flex items-center gap-1.5 uppercase tracking-wider"
                >
                    <FileText className="w-3.5 h-3.5" /> Слайды
                </button>
            )}
        </div>

        <div className="relative group">
            <div className="absolute -inset-0.5 bg-white/5 rounded-2xl blur opacity-0 group-focus-within:opacity-100 transition duration-500 pointer-events-none"></div>
            <div className={`relative bg-[#111111] border rounded-2xl p-2 flex items-end gap-2 transition-colors ${
                isPresentationMode ? "border-white/30" : "border-white/10 focus-within:border-white/30"
            } ${disabled ? "opacity-50" : ""}`}>
            <textarea
                ref={textareaRef}
                value={value}
                onChange={onChange}
                onKeyDown={handleKeyDown}
                placeholder={isPresentationMode ? "Опишите идею для презентации..." : placeholder}
                disabled={disabled}
                className="flex-1 bg-transparent border-none py-3 px-4 text-white focus:outline-none focus:ring-0 resize-none font-body-sm text-[14px] min-h-[56px] max-h-48 placeholder:text-[#444444]"
                rows={1}
            ></textarea>
            <div className="flex items-center gap-1 mb-1.5 mr-1.5">
                <button className="p-2 text-neutral-500 hover:text-white transition-colors rounded-lg">
                <Mic className="w-[18px] h-[18px]" />
                </button>
                {isLoading ? (
                    <button 
                    onClick={onStop}
                    className="bg-white/10 text-white border border-white/20 h-10 w-10 flex items-center justify-center rounded-xl hover:bg-white/20 active:scale-95 transition-all"
                    >
                    <Square className="w-4 h-4 fill-white" />
                    </button>
                ) : (
                    <button 
                    onClick={onSend}
                    disabled={disabled || !value.trim()}
                    className={`h-10 w-10 flex items-center justify-center rounded-xl transition-all ${
                        value.trim() && !disabled
                        ? "bg-white text-black hover:bg-neutral-200 active:scale-95"
                        : "bg-white/10 text-white/30 cursor-not-allowed"
                    }`}
                    >
                    <ArrowUp className="w-5 h-5" />
                    </button>
                )}
            </div>
            </div>
        </div>

        <div className="mt-4 flex justify-between items-center px-2">
            <div className="flex items-center gap-4">
            <span className="font-code text-[9px] text-neutral-600 uppercase tracking-widest">Model: Analyst-Ultra-v4</span>
            <span className="font-code text-[9px] text-neutral-600 uppercase tracking-widest">Tokens: 4.2k/128k</span>
            </div>
            <div className="flex items-center gap-2">
            <span className="w-1 h-1 bg-green-500 rounded-full"></span>
            <span className="font-code text-[9px] text-neutral-600 uppercase tracking-widest">Online</span>
            </div>
        </div>
      </div>
    </div>
  );
}
