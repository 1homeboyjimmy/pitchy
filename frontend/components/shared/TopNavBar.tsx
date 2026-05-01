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

export function TopNavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 w-full z-50 bg-[#0A0A0A]/80 backdrop-blur-xl border-b border-white/[0.08]">
      <div className="relative flex items-center justify-between px-6 h-14 w-full max-w-[1440px] mx-auto">
        {/* Logo */}
        <div className="flex items-center">
          <Link className="text-lg font-bold tracking-tighter text-white" href="/">
            PITCHY.PRO
          </Link>
        </div>

        {/* Center Nav Links */}
        <div className="hidden md:flex items-center gap-6 absolute left-1/2 -translate-x-1/2">
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
        </div>

        {/* Right: Account / Logout */}
        <div className="flex items-center gap-4">
          <Link
            href="/account"
            className="px-4 py-1.5 border border-white text-white font-mono-label text-[10px] uppercase tracking-widest hover:bg-white hover:text-black transition-colors duration-200 cursor-crosshair"
          >
            АККАУНТ
          </Link>
          <button
            className="text-neutral-500 font-mono-label text-[10px] uppercase tracking-widest hover:text-white transition-colors duration-200 cursor-crosshair"
          >
            ВЫЙТИ
          </button>
        </div>
      </div>
    </nav>
  );
}
