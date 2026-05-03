"use client";

import Link from "next/link";
import { LayoutDashboard, MessageSquare, GitBranch, Users, Shield, HelpCircle, Star, X } from "lucide-react";
import { PitchyLogo } from "../shared/PitchyLogo";

interface Props {
  activeTab: string;
  setActiveTab: (t: string) => void;
  isAdmin?: boolean;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function SideNavBar({ activeTab, setActiveTab, isAdmin, isMobileOpen, onMobileClose }: Props) {
  const topNavItems = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "chat", label: "Чат", icon: MessageSquare },
    { id: "tree", label: "Дерево решений", icon: GitBranch },
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
        className={`h-screen w-64 fixed left-0 top-0 border-r border-white/5 bg-black flex flex-col py-8 z-50 transition-transform duration-500 ease-[0.16,1,0.3,1] md:translate-x-0 ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-8 mb-12 flex items-start justify-between">
          <div>
            <PitchyLogo size="xl" />
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/20 mt-2 font-bold">Workspace v2.0</p>
          </div>
          <button
            onClick={onMobileClose}
            className="md:hidden text-white/40 hover:text-white p-1 transition-colors"
            aria-label="Закрыть меню"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          {topNavItems.map((item) => {
            const isActive = activeTab === item.id;
            const content = (
              <>
                <item.icon size={18} strokeWidth={1.5} className={isActive ? "text-white" : "text-white/40"} />
                <span className={`font-display text-[17px] tracking-tight ${isActive ? "text-white" : "text-white/50 group-hover:text-white/80"}`}>
                  {item.label}
                </span>
              </>
            );

            if (item.href) {
              return (
                <a
                  key={item.id}
                  href={item.href}
                  className="group flex items-center gap-3 px-4 py-3 text-white/50 hover:bg-white/[0.03] transition-all duration-300 rounded-2xl active:scale-[0.98]"
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
                }`}
              >
                {content}
              </button>
            );
          })}
        </nav>

        <div className="px-5 mb-6">
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

        <div className="px-4 border-t border-white/5 pt-6">
          <Link
            href="/contact"
            onClick={onMobileClose}
            className="group w-full flex items-center gap-3 px-4 py-3 text-white/50 hover:bg-white/[0.03] hover:text-white transition-all duration-300 rounded-2xl active:scale-[0.98]"
          >
            <HelpCircle size={18} strokeWidth={1.5} className="text-white/40 group-hover:text-white/80" />
            <span className="font-display text-[17px] tracking-tight">Поддержка</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
