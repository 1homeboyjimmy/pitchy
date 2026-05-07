"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { QuotaSnapshot } from "@/lib/planLimits";

interface QuotaCardProps {
  label: string;
  caption: string;
  icon: LucideIcon;
  snapshot: QuotaSnapshot;
}

export function QuotaCard({ label, caption, icon: Icon, snapshot }: QuotaCardProps) {
  const { remaining, limit, isUnlimited, percentUsed } = snapshot;

  const bigValue = isUnlimited ? "∞" : remaining.toLocaleString("ru-RU");
  const subline = isUnlimited
    ? "БЕЗЛИМИТ"
    : `ИЗ ${limit.toLocaleString("ru-RU")}`;

  return (
    <div className="lovable-glass-strong border border-white/5 p-8 flex flex-col justify-between hover:border-white/20 transition-all duration-500 rounded-[2rem] bg-gradient-to-br from-white/[0.04] to-transparent min-h-[220px] group">
      <div className="flex justify-between items-start mb-12">
        <span className="font-sans text-[14px] text-white/50 tracking-tight">{label}</span>
        <Icon className="text-white/20 group-hover:text-white/40 transition-colors" size={20} />
      </div>
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <span className="font-sans text-5xl font-semibold text-white tracking-tight leading-none">
            {bigValue}
          </span>
          {!isUnlimited && (
            <span className="font-mono text-[10px] text-white/30 font-bold tracking-widest uppercase">
              {caption}
            </span>
          )}
        </div>
        {!isUnlimited ? (
          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mb-3">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.round((1 - percentUsed) * 100)}%` }}
              transition={{ duration: 1.2, ease: "easeOut" }}
              className="h-full bg-white/80"
            />
          </div>
        ) : (
          <div className="h-1 mb-3" />
        )}
        <p className="font-mono text-[9px] text-white/20 font-bold tracking-widest uppercase">
          {subline}
        </p>
      </div>
    </div>
  );
}
