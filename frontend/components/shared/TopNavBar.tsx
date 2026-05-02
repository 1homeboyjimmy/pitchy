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

  const linkBase = "font-mono-label text-[12px] uppercase tracking-widest transition-colors duration-200 cursor-crosshair active:opacity-70";

  return (
    <nav className="fixed top-0 w-full z-50 bg-[#0A0A0A]/80 backdrop-blur-xl border-b border-white/[0.08]">
      <div className="relative flex items-center justify-between px-4 sm:px-6 h-14 w-full max-w-[1440px] mx-auto">
        <div className="flex items-center">
          <Link className="text-base sm:text-lg font-bold tracking-tighter text-white" href="/">
            PITCHY.PRO
          </Link>
        </div>

        {/* Center Nav Links — Desktop */}
        <div className="hidden md:flex items-center gap-6 absolute left-1/2 -translate-x-1/2">
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
        </div>

        {/* Right — Desktop */}
        <div className="hidden md:flex items-center gap-5">
          {isAuthenticated ? (
            <>
              <Link href="/account" className={`${linkBase} text-neutral-500 hover:text-white`}>
                АККАУНТ
              </Link>
              <button onClick={handleLogout} className={`${linkBase} text-neutral-500 hover:text-white`}>
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
          <div className="fixed inset-x-0 top-14 bottom-0 z-30 bg-black/50 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />
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
    </nav>
  );
}
