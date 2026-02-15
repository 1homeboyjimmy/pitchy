import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, Zap, TrendingUp, Users, Building2, Loader2, CheckCircle2, AlertTriangle, Lightbulb } from 'lucide-react';
import { ScoreRing } from '../ui/ScoreRing';

interface Message {
  id: string;
  type: 'ai' | 'user' | 'system';
  content: string;
  timestamp: Date;
  analysis?: AnalysisResult;
}

interface AnalysisResult {
  name: string;
  score: number;
  breakdown: {
    market: number;
    team: number;
    product: number;
    traction: number;
    financials: number;
  };
  strengths: string[];
  risks: string[];
  recommendation: string;
  summary: string;
}

interface ChatInterfaceProps {
  initialQuery?: string;
  onAnalysisComplete?: (analysis: AnalysisResult) => void;
}

const quickPrompts = [
  { icon: Zap, label: 'Analyze Stripe', query: 'Analyze Stripe' },
  { icon: Building2, label: 'Evaluate Airbnb', query: 'Evaluate Airbnb' },
  { icon: TrendingUp, label: 'Check Notion', query: 'Check Notion' },
  { icon: Users, label: 'Review Figma', query: 'Review Figma' },
];

// Mock analysis data - AI intelligence report format
const mockAnalysis = (query: string): AnalysisResult => {
  const companies: Record<string, AnalysisResult> = {
    'stripe': {
      name: 'Stripe',
      score: 94,
      breakdown: { market: 96, team: 95, product: 98, traction: 92, financials: 90 },
      strengths: [
        'Category-leading payment infrastructure',
        'Exceptional developer experience',
        'Strong recurring revenue model',
        'Global market penetration'
      ],
      risks: [
        'Regulatory pressure in fintech',
        'Increasing competition from Big Tech',
        'Economic downturn impact on transaction volume'
      ],
      recommendation: 'STRONG BUY — Market leader with durable competitive advantages',
      summary: 'Stripe demonstrates exceptional product-market fit with a best-in-class developer experience. The company has built a robust moat through network effects and platform stickiness.',
    },
    'airbnb': {
      name: 'Airbnb',
      score: 88,
      breakdown: { market: 90, team: 88, product: 92, traction: 85, financials: 86 },
      strengths: [
        'Two-sided marketplace with strong network effects',
        'Global brand recognition',
        'Diversified revenue streams',
        'Post-pandemic travel recovery'
      ],
      risks: [
        'Regulatory challenges in key markets',
        'Supply constraints in high-demand areas',
        'Macroeconomic sensitivity'
      ],
      recommendation: 'BUY — Solid fundamentals with growth potential',
      summary: 'Airbnb has successfully navigated post-pandemic recovery and continues to strengthen its marketplace position. Strong brand and network effects provide defensibility.',
    },
    'notion': {
      name: 'Notion',
      score: 87,
      breakdown: { market: 85, team: 90, product: 95, traction: 88, financials: 78 },
      strengths: [
        'Exceptional product-led growth',
        'Passionate user community',
        'Flexible all-in-one workspace',
        'Strong viral coefficient'
      ],
      risks: [
        'Intense competition from Microsoft and Google',
        'Enterprise sales motion still developing',
        'Feature complexity may alienate casual users'
      ],
      recommendation: 'BUY — Product excellence with strong growth trajectory',
      summary: 'Notion has achieved remarkable product-market fit with a passionate user base. The challenge lies in scaling enterprise adoption against entrenched competitors.',
    },
    'figma': {
      name: 'Figma',
      score: 91,
      breakdown: { market: 88, team: 92, product: 98, traction: 90, financials: 88 },
      strengths: [
        'Category-defining design tool',
        'Real-time collaboration moat',
        'Adobe acquisition validates market position',
        'Expanding into developer handoff'
      ],
      risks: [
        'Adobe integration execution risk',
        'Emerging AI design tools',
        'Market saturation in core design segment'
      ],
      recommendation: 'STRONG BUY — Category leader with strategic value',
      summary: 'Figma has fundamentally transformed design workflows. The Adobe acquisition underscores its strategic importance in the creative toolchain.',
    },
  };

  const key = Object.keys(companies).find(k => query.toLowerCase().includes(k));
  return key ? companies[key] : {
    name: query.replace(/(analyze|evaluate|check|review)/i, '').trim(),
    score: Math.floor(Math.random() * 40) + 50,
    breakdown: {
      market: Math.floor(Math.random() * 40) + 50,
      team: Math.floor(Math.random() * 40) + 50,
      product: Math.floor(Math.random() * 40) + 50,
      traction: Math.floor(Math.random() * 40) + 50,
      financials: Math.floor(Math.random() * 40) + 50,
    },
    strengths: [
      'Emerging market opportunity',
      'Innovative product approach',
      'Growing user base'
    ],
    risks: [
      'Limited track record',
      'Competitive market dynamics',
      'Execution risk on growth plans'
    ],
    recommendation: 'HOLD — Monitor for additional traction signals',
    summary: 'Early-stage player with moderate traction. Further validation needed before significant investment consideration.',
  };
};

export function ChatInterface({ initialQuery = '', onAnalysisComplete }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      type: 'ai',
      content: "Hello! I'm your AI startup analyst. Enter a company name to get an intelligence report with risk assessment and investment recommendation.",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState(initialQuery);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (initialQuery) {
      handleSend(initialQuery);
    }
  }, [initialQuery]);

  const handleSend = async (query: string = inputValue) => {
    if (!query.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: query,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    // Simulate AI processing
    setTimeout(() => {
      const analysis = mockAnalysis(query);
      
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        content: `Analysis complete for ${analysis.name}.`,
        timestamp: new Date(),
        analysis,
      };

      setMessages(prev => [...prev, aiMessage]);
      setIsTyping(false);
      onAnalysisComplete?.(analysis);
    }, 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Chat Window */}
      <div className="glass-panel rounded-3xl overflow-hidden shadow-glow-primary/30">
        {/* Messages Area */}
        <div className="h-[400px] sm:h-[500px] overflow-y-auto p-4 sm:p-6 space-y-4">
          <AnimatePresence mode="popLayout">
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className={`flex ${
                  message.type === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[85%] sm:max-w-[75%] ${
                    message.type === 'user'
                      ? 'bg-pitchy-violet/20 border border-pitchy-violet/30 rounded-2xl rounded-tr-sm'
                      : 'glass-card rounded-2xl rounded-tl-sm'
                  } px-4 py-3`}
                >
                  {message.type === 'ai' && (
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-pitchy-violet to-pitchy-cyan flex items-center justify-center">
                        <Sparkles className="w-3 h-3 text-white" />
                      </div>
                      <span className="text-xs font-medium text-white/60">AI Analyst</span>
                    </div>
                  )}
                  
                  <p className="text-sm sm:text-base text-white/90 leading-relaxed">
                    {message.content}
                  </p>

                  {/* Analysis Result Card - New Format */}
                  {message.analysis && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3, duration: 0.4 }}
                      className="mt-4 pt-4 border-t border-white/10"
                    >
                      {/* Score Header */}
                      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-6">
                        <div className="flex-shrink-0">
                          <ScoreRing score={message.analysis.score} size="md" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-white mb-1">
                            {message.analysis.name}
                          </h3>
                          <p className="text-sm text-white/60 leading-relaxed">
                            {message.analysis.summary}
                          </p>
                        </div>
                      </div>

                      {/* Breakdown Metrics */}
                      <div className="mb-6">
                        <h4 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">
                          Score Breakdown
                        </h4>
                        <div className="space-y-2">
                          {Object.entries(message.analysis.breakdown).map(([key, value], i) => (
                            <motion.div
                              key={key}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.5 + i * 0.1 }}
                              className="flex items-center gap-3"
                            >
                              <span className="w-20 text-xs text-white/50 capitalize">{key}</span>
                              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${value}%` }}
                                  transition={{ delay: 0.6 + i * 0.1, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                                  className="h-full rounded-full"
                                  style={{
                                    background: value >= 90 ? '#10B981' : value >= 75 ? '#14B8A6' : value >= 60 ? '#F59E0B' : '#F97316',
                                  }}
                                />
                              </div>
                              <span className="w-8 text-xs font-mono-numbers text-white/70 text-right">{value}</span>
                            </motion.div>
                          ))}
                        </div>
                      </div>

                      {/* Strengths */}
                      <div className="mb-4">
                        <h4 className="text-xs font-medium text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Strengths
                        </h4>
                        <ul className="space-y-1.5">
                          {message.analysis.strengths.map((strength, i) => (
                            <motion.li
                              key={i}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.8 + i * 0.05 }}
                              className="text-sm text-white/70 flex items-start gap-2"
                            >
                              <span className="w-1 h-1 rounded-full bg-emerald-400 mt-2 flex-shrink-0" />
                              {strength}
                            </motion.li>
                          ))}
                        </ul>
                      </div>

                      {/* Risks */}
                      <div className="mb-4">
                        <h4 className="text-xs font-medium text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Key Risks
                        </h4>
                        <ul className="space-y-1.5">
                          {message.analysis.risks.map((risk, i) => (
                            <motion.li
                              key={i}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.9 + i * 0.05 }}
                              className="text-sm text-white/70 flex items-start gap-2"
                            >
                              <span className="w-1 h-1 rounded-full bg-amber-400 mt-2 flex-shrink-0" />
                              {risk}
                            </motion.li>
                          ))}
                        </ul>
                      </div>

                      {/* Recommendation */}
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 1 }}
                        className="p-3 rounded-xl bg-white/5 border border-white/10"
                      >
                        <h4 className="text-xs font-medium text-pitchy-violet uppercase tracking-wider mb-1 flex items-center gap-1.5">
                          <Lightbulb className="w-3.5 h-3.5" />
                          Recommendation
                        </h4>
                        <p className="text-sm text-white/80">{message.analysis.recommendation}</p>
                      </motion.div>

                      {/* Actions */}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-white hover:bg-white/15 transition-colors"
                        >
                          Save Analysis
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-colors border border-white/10"
                        >
                          Compare
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-colors border border-white/10"
                        >
                          Export PDF
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Typing Indicator */}
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex justify-start"
            >
              <div className="glass-card rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-full bg-gradient-to-br from-pitchy-violet to-pitchy-cyan flex items-center justify-center">
                    <Sparkles className="w-3 h-3 text-white" />
                  </div>
                  <span className="text-xs font-medium text-white/60">AI Analyst</span>
                </div>
                <div className="flex items-center gap-1">
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                    className="w-2 h-2 rounded-full bg-pitchy-violet"
                  />
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: 0.15 }}
                    className="w-2 h-2 rounded-full bg-pitchy-violet"
                  />
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: 0.3 }}
                    className="w-2 h-2 rounded-full bg-pitchy-violet"
                  />
                </div>
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 sm:p-6 border-t border-white/8 bg-black/20">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter startup name..."
              className="w-full pitchy-input pr-12 text-sm sm:text-base"
              disabled={isTyping}
            />
            <motion.button
              onClick={() => handleSend()}
              disabled={!inputValue.trim() || isTyping}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-xl bg-pitchy-violet text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-glow-primary"
            >
              {isTyping ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </motion.button>
          </div>

          {/* Quick Prompts */}
          <div className="mt-4 flex flex-wrap gap-2">
            {quickPrompts.map((prompt, idx) => (
              <motion.button
                key={prompt.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * idx }}
                onClick={() => handleSend(prompt.query)}
                disabled={isTyping}
                whileHover={{ scale: 1.02, backgroundColor: 'rgba(255, 255, 255, 0.1)' }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/5 text-white/60 border border-white/8 hover:text-white/90 hover:border-white/15 transition-all disabled:opacity-40"
              >
                <prompt.icon className="w-3.5 h-3.5" />
                {prompt.label}
              </motion.button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatInterface;
