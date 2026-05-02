"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/lib/hooks/useAuth";
import { clearToken } from "@/lib/auth";

const navLinks = [
  { href: "/", label: "Главная" },
  { href: "/dashboard", label: "Дашборд" },
  { href: "/faq", label: "FAQ" },
  { href: "/about", label: "О нас" },
  { href: "/pricing", label: "Тарифы" },
  { href: "/contact", label: "Контакты" },
];

export function LandingNavBar() {
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

  const linkBase = "font-mono-label text-[12px] uppercase tracking-widest transition-colors duration-200 cursor-crosshair active:opacity-70";

  return (
    <header className="bg-[#0A0A0A]/80 backdrop-blur-md sticky top-0 z-50">
      <div className="relative flex justify-between items-center w-full px-4 sm:px-6 h-14 max-w-[1440px] mx-auto border-b border-white/10">
        <div className="flex items-center">
          <Link className="text-base sm:text-xl font-bold tracking-widest text-white" href="/">
            PITCHY.PRO
          </Link>
        </div>

        {/* Center Nav Links — Desktop */}
        <nav className="hidden md:flex items-center gap-6 absolute left-1/2 -translate-x-1/2">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${linkBase} ${
                  isActive
                    ? "text-white border-b border-white/40 pb-1"
                    : "text-neutral-500 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Right — Desktop */}
        <div className="hidden md:flex items-center gap-5">
          {isAuthenticated ? (
            <>
              <Link
                href="/account"
                className="px-4 py-1.5 border border-white text-white font-mono-label text-[12px] uppercase tracking-widest hover:bg-white hover:text-black transition-colors duration-200 cursor-crosshair"
              >
                АККАУНТ
              </Link>
              <button
                onClick={handleLogout}
                className="px-4 py-1.5 border border-white text-white font-mono-label text-[12px] uppercase tracking-widest hover:bg-white hover:text-black transition-colors duration-200 cursor-crosshair"
              >
                ВЫЙТИ
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className={`${linkBase} text-neutral-500 hover:text-white`}>
                ВОЙТИ
              </Link>
              <Link
                href="/signup"
                className="bg-white text-black font-mono-label text-[12px] uppercase tracking-widest px-4 py-1.5 hover:bg-neutral-200 transition-colors duration-200 cursor-crosshair"
              >
                РЕГИСТРАЦИЯ
              </Link>
            </>
          )}
        </div>

        {/* Mobile burger */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="md:hidden p-2 text-white/80 hover:text-white"
          aria-label="Меню"
        >
          {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {isMobileMenuOpen && (
        <>
          <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />
          <div className="md:hidden absolute left-0 right-0 z-40 bg-[#0A0A0A]/98 backdrop-blur-xl border-b border-white/10 shadow-xl">
            <div className="px-4 py-3 space-y-1">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`block px-4 py-3 rounded text-sm font-mono-label uppercase tracking-widest ${
                      isActive ? "text-white bg-white/10" : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
            <div className="px-4 pb-4 pt-2 border-t border-white/10 flex gap-3">
              {isAuthenticated ? (
                <>
                  <Link href="/account" className="flex-1 text-center px-4 py-3 font-mono-label text-[12px] uppercase tracking-widest text-white/70 hover:text-white">
                    АККАУНТ
                  </Link>
                  <button onClick={handleLogout} className="flex-1 text-center px-4 py-3 font-mono-label text-[12px] uppercase tracking-widest text-white/70 hover:text-white">
                    ВЫЙТИ
                  </button>
                </>
              ) : (
                <>
                  <Link href="/login" className="flex-1 text-center px-4 py-3 font-mono-label text-[12px] uppercase tracking-widest text-white/70 hover:text-white">
                    ВОЙТИ
                  </Link>
                  <Link href="/signup" className="flex-1 text-center bg-white text-black px-4 py-3 font-mono-label text-[12px] uppercase tracking-widest font-bold">
                    РЕГИСТРАЦИЯ
                  </Link>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </header>
  );
}
