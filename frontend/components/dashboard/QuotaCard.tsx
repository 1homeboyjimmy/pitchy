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
    <div className="lovable-glass-strong border border-white/5 p-5 sm:p-8 flex flex-col justify-between hover:border-white/20 transition-all duration-500 rounded-2xl sm:rounded-[2rem] bg-gradient-to-br from-white/[0.04] to-transparent min-h-[130px] sm:min-h-[220px] group">
      <div className="flex justify-between items-start mb-6 sm:mb-12 gap-3">
        <span className="font-sans text-[12px] sm:text-[14px] text-white/50 tracking-tight leading-snug">{label}</span>
        <Icon className="text-white/20 group-hover:text-white/40 transition-colors shrink-0" size={18} />
      </div>
      <div>
        <div className="flex items-baseline gap-2 mb-2 sm:mb-3 flex-wrap">
          <span className="font-sans text-3xl sm:text-5xl font-semibold text-white tracking-tight leading-none">
            {bigValue}
          </span>
          {!isUnlimited && (
            <span className="font-mono text-[9px] sm:text-[10px] text-white/30 font-bold tracking-widest uppercase">
              {caption}
            </span>
          )}
        </div>
        {!isUnlimited ? (
          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mb-2 sm:mb-3">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.round((1 - percentUsed) * 100)}%` }}
              transition={{ duration: 1.2, ease: "easeOut" }}
              className="h-full bg-white/80"
            />
          </div>
        ) : (
          <div className="h-1 mb-2 sm:mb-3" />
        )}
        <p className="font-mono text-[9px] text-white/20 font-bold tracking-widest uppercase">
          {subline}
        </p>
      </div>
    </div>
  );
}
