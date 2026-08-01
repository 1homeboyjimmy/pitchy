"use client";

import Link from "next/link";
import { LayoutDashboard, MessageSquare, GitBranch, Users, Shield, HelpCircle, Star, X, ChevronLeft, ChevronRight, Lock, Banknote } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PitchyLogo } from "../shared/PitchyLogo";

const EASE = [0.16, 1, 0.3, 1] as const;

interface Props {
  activeTab: string;
  setActiveTab: (t: string) => void;
  isAdmin?: boolean;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  // Permission flags from /me/usage — when false the corresponding nav
  // item shows a lock icon and clicks open an upgrade prompt.
  canUseTree?: boolean;
  canUseCustdev?: boolean;
  onLockedClick?: (featureLabel: string) => void;
}

export function SideNavBar({
  activeTab,
  setActiveTab,
  isAdmin,
  isMobileOpen,
  onMobileClose,
  isCollapsed,
  onToggleCollapse,
  canUseTree = true,
  canUseCustdev = true,
  onLockedClick,
}: Props) {
  const topNavItems = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard, locked: false },
    { id: "chat", label: "Чат", icon: MessageSquare, locked: false },
    { id: "tree", label: "Дорожная карта", icon: GitBranch, locked: !canUseTree },
    { id: "grants", label: "Гранты", icon: Banknote, href: "/grants", locked: false },
    {
      id: "custdev",
      label: "Кастдев",
      icon: Users,
      href: "https://custdev.pitchy.pro/",
      locked: !canUseCustdev,
    },
  ];

  if (isAdmin) {
    topNavItems.push({ id: "admin", label: "Админ", icon: Shield, locked: false });
  }

  const handleTabClick = (id: string, locked: boolean, label: string) => {
    if (locked) {
      onLockedClick?.(label);
      onMobileClose?.();
      return;
    }
    setActiveTab(id);
    onMobileClose?.();
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/85 backdrop-blur-sm md:hidden"
          onClick={onMobileClose}
        />
      )}
      <motion.aside
        initial={false}
        animate={{ width: !isMobileOpen && isCollapsed ? 80 : 256 }}
        transition={{ duration: 0.45, ease: EASE }}
        className={`h-[100dvh] max-w-[calc(100vw-1rem)] min-h-0 overflow-y-auto overflow-x-hidden border-r border-white/5 bg-black flex flex-col py-5 sm:py-8 z-50 ${
          isMobileOpen ? "fixed inset-y-0 left-0" : "hidden md:flex"
        }`}
      >
        <div className={`px-6 mb-12 flex items-center justify-between transition-all duration-500 ${isCollapsed ? "flex-col gap-8" : ""}`}>
          <div className="flex items-center gap-3 overflow-hidden">
            <PitchyLogo size={isCollapsed ? "xl" : "xl"} isCompact={isCollapsed} />
          </div>
          <button
            onClick={isMobileOpen ? onMobileClose : onToggleCollapse}
            className="text-white/40 hover:text-white p-2 transition-all rounded-xl hover:bg-white/5 active:scale-90"
            aria-label={isCollapsed ? "Развернуть" : "Свернуть"}
          >
            {isMobileOpen ? <X size={18} /> : (isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />)}
          </button>
        </div>

        <nav className="flex-1 min-h-0 px-3 space-y-1 overflow-y-auto overflow-x-hidden overscroll-contain pr-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
          {topNavItems.map((item) => {
            const isActive = activeTab === item.id;
            const locked = item.locked;
            const content = (
              <>
                <div className={`flex items-center justify-center transition-all duration-500 ${isCollapsed ? "w-10 h-10" : "w-5"}`}>
                    <item.icon size={isCollapsed ? 20 : 18} strokeWidth={1.5} className={isActive ? "text-white" : locked ? "text-white/25" : "text-white/40"} />
                </div>
                {!isCollapsed && (
                    <span className={`font-display text-[17px] tracking-tight whitespace-nowrap transition-all duration-500 flex-1 ${isActive ? "text-white" : locked ? "text-white/30" : "text-white/50 group-hover:text-white/80"}`}>
                      {item.label}
                    </span>
                )}
                {!isCollapsed && locked && (
                  <Lock size={13} strokeWidth={2} className="text-amber-400/60 shrink-0" />
                )}
              </>
            );

            if (item.href) {
              if (locked) {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleTabClick(item.id, true, item.label)}
                    className={`group w-full flex items-center gap-3 px-4 py-3 text-white/30 hover:bg-amber-500/[0.04] transition-all duration-300 rounded-2xl active:scale-[0.98] ${isCollapsed ? "justify-center px-0" : ""}`}
                    title={isCollapsed ? `${item.label} (требуется тариф)` : ""}
                  >
                    {content}
                  </button>
                );
              }
              return (
                <a
                  key={item.id}
                  href={item.href}
                  className={`group flex items-center gap-3 px-4 py-3 text-white/50 hover:bg-white/[0.03] transition-all duration-300 rounded-2xl active:scale-[0.98] ${isCollapsed ? "justify-center px-0" : ""}`}
                  title={isCollapsed ? item.label : ""}
                >
                  {content}
                </a>
              );
            }

            return (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id, locked, item.label)}
                className={`group w-full flex items-center gap-3 px-4 py-3 transition-all duration-300 active:scale-[0.98] text-left rounded-2xl ${
                  isActive
                    ? "bg-white/[0.05] text-white shadow-[0_4px_20px_rgba(255,255,255,0.02)]"
                    : locked
                      ? "text-white/30 hover:bg-amber-500/[0.04]"
                      : "text-white/50 hover:bg-white/[0.03] hover:text-white"
                } ${isCollapsed ? "justify-center px-0" : ""}`}
                title={isCollapsed ? (locked ? `${item.label} (требуется тариф)` : item.label) : ""}
              >
                {content}
              </button>
            );
          })}
        </nav>

        <div className={`shrink-0 px-3 border-t border-white/5 pt-4 transition-all duration-500 ${isCollapsed ? "flex flex-col items-center" : ""}`}>
          <AnimatePresence initial={false}>
            {!isCollapsed && (
              <motion.div
                key="tip-card"
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1, transition: { duration: 0.35, ease: EASE, delay: 0.12 } }}
                exit={{ y: 16, opacity: 0, transition: { duration: 0.2, ease: EASE } }}
                className="hidden md:flex mb-3 lovable-glass rounded-2xl p-4 flex-col gap-2 border border-white/5 bg-gradient-to-br from-white/[0.02] to-transparent"
              >
                <div className="flex items-center gap-2 text-white/40">
                  <Star size={14} strokeWidth={2} />
                  <span className="font-mono text-[9px] uppercase tracking-[0.2em] font-bold">СОВЕТ</span>
                </div>
                <p className="font-sans text-[11px] text-white/40 leading-relaxed font-medium italic">
                  «Чем подробнее вы опишете проект в начале, тем точнее будет анализ.»
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <Link
            href="/contact"
            onClick={onMobileClose}
            className={`group w-full flex items-center gap-3 px-4 py-3 text-white/50 hover:bg-white/[0.03] hover:text-white transition-all duration-300 rounded-2xl active:scale-[0.98] ${isCollapsed ? "justify-center px-0" : ""}`}
            title={isCollapsed ? "Поддержка" : ""}
          >
            <div className={`flex items-center justify-center transition-all duration-500 ${isCollapsed ? "w-10 h-10" : "w-5"}`}>
                <HelpCircle size={isCollapsed ? 20 : 18} strokeWidth={1.5} className="text-white/40 group-hover:text-white/80" />
            </div>
            {!isCollapsed && (
                <span className="font-display text-[17px] tracking-tight whitespace-nowrap">Поддержка</span>
            )}
          </Link>
        </div>
      </motion.aside>
    </>
  );
}
