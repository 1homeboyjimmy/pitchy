"use client";

import React, { useState } from "react";
import { X, Copy, Check, DownloadCloud, ArrowRight } from "react-feather";
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
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-[#131313] border border-white/10 rounded-2xl shadow-2xl z-[101] overflow-hidden text-white"
          >
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <DownloadCloud className="w-5 h-5 text-pitchy-violet" />
                Импорт контекста
              </h2>
              <button
                onClick={handleClose}
                className="p-1.5 text-white/50 hover:text-white rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {!result ? (
                <div className="space-y-6">
                  {/* Step A */}
                  <div>
                    <h3 className="text-sm font-semibold text-white/90 mb-2 flex items-center gap-2">
                      <span className="bg-white/10 w-6 h-6 rounded-md flex items-center justify-center text-xs">1</span>
                      Скопируйте этот промпт
                    </h3>
                    <p className="text-xs text-white/50 mb-3">
                      Вставьте его в ChatGPT / Claude / Gemini в тот чат, где вы уже обсуждали свой стартап, чтобы он собрал выжимку данных.
                    </p>
                    <div className="relative bg-white/5 p-4 rounded-xl border border-white/10 group">
                      <p className="text-sm text-white/80 pr-10">{promptText}</p>
                      <button
                        onClick={handleCopy}
                        className="absolute right-3 top-3 p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white"
                        title="Копировать"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Step B */}
                  <div>
                    <h3 className="text-sm font-semibold text-white/90 mb-2 flex items-center gap-2">
                      <span className="bg-white/10 w-6 h-6 rounded-md flex items-center justify-center text-xs">2</span>
                      Вставьте ответ сюда
                    </h3>
                    <p className="text-xs text-white/50 mb-3">
                      Скопируйте всё, что ответила нейросеть (включая JSON или просто текст) и вставьте в это поле. Pitchy сам всё разберет.
                    </p>
                    <textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Вставьте текст или JSON-отчет здесь..."
                      rows={6}
                      className="w-full bg-[#1A1A24] border border-white/10 focus:border-pitchy-violet rounded-xl p-4 text-sm text-white placeholder-white/30 resize-none outline-none transition-colors"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={handleSubmit}
                      disabled={!inputText.trim() || isSubmitting}
                      className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-pitchy-violet to-purple-600 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-opacity"
                    >
                      {isSubmitting ? "Обработка..." : "Импортировать"}
                      {!isSubmitting && <ArrowRight className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center space-y-4">
                  <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center ${result.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {result.success ? <Check className="w-8 h-8" /> : <X className="w-8 h-8" />}
                  </div>
                  <h3 className="text-xl font-bold text-white">
                    {result.success ? "Успешно импортировано!" : "Ошибка импорта"}
                  </h3>
                  <p className="text-white/60 text-sm max-w-sm mx-auto">
                    {result.message || (result.success ? "Контекст был успешно добавлен в базу знаний. Теперь Pitchy знает детали вашего проекта." : "Что-то пошло не так. Попробуйте еще раз.")}
                  </p>
                  
                  {result.success && result.summary && result.summary.project_name && (
                    <div className="mt-6 inline-block bg-white/5 border border-white/10 rounded-xl p-4 text-left">
                      <p className="text-xs text-white/40 uppercase tracking-widest mb-1">Распознанный проект</p>
                      <p className="text-sm font-semibold text-white">{result.summary.project_name}</p>
                    </div>
                  )}

                  <div className="pt-6">
                    <button
                      onClick={handleClose}
                      className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-colors"
                    >
                      Закрыть и вернуться к чату
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </React.Fragment>
      )}
    </AnimatePresence>
  );
}
