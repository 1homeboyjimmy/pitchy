"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion } from "framer-motion";
import { Crosshair, ShoppingBag, Globe, DollarSign, Users, AlertTriangle, CheckCircle, Circle, FileText, HelpCircle, ChevronDown, ChevronRight } from "react-feather";

/* ——— helpers ——— */

const statusColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  empty:     { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.12)", text: "text-white/40", glow: "" },
  partial:   { bg: "rgba(245,158,11,0.15)",  border: "#D97706", text: "text-[#F59E0B]", glow: "shadow-[0_0_12px_rgba(245,158,11,0.2)]" },
  completed: { bg: "rgba(16,185,129,0.15)",  border: "#059669", text: "text-[#10B981]", glow: "shadow-[0_0_12px_rgba(16,185,129,0.2)]" },
  critical:  { bg: "rgba(239,68,68,0.15)",   border: "#DC2626", text: "text-[#EF4444]", glow: "shadow-[0_0_12px_rgba(239,68,68,0.2)]" },
  skipped:   { bg: "rgba(107,114,128,0.15)", border: "rgba(107,114,128,0.3)", text: "text-[#6B7280]", glow: "opacity-50" },
};

const typeIcons: Record<string, React.ReactNode> = {
  Question: <HelpCircle className="w-3.5 h-3.5" />,
  Risk:     <AlertTriangle className="w-3.5 h-3.5" />,
  Fact:     <FileText className="w-3.5 h-3.5" />,
  Task:     <CheckCircle className="w-3.5 h-3.5" />,
  Artifact: <Circle className="w-3.5 h-3.5" />,
};

const categoryIcons: Record<string, React.ReactNode> = {
  product:      <ShoppingBag className="w-5 h-5" />,
  market:       <Globe className="w-5 h-5" />,
  monetization: <DollarSign className="w-5 h-5" />,
  team:         <Users className="w-5 h-5" />,
};

/* ——— Readiness Root Node (Level 0) ——— */

type ReadinessNodeData = {
  label: string;
  readiness: number;
  status: string;
};

export const ReadinessNode = memo(function ReadinessNode({ data }: NodeProps) {
  const d = data as unknown as ReadinessNodeData;
  const pct = d.readiness ?? 0;
  const circumference = 2 * Math.PI * 36;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="flex flex-col items-center"
    >
      <div className="relative w-24 h-24 flex items-center justify-center rounded-full bg-gradient-to-br from-pitchy-violet/20 to-purple-900/30 border-2 border-pitchy-violet/40 shadow-[0_0_30px_rgba(168,85,247,0.25)]">
        {/* SVG ring */}
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
          <circle
            cx="40" cy="40" r="36" fill="none"
            stroke="url(#grad)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1s ease" }}
          />
          <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
        </svg>
        <div className="flex flex-col items-center z-10">
          <span className="text-2xl font-bold text-white">{pct}</span>
          <span className="text-[10px] text-white/40 uppercase tracking-wider">индекс</span>
        </div>
      </div>
      <span className="mt-2 text-xs font-semibold text-white/70 tracking-wide">{d.label}</span>
      <Handle type="source" position={Position.Bottom} className="!bg-pitchy-violet !w-2 !h-2 !border-none" />
    </motion.div>
  );
});

/* ——— Category Node (Level 1: Продукт, Рынок etc.) ——— */

type CategoryNodeData = {
  label: string;
  category: string;
  status: string;
  childCount: number;
  expanded: boolean;
  summary?: Record<string, string> | null;
  onToggle: () => void;
};

export const CategoryNode = memo(function CategoryNode({ data }: NodeProps) {
  const d = data as unknown as CategoryNodeData;
  const style = statusColors[d.status] || statusColors.empty;
  const icon = categoryIcons[d.category] || <Crosshair className="w-5 h-5" />;
  const isCompleted = d.status === "completed";
  const hasSummary = !!d.summary && Object.keys(d.summary).length > 0;

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ 
        scale: 1, 
        opacity: 1,
        width: isCompleted ? 280 : "auto"
      }}
      whileHover={{ scale: 1.03 }}
      className={`relative min-w-[200px] rounded-2xl border backdrop-blur-md cursor-pointer ${style.glow}`}
      style={{ background: style.bg, borderColor: style.border }}
    >
      <Handle type="target" position={Position.Top} className="!bg-white/20 !w-2 !h-2 !border-none" />

      <div className="p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${style.text}`}
          style={{ background: style.bg, border: `1px solid ${style.border}` }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{d.label}</p>
          <p className="text-[10px] text-white/40 mt-0.5">
            {d.childCount ?? 0} подзадач
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); d.onToggle?.(); }}
          className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
        >
          {d.expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-white/50" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-white/50" />
          )}
        </button>
      </div>

      {/* AI Summary Table for CategoryNode */}
      {isCompleted && hasSummary && (
        <div className="px-4 pb-4">
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            className="mt-1 overflow-hidden border-t border-white/10 pt-3"
          >
            <div className="space-y-1.5">
              {Object.entries(d.summary as Record<string, string>).map(([key, val]) => (
                <div key={key} className="flex flex-col gap-0.5 overflow-hidden mb-2 last:mb-0">
                  <span className="text-[10px] text-white/40 uppercase tracking-tight font-medium shrink-0 leading-tight">
                    {key}
                  </span>
                  <span className="text-[11px] text-white/90 leading-snug break-words">
                    {val}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-white/20 !w-2 !h-2 !border-none" />
    </motion.div>
  );
});

/* ——— Task Node (Level 2+) ——— */

type TaskNodeData = {
  label: string;
  nodeType: string;
  status: string;
  childCount: number;
  expanded: boolean;
  progress?: string;
  summary?: Record<string, string> | null;
  onToggle: () => void;
};

export const TaskNode = memo(function TaskNode({ data }: NodeProps) {
  const d = data as unknown as TaskNodeData;
  const style = statusColors[d.status] || statusColors.empty;
  const icon = typeIcons[d.nodeType] || typeIcons.Task;
  const isCompleted = d.status === "completed";
  const isActive = d.status === "active";
  const hasSummary = !!d.summary && Object.keys(d.summary).length > 0;

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ 
        scale: 1, 
        opacity: 1,
        width: isCompleted ? 280 : 200 
      }}
      whileHover={{ scale: 1.02 }}
      className={`relative rounded-xl border backdrop-blur-sm cursor-pointer transition-all duration-300 ${style.glow} ${isActive ? "ring-2 ring-pitchy-violet/50 animate-pulse" : ""}`}
      style={{ background: style.bg, borderColor: style.border }}
    >
      <Handle type="target" position={Position.Top} className="!bg-white/20 !w-1.5 !h-1.5 !border-none" />

      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${style.text}`}
            style={{ background: style.bg, border: `1px solid ${style.border}` }}
          >
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white leading-snug">{d.label}</p>
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {isActive ? (
                 <span className="text-[8px] inline-block px-1.5 py-0.5 rounded-full bg-pitchy-violet/20 text-pitchy-violet border border-pitchy-violet/30 font-bold uppercase tracking-wider">
                  В процессе
                 </span>
              ) : (
                <span className={`text-[8px] inline-block px-1.5 py-0.5 rounded-full ${style.text}`}
                  style={{ background: style.bg, border: `1px solid ${style.border}` }}
                >
                  {d.nodeType}
                </span>
              )}
              {d.progress && (
                <span className="text-[8px] font-bold opacity-80 bg-black/30 px-1.2 py-0.5 rounded text-white/70">
                  {d.progress}
                </span>
              )}
            </div>
          </div>
          {(d.childCount ?? 0) > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); d.onToggle?.(); }}
              className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors shrink-0"
            >
              {d.expanded ? (
                <ChevronDown className="w-3 h-3 text-white/50" />
              ) : (
                <ChevronRight className="w-3 h-3 text-white/50" />
              )}
            </button>
          )}
        </div>

        {/* AI Summary Table */}
        {isCompleted && hasSummary && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            className="mt-3 overflow-hidden border-t border-white/10 pt-2"
          >
            <div className="space-y-1.5">
              {Object.entries(d.summary as Record<string, string>).map(([key, val]) => (
                <div key={key} className="flex items-center justify-between gap-2 overflow-hidden">
                  <span className="text-[9px] text-white/30 uppercase tracking-tight shrink-0 font-medium">{key}:</span>
                  <span className="text-[10px] text-white/80 font-semibold truncate bg-white/5 px-1.5 py-0.5 rounded border border-white/5">{val}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-white/20 !w-1.5 !h-1.5 !border-none" />
    </motion.div>
  );
});
