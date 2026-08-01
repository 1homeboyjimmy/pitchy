"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { LogOut, User, Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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
  compactDashboard?: boolean;
}

export function InternalTopNavBar({ activeTab, compactDashboard = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const isAccountPage = pathname === "/account";
  const [isPagesMenuOpen, setIsPagesMenuOpen] = useState(false);
  const visibleNavLinks = compactDashboard
    ? navLinks.filter((link) => !["/faq", "/about", "/contact"].includes(link.href))
    : navLinks;

  const getTabName = (tab: string) => {
    switch (tab) {
      case "overview": return "Обзор";
      case "chat": return "Чат";
      case "tree": return "Дорожная карта";
      case "grants": return "Гранты";
      case "admin": return "Админ";
      default: return tab;
    }
  };

  const handleLogout = async () => {
    await clearToken();
    router.push("/");
  };

  return (
    <header className="relative w-full bg-black/95 backdrop-blur-xl border-b border-white/5">
      <div className="flex flex-row justify-between items-center py-3 sm:py-4 px-4 sm:px-8 w-full max-w-[1440px] mx-auto">
        {/* Left: Logo & Menu Toggle */}
        <div className="flex items-center gap-4 relative z-[110]">
          {/* Spacer so logo aligns with mobile floating burger position */}
          <span className="md:hidden w-9 h-9" aria-hidden />
          {!compactDashboard && (
            <Link href="/" className="flex items-center gap-2">
              <PitchyLogo size="xl" />
            </Link>
          )}
          <div className={`hidden sm:flex items-center gap-3 ${
            compactDashboard ? "" : "ml-4 border-l border-white/10 pl-4"
          }`}>
            <span className="font-mono text-[9px] text-white/30 uppercase tracking-[0.2em] font-bold">
              {getTabName(activeTab)}
            </span>
          </div>
        </div>

        {/* Center Nav Links — Desktop */}
        <nav className="hidden lg:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
          {visibleNavLinks.map((link) => {
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

        {/* Right — Desktop (АККАУНТ + ВЫЙТИ), Mobile (burger that opens pages dropdown) */}
        <div className="flex items-center gap-3 sm:gap-4 relative z-[110]">
          <Link
            href="/account"
            className={`hidden md:flex items-center gap-2 px-6 py-2 border font-sans text-[12px] font-bold uppercase tracking-tight transition-all rounded-full active:scale-[0.98] ${
              isAccountPage
              ? "bg-white text-black border-white"
              : "border-white/10 text-white/60 hover:bg-white hover:text-black hover:border-white"
            }`}
          >
            <User size={14} strokeWidth={2.5} />
            <span className="tracking-tighter">АККАУНТ</span>
          </Link>
          <button
            onClick={handleLogout}
            className="hidden md:flex items-center gap-2 px-6 py-2 border border-white/10 text-white/60 font-sans text-[12px] font-bold uppercase tracking-tight transition-all rounded-full hover:bg-white hover:text-black hover:border-white active:scale-[0.98]"
          >
            <LogOut size={14} strokeWidth={2.5} />
            <span className="tracking-tighter">ВЫЙТИ</span>
          </button>

          {/* Mobile pages burger */}
          <button
            onClick={() => setIsPagesMenuOpen((v) => !v)}
            className="md:hidden p-2 text-white/80 hover:text-white bg-black/70 backdrop-blur-md border border-white/10 rounded-lg active:scale-95 transition-colors"
            aria-label={isPagesMenuOpen ? "Закрыть меню" : "Открыть меню"}
          >
            {isPagesMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile pages dropdown */}
      <AnimatePresence>
        {isPagesMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="md:hidden absolute top-full left-0 right-0 bg-black/95 backdrop-blur-xl border-b border-white/10 z-[105]"
          >
            <nav className="flex flex-col py-3 px-4">
              {visibleNavLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsPagesMenuOpen(false)}
                    className={`px-3 py-3 rounded-lg font-sans text-[14px] font-medium uppercase tracking-tight transition-colors ${
                      isActive ? "text-white bg-white/5" : "text-white/60 hover:text-white hover:bg-white/[0.03]"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
              <div className="h-px bg-white/5 my-2" />
              <Link
                href="/account"
                onClick={() => setIsPagesMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-3 rounded-lg font-sans text-[14px] font-medium uppercase tracking-tight transition-colors ${
                  isAccountPage ? "text-white bg-white/5" : "text-white/60 hover:text-white hover:bg-white/[0.03]"
                }`}
              >
                <User size={16} strokeWidth={2} />
                Аккаунт
              </Link>
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-3 py-3 rounded-lg font-sans text-[14px] font-medium uppercase tracking-tight text-white/60 hover:text-white hover:bg-white/[0.03] transition-colors text-left"
              >
                <LogOut size={16} strokeWidth={2} />
                Выйти
              </button>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
