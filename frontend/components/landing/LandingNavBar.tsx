"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <header className="bg-[#0A0A0A]/80 backdrop-blur-md sticky top-0 z-50">
      <div className="relative flex justify-between items-center w-full px-6 h-14 max-w-[1440px] mx-auto border-b border-white/10">
        <div className="flex items-center">
          <Link className="text-xl font-bold tracking-widest text-white" href="/">
            PITCHY.PRO
          </Link>
        </div>
        
        {/* Center Nav Links */}
        <nav className="hidden md:flex items-center gap-6 absolute left-1/2 -translate-x-1/2">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`font-mono-label text-[10px] uppercase tracking-widest transition-colors duration-200 cursor-crosshair active:opacity-70 ${
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

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-neutral-500 font-mono-label text-[10px] uppercase tracking-widest hover:text-white transition-colors duration-200 cursor-crosshair"
          >
            ВОЙТИ
          </Link>
          <Link 
            href="/signup" 
            className="bg-white text-black font-mono-label text-[10px] uppercase tracking-widest px-4 py-1.5 hover:bg-neutral-200 transition-colors duration-200 cursor-crosshair"
          >
            РЕГИСТРАЦИЯ
          </Link>
        </div>
      </div>
    </header>
  );
}
