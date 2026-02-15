import { motion } from 'framer-motion';
import { Sparkles, Brain, Zap, Target, TrendingUp } from 'lucide-react';
import { GlassCard, PageWrapper } from '../components/shared';

interface AboutProps {
  onNavigate?: (page: string) => void;
}

const advantages = [
  {
    icon: Brain,
    title: 'AI-Powered Analysis',
    description: 'Our neural networks process millions of data points to identify patterns invisible to human analysts.',
  },
  {
    icon: Zap,
    title: 'Instant Results',
    description: 'Get comprehensive startup intelligence in under 30 seconds, not weeks of manual research.',
  },
  {
    icon: Target,
    title: 'Objective Scoring',
    description: 'Remove bias with standardized 100-point evaluation across 5 key dimensions.',
  },
  {
    icon: TrendingUp,
    title: 'Predictive Insights',
    description: 'Machine learning models trained on thousands of startup outcomes for accurate forecasting.',
  },
];

export function About({ onNavigate }: AboutProps) {
  return (
    <PageWrapper>
      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center mb-16"
      >
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card mb-6">
          <Sparkles className="w-4 h-4 text-pitchy-violet" />
          <span className="text-sm text-white/70">About Pitchy.pro</span>
        </div>
        
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-6">
          The future of{' '}
          <span className="text-gradient-violet">startup analysis</span>
        </h1>
        
        <p className="text-lg text-white/60 max-w-2xl mx-auto">
          We believe every investor deserves access to institutional-grade startup intelligence. 
          Our AI levels the playing field.
        </p>
      </motion.section>

      {/* Mission */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="mb-16"
      >
        <GlassCard className="p-8 sm:p-12 text-center" glow="violet">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
            Our Mission
          </h2>
          <p className="text-lg text-white/60 max-w-2xl mx-auto leading-relaxed">
            Democratize startup evaluation by making AI-powered analysis accessible to every investor, 
            founder, and analyst. We combine cutting-edge machine learning with deep domain expertise 
            to deliver insights that were once reserved for top-tier VC firms.
          </p>
        </GlassCard>
      </motion.section>

      {/* Why AI is Better */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="mb-16"
      >
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-8">
          Why AI analysis outperforms human evaluation
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {advantages.map((item, index) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 + index * 0.1 }}
            >
              <GlassCard className="p-6 h-full">
                <div className="w-12 h-12 rounded-xl bg-pitchy-violet/20 flex items-center justify-center mb-4">
                  <item.icon className="w-6 h-6 text-pitchy-violet" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-white/50">{item.description}</p>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Stats */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="mb-16"
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { value: '50K+', label: 'Startups Analyzed' },
            { value: '98%', label: 'Accuracy Rate' },
            { value: '30s', label: 'Analysis Time' },
            { value: '5', label: 'Key Metrics' },
          ].map((stat) => (
            <GlassCard key={stat.label} className="p-6 text-center">
              <div className="text-3xl sm:text-4xl font-bold text-white font-mono-numbers mb-1">
                {stat.value}
              </div>
              <div className="text-sm text-white/50">{stat.label}</div>
            </GlassCard>
          ))}
        </div>
      </motion.section>

      {/* CTA */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="text-center"
      >
        <GlassCard className="p-8 sm:p-12 inline-block" glow="violet">
          <h2 className="text-2xl font-bold text-white mb-4">
            Ready to experience AI-powered analysis?
          </h2>
          <p className="text-white/60 mb-6">
            Join thousands of investors making smarter decisions.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <motion.button
              onClick={() => onNavigate?.('signup')}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-6 py-3 rounded-xl bg-pitchy-violet text-white font-medium hover:bg-pitchy-violet/90 transition-colors shadow-glow-primary"
            >
              Get Started Free
            </motion.button>
            <motion.button
              onClick={() => onNavigate?.('chat')}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-medium hover:bg-white/10 transition-colors"
            >
              Try Demo
            </motion.button>
          </div>
        </GlassCard>
      </motion.section>
    </PageWrapper>
  );
}

export default About;
