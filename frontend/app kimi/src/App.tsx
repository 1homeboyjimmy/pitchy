import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { HeroSection } from './sections/HeroSection';
import { FeaturesSection } from './sections/FeaturesSection';
import { Dashboard } from './components/dashboard/Dashboard';
import { ChatInterface } from './components/chat/ChatInterface';
import { DarkVeil } from './components/effects/DarkVeil';
import { 
  Login, 
  SignUp, 
  About, 
  FAQ, 
  Contact, 
  Pricing, 
  Privacy, 
  Terms, 
  Security, 
  Analytics, 
  Settings 
} from './pages';

type Page = 
  | 'landing' 
  | 'dashboard' 
  | 'chat' 
  | 'login' 
  | 'signup' 
  | 'about' 
  | 'faq' 
  | 'contact' 
  | 'pricing' 
  | 'privacy' 
  | 'terms' 
  | 'security'
  | 'analytics'
  | 'settings';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('landing');
  const [initialChatQuery, setInitialChatQuery] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const handleNavigate = (page: string) => {
    const validPages: Page[] = [
      'landing', 'dashboard', 'chat', 'login', 'signup', 
      'about', 'faq', 'contact', 'pricing', 'privacy', 
      'terms', 'security', 'analytics', 'settings'
    ];
    if (validPages.includes(page as Page)) {
      setCurrentPage(page as Page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setCurrentPage('dashboard');
  };



  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentPage('landing');
  };

  const handleNewAnalysis = () => {
    setInitialChatQuery('');
    setCurrentPage('chat');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStartAnalysis = (_query: string) => {
    setInitialChatQuery(_query);
    setCurrentPage('chat');
  };

  // Pages that don't show footer
  const noFooterPages: Page[] = ['login', 'signup', 'chat', 'dashboard', 'analytics', 'settings'];
  const showFooter = !noFooterPages.includes(currentPage);

  return (
    <div className="min-h-screen text-white overflow-x-hidden relative">
      {/* Global DarkVeil Background */}
      <DarkVeil 
        hueShift={0}
        noiseIntensity={0.02}
        scanlineIntensity={0}
        speed={0.4}
        warpAmount={0.15}
        resolutionScale={1}
      />

      <Header 
        onNavigate={handleNavigate} 
        currentPage={currentPage}
        isAuthenticated={isAuthenticated}
        onLogout={handleLogout}
      />

      <AnimatePresence mode="wait">
        {currentPage === 'landing' && (
          <motion.main
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <HeroSection onStartAnalysis={handleStartAnalysis} />
            <FeaturesSection />
            {showFooter && <Footer onNavigate={handleNavigate} />}
          </motion.main>
        )}

        {currentPage === 'chat' && (
          <motion.main
            key="chat"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="min-h-screen pt-24 pb-12 px-4 sm:px-6 lg:px-8"
          >
            <div className="max-w-4xl mx-auto">
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-center mb-8"
              >
                <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                  New Analysis
                </h1>
                <p className="text-white/50">
                  Chat with our AI analyst to evaluate any startup
                </p>
              </motion.div>

              <ChatInterface 
                initialQuery={initialChatQuery}
                onAnalysisComplete={(analysis) => {
                  console.log('Analysis complete:', analysis);
                }}
              />

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="mt-8 text-center"
              >
                <button
                  onClick={() => handleNavigate('dashboard')}
                  className="text-sm text-white/50 hover:text-white transition-colors"
                >
                  View all analyses →
                </button>
              </motion.div>
            </div>
          </motion.main>
        )}

        {currentPage === 'dashboard' && (
          <motion.main
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Dashboard 
              onNewAnalysis={handleNewAnalysis}
              onNavigate={handleNavigate}
              isAuthenticated={isAuthenticated}
              onLogin={() => handleNavigate('login')}
              onSignUp={() => handleNavigate('signup')}
            />
          </motion.main>
        )}

        {currentPage === 'login' && (
          <motion.main
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Login onNavigate={handleNavigate} onLoginSuccess={handleLoginSuccess} />
          </motion.main>
        )}

        {currentPage === 'signup' && (
          <motion.main
            key="signup"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <SignUp onNavigate={handleNavigate} onSignUpSuccess={handleLoginSuccess} />
          </motion.main>
        )}

        {currentPage === 'about' && (
          <motion.main
            key="about"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <About onNavigate={handleNavigate} />
            <Footer onNavigate={handleNavigate} />
          </motion.main>
        )}

        {currentPage === 'faq' && (
          <motion.main
            key="faq"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <FAQ onNavigate={handleNavigate} />
            <Footer onNavigate={handleNavigate} />
          </motion.main>
        )}

        {currentPage === 'contact' && (
          <motion.main
            key="contact"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Contact />
            <Footer onNavigate={handleNavigate} />
          </motion.main>
        )}

        {currentPage === 'pricing' && (
          <motion.main
            key="pricing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Pricing onNavigate={handleNavigate} />
            <Footer onNavigate={handleNavigate} />
          </motion.main>
        )}

        {currentPage === 'privacy' && (
          <motion.main
            key="privacy"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Privacy />
            <Footer onNavigate={handleNavigate} />
          </motion.main>
        )}

        {currentPage === 'terms' && (
          <motion.main
            key="terms"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Terms />
            <Footer onNavigate={handleNavigate} />
          </motion.main>
        )}

        {currentPage === 'security' && (
          <motion.main
            key="security"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Security />
            <Footer onNavigate={handleNavigate} />
          </motion.main>
        )}

        {currentPage === 'analytics' && (
          <motion.main
            key="analytics"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Analytics />
          </motion.main>
        )}

        {currentPage === 'settings' && (
          <motion.main
            key="settings"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Settings />
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
;
