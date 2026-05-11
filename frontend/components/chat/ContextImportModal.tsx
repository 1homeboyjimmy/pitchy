"use client";

import React, { useState } from "react";
import { X, Copy, Check, DownloadCloud, ArrowRight, Loader } from "react-feather";
import { motion, AnimatePresence } from "framer-motion";
import { ImportContextResponse } from "@/lib/api";

interface ContextImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<ImportContextResponse>;
}

export function ContextImportModal({ isOpen, onClose, onSubmit }: ContextImportModalProps) {
  const [copied, setCopied] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ImportContextResponse | null>(null);

  const promptText = `Проанализируй наш текущий диалог. Сформируй структурированный отчет в формате JSON, где выдели: 1) Основную бизнес-идею, 2) Целевую аудиторию, 3) Ключевые гипотезы, 4) Список решенных задач. Не используй лишних слов, только данные.`;

  const handleCopy = () => {
    navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async () => {
    if (!inputText.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await onSubmit(inputText);
      setResult(res);
    } catch {
      setResult({ success: false, message: "Произошла ошибка при отправке." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setInputText("");
    setResult(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <React.Fragment>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 20 }}
            className="fixed inset-3 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:max-h-[calc(100vh-3rem)] bg-black border border-white/5 rounded-3xl sm:rounded-[2.5rem] shadow-[0_0_100px_-20px_rgba(0,0,0,0.5)] z-[101] overflow-hidden text-white flex flex-col"
          >
            {/* Sticky header with close */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/10 shrink-0 gap-3">
              <h2 className="font-sans text-lg sm:text-2xl text-white flex items-center gap-3 sm:gap-4 font-semibold tracking-tight min-w-0">
                <DownloadCloud className="w-5 h-5 sm:w-7 sm:h-7 text-white/40 shrink-0" strokeWidth={1.5} />
                <span className="truncate">Импорт контекста</span>
              </h2>
              <button
                onClick={handleClose}
                aria-label="Закрыть"
                className="shrink-0 p-2 text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors active:scale-95"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {!result ? (
                <div className="space-y-5 sm:space-y-6">
                  {/* Step A */}
                  <div>
                    <h3 className="text-sm font-semibold text-white/90 mb-2 flex items-center gap-2">
                      <span className="bg-white/10 w-6 h-6 rounded-md flex items-center justify-center text-xs shrink-0">1</span>
                      Скопируйте этот промпт
                    </h3>
                    <p className="text-xs text-white/50 mb-3">
                      Вставьте его в ChatGPT / Claude / Gemini в тот чат, где вы уже обсуждали свой стартап, чтобы он собрал выжимку данных.
                    </p>
                    <div className="relative bg-white/[0.03] p-4 sm:p-6 rounded-2xl border border-white/5 group">
                      <p className="text-[14px] sm:text-[15px] text-white/80 pr-12 leading-relaxed font-light">{promptText}</p>
                      <button
                        onClick={handleCopy}
                        className="absolute right-3 top-3 sm:right-4 sm:top-4 p-2 sm:p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all text-white active:scale-95"
                        title="Копировать"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Step B */}
                  <div>
                    <h3 className="text-sm font-semibold text-white/90 mb-2 flex items-center gap-2">
                      <span className="bg-white/10 w-6 h-6 rounded-md flex items-center justify-center text-xs shrink-0">2</span>
                      Вставьте ответ сюда
                    </h3>
                    <p className="text-xs text-white/50 mb-3">
                      Скопируйте всё, что ответила нейросеть (включая JSON или просто текст) и вставьте в это поле. Pitchy сам всё разберет.
                    </p>
                    <textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Вставьте текст или JSON-отчет здесь..."
                      rows={5}
                      className="w-full bg-white/[0.02] border border-white/5 focus:border-white/20 rounded-2xl p-4 sm:p-6 text-[14px] sm:text-[15px] text-white placeholder-white/20 resize-none outline-none transition-all font-light"
                    />
                  </div>
                </div>
              ) : (
                <div className="py-6 sm:py-8 text-center space-y-4">
                  <div className={`w-14 h-14 sm:w-16 sm:h-16 mx-auto rounded-full flex items-center justify-center ${result.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {result.success ? <Check className="w-7 h-7 sm:w-8 sm:h-8" /> : <X className="w-7 h-7 sm:w-8 sm:h-8" />}
                  </div>
                  <h3 className="text-lg sm:text-xl font-bold text-white">
                    {result.success ? "Успешно импортировано!" : "Ошибка импорта"}
                  </h3>
                  <p className="text-white/60 text-sm max-w-sm mx-auto px-2">
                    {result.message || (result.success ? "Контекст был успешно добавлен в базу знаний. Теперь Pitchy знает детали вашего проекта." : "Что-то пошло не так. Попробуйте еще раз.")}
                  </p>

                  {result.success && result.summary && result.summary.project_name && (
                    <div className="mt-6 inline-block bg-white/5 border border-white/10 rounded-xl p-4 text-left max-w-full">
                      <p className="text-xs text-white/40 uppercase tracking-widest mb-1">Распознанный проект</p>
                      <p className="text-sm font-semibold text-white break-words">{result.summary.project_name}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sticky footer with submit / close */}
            <div className="shrink-0 border-t border-white/10 p-4 sm:p-5 flex justify-end gap-3 bg-black">
              {!result ? (
                <button
                  onClick={handleSubmit}
                  disabled={!inputText.trim() || isSubmitting}
                  className="flex items-center justify-center gap-2 sm:gap-3 w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-3.5 bg-white text-black font-mono text-[11px] uppercase tracking-[0.2em] font-bold rounded-full hover:bg-neutral-200 disabled:opacity-50 transition-all active:scale-[0.98] shadow-xl shadow-white/5"
                >
                  {isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : "Импортировать"}
                  {!isSubmitting && <ArrowRight className="w-4 h-4" />}
                </button>
              ) : (
                <button
                  onClick={handleClose}
                  className="w-full sm:w-auto px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-full text-sm font-medium transition-colors"
                >
                  Закрыть и вернуться к чату
                </button>
              )}
            </div>
          </motion.div>
        </React.Fragment>
      )}
    </AnimatePresence>
  );
}
