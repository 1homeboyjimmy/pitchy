"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, LogOut, User } from "lucide-react";
import { clearToken } from "@/lib/auth";

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

  const getTabName = (tab: string) => {
    switch (tab) {
      case "overview": return "Обзор";
      case "chat": return "Чат";
      case "tree": return "Древо";
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
    <header className="fixed top-0 right-0 left-0 md:left-64 h-16 border-b border-white/5 bg-black/80 backdrop-blur-2xl z-40 flex items-center justify-between px-6 sm:px-8">
      <div className="flex items-center gap-4 min-w-0">
        <button
          onClick={onMenuClick}
          className="md:hidden text-white/40 hover:text-white p-1 transition-colors"
          aria-label="Меню"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-[10px] text-white/30 uppercase tracking-[0.2em] hover:text-white cursor-pointer transition-colors truncate font-bold">
            {getTabName(activeTab)}
          </span>
          <span className="font-mono text-[10px] text-white/10 font-bold">/</span>
          <span className="font-mono text-[10px] text-white uppercase tracking-[0.2em] truncate font-bold">
            Проект
          </span>
        </div>
      </div>

      <nav className="hidden xl:flex absolute left-1/2 top-0 h-16 -translate-x-1/2 items-center gap-8 z-50">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`${linkBase} ${activeTab === link.label.toLowerCase() ? "text-white" : "text-white/30 hover:text-white"}`}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-3 sm:gap-4">
        <Link
          href="/account"
          className="flex items-center gap-2 px-5 py-2 border border-white/10 text-white/60 font-mono text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-white hover:text-black hover:border-white transition-all rounded-full active:scale-[0.98]"
        >
          <User size={14} strokeWidth={2} />
          <span className="hidden sm:inline">АККАУНТ</span>
        </Link>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-5 py-2 bg-white/5 border border-white/10 text-white/60 font-mono text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all rounded-full active:scale-[0.98]"
        >
          <LogOut size={14} strokeWidth={2} />
          <span className="hidden sm:inline">ВЫЙТИ</span>
        </button>
      </div>
    </header>
  );
}
