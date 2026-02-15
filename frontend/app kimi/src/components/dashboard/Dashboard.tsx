import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  LayoutDashboard, 
  MessageSquare, 
  BarChart3, 
  Settings, 
  Plus,
  Search,
  Filter,
  TrendingUp,
  Activity,
  Star,
  Clock,
  Sparkles,
  Lock,
  ChevronRight
} from 'lucide-react';
import { AnalysisCard } from './AnalysisCard';
import { StatsCard } from './StatsCard';
import { GlassCard, Button } from '../shared';

interface DashboardProps {
  onNewAnalysis?: () => void;
  onNavigate?: (page: string) => void;
  isAuthenticated?: boolean;
  onLogin?: () => void;
  onSignUp?: () => void;
}

// Mock data for analyses
const mockAnalyses = [
  {
    id: '1',
    name: 'Notion',
    score: 87,
    category: 'Productivity / SaaS',
    date: '2 hours ago',
    summary: 'Innovative productivity tool with passionate user base and strong growth trajectory.',
  },
  {
    id: '2',
    name: 'Stripe',
    score: 94,
    category: 'Fintech / Payments',
    date: '1 day ago',
    summary: 'Leading payment infrastructure with exceptional product-market fit.',
  },
  {
    id: '3',
    name: 'Airbnb',
    score: 88,
    category: 'Travel / Marketplace',
    date: '3 days ago',
    summary: 'Strong marketplace with global reach, recovering well post-pandemic.',
  },
  {
    id: '4',
    name: 'WeWork',
    score: 34,
    category: 'Real Estate / Coworking',
    date: '1 week ago',
    summary: 'Significant challenges with business model and profitability.',
  },
  {
    id: '5',
    name: 'Figma',
    score: 91,
    category: 'Design / Collaboration',
    date: '1 week ago',
    summary: 'Category-defining design tool with exceptional product and market position.',
  },
  {
    id: '6',
    name: 'Coda',
    score: 72,
    category: 'Productivity / SaaS',
    date: '2 weeks ago',
    summary: 'Solid all-in-one document tool competing in crowded market.',
  },
];

const sidebarItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, labelRu: 'Дашборд' },
  { id: 'chat', label: 'New Analysis', icon: MessageSquare, labelRu: 'Новый анализ' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, labelRu: 'Аналитика' },
  { id: 'settings', label: 'Settings', icon: Settings, labelRu: 'Настройки' },
];

// Demo Dashboard Teaser (for non-authenticated users)
function DemoDashboardTeaser() {
  return (
    <div className="relative pointer-events-none select-none">
      {/* Blur overlay */}
      <div className="absolute inset-0 backdrop-blur-[12px] bg-[rgba(10,10,15,0.4)] z-10 rounded-2xl" />
      
      {/* Demo content */}
      <div className="opacity-40 p-6 space-y-6">
        {/* Demo stats */}
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-white/5 border border-white/10" />
          ))}
        </div>
        
        {/* Demo score ring */}
        <div className="flex items-center gap-6">
          <div className="w-32 h-32 rounded-full border-8 border-white/10 flex items-center justify-center">
            <span className="text-3xl font-bold text-white/30 font-mono">87</span>
          </div>
          <div className="flex-1 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-20 h-2 rounded-full bg-white/10" />
                <div className="flex-1 h-2 rounded-full bg-white/10" />
              </div>
            ))}
          </div>
        </div>
        
        {/* Demo list */}
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-white/5 border border-white/10" />
          ))}
        </div>
      </div>
    </div>
  );
}

// Conversion CTA Card (for non-authenticated users)
function ConversionCTA({ onSignUp, onLogin }: { onSignUp?: () => void; onLogin?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative z-20"
    >
      {/* Spotlight gradient */}
      <div 
        className="absolute -inset-20 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 50%, rgba(139, 92, 246, 0.15) 0%, transparent 60%)',
        }}
      />
      
      <GlassCard className="p-8 sm:p-12 text-center max-w-xl mx-auto" glow="violet">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pitchy-violet to-pitchy-cyan flex items-center justify-center shadow-glow-primary">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
        </div>
        
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
          Unlock AI Startup Intelligence
        </h2>
        
        <p className="text-white/60 mb-8 max-w-sm mx-auto">
          Create an account to access AI-powered startup scoring, risk modeling and investor-grade reports.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={onSignUp} icon={<ChevronRight className="w-4 h-4" />} iconPosition="right">
            Create Account
          </Button>
          <Button variant="glass" onClick={onLogin}>
            Log In
          </Button>
        </div>
        
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-white/40">
          <Lock className="w-4 h-4" />
          <span>Free plan available. No credit card required.</span>
        </div>
      </GlassCard>
    </motion.div>
  );
}

export function Dashboard({ 
  onNewAnalysis, 
  onNavigate, 
  isAuthenticated = false,
  onLogin,
  onSignUp 
}: DashboardProps) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [language] = useState<'en' | 'ru'>('en');

  const filteredAnalyses = mockAnalyses.filter(analysis =>
    analysis.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    analysis.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const averageScore = Math.round(
    mockAnalyses.reduce((acc, a) => acc + a.score, 0) / mockAnalyses.length
  );

  const highScores = mockAnalyses.filter(a => a.score >= 75).length;

  // Non-authenticated view
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen pt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Conversion CTA */}
          <ConversionCTA onSignUp={onSignUp} onLogin={onLogin} />
          
          {/* Demo Dashboard Teaser */}
          <div className="mt-12">
            <DemoDashboardTeaser />
          </div>
        </div>
      </div>
    );
  }

  // Authenticated view
  return (
    <div className="min-h-screen pt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
          {/* Sidebar - Desktop */}
          <motion.aside
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            className="hidden lg:block w-64 flex-shrink-0"
          >
            <div className="sticky top-24 space-y-2">
              {sidebarItems.map((item) => (
                <motion.button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    if (item.id === 'chat') onNewAnalysis?.();
                    else onNavigate?.(item.id);
                  }}
                  whileHover={{ scale: 1.02, x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all ${
                    activeTab === item.id
                      ? 'bg-pitchy-violet/20 text-white border border-pitchy-violet/30'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">
                    {language === 'en' ? item.label : item.labelRu}
                  </span>
                </motion.button>
              ))}

              <div className="pt-6 border-t border-white/8">
                <p className="px-4 text-xs font-medium text-white/40 uppercase tracking-wider mb-3">
                  {language === 'en' ? 'Recent' : 'Недавние'}
                </p>
                <div className="space-y-1">
                  {mockAnalyses.slice(0, 3).map((analysis) => (
                    <motion.button
                      key={analysis.id}
                      whileHover={{ scale: 1.02, x: 2 }}
                      whileTap={{ scale: 0.98 }}
                      className="w-full flex items-center justify-between px-4 py-2 rounded-lg text-left hover:bg-white/5 transition-colors"
                    >
                      <span className="text-sm text-white/70">{analysis.name}</span>
                      <span className={`text-xs font-mono-numbers ${
                        analysis.score >= 75 ? 'text-emerald-400' :
                        analysis.score >= 60 ? 'text-amber-400' : 'text-red-400'
                      }`}>
                        {analysis.score}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </div>

              <motion.button
                onClick={onNewAnalysis}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full flex items-center gap-2 px-4 py-3 rounded-xl bg-pitchy-violet text-white font-medium hover:bg-pitchy-violet/90 transition-colors mt-4"
              >
                <Plus className="w-5 h-5" />
                {language === 'en' ? 'New Analysis' : 'Новый анализ'}
              </motion.button>
            </div>
          </motion.aside>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6"
            >
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white">
                  {language === 'en' ? 'Dashboard' : 'Дашборд'}
                </h1>
                <p className="mt-1 text-sm text-white/50">
                  {language === 'en' 
                    ? `You have ${mockAnalyses.length} startup analyses`
                    : `У вас ${mockAnalyses.length} анализов стартапов`}
                </p>
              </div>

              <motion.button
                onClick={onNewAnalysis}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-pitchy-violet text-white font-medium hover:bg-pitchy-violet/90 transition-colors sm:hidden"
              >
                <Plus className="w-5 h-5" />
                {language === 'en' ? 'New Analysis' : 'Новый анализ'}
              </motion.button>
            </motion.div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatsCard
                title={language === 'en' ? 'Total Analyses' : 'Всего анализов'}
                value={mockAnalyses.length}
                subtitle={language === 'en' ? 'All time' : 'За все время'}
                icon={Activity}
                index={0}
                color="violet"
              />
              <StatsCard
                title={language === 'en' ? 'Average Score' : 'Средний скор'}
                value={averageScore}
                subtitle={language === 'en' ? 'Out of 100' : 'Из 100'}
                icon={TrendingUp}
                trend={{ value: 5.2, isPositive: true }}
                index={1}
                color="emerald"
              />
              <StatsCard
                title={language === 'en' ? 'High Scores' : 'Высокие скоры'}
                value={highScores}
                subtitle={language === 'en' ? 'Score 75+' : 'Скор 75+'}
                icon={Star}
                index={2}
                color="cyan"
              />
              <StatsCard
                title={language === 'en' ? 'This Month' : 'В этом месяце'}
                value={4}
                subtitle={language === 'en' ? 'New analyses' : 'Новых анализа'}
                icon={Clock}
                trend={{ value: 12, isPositive: true }}
                index={3}
                color="amber"
              />
            </div>

            {/* Search and Filter */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="flex flex-col sm:flex-row gap-3 mb-6"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={language === 'en' ? 'Search analyses...' : 'Поиск анализов...'}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-pitchy-violet/50 focus:ring-2 focus:ring-pitchy-violet/20 transition-all"
                />
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-all"
              >
                <Filter className="w-4 h-4" />
                {language === 'en' ? 'Filter' : 'Фильтр'}
              </motion.button>
            </motion.div>

            {/* Analyses List */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">
                  {language === 'en' ? 'Recent Analyses' : 'Недавние анализы'}
                </h2>
                <span className="text-sm text-white/40">
                  {filteredAnalyses.length} {language === 'en' ? 'results' : 'результатов'}
                </span>
              </div>

              {filteredAnalyses.length > 0 ? (
                filteredAnalyses.map((analysis, index) => (
                  <AnalysisCard
                    key={analysis.id}
                    analysis={analysis}
                    index={index}
                    onClick={() => console.log('Open analysis:', analysis.id)}
                  />
                ))
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="glass-card p-8 text-center"
                >
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                    <Search className="w-8 h-8 text-white/30" />
                  </div>
                  <p className="text-white/60 font-medium">
                    {language === 'en' ? 'No analyses found' : 'Анализы не найдены'}
                  </p>
                  <p className="mt-1 text-sm text-white/40">
                    {language === 'en' ? 'Try adjusting your search' : 'Попробуйте изменить поиск'}
                  </p>
                </motion.div>
              )}
            </motion.div>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-pitchy-bg/95 backdrop-blur-xl border-t border-white/8 px-4 py-3 z-40">
        <div className="flex items-center justify-around">
          {sidebarItems.slice(0, 4).map((item) => (
            <motion.button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                if (item.id === 'chat') onNewAnalysis?.();
                else onNavigate?.(item.id);
              }}
              whileTap={{ scale: 0.95 }}
              className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${
                activeTab === item.id
                  ? 'text-pitchy-violet'
                  : 'text-white/50'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-xs font-medium">
                {language === 'en' ? item.label : item.labelRu}
              </span>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
