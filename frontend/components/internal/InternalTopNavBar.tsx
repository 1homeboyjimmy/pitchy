"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Menu, LogOut, User } from "lucide-react";
import { clearToken } from "@/lib/auth";
import { PitchyLogo } from "@/components/shared/PitchyLogo";

const navLinks = [
  { href: "/", label: "Главная" },
  { href: "/dashboard", label: "Дашборд" },
  { href: "/faq", label: "FAQ" },
  { href: "/about", label: "О нас" },
  { href: "/pricing", label: "Тарифы" },
  { href: "/contact", label: "Контакты" },
];

interface Props {
  activeTab: string;
  onMenuClick?: () => void;
}

export function InternalTopNavBar({ activeTab, onMenuClick }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const isAccountPage = pathname === "/account";

  const getTabName = (tab: string) => {
    switch (tab) {
      case "overview": return "Обзор";
      case "chat": return "Чат";
      case "tree": return "Дорожная карта";
      case "admin": return "Админ";
      default: return tab;
    }
  };

  const handleLogout = async () => {
    await clearToken();
    router.push("/");
  };

  const linkBase = "font-mono text-[10px] uppercase tracking-[0.2em] transition-all font-bold";

  return (
    <header className="w-full bg-black/95 backdrop-blur-xl border-b border-white/5">
      <div className="flex flex-row justify-between items-center py-4 px-8 w-full max-w-[1440px] mx-auto">
        {/* Left: Logo & Menu Toggle */}
        <div className="flex items-center gap-4 relative z-[110]">
          <button
            onClick={onMenuClick}
            className="md:hidden text-white/40 hover:text-white p-1 transition-colors"
            aria-label="Меню"
          >
            <Menu size={20} />
          </button>
          <Link href="/" className="flex items-center gap-2">
            <PitchyLogo size="xl" />
          </Link>
          <div className="hidden sm:flex items-center gap-3 ml-4 border-l border-white/10 pl-4">
            <span className="font-mono text-[9px] text-white/30 uppercase tracking-[0.2em] font-bold">
              {getTabName(activeTab)}
            </span>
          </div>
        </div>

        {/* Center Nav Links — Desktop */}
        <nav className="hidden lg:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1 transition-colors font-medium text-[12px] uppercase tracking-tighter font-sans ${
                  isActive ? "text-white" : "text-foreground/70 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Right — Desktop */}
        <div className="flex items-center gap-3 sm:gap-4 relative z-[110]">
          <Link
            href="/account"
            className={`flex items-center gap-2 px-6 py-2 border font-sans text-[12px] font-bold uppercase tracking-tight transition-all rounded-full active:scale-[0.98] ${
              isAccountPage 
              ? "bg-white text-black border-white" 
              : "border-white/10 text-white/60 hover:bg-white hover:text-black hover:border-white"
            }`}
          >
            <User size={14} strokeWidth={2.5} />
            <span className="hidden sm:inline tracking-tighter">АККАУНТ</span>
          </Link>
          <button
            onClick={handleLogout}
            className="hidden sm:flex items-center gap-2 px-6 py-2 border border-white/10 text-white/60 font-sans text-[12px] font-bold uppercase tracking-tight transition-all rounded-full hover:bg-white hover:text-black hover:border-white active:scale-[0.98]"
          >
            <LogOut size={14} strokeWidth={2.5} />
            <span className="tracking-tighter">ВЫЙТИ</span>
          </button>
        </div>
      </div>
    </header>
  );
}
