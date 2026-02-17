"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Menu,
  X,
  LogOut,
  User,
  Mail,
  Send,
} from "lucide-react";
import { getToken, clearToken, authEvents } from "@/lib/auth";

/* ─── Navigation Items ─── */
const navItems = [
  { path: "/", label: "Главная" },
  { path: "/dashboard", label: "Дашборд" },
  { path: "/faq", label: "FAQ" },
  { path: "/about", label: "О нас" },
  { path: "/pricing", label: "Тарифы" },
  { path: "/contact", label: "Контакты" },
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
  { icon: Mail, href: "mailto:hello@pitchy.pro", label: "Email" },
];


/* ═══════════════════════════ Header ═══════════════════════════ */
function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Use state for token to trigger re-renders
  const [token, setTokenState] = useState<string | null>(null);

  useEffect(() => {
    // Initial check
    setTokenState(getToken());

    // Listen for auth changes
    const handleAuthChange = () => {
      setTokenState(getToken());
      router.refresh(); // Refresh server components if needed
    };

    authEvents.addEventListener("auth-change", handleAuthChange);
    return () => {
      authEvents.removeEventListener("auth-change", handleAuthChange);
    };
  }, [router]);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleLogout = () => {
    clearToken();
    router.push("/");
  };

  return (
    <>
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className={`fixed top-0 left-0 right-0 z-50 h-16 flex items-center transition-all duration-300 ${isScrolled
          ? "bg-pitchy-bg/80 backdrop-blur-xl border-b border-white/8 shadow-lg shadow-black/20"
          : "bg-transparent"
          }`}
      >
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-1 group">
            <span className="text-xl font-bold text-white group-hover:text-pitchy-violet-light transition-colors">
              Pitchy
            </span>
            <span className="text-xl font-bold text-pitchy-violet">.pro</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${pathname === item.path
                  ? "text-white bg-white/10"
                  : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Desktop Auth */}
          <div className="hidden md:flex items-center gap-3">
            {token ? (
              <>
                <Link
                  href="/account"
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white/70 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                >
                  <User className="w-4 h-4" />
                  Аккаунт
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white/70 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Выйти
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="px-4 py-2 text-sm font-medium text-white/70 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                >
                  Войти
                </Link>
                <Link
                  href="/signup"
                  className="px-4 py-2 text-sm font-medium text-white bg-pitchy-violet hover:bg-pitchy-violet-dark rounded-xl transition-colors shadow-glow-primary"
                >
                  Регистрация
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

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-pitchy-bg/95 backdrop-blur-xl md:hidden"
          >
            <div className="flex flex-col items-center justify-center h-full gap-2 pt-16">
              {navItems.map((item, index) => (
                <motion.div
                  key={item.path}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ delay: index * 0.05, duration: 0.3 }}
                >
                  <Link
                    href={item.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`block px-8 py-3 text-lg font-medium rounded-xl transition-colors ${pathname === item.path
                      ? "text-white bg-white/10"
                      : "text-white/60 hover:text-white"
                      }`}
                  >
                    {item.label}
                  </Link>
                </motion.div>
              ))}

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: navItems.length * 0.05, duration: 0.3 }}
                className="mt-6 pt-6 border-t border-white/10 flex flex-col items-center gap-3 w-64"
              >
                {token ? (
                  <>
                    <Link
                      href="/account"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="w-full text-center px-6 py-3 text-sm font-medium text-white/70 hover:text-white rounded-xl hover:bg-white/5 transition-colors"
                    >
                      Аккаунт
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="w-full px-6 py-3 text-sm font-medium text-white/70 hover:text-red-400 rounded-xl hover:bg-white/5 transition-colors"
                    >
                      Выйти
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      href="/login"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="w-full text-center px-6 py-3 text-sm font-medium text-white/70 hover:text-white rounded-xl border border-white/10 transition-colors"
                    >
                      Войти
                    </Link>
                    <Link
                      href="/signup"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="w-full text-center px-6 py-3 text-sm font-medium text-white bg-pitchy-violet hover:bg-pitchy-violet-dark rounded-xl transition-colors"
                    >
                      Регистрация
                    </Link>
                  </>
                )}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ═══════════════════════════ Footer ═══════════════════════════ */
function Footer() {
  return (
    <footer className="relative border-t border-white/8 mt-24">
      {/* Gradient top border */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-pitchy-violet/50 to-transparent" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        {/* Link Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12"
        >
          {footerColumns.map((column) => (
            <div key={column.title}>
              <h4 className="text-sm font-semibold text-white mb-4">
                {column.title}
              </h4>
              <ul className="space-y-3">
                {column.links.map((link) => (
                  <li key={link.path}>
                    <Link
                      href={link.path}
                      className="text-sm text-white/40 hover:text-white transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </motion.div>

        {/* Bottom row */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8 border-t border-white/8">
          {/* Logo + copyright */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">Pitchy</span>
            <span className="text-sm font-bold text-pitchy-violet">.pro</span>
            <span className="text-xs text-white/30 ml-2">
              © {new Date().getFullYear()} Все права защищены
            </span>
          </div>

          {/* Social Links */}
          <div className="flex items-center gap-4">
            {socialLinks.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 text-white/30 hover:text-white transition-colors rounded-xl hover:bg-white/5"
                aria-label={social.label}
              >
                <social.icon className="w-4 h-4" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ═══════════════════════════ Layout ═══════════════════════════ */
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-16">{children}</main>
      <Footer />
    </div>
  );
}

export default Layout;
