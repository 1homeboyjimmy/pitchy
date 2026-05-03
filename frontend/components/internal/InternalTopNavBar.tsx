"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
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

  const linkBase = "font-sans text-[12px] uppercase tracking-tighter transition-colors font-medium";

  return (
    <header className="fixed top-0 right-0 left-0 md:left-64 h-14 border-b border-white/10 bg-[#0A0A0A]/40 backdrop-blur-xl z-40 flex items-center justify-between px-4 sm:px-6">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="md:hidden text-white/70 hover:text-white p-1"
          aria-label="Меню"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-sans text-[12px] text-neutral-500 uppercase tracking-tighter hover:text-white cursor-pointer transition-colors truncate font-medium">
            {getTabName(activeTab)}
          </span>
          <span className="font-sans text-[12px] text-neutral-600 font-medium">/</span>
          <span className="font-sans text-[12px] text-white uppercase tracking-tighter truncate font-medium">
            Проект
          </span>
        </div>
      </div>

      <nav className="hidden lg:flex absolute left-1/2 top-0 h-14 -translate-x-1/2 items-center gap-6 z-50">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`${linkBase} text-neutral-500 hover:text-white`}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-3 sm:gap-4">
        <Link
          href="/account"
          className="px-4 py-1.5 border border-white text-white font-sans text-[11px] font-medium uppercase tracking-tighter hover:bg-white hover:text-black transition-colors"
        >
          АККАУНТ
        </Link>
        <button
          onClick={handleLogout}
          className="px-4 py-1.5 border border-white text-white font-sans text-[11px] font-medium uppercase tracking-tighter hover:bg-white hover:text-black transition-colors"
        >
          ВЫЙТИ
        </button>
      </div>
    </header>
  );
}
