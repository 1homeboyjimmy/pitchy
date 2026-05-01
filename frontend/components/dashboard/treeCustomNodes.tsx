"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion } from "framer-motion";
import { Crosshair, ShoppingBag, Globe, DollarSign, Users, AlertTriangle, CheckCircle, Circle, FileText, HelpCircle, ChevronDown, ChevronRight } from "react-feather";

/* ——— helpers ——— */

const statusDots: Record<string, string> = {
  empty: "bg-neutral-600",
  partial: "bg-yellow-500",
  completed: "bg-emerald-500",
  critical: "bg-red-500",
  skipped: "bg-neutral-600",
};

const typeIcons: Record<string, React.ReactNode> = {
  Question: <HelpCircle className="w-5 h-5 text-white/40 group-hover:text-white transition-colors" />,
  Risk:     <AlertTriangle className="w-5 h-5 text-red-500/40 group-hover:text-red-500 transition-colors" />,
  Fact:     <FileText className="w-5 h-5 text-white/40 group-hover:text-white transition-colors" />,
  Task:     <CheckCircle className="w-5 h-5 text-white/40 group-hover:text-white transition-colors" />,
  Artifact: <Circle className="w-5 h-5 text-white/40 group-hover:text-white transition-colors" />,
};

const categoryIcons: Record<string, React.ReactNode> = {
  product:      <ShoppingBag className="w-5 h-5 text-white/40 group-hover:text-white transition-colors" />,
  market:       <Globe className="w-5 h-5 text-white/40 group-hover:text-white transition-colors" />,
  monetization: <DollarSign className="w-5 h-5 text-white/40 group-hover:text-white transition-colors" />,
  team:         <Users className="w-5 h-5 text-white/40 group-hover:text-white transition-colors" />,
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

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="flex flex-col items-center group"
    >
        <div className="absolute inset-0 bg-white/5 blur-xl group-hover:bg-white/10 transition-all duration-700 rounded-full pointer-events-none"></div>
        <div className="relative bg-[#111111] border-2 border-white/20 p-8 flex flex-col items-center justify-center w-48 h-48 border-dashed group-hover:border-white/40 transition-colors">
            <span className="font-display text-white text-5xl font-black tracking-tighter">{pct}</span>
            <span className="font-mono-label text-[11px] text-neutral-500 uppercase tracking-widest mt-2">{d.label}</span>
            <div className="absolute -bottom-2.5 bg-white text-black px-2.5 py-0.5 text-[9px] font-bold font-mono-label uppercase">КОРНЕВОЙ УЗЕЛ</div>
        </div>
      <Handle type="source" position={Position.Bottom} className="!bg-white !w-2 !h-2 !border-none opacity-0" />
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
  const icon = categoryIcons[d.category] || <Crosshair className="w-5 h-5 text-white/40 group-hover:text-white transition-colors" />;
  const isCompleted = d.status === "completed";
  const hasSummary = !!d.summary && Object.keys(d.summary).length > 0;
  const dotColor = statusDots[d.status] || statusDots.empty;

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`relative rounded-none cursor-pointer flex flex-col items-center group`}
    >
      <Handle type="target" position={Position.Top} className="!bg-white/20 !w-2 !h-2 !border-none opacity-0" />

      <div className={`bg-[#111111] border ${isCompleted ? 'border-white/30 shadow-[0_0_30px_rgba(255,255,255,0.05)] bg-[#161616]' : 'border-white/10 hover:border-white/40'} p-6 w-64 transition-all duration-300`}>
        <div className="flex justify-between items-start mb-4">
            {icon}
            <span className="text-[10px] font-mono text-neutral-600 uppercase">CAT</span>
        </div>
        
        <h3 className="font-mono-label text-white uppercase text-[13px] tracking-wide mb-1 leading-tight">{d.label}</h3>
        <p className="text-[10px] text-neutral-500 mb-4 line-clamp-2">Базовая категория анализа</p>
        
        <div className="flex items-center justify-between pt-4 border-t border-white/5">
            <div className="flex items-center space-x-2">
                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></span>
                <span className="text-[9px] font-mono-label text-neutral-400 uppercase tracking-widest">{d.childCount ?? 0} ПОДЗАДАЧ</span>
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); d.onToggle?.(); }}
                className="text-neutral-600 group-hover:text-white transition-colors"
            >
                {d.expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
        </div>

        {/* AI Summary Table */}
        {isCompleted && hasSummary && (
        <div className="pt-4 mt-2 border-t border-white/5">
            <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            >
            <div className="space-y-2">
                {Object.entries(d.summary as Record<string, string>).map(([key, val]) => (
                <div key={key} className="flex flex-col gap-1 overflow-hidden">
                    <span className="text-[9px] font-code text-neutral-500 uppercase tracking-tight font-medium shrink-0">
                    {key}
                    </span>
                    <span className="text-[11px] text-neutral-300 leading-snug break-words">
                    {val}
                    </span>
                </div>
                ))}
            </div>
            </motion.div>
        </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-white/20 !w-2 !h-2 !border-none opacity-0" />
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
  const icon = typeIcons[d.nodeType] || typeIcons.Task;
  const isCompleted = d.status === "completed";
  const isActive = d.status === "active";
  const hasSummary = !!d.summary && Object.keys(d.summary).length > 0;
  const dotColor = isActive ? "bg-white animate-pulse" : (statusDots[d.status] || statusDots.empty);

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`relative rounded-none cursor-pointer flex flex-col items-center group`}
    >
      <Handle type="target" position={Position.Top} className="!bg-white/20 !w-1.5 !h-1.5 !border-none opacity-0" />

      <div className={`bg-[#111111] border ${isActive ? 'border-white/50 bg-[#161616]' : (isCompleted ? 'border-white/30 shadow-[0_0_30px_rgba(255,255,255,0.05)] bg-[#161616]' : 'border-white/10 hover:border-white/40')} p-6 w-60 transition-all duration-300`}>
        <div className="flex justify-between items-start mb-4">
            {icon}
            <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-widest">{d.nodeType}</span>
        </div>
        
        <h3 className="font-mono-label text-white uppercase text-[12px] tracking-wide mb-1 leading-tight">{d.label}</h3>
        <p className="text-[10px] font-code text-neutral-500 mb-4 line-clamp-2">
            {isActive ? "Анализируется ИИ..." : (isCompleted ? "Анализ завершен" : "Требует внимания")}
        </p>
        
        <div className="flex items-center justify-between pt-4 border-t border-white/5">
            <div className="flex items-center space-x-2">
                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></span>
                <span className="text-[9px] font-mono-label text-neutral-400 uppercase tracking-widest">
                    {d.progress ? `ПРОГРЕСС: ${d.progress}` : `${d.childCount ?? 0} ПОДЗАДАЧ`}
                </span>
            </div>
            {(d.childCount ?? 0) > 0 && (
                <button
                    onClick={(e) => { e.stopPropagation(); d.onToggle?.(); }}
                    className="text-neutral-600 group-hover:text-white transition-colors"
                >
                    {d.expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
            )}
        </div>

        {/* AI Summary Table */}
        {isCompleted && hasSummary && (
        <div className="pt-4 mt-2 border-t border-white/5">
            <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            >
            <div className="space-y-1.5">
                {Object.entries(d.summary as Record<string, string>).map(([key, val]) => (
                <div key={key} className="flex flex-col gap-0.5 overflow-hidden mb-2">
                    <span className="text-[9px] font-code text-neutral-500 uppercase tracking-tight shrink-0 font-medium">{key}:</span>
                    <span className="text-[10px] text-neutral-300 font-semibold">{val}</span>
                </div>
                ))}
            </div>
            </motion.div>
        </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-white/20 !w-1.5 !h-1.5 !border-none opacity-0" />
    </motion.div>
  );
});
