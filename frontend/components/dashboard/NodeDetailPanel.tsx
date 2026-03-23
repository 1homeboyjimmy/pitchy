"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, MessageSquare, Edit3, Sparkles, FastForward, CheckCircle2, ChevronRight } from "lucide-react";
import type { TreeNodeResponse, TreeInputResponse } from "../../lib/api";

type Props = {
  node: TreeNodeResponse | null;
  onClose: () => void;
  onDiscussInChat: (node: TreeNodeResponse) => void;
  onAction: (action: string, node: TreeNodeResponse) => void;
};

const statusLabels: Record<string, { label: string; bg: string; text: string }> = {
  empty: { label: "Пусто", bg: "bg-white/5", text: "text-white/40" },
  partial: { label: "Частично выполнено", bg: "bg-[#F59E0B]/10", text: "text-[#F59E0B]" },
  completed: { label: "Готово", bg: "bg-[#10B981]/10", text: "text-[#10B981]" },
  critical: { label: "Критично", bg: "bg-[#EF4444]/10", text: "text-[#EF4444]" },
  skipped: { label: "Отложено", bg: "bg-[#6B7280]/10", text: "text-[#6B7280]" },
};

export function NodeDetailPanel({ node, onClose, onDiscussInChat, onAction }: Props) {
  if (!node) return null;

  const data = node.data;
  const inputs = data.inputs || [];
  const outputs = data.outputs || {};
  
  const totalRequired = inputs.filter((i: TreeInputResponse) => i.required).length;
  const filledRequired = inputs.filter((i: TreeInputResponse) => i.required && i.status === "completed").length;
  
  const knownInputs = inputs.filter((i: TreeInputResponse) => i.status === "completed");
  const missingInputs = inputs.filter((i: TreeInputResponse) => i.status !== "completed");
  const sc = statusLabels[node.status] || statusLabels.empty;

  return (
    <AnimatePresence>
      <motion.div
        key="detail-panel"
        initial={{ x: 380, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 380, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="absolute top-0 right-0 h-full w-[380px] border-l border-white/10 bg-[#0c0a1a]/95 backdrop-blur-xl z-50 flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-white/10 bg-gradient-to-b from-white/[0.02] to-transparent">
          <div>
            <h3 className="text-lg font-semibold text-white tracking-tight flex items-center gap-2">
              <span className="text-xl">🎯</span> {node.label}
            </h3>
            <div className={`mt-2 flex items-center gap-2 px-2.5 py-1 rounded-md w-fit border border-current ${sc.bg} ${sc.text}`}>
              <span className="text-xs font-medium">{sc.label}</span>
              {totalRequired > 0 && (
                <span className="text-[10px] font-bold opacity-80 bg-black/20 px-1.5 py-0.5 rounded">
                  {filledRequired}/{totalRequired}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 hover:text-white transition-all shrink-0 text-white/50 self-start"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          
          {data.description && (
             <p className="text-sm text-white/60 leading-relaxed border-l-2 border-white/20 pl-3">
               {data.description}
             </p>
          )}

          {/* Known Data (Известно) */}
          {(knownInputs.length > 0 || Object.keys(outputs).length > 0) && (
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 text-sm font-medium text-[#10B981]">
                <CheckCircle2 className="w-4 h-4" /> Что уже известно:
              </h4>
              <div className="bg-white/5 rounded-xl p-4 space-y-3 border border-white/10">
                {knownInputs.map((k: TreeInputResponse, i: number) => (
                  <div key={i}>
                    <span className="text-xs text-white/40 block mb-0.5">{k.label}</span>
                    <span className="text-sm text-white font-medium">{String(k.value)}</span>
                  </div>
                ))}
                {Object.entries(outputs).map(([key, val]) => (
                  <div key={key}>
                    <span className="text-xs text-white/40 block mb-0.5">{key}</span>
                    <span className="text-sm text-white font-medium">{String(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Missing Data (Нужно уточнить) */}
          {missingInputs.length > 0 && (
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 text-sm font-medium text-[#F59E0B]">
                <span className="text-lg">❓</span> Нужно уточнить:
              </h4>
              <ul className="bg-[#F59E0B]/5 rounded-xl p-4 border border-[#F59E0B]/20 space-y-2.5">
                {missingInputs.map((m: TreeInputResponse, i: number) => (
                  <li key={i} className="flex flex-col gap-1 relative pl-4 before:content-['•'] before:absolute before:left-0 before:top-0 before:text-[#F59E0B]">
                    <span className="text-sm text-white/90">
                      {m.label}
                      {m.required && <span className="text-[#EF4444] ml-1">*</span>}
                    </span>
                    {m.placeholder && <span className="text-xs text-white/40">{m.placeholder}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Next Action */}
          {data.next_action && node.status === "completed" && (
            <div className="rounded-xl border border-pitchy-violet/30 bg-pitchy-violet/5 p-4 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-r from-pitchy-violet/0 via-pitchy-violet/5 to-pitchy-violet/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
              <p className="text-[10px] uppercase font-bold tracking-widest text-pitchy-violet/70 mb-1">Следующий шаг</p>
              <div className="flex items-center justify-between">
                <p className="text-sm text-white font-medium">{data.next_action.title}</p>
                <ChevronRight className="w-4 h-4 text-pitchy-violet" />
              </div>
            </div>
          )}

        </div>

        {/* Action Buttons */}
        <div className="p-5 border-t border-white/10 bg-[#0c0a1a] flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onDiscussInChat(node)}
              className="flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-pitchy-violet to-purple-600 text-white text-sm font-medium hover:opacity-90 hover:scale-[1.02] transition-all"
            >
              <MessageSquare className="w-4 h-4" />
              В чат
            </button>
            <button
              onClick={() => onAction("Заполни данные для этого узла", node)}
              className="flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/15 transition-all"
            >
              <Edit3 className="w-4 h-4" />
              Заполнить
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <button 
              onClick={() => onAction("Покажи примеры заполнения для этого блока", node)}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Примеры
            </button>
            <button 
              onClick={() => onAction("Пропусти этот шаг пока что", node)}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            >
              <FastForward className="w-3.5 h-3.5" />
              Пропустить
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
