"use client";

import React, { useRef, useEffect, useState } from "react";
import { Send, Square, Maximize2, Minimize2, Globe, Sliders, Activity, ChevronUp, DownloadCloud } from "react-feather";
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
  onGeneratePresentation?: () => void;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  isLoading,
  onStop,
  placeholder = "Введите сообщение...",
  disabled = false,
  useDeepSearch = false,
  onToggleDeepSearch,
  isResearchMode = false,
  onToggleResearchMode,
  onOpenImportModal,
  onGeneratePresentation,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsToolsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-expand logic based on content ONLY if not fullscreen
  useEffect(() => {
    if (textareaRef.current) {
      if (isFullscreen) {
        // In expanded mode, we fix the height to a large value
        textareaRef.current.style.height = '300px';
      } else {
        // Auto adjust based on scrollHeight
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 40), 200)}px`;
      }
    }
  }, [value, isFullscreen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim() && !isLoading) {
        onSend();
      }
    }
  };

  return (
    <div className="relative w-full max-w-4xl mx-auto">
      <div 
        className={`relative w-full flex flex-col rounded-[20px] bg-[#111118] border border-white/10 transition-all duration-300 focus-within:border-white/20 focus-within:shadow-[0_0_20px_rgba(255,255,255,0.05)] ${disabled ? 'opacity-50 cursor-not-allowed' : ''} shadow-lg overflow-hidden group`}
      >
        <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-[#111118] to-transparent z-10 pointer-events-none opacity-0 transition-opacity duration-300 group-focus-within:opacity-100" />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full bg-transparent text-white placeholder-white/30 text-[15px] resize-none overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 focus:outline-none focus:ring-0 border-none !outline-none disabled:cursor-not-allowed px-5 py-4 pb-2 z-0 relative"
          style={{ minHeight: '56px' }}
        />

        {/* Action Buttons - safely placed inside the container at the bottom */}
        <div className="flex justify-between items-center w-full px-3 pb-2 pt-1 mt-auto">
          <div className="flex items-center gap-1 ml-1">
            <motion.button
              onClick={() => setIsFullscreen(!isFullscreen)}
              whileTap={{ scale: 0.9 }}
              type="button"
              className="w-9 h-9 rounded-full bg-transparent hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors"
              title={isFullscreen ? "Свернуть" : "Во весь экран"}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </motion.button>

            {onToggleDeepSearch && (
              <motion.button
                onClick={onToggleDeepSearch}
                whileTap={{ scale: 0.9 }}
                type="button"
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                  useDeepSearch 
                    ? "bg-blue-500/20 text-blue-400" 
                    : "bg-transparent text-white/40 hover:bg-white/10 hover:text-white"
                }`}
                title={useDeepSearch ? "Быстрый поиск включен" : "Включить быстрый поиск"}
              >
                <Globe className="w-4 h-4" />
              </motion.button>
            )}

            <div className="relative" ref={menuRef}>
              <motion.button
                onClick={() => setIsToolsOpen(!isToolsOpen)}
                whileTap={{ scale: 0.95 }}
                type="button"
                className={`flex items-center gap-2 px-3 h-9 rounded-full transition-all ${
                  isResearchMode 
                    ? "bg-pitchy-violet text-white shadow-[0_0_15px_rgba(139,92,246,0.3)]"
                    : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Sliders className="w-4 h-4" />
                <span className="text-xs font-medium">Инструменты</span>
                <ChevronUp className={`w-3 h-3 transition-transform duration-200 ${isToolsOpen ? 'rotate-180' : ''}`} />
              </motion.button>

              <AnimatePresence>
                {isToolsOpen && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 10 }}
                      className="absolute bottom-full left-0 mb-3 w-64 bg-[#1A1A24] border border-white/20 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] z-50 backdrop-blur-2xl"
                    >
                      <div className="p-3 border-b border-white/10 bg-white/5">
                        <span className="text-[11px] font-bold text-pitchy-violet uppercase tracking-widest px-2">ДОСТУПНЫЕ ИНСТРУМЕНТЫ</span>
                      </div>
                    <div className="p-1">
                      <button
                        onClick={() => {
                          onToggleResearchMode?.();
                          setIsToolsOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                          isResearchMode 
                            ? "bg-pitchy-violet/20 text-pitchy-violet" 
                            : "text-white/70 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isResearchMode ? 'bg-pitchy-violet text-white' : 'bg-white/5'}`}>
                          <Activity className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col items-start">
                          <span className="text-sm font-medium">Deep Research</span>
                          <span className="text-[10px] text-white/30">Глубокое агентное исследование</span>
                        </div>
                      </button>

                      <button
                        onClick={() => {
                          setIsToolsOpen(false);
                          onOpenImportModal?.();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-white/70 hover:bg-white/5 hover:text-white mt-1"
                      >
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5">
                          <DownloadCloud className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col items-start">
                          <span className="text-sm font-medium">Импорт из других ИИ</span>
                          <span className="text-[10px] text-white/30">Перенести контекст стартапа</span>
                        </div>
                      </button>

                      <button
                        onClick={() => {
                          setIsToolsOpen(false);
                          onGeneratePresentation?.();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-white/70 hover:bg-white/5 hover:text-white mt-1"
                      >
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5">
                          <Activity className="w-4 h-4 text-pitchy-cyan" />
                        </div>
                        <div className="flex flex-col items-start">
                          <span className="text-sm font-medium">Слайды проекта</span>
                          <span className="text-[10px] text-white/30">Генерация презентации</span>
                        </div>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          
          <div className="flex items-center">
            {isLoading ? (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={onStop}
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors mr-1"
              >
                <Square className="w-4 h-4 fill-white" />
              </motion.button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={onSend}
                disabled={disabled || !value.trim()}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors mr-1 ${
                  value.trim() && !disabled 
                    ? 'bg-white text-black hover:bg-white/90 shadow-md' 
                    : 'bg-white/5 text-white/30 cursor-not-allowed'
                }`}
              >
                <Send className="w-4 h-4 ml-[2px]" />
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
