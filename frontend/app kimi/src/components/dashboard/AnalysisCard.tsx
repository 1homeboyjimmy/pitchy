import { motion } from 'framer-motion';
import { Calendar, ArrowRight, Building2 } from 'lucide-react';
import { ScoreRing } from '../ui/ScoreRing';

interface Analysis {
  id: string;
  name: string;
  score: number;
  category: string;
  date: string;
  summary: string;
}

interface AnalysisCardProps {
  analysis: Analysis;
  index?: number;
  onClick?: () => void;
}

export function AnalysisCard({ analysis, index = 0, onClick }: AnalysisCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ scale: 1.01, backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className="glass-card-hover p-4 sm:p-5 cursor-pointer group"
    >
      <div className="flex items-center gap-4">
        {/* Score */}
        <div className="flex-shrink-0">
          <ScoreRing score={analysis.score} size="sm" showLabel={false} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-white group-hover:text-pitchy-violet-light transition-colors">
                {analysis.name}
              </h3>
              <div className="flex items-center gap-2 mt-0.5">
                <Building2 className="w-3.5 h-3.5 text-white/40" />
                <span className="text-xs sm:text-sm text-white/50">{analysis.category}</span>
              </div>
            </div>
            
            <motion.div
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              whileHover={{ x: 3 }}
            >
              <ArrowRight className="w-5 h-5 text-pitchy-violet" />
            </motion.div>
          </div>

          <p className="mt-2 text-xs sm:text-sm text-white/60 line-clamp-1">
            {analysis.summary}
          </p>

          <div className="mt-3 flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-white/40">
              <Calendar className="w-3 h-3" />
              <span>{analysis.date}</span>
            </div>
            
            {/* Score badge */}
            <span 
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                analysis.score >= 90 ? 'bg-emerald-500/20 text-emerald-400' :
                analysis.score >= 75 ? 'bg-teal-500/20 text-teal-400' :
                analysis.score >= 60 ? 'bg-amber-500/20 text-amber-400' :
                analysis.score >= 40 ? 'bg-orange-500/20 text-orange-400' :
                'bg-red-500/20 text-red-400'
              }`}
            >
              {analysis.score >= 90 ? 'Exceptional' :
               analysis.score >= 75 ? 'Strong' :
               analysis.score >= 60 ? 'Moderate' :
               analysis.score >= 40 ? 'Weak' : 'Poor'}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default AnalysisCard;
