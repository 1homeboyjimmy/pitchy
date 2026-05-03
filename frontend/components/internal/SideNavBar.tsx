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
        className={`h-screen w-64 fixed left-0 top-0 border-r border-white/10 bg-[#0A0A0A] flex flex-col py-6 z-50 transition-transform duration-300 md:translate-x-0 ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-6 mb-10 flex items-start justify-between">
          <div>
            <PitchyLogo size="xl" />
            <p className="font-sans font-medium uppercase tracking-tight text-[10px] text-neutral-500 mt-1">Рабочая область</p>
          </div>
          <button
            onClick={onMobileClose}
            className="md:hidden text-white/60 hover:text-white p-1"
            aria-label="Закрыть меню"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {topNavItems.map((item) => {
            const isActive = activeTab === item.id;
            const content = (
              <>
                <item.icon size={18} strokeWidth={2} />
                <span className="font-display font-medium tracking-tight text-[16px]">{item.label}</span>
              </>
            );

            if (item.href) {
              return (
                <a
                  key={item.id}
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-2.5 text-neutral-400 hover:bg-white/5 hover:text-white transition-all duration-150 active:scale-[0.98] rounded-xl"
                >
                  {content}
                </a>
              );
            }

            return (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all duration-150 active:scale-[0.98] text-left rounded-xl ${
                  isActive
                    ? "bg-white/10 text-white shadow-[0_0_20px_rgba(255,255,255,0.05)]"
                    : "text-neutral-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {content}
              </button>
            );
          })}
        </nav>

        <div className="px-4 mb-4">
          <div className="lovable-glass rounded-2xl p-4 flex flex-col gap-2 border border-white/5">
            <div className="flex items-center gap-2 text-white/80">
              <Star size={14} strokeWidth={2} />
              <span className="font-sans text-[10px] uppercase tracking-wider font-bold">СОВЕТ</span>
            </div>
            <p className="font-sans text-[12px] text-neutral-500 leading-relaxed font-medium">
              Чем подробнее вы опишете проект в начале, тем точнее будет анализ.
            </p>
          </div>
        </div>

        <div className="px-3 border-t border-white/5 pt-4 space-y-1">
          <Link
            href="/contact"
            onClick={onMobileClose}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-neutral-400 hover:bg-white/5 hover:text-white transition-all duration-150 active:scale-[0.98] text-left rounded-xl"
          >
            <HelpCircle size={18} strokeWidth={2} />
            <span className="font-display font-medium tracking-tight text-[16px]">Поддержка</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
