"use client";

import Link from "next/link";
import { LayoutDashboard, MessageSquare, GitBranch, Users, Shield, HelpCircle, Star, X, ChevronLeft, ChevronRight } from "lucide-react";
import { PitchyLogo } from "../shared/PitchyLogo";

interface Props {
  activeTab: string;
  setActiveTab: (t: string) => void;
  isAdmin?: boolean;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function SideNavBar({ 
  activeTab, 
  setActiveTab, 
  isAdmin, 
  isMobileOpen, 
  onMobileClose,
  isCollapsed,
  onToggleCollapse 
}: Props) {
  const topNavItems = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "chat", label: "Чат", icon: MessageSquare },
    { id: "tree", label: "Дорожная карта", icon: GitBranch },
    { id: "custdev", label: "Кастдев", icon: Users, href: "https://custdev.pitchy.pro/" },
  ];

  if (isAdmin) {
    topNavItems.push({ id: "admin", label: "Админ", icon: Shield });
  }

  const handleTabClick = (id: string) => {
    setActiveTab(id);
    onMobileClose?.();
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={onMobileClose}
        />
      )}
      <aside
        className={`h-screen border-r border-white/5 bg-black flex flex-col py-8 z-50 transition-all duration-500 ease-[0.16,1,0.3,1] ${
          isMobileOpen ? "fixed inset-y-0 left-0 translate-x-0 w-64" : "hidden md:flex translate-x-0"
        } ${isCollapsed ? "w-20" : "w-64"}`}
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

        <nav className="flex-1 px-3 space-y-1 overflow-hidden">
          {topNavItems.map((item) => {
            const isActive = activeTab === item.id;
            const content = (
              <>
                <div className={`flex items-center justify-center transition-all duration-500 ${isCollapsed ? "w-10 h-10" : "w-5"}`}>
                    <item.icon size={isCollapsed ? 20 : 18} strokeWidth={1.5} className={isActive ? "text-white" : "text-white/40"} />
                </div>
                {!isCollapsed && (
                    <span className={`font-display text-[17px] tracking-tight whitespace-nowrap transition-all duration-500 ${isActive ? "text-white" : "text-white/50 group-hover:text-white/80"}`}>
                      {item.label}
                    </span>
                )}
              </>
            );

            if (item.href) {
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
                onClick={() => handleTabClick(item.id)}
                className={`group w-full flex items-center gap-3 px-4 py-3 transition-all duration-300 active:scale-[0.98] text-left rounded-2xl ${
                  isActive
                    ? "bg-white/[0.05] text-white shadow-[0_4px_20px_rgba(255,255,255,0.02)]"
                    : "text-white/50 hover:bg-white/[0.03] hover:text-white"
                } ${isCollapsed ? "justify-center px-0" : ""}`}
                title={isCollapsed ? item.label : ""}
              >
                {content}
              </button>
            );
          })}
        </nav>

        {!isCollapsed && (
            <div className="px-5 mb-6 transition-all duration-500 opacity-100">
              <div className="lovable-glass rounded-3xl p-5 flex flex-col gap-3 border border-white/5 bg-gradient-to-br from-white/[0.02] to-transparent">
                <div className="flex items-center gap-2 text-white/40">
                  <Star size={14} strokeWidth={2} />
                  <span className="font-mono text-[9px] uppercase tracking-[0.2em] font-bold">СОВЕТ</span>
                </div>
                <p className="font-sans text-[12px] text-white/40 leading-relaxed font-medium italic">
                  «Чем подробнее вы опишете проект в начале, тем точнее будет анализ.»
                </p>
              </div>
            </div>
        )}

        <div className={`px-3 border-t border-white/5 pt-6 transition-all duration-500 ${isCollapsed ? "flex flex-col items-center" : ""}`}>
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
      </aside>
    </>
  );
}
