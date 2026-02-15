import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  index?: number;
  color?: 'violet' | 'cyan' | 'emerald' | 'amber';
}

const colorMap = {
  violet: {
    bg: 'rgba(139, 92, 246, 0.1)',
    border: 'rgba(139, 92, 246, 0.2)',
    icon: 'text-pitchy-violet',
    glow: 'shadow-glow-primary/20',
  },
  cyan: {
    bg: 'rgba(6, 182, 212, 0.1)',
    border: 'rgba(6, 182, 212, 0.2)',
    icon: 'text-pitchy-cyan',
    glow: 'shadow-glow-cyan/20',
  },
  emerald: {
    bg: 'rgba(16, 185, 129, 0.1)',
    border: 'rgba(16, 185, 129, 0.2)',
    icon: 'text-emerald-400',
    glow: 'shadow-glow-success/20',
  },
  amber: {
    bg: 'rgba(245, 158, 11, 0.1)',
    border: 'rgba(245, 158, 11, 0.2)',
    icon: 'text-amber-400',
    glow: '',
  },
};

export function StatsCard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  trend, 
  index = 0,
  color = 'violet'
}: StatsCardProps) {
  const colors = colorMap[color];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ scale: 1.02, y: -2 }}
      className={`relative overflow-hidden rounded-2xl p-5 border transition-all duration-300 ${colors.glow}`}
      style={{
        background: colors.bg,
        borderColor: colors.border,
      }}
    >
      {/* Background glow */}
      <div 
        className="absolute -top-10 -right-10 w-20 h-20 rounded-full blur-3xl opacity-30"
        style={{ background: colors.border }}
      />

      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-white/50 font-medium">{title}</p>
            <motion.p
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 + 0.2, duration: 0.4 }}
              className="mt-2 text-2xl sm:text-3xl font-bold text-white font-mono-numbers"
            >
              {value}
            </motion.p>
            
            {subtitle && (
              <p className="mt-1 text-xs text-white/40">{subtitle}</p>
            )}

            {trend && (
              <div className="mt-2 flex items-center gap-1">
                <span className={`text-xs font-medium ${
                  trend.isPositive ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {trend.isPositive ? '+' : ''}{trend.value}%
                </span>
                <span className="text-xs text-white/40">vs last month</span>
              </div>
            )}
          </div>

          <div 
            className={`p-3 rounded-xl`}
            style={{ background: colors.border }}
          >
            <Icon className={`w-5 h-5 ${colors.icon}`} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default StatsCard;
