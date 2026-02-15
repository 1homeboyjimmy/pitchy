"use client";

import { motion } from "framer-motion";
import { CountUp } from "../reactbits/CountUp";

interface ScoreCardProps {
  score: number;
  strengths: string[];
  weaknesses: string[];
  explanation: string;
}

export function ScoreCard({ score, strengths, weaknesses, explanation }: ScoreCardProps) {
  const getScoreColor = (value: number) => {
    if (value >= 80) return "text-emerald-400";
    if (value >= 60) return "text-yellow-400";
    if (value >= 40) return "text-orange-400";
    return "text-red-400";
  };

  const getScoreBg = (value: number) => {
    if (value >= 80) return "from-emerald-500/20 to-emerald-600/10";
    if (value >= 60) return "from-yellow-500/20 to-yellow-600/10";
    if (value >= 40) return "from-orange-500/20 to-orange-600/10";
    return "from-red-500/20 to-red-600/10";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-4xl mx-auto"
    >
      <div
        className={`relative p-8 rounded-2xl bg-gradient-to-br ${getScoreBg(
          score
        )} border border-zinc-800/50 mb-6`}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-zinc-400 text-lg mb-1">Инвестиционная оценка</h3>
            <div className={`text-6xl font-bold ${getScoreColor(score)}`}>
              <CountUp end={score} duration={1.5} suffix="/100" />
            </div>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-medium ${getScoreColor(score)}`}>
              {score >= 80
                ? "Отлично"
                : score >= 60
                  ? "Хорошо"
                  : score >= 40
                    ? "Средне"
                    : "Плохо"}
            </div>
            <p className="text-zinc-500 text-sm mt-1">На основе ИИ-анализа</p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800/50"
        >
          <h4 className="text-emerald-400 font-medium mb-4 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Сильные стороны
          </h4>
          <ul className="space-y-2">
            {strengths.map((strength, index) => (
              <motion.li
                key={index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + index * 0.1 }}
                className="text-zinc-300 text-sm flex items-start gap-2"
              >
                <span className="text-emerald-500 mt-1">•</span>
                {strength}
              </motion.li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800/50"
        >
          <h4 className="text-red-400 font-medium mb-4 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            Слабые стороны
          </h4>
          <ul className="space-y-2">
            {weaknesses.map((weakness, index) => (
              <motion.li
                key={index}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + index * 0.1 }}
                className="text-zinc-300 text-sm flex items-start gap-2"
              >
                <span className="text-red-500 mt-1">•</span>
                {weakness}
              </motion.li>
            ))}
          </ul>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800/50"
      >
        <h4 className="text-violet-400 font-medium mb-3">Анализ ИИ</h4>
        <p className="text-zinc-400 text-sm leading-relaxed whitespace-pre-line">
          {explanation}
        </p>
      </motion.div>
    </motion.div>
  );
}
