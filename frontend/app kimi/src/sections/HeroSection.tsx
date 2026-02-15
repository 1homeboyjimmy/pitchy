import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Zap, Target, BarChart3, ChevronDown } from 'lucide-react';
import { ChatInterface } from '../components/chat/ChatInterface';

interface HeroSectionProps {
  onStartAnalysis?: (_query: string) => void;
}

const features = [
  { icon: Zap, label: '30 seconds', sublabel: 'Analysis time' },
  { icon: Target, label: '0-100', sublabel: 'Score scale' },
  { icon: BarChart3, label: 'Deep dive', sublabel: '5 key metrics' },
];

export function HeroSection({ onStartAnalysis: _onStartAnalysis }: HeroSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Parallax effect for background
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const { clientX, clientY } = e;
      const { innerWidth, innerHeight } = window;
      
      const x = (clientX / innerWidth - 0.5) * 20;
      const y = (clientY / innerHeight - 0.5) * 20;
      
      containerRef.current.style.setProperty('--mouse-x', `${x}px`);
      containerRef.current.style.setProperty('--mouse-y', `${y}px`);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <section 
      ref={containerRef}
      className="relative min-h-screen flex flex-col items-center justify-center pt-16 pb-12 px-4 sm:px-6 lg:px-8 overflow-hidden"
    >
      {/* Background Effects */}
      <div className="absolute inset-0 gradient-hero" />
      
      {/* Animated gradient orb */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 60%)',
          filter: 'blur(60px)',
          transform: 'translate(calc(-50% + var(--mouse-x, 0px)), calc(-25% + var(--mouse-y, 0px)))',
          transition: 'transform 0.3s ease-out',
        }}
      />

      {/* Grid pattern */}
      <div className="absolute inset-0 grid-pattern opacity-50" />

      {/* Content */}
      <div className="relative z-10 w-full max-w-5xl mx-auto">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex justify-center mb-6"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card">
            <Sparkles className="w-4 h-4 text-pitchy-violet" />
            <span className="text-sm text-white/70">AI-powered startup intelligence</span>
          </div>
        </motion.div>

        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-center mb-4"
        >
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-tight">
            <span className="text-gradient">Pitchy</span>
            <span className="text-pitchy-violet">.pro</span>
          </h1>
        </motion.div>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-center text-lg sm:text-xl md:text-2xl text-white/70 mb-4 max-w-2xl mx-auto"
        >
          Evaluate any startup in seconds
        </motion.p>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="text-center text-sm sm:text-base text-white/50 mb-10 max-w-xl mx-auto"
        >
          AI-powered analysis for investors, founders, and analysts. 
          Get instant scores across 5 key metrics.
        </motion.p>

        {/* Chat Interface */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <ChatInterface onAnalysisComplete={(analysis) => {
            console.log('Analysis complete:', analysis);
          }} />
        </motion.div>

        {/* Feature Pills */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="flex flex-wrap justify-center gap-3 sm:gap-4 mt-8"
        >
          {features.map((feature, index) => (
            <motion.div
              key={feature.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8 + index * 0.1 }}
              whileHover={{ scale: 1.05, backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
              className="flex items-center gap-2 px-4 py-2 rounded-full glass-card cursor-default"
            >
              <feature.icon className="w-4 h-4 text-pitchy-violet" />
              <span className="text-sm font-medium text-white">{feature.label}</span>
              <span className="text-xs text-white/40">{feature.sublabel}</span>
            </motion.div>
          ))}
        </motion.div>

        {/* Trust badges */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 1 }}
          className="mt-12 text-center"
        >
          <p className="text-xs text-white/30 uppercase tracking-wider mb-4">
            Trusted by investors and founders worldwide
          </p>
          <div className="flex flex-wrap justify-center items-center gap-6 sm:gap-8 opacity-40">
            {['YC', 'a16z', 'Sequoia', 'Accel', 'Index'].map((firm, index) => (
              <motion.span
                key={firm}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.1 + index * 0.1 }}
                className="text-lg sm:text-xl font-bold text-white/60"
              >
                {firm}
              </motion.span>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="flex flex-col items-center gap-2 text-white/30"
        >
          <span className="text-xs uppercase tracking-wider">Scroll</span>
          <ChevronDown className="w-4 h-4" />
        </motion.div>
      </motion.div>
    </section>
  );
}

export default HeroSection;
