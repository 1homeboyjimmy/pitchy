"use client";

import Link from "next/link";

const navLinks = [
  { href: "/", label: "Главная" },
  { href: "/dashboard", label: "Дашборд" },
  { href: "/faq", label: "FAQ" },
  { href: "/about", label: "О нас" },
  { href: "/pricing", label: "Тарифы" },
  { href: "/contacts", label: "Контакты" },
];

export function InternalTopNavBar({ activeTab }: { activeTab: string }) {
  const getTabName = (tab: string) => {
    switch(tab) {
      case "overview": return "Обзор";
      case "chat": return "Чат";
      case "tree": return "Древо";
      case "admin": return "Админ";
      default: return tab;
    }
  };

  return (
    <header className="fixed top-0 right-0 left-64 h-14 border-b border-white/10 bg-[#0A0A0A] z-40 flex items-center justify-between px-6">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-neutral-500 uppercase tracking-widest hover:text-white cursor-pointer transition-colors">
          {getTabName(activeTab)}
        </span>
        <span className="font-mono text-xs text-neutral-600">/</span>
        <span className="font-mono text-xs text-white uppercase tracking-widest">
          Проект
        </span>
      </div>

      <nav className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-6">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="font-mono text-[10px] text-neutral-500 uppercase tracking-widest hover:text-white transition-colors"
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-4">
        <button className="px-4 py-1.5 border border-white/10 text-white font-mono text-[10px] uppercase tracking-widest hover:bg-white hover:text-black transition-all rounded-sm">
          Аккаунт
        </button>
        <button className="px-4 py-1.5 border border-white/10 text-neutral-500 font-mono text-[10px] uppercase tracking-widest hover:text-white transition-all rounded-sm">
          Выйти
        </button>
      </div>
    </header>
  );
}
