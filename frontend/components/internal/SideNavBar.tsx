"use client";

import Link from "next/link";
import { LayoutDashboard, MessageSquare, GitBranch, Users, Shield, Settings, HelpCircle } from "lucide-react";

export function SideNavBar({ activeTab, setActiveTab, isAdmin }: { activeTab: string, setActiveTab: (t: string) => void, isAdmin?: boolean }) {
  const topNavItems = [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "chat", label: "Чат", icon: MessageSquare },
    { id: "tree", label: "Древо принятия решений", icon: GitBranch },
    { id: "custdev", label: "CustDev", icon: Users, href: "https://custdev.pitchy.pro/" },
  ];

  if (isAdmin) {
    topNavItems.push({ id: "admin", label: "Админ", icon: Shield });
  }

  const bottomNavItems = [
    { id: "settings", label: "Настройки", icon: Settings },
    { id: "support", label: "Поддержка", icon: HelpCircle },
  ];

  return (
    <aside className="h-screen w-64 fixed left-0 top-0 border-r border-white/10 bg-[#0A0A0A] flex flex-col py-6 z-50">
      <div className="px-6 mb-10">
        <h1 className="text-white font-bold tracking-tighter text-lg">Pitchy.pro</h1>
        <p className="font-mono uppercase tracking-widest text-[11px] text-neutral-500 mt-1">Внутреннее пространство</p>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {topNavItems.map((item) => {
          const isActive = activeTab === item.id;
          const content = (
            <>
              <item.icon size={18} strokeWidth={1.5} />
              <span className="font-mono uppercase tracking-widest text-[11px]">{item.label}</span>
            </>
          );

          if (item.href) {
            return (
              <a
                key={item.id}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2 text-neutral-500 hover:bg-white/5 hover:text-white transition-colors duration-150 active:scale-[0.98] rounded-sm"
              >
                {content}
              </a>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 transition-colors duration-150 active:scale-[0.98] text-left rounded-sm ${
                isActive 
                  ? "bg-white/10 text-white border-l-2 border-white" 
                  : "text-neutral-500 hover:bg-white/5 hover:text-white border-l-2 border-transparent"
              }`}
            >
              {content}
            </button>
          );
        })}
      </nav>

      <div className="px-3 border-t border-white/10 pt-4 space-y-1">
        {bottomNavItems.map((item) => (
          <button
            key={item.id}
            className="w-full flex items-center gap-3 px-3 py-2 text-neutral-500 hover:bg-white/5 hover:text-white transition-colors duration-150 active:scale-[0.98] text-left rounded-sm"
          >
            <item.icon size={18} strokeWidth={1.5} />
            <span className="font-mono uppercase tracking-widest text-[11px]">{item.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
