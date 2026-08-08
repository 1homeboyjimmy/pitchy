"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Mail, Send } from "react-feather";
import { getToken, clearToken, authEvents } from "@/lib/auth";
import { useLayoutStore } from "@/lib/store/layout";

/* ─── Navigation Items ─── */
const navItems = [
  { path: "/", label: "ГЛАВНАЯ" },
  { path: "/dashboard", label: "ДАШБОРД" },
  { path: "/faq", label: "FAQ" },
  { path: "/about", label: "О НАС" },
  { path: "/pricing", label: "ТАРИФЫ" },
  { path: "/contact", label: "КОНТАКТЫ" },
];

/* ─── Footer Column Data ─── */
const footerColumns = [
  {
    title: "Продукт",
    links: [
      { label: "Главная", path: "/" },
      { label: "Тарифы", path: "/pricing" },
      { label: "FAQ", path: "/faq" },
    ],
  },
  {
    title: "Компания",
    links: [
      { label: "О нас", path: "/about" },
      { label: "Контакты", path: "/contact" },
    ],
  },
  {
    title: "Ресурсы",
    links: [
      { label: "Дашборд", path: "/dashboard" },
    ],
  },
  {
    title: "Правовая информация",
    links: [
      { label: "Конфиденциальность", path: "/privacy" },
      { label: "Условия", path: "/terms" },
      { label: "Безопасность", path: "/security" },
    ],
  },
];

const socialLinks = [
  { icon: Send, href: "https://t.me/homeboyjimmy1", label: "Telegram" },
  { icon: Mail, href: "mailto:auth@pitchy.pro", label: "Email" },
];


/* ═══════════════════════════ Header ═══════════════════════════ */
function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Use state for token to trigger re-renders
  const [token, setTokenState] = useState<string | null>(null);

  const { isSidebarOpen, isDashboard } = useLayoutStore();
  const [isLgScreen, setIsLgScreen] = useState(false);

  useEffect(() => {
    const checkLg = () => setIsLgScreen(window.innerWidth >= 1024);
    checkLg();
    window.addEventListener("resize", checkLg, { passive: true });
    return () => window.removeEventListener("resize", checkLg);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setTokenState(getToken());
    }, 0);

    const handleAuthChange = () => {
      setTokenState(getToken());
    };

    authEvents.addEventListener("auth-change", handleAuthChange);
    return () => {
      clearTimeout(timer);
      authEvents.removeEventListener("auth-change", handleAuthChange);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleLogout = () => {
    clearToken();
    router.push("/");
  };

  const isHeaderHidden = isDashboard && !isSidebarOpen && isLgScreen;

  return (
    <>
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: isHeaderHidden ? -100 : 0, opacity: isHeaderHidden ? 0 : 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className={`fixed top-0 left-0 right-0 z-50 h-[4rem] flex items-center transition-all duration-300 ${isScrolled
          ? "bg-pitchy-bg/80 backdrop-blur-xl border-b border-white/8 shadow-lg shadow-black/20"
          : "bg-transparent"
          }`}
      >
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-full">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-1 group">
            <span className="text-[15px] font-black tracking-widest text-white uppercase group-hover:opacity-80 transition-opacity">
              Pitchy.pro
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6 transition-all duration-300">
            {navItems.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className={`font-mono-label text-[12px] tracking-widest uppercase transition-colors ${pathname === item.path
                  ? "text-white"
                  : "text-neutral-500 hover:text-white"
                  }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Desktop Auth */}
          <div className="hidden md:flex items-center gap-4 transition-all duration-300">
            {token ? (
              <>
                <Link
                  href="/account"
                  className="px-4 py-1.5 border border-white text-white font-mono-label text-[12px] uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
                >
                  АККАУНТ
                </Link>
                <button
                  onClick={handleLogout}
                  className="px-4 py-1.5 border border-white text-white font-mono-label text-[12px] uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
                >
                  ВЫЙТИ
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="font-mono-label text-[12px] uppercase tracking-widest text-neutral-500 hover:text-white transition-colors"
                >
                  ВОЙТИ
                </Link>
                <Link
                  href="/signup"
                  className="bg-white text-black px-4 py-1.5 font-mono-label text-[12px] uppercase tracking-widest font-bold hover:opacity-90 transition-opacity"
                >
                  РЕГИСТРАЦИЯ
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <motion.button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            whileTap={{ scale: 0.95 }}
            className="md:hidden p-2 text-white/70 hover:text-white rounded-lg"
            aria-label="Меню"
          >
            {isMobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </motion.button>
        </div>
      </motion.header>

      {/* Mobile Menu Dropdown */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 z-30 bg-black/50 md:hidden"
            />
            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="fixed top-[4rem] left-0 right-0 z-40 md:hidden bg-pitchy-bg/98 backdrop-blur-xl border-b border-white/10 shadow-xl"
            >
              <div className="px-4 py-4 space-y-1">
                {navItems.map((item) => (
                  <Link
                    key={item.path}
                    href={item.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex items-center px-4 py-3 rounded-xl text-base font-medium transition-colors ${pathname === item.path
                      ? "text-white bg-white/10"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>

              <div className="px-4 pb-4 pt-2 border-t border-white/10">
                {token ? (
                  <div className="flex gap-2">
                    <Link
                      href="/account"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="w-full text-center px-4 py-3 border border-white text-white font-mono-label text-[12px] uppercase tracking-widest hover:bg-white hover:text-black transition-colors font-bold"
                    >
                      АККАУНТ
                    </Link>
                    <button
                      onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}
                      className="w-full font-mono-label text-[12px] uppercase tracking-widest text-neutral-500 hover:text-white transition-colors py-2"
                    >
                      ВЫЙТИ
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Link
                      href="/login"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="font-mono-label text-[12px] uppercase tracking-widest text-neutral-500 hover:text-white transition-colors"
                    >
                      ВОЙТИ
                    </Link>
                    <Link
                      href="/signup"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="w-full text-center bg-white text-black px-4 py-3 font-mono-label text-[12px] uppercase tracking-widest font-bold hover:opacity-90 transition-opacity"
                    >
                      РЕГИСТРАЦИЯ
                    </Link>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

/* ═══════════════════════════ Footer ═══════════════════════════ */
function Footer() {
  return (
    <footer className="bg-[#0A0A0A] border-t border-white/[0.08] pt-24 pb-24 mt-auto">
      <div className="max-w-[1440px] mx-auto px-4 md:px-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12">
          <div className="space-y-6">
            <h4 className="text-white font-mono-label font-bold text-[13px] uppercase tracking-wider mb-6">Продукт</h4>
            <ul className="space-y-4">
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/">Главная</Link></li>
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/pricing">Тарифы</Link></li>
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/faq">FAQ</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white font-mono-label font-bold text-[13px] uppercase tracking-wider mb-6">Компания</h4>
            <ul className="space-y-4">
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/about">О нас</Link></li>
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/contact">Контакты</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white font-mono-label font-bold text-[13px] uppercase tracking-wider mb-6">Ресурсы</h4>
            <ul className="space-y-4">
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/dashboard">Дашборд</Link></li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-white font-mono-label font-bold text-[13px] uppercase tracking-wider mb-6">Правовая информация</h4>
            <ul className="space-y-4">
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/privacy">Конфиденциальность</Link></li>
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/terms">Условия</Link></li>
              <li><Link className="font-code text-neutral-500 hover:text-white transition-colors text-[13px]" href="/security">Безопасность</Link></li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ═══════════════════════════ Layout ═══════════════════════════ */
import { useIdleTimeout } from "@/lib/hooks/useIdleTimeout";

export function Layout({ children }: { children: React.ReactNode }) {
  // Initialize the auto-logout hook (defaults to 3 hours)
  useIdleTimeout();
  const { isSidebarOpen, isDashboard, isChatOpen } = useLayoutStore();
  const isHeaderHidden = isDashboard && !isSidebarOpen;

  const lockScroll = isDashboard && isChatOpen;

  return (
    <div className={`${lockScroll ? "h-[100dvh] overflow-hidden" : "min-h-[100dvh]"} flex flex-col bg-transparent`}>
      <Header />
      <main className={`flex-1 flex flex-col min-h-0 transition-all duration-300 pt-16 ${isHeaderHidden ? "lg:pt-0" : ""}`}>
        {children}
      </main>
      {!isDashboard && <Footer />}
    </div>
  );
}

export default Layout;
