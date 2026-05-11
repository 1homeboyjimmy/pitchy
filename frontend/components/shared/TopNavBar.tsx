"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/lib/hooks/useAuth";
import { clearToken } from "@/lib/auth";
import { motion, AnimatePresence } from "framer-motion";
import { PitchyLogo } from "./PitchyLogo";

const navLinks = [
  { href: "/", label: "Главная" },
  { href: "/dashboard", label: "Дашборд" },
  { href: "/faq", label: "FAQ" },
  { href: "/about", label: "О нас" },
  { href: "/pricing", label: "Тарифы" },
  { href: "/contact", label: "Контакты" },
];

export function TopNavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    await clearToken();
    router.push("/");
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-[100] w-full bg-black/95 backdrop-blur-xl border-b border-white/5">
      <div className="flex flex-row justify-between items-center py-4 px-8 w-full max-w-[1440px] mx-auto">
        {/* Left: Logo */}
        <Link href="/" className="flex items-center gap-2 relative z-[110]">
          <PitchyLogo size="xl" />
        </Link>

        {/* Center Nav Links — Desktop */}
        <nav className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1 transition-colors font-medium text-[13px] uppercase tracking-tighter font-sans ${
                  isActive ? "text-white" : "text-foreground/70 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Mobile burger — always visible on small screens */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="md:hidden text-white/80 hover:text-white relative z-[110] p-2 -mr-2"
          aria-label="Меню"
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>

        {/* Right — Desktop */}
        <div className="hidden md:flex items-center gap-4 relative z-[110]">
          {isAuthenticated ? (
            <>
              <Link
                href="/account"
                className="text-foreground/70 hover:text-white text-[12px] font-medium uppercase tracking-tighter font-sans mr-2"
              >
                АККАУНТ
              </Link>
              <button
                onClick={handleLogout}
                className="bg-white text-black px-6 py-2 rounded-full text-[12px] font-bold uppercase tracking-tight font-sans hover:bg-neutral-200 transition-colors"
              >
                ВЫЙТИ
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-foreground/70 hover:text-white text-[12px] font-medium uppercase tracking-tighter font-sans mr-4">ВОЙТИ</Link>
              <Link
                href="/signup"
                className="bg-white text-black px-6 py-2 rounded-full text-[12px] font-bold uppercase tracking-tight font-sans hover:bg-neutral-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.1)]"
              >
                РЕГИСТРАЦИЯ
              </Link>
            </>
          )}

        </div>
      </div>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-full left-0 right-0 bg-black/95 backdrop-blur-xl border-b border-white/10 p-8 md:hidden"
          >
            <nav className="flex flex-col gap-6 items-center">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-xl font-medium text-foreground/80 hover:text-white uppercase tracking-tighter font-sans"
                >
                  {link.label}
                </Link>
              ))}
              <div className="flex flex-col gap-4 w-full mt-4">
                {isAuthenticated ? (
                  <>
                    <Link href="/account" className="text-center text-foreground/70 text-lg font-medium font-sans">АККАУНТ</Link>
                    <button onClick={handleLogout} className="bg-white text-black text-center py-4 rounded-full font-bold uppercase tracking-tight font-sans">ВЫЙТИ</button>
                  </>
                ) : (
                  <>
                    <Link href="/login" className="text-center text-foreground/70 text-lg font-medium font-sans">ВОЙТИ</Link>
                    <Link href="/signup" className="bg-white text-black text-center py-4 rounded-full font-bold uppercase tracking-tight font-sans">РЕГИСТРАЦИЯ</Link>
                  </>
                )}
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
