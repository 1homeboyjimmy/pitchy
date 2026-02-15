import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, Sparkles, Globe, User, LogOut } from 'lucide-react';

interface HeaderProps {
  onNavigate?: (page: string) => void;
  currentPage?: string;
  isAuthenticated?: boolean;
  onLogout?: () => void;
}

export function Header({ onNavigate, currentPage = 'landing', isAuthenticated = false, onLogout }: HeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [language, setLanguage] = useState<'en' | 'ru'>('en');

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { id: 'landing', label: 'Home', labelRu: 'Главная' },
    { id: 'chat', label: 'New Analysis', labelRu: 'Новый анализ' },
    { id: 'dashboard', label: 'Dashboard', labelRu: 'Дашборд' },
  ];

  const toggleLanguage = () => {
    setLanguage(prev => prev === 'en' ? 'ru' : 'en');
  };

  return (
    <motion.header
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? 'bg-pitchy-bg/80 backdrop-blur-xl border-b border-white/6'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <motion.button
            onClick={() => onNavigate?.('landing')}
            className="flex items-center gap-2 group"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="relative w-8 h-8 flex items-center justify-center">
              <div className="absolute inset-0 bg-gradient-to-br from-pitchy-violet to-pitchy-cyan rounded-lg opacity-80 group-hover:opacity-100 transition-opacity" />
              <Sparkles className="w-4 h-4 text-white relative z-10" />
            </div>
            <span className="text-lg font-bold text-white tracking-tight">
              Pitchy<span className="text-pitchy-violet">.pro</span>
            </span>
          </motion.button>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <motion.button
                key={item.id}
                onClick={() => onNavigate?.(item.id as any)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  currentPage === item.id
                    ? 'text-white bg-white/10'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {language === 'en' ? item.label : item.labelRu}
              </motion.button>
            ))}
          </nav>

          {/* Right side actions */}
          <div className="flex items-center gap-2">
            {/* Language toggle */}
            <motion.button
              onClick={toggleLanguage}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-all"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Globe className="w-4 h-4" />
              <span className="font-medium uppercase">{language}</span>
            </motion.button>

            {/* Auth buttons - Desktop */}
            <div className="hidden md:flex items-center gap-2">
              {isAuthenticated ? (
                <>
                  <motion.button
                    onClick={() => onNavigate?.('settings')}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-pitchy-violet to-pitchy-cyan flex items-center justify-center">
                      <User className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span>Account</span>
                  </motion.button>
                  <motion.button
                    onClick={onLogout}
                    className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    title="Log out"
                  >
                    <LogOut className="w-4 h-4" />
                  </motion.button>
                </>
              ) : (
                <>
                  <motion.button
                    onClick={() => onNavigate?.('login')}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-white/70 hover:text-white transition-colors"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {language === 'en' ? 'Log in' : 'Войти'}
                  </motion.button>
                  <motion.button
                    onClick={() => onNavigate?.('signup')}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-white text-pitchy-bg hover:bg-white/90 transition-colors"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {language === 'en' ? 'Sign up' : 'Регистрация'}
                  </motion.button>
                </>
              )}
            </div>

            {/* Mobile menu button */}
            <motion.button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition-all"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </motion.button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="md:hidden bg-pitchy-bg/95 backdrop-blur-xl border-b border-white/6"
          >
            <div className="px-4 py-4 space-y-2">
              {navItems.map((item) => (
                <motion.button
                  key={item.id}
                  onClick={() => {
                    onNavigate?.(item.id as any);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full px-4 py-3 rounded-lg text-left text-sm font-medium transition-all ${
                    currentPage === item.id
                      ? 'text-white bg-white/10'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                  whileTap={{ scale: 0.98 }}
                >
                  {language === 'en' ? item.label : item.labelRu}
                </motion.button>
              ))}
              
              <div className="pt-4 border-t border-white/10 space-y-2">
                <motion.button
                  onClick={toggleLanguage}
                  className="w-full flex items-center gap-2 px-4 py-3 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-all"
                  whileTap={{ scale: 0.98 }}
                >
                  <Globe className="w-4 h-4" />
                  <span>{language === 'en' ? 'Switch to Russian' : 'Switch to English'}</span>
                </motion.button>
                
                {isAuthenticated ? (
                  <>
                    <motion.button
                      onClick={() => {
                        onNavigate?.('settings');
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-all"
                      whileTap={{ scale: 0.98 }}
                    >
                      <User className="w-4 h-4" />
                      <span>Account Settings</span>
                    </motion.button>
                    <motion.button
                      onClick={() => {
                        onLogout?.();
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-red-400 hover:text-red-300 hover:bg-white/5 transition-all"
                      whileTap={{ scale: 0.98 }}
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Log out</span>
                    </motion.button>
                  </>
                ) : (
                  <>
                    <motion.button
                      onClick={() => {
                        onNavigate?.('login');
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full px-4 py-3 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-all"
                      whileTap={{ scale: 0.98 }}
                    >
                      {language === 'en' ? 'Log in' : 'Войти'}
                    </motion.button>
                    <motion.button
                      onClick={() => {
                        onNavigate?.('signup');
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full px-4 py-3 rounded-lg text-sm font-medium bg-white text-pitchy-bg hover:bg-white/90 transition-all"
                      whileTap={{ scale: 0.98 }}
                    >
                      {language === 'en' ? 'Sign up' : 'Регистрация'}
                    </motion.button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}

export default Header;
