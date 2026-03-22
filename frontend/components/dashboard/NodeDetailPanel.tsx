"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  FileText,
  HelpCircle,
  CircleDot,
  ExternalLink,
} from "lucide-react";

export type TreeNodeData = {
  id: string;
  type: "Question" | "Risk" | "Fact" | "Task" | "Artifact";
  status: "empty" | "partial" | "completed" | "risk";
  label: string;
  data: {
    description?: string;
    metrics?: Record<string, string | number>;
    aiRecommendation?: string;
    sourceRef?: string;
  };
  parent_id: string | null;
  children_ids: string[];
};

type Props = {
  node: TreeNodeData | null;
  onClose: () => void;
  onDiscussInChat: (node: TreeNodeData) => void;
};

const statusLabels: Record<string, { label: string; color: string; bg: string }> = {
  empty:     { label: "Пусто",     color: "text-white/40",   bg: "bg-white/5" },
  partial:   { label: "Частично",  color: "text-purple-300", bg: "bg-purple-500/10" },
  completed: { label: "Завершено", color: "text-green-300",  bg: "bg-green-500/10" },
  risk:      { label: "Риск",      color: "text-red-300",    bg: "bg-red-500/10" },
};

const typeConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  Question: { label: "Вопрос",   icon: <HelpCircle className="w-4 h-4" />,    color: "text-blue-300" },
  Risk:     { label: "Риск",     icon: <AlertTriangle className="w-4 h-4" />,  color: "text-red-300" },
  Fact:     { label: "Факт",     icon: <FileText className="w-4 h-4" />,       color: "text-cyan-300" },
  Task:     { label: "Задача",   icon: <CheckCircle2 className="w-4 h-4" />,   color: "text-green-300" },
  Artifact: { label: "Артефакт", icon: <CircleDot className="w-4 h-4" />,      color: "text-amber-300" },
};

export function NodeDetailPanel({ node, onClose, onDiscussInChat }: Props) {
  return (
    <AnimatePresence>
      {node && (
        <motion.div
          key="detail-panel"
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="absolute top-0 right-0 h-full w-[320px] border-l border-white/10 bg-[#0c0a1a]/95 backdrop-blur-xl z-50 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h3 className="text-sm font-semibold text-white truncate pr-2">{node.label}</h3>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors shrink-0"
            >
              <X className="w-4 h-4 text-white/50" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Type & Status Badges */}
            <div className="flex items-center gap-2 flex-wrap">
              {(() => {
                const tc = typeConfig[node.type] || typeConfig.Task;
                return (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${tc.color} bg-white/5 border border-white/10`}>
                    {tc.icon} {tc.label}
                  </span>
                );
              })()}
              {(() => {
                const sc = statusLabels[node.status] || statusLabels.empty;
                return (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${sc.color} ${sc.bg} border border-white/10`}>
                    {sc.label}
                  </span>
                );
              })()}
            </div>

            {/* Description */}
            {node.data.description && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">Описание</p>
                <p className="text-sm text-white/70 leading-relaxed">{node.data.description}</p>
              </div>
            )}

            {/* Metrics */}
            {node.data.metrics && Object.keys(node.data.metrics).length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-2">Метрики</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(node.data.metrics).map(([key, value]) => (
                    <div key={key} className="rounded-xl bg-white/5 border border-white/10 p-2.5">
                      <p className="text-[10px] text-white/40 truncate">{key}</p>
                      <p className="text-sm font-semibold text-white mt-0.5">{String(value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Recommendation */}
            {node.data.aiRecommendation && (
              <div className="rounded-xl bg-gradient-to-br from-pitchy-violet/10 to-transparent border border-pitchy-violet/20 p-3.5">
                <p className="text-[10px] uppercase tracking-wider text-pitchy-violet/70 mb-1.5 flex items-center gap-1">
                  ✨ Рекомендация ИИ
                </p>
                <p className="text-xs text-white/70 leading-relaxed">{node.data.aiRecommendation}</p>
              </div>
            )}

            {/* Source Reference */}
            {node.data.sourceRef && (
              <div className="flex items-center gap-2 text-xs text-white/30">
                <ExternalLink className="w-3 h-3" />
                <span>Источник: {node.data.sourceRef}</span>
              </div>
            )}
          </div>

          {/* Footer: Discuss Button */}
          <div className="px-5 py-4 border-t border-white/10">
            <button
              onClick={() => onDiscussInChat(node)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-pitchy-violet to-purple-600 text-white text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
            >
              <MessageSquare className="w-4 h-4" />
              Обсудить в чате
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
