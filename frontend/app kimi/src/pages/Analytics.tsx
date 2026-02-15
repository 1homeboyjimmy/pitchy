import { motion } from 'framer-motion';
import { TrendingUp, Download, Lightbulb } from 'lucide-react';
import { GlassCard, Button, PageWrapper } from '../components/shared';
import { ScoreRing } from '../components/ui/ScoreRing';

// Mock data for analytics
const portfolioData = {
  totalAnalyzed: 47,
  averageScore: 76,
  highPerformers: 18,
  atRisk: 8,
  scoreDistribution: [
    { range: '90-100', count: 5, color: '#10B981' },
    { range: '75-89', count: 13, color: '#14B8A6' },
    { range: '60-74', count: 21, color: '#F59E0B' },
    { range: '40-59', count: 6, color: '#F97316' },
    { range: '0-39', count: 2, color: '#EF4444' },
  ],
  recentTrend: [
    { month: 'Jan', score: 72 },
    { month: 'Feb', score: 74 },
    { month: 'Mar', score: 73 },
    { month: 'Apr', score: 76 },
    { month: 'May', score: 78 },
    { month: 'Jun', score: 76 },
  ],
  insights: [
    'Portfolio average improved 5.6% over last quarter',
    'Product dimension shows strongest performance',
    'Financials metric needs attention for 4 startups',
    'Market timing appears favorable for new investments',
  ],
};

export function Analytics() {
  return (
    <PageWrapper>
      {/* Header */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8"
      >
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">Analytics</h1>
          <p className="mt-1 text-white/50">Portfolio insights and trends</p>
        </div>
        <Button variant="glass" icon={<Download className="w-4 h-4" />} iconPosition="left">
          Export Report
        </Button>
      </motion.section>

      {/* Overview Stats */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
      >
        <GlassCard className="p-5 text-center">
          <div className="text-3xl font-bold text-white font-mono-numbers mb-1">
            {portfolioData.totalAnalyzed}
          </div>
          <div className="text-sm text-white/50">Total Analyzed</div>
        </GlassCard>
        <GlassCard className="p-5 text-center">
          <div className="text-3xl font-bold text-emerald-400 font-mono-numbers mb-1">
            {portfolioData.averageScore}
          </div>
          <div className="text-sm text-white/50">Average Score</div>
        </GlassCard>
        <GlassCard className="p-5 text-center">
          <div className="text-3xl font-bold text-pitchy-violet font-mono-numbers mb-1">
            {portfolioData.highPerformers}
          </div>
          <div className="text-sm text-white/50">High Performers</div>
        </GlassCard>
        <GlassCard className="p-5 text-center">
          <div className="text-3xl font-bold text-amber-400 font-mono-numbers mb-1">
            {portfolioData.atRisk}
          </div>
          <div className="text-sm text-white/50">At Risk</div>
        </GlassCard>
      </motion.section>

      {/* Main Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Score Overview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="lg:col-span-1"
        >
          <GlassCard className="p-6 h-full flex flex-col items-center justify-center">
            <h3 className="text-lg font-semibold text-white mb-4">Portfolio Score</h3>
            <ScoreRing score={portfolioData.averageScore} size="lg" />
            <p className="mt-4 text-sm text-white/50 text-center">
              Based on {portfolioData.totalAnalyzed} startup analyses
            </p>
          </GlassCard>
        </motion.div>

        {/* Score Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="lg:col-span-2"
        >
          <GlassCard className="p-6 h-full">
            <h3 className="text-lg font-semibold text-white mb-6">Score Distribution</h3>
            <div className="space-y-4">
              {portfolioData.scoreDistribution.map((item) => (
                <div key={item.range} className="flex items-center gap-4">
                  <span className="w-16 text-sm text-white/50 font-mono-numbers">{item.range}</span>
                  <div className="flex-1 h-3 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(item.count / portfolioData.totalAnalyzed) * 100}%` }}
                      transition={{ duration: 0.8, delay: 0.4 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                  </div>
                  <span className="w-8 text-sm text-white/70 font-mono-numbers text-right">{item.count}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>
      </div>

      {/* Trend Chart & Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          <GlassCard className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <TrendingUp className="w-5 h-5 text-pitchy-violet" />
              <h3 className="text-lg font-semibold text-white">Score Trend</h3>
            </div>
            <div className="flex items-end justify-between h-40 gap-2">
              {portfolioData.recentTrend.map((item, index) => (
                <div key={item.month} className="flex-1 flex flex-col items-center gap-2">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${(item.score / 100) * 140}px` }}
                    transition={{ duration: 0.5, delay: 0.5 + index * 0.1 }}
                    className="w-full max-w-12 rounded-t-lg bg-gradient-to-t from-pitchy-violet/50 to-pitchy-violet"
                  />
                  <span className="text-xs text-white/50">{item.month}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* AI Insights */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <GlassCard className="p-6" glow="violet">
            <div className="flex items-center gap-3 mb-6">
              <Lightbulb className="w-5 h-5 text-pitchy-violet" />
              <h3 className="text-lg font-semibold text-white">AI Insights</h3>
            </div>
            <ul className="space-y-4">
              {portfolioData.insights.map((insight, index) => (
                <motion.li
                  key={index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + index * 0.1 }}
                  className="flex items-start gap-3"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-pitchy-violet mt-2 flex-shrink-0" />
                  <span className="text-white/70">{insight}</span>
                </motion.li>
              ))}
            </ul>
          </GlassCard>
        </motion.div>
      </div>
    </PageWrapper>
  );
}

export default Analytics;
