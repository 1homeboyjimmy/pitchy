"use client";

import { BarChart3, BookOpen, ChevronDown, FileText, LayoutDashboard, Settings2, Users, UserRoundCheck, type LucideIcon } from "lucide-react";
import type { OrganizerTab } from "./OrganizerOverview";

const GROUPS: Array<{ label: string; icon: LucideIcon; keys: OrganizerTab[] }> = [
  { label: "Обзор", icon: LayoutDashboard, keys: ["overview"] },
  { label: "Заявки", icon: FileText, keys: ["applications", "form"] },
  { label: "Участники", icon: Users, keys: ["reports", "tracking"] },
  { label: "Команды и трекеры", icon: UserRoundCheck, keys: ["trackers", "matching"] },
  { label: "Программа", icon: BookOpen, keys: ["program", "homework", "attendance"] },
  { label: "Результаты", icon: BarChart3, keys: ["artifacts", "project_audit", "demo_day", "closure"] },
  { label: "Настройки", icon: Settings2, keys: ["settings", "operations", "quotas", "audit"] },
];
const CHILD_LABELS: Partial<Record<OrganizerTab, string>> = { applications: "Список заявок", program: "Этапы программы", reports: "Отчётность", settings: "Параметры потока" };

export function OrganizerNavigation({ tabs, active, onNavigate }: { tabs: Array<{ key: OrganizerTab; label: string }>; active: OrganizerTab; onNavigate: (tab: OrganizerTab) => void }) {
  return <nav aria-label="Разделы акселератора" className="organizer-navigation">
    {GROUPS.map(group => {
      const children = group.keys.flatMap(key => tabs.filter(tab => tab.key === key));
      if (!children.length) return null;
      const selected = group.keys.includes(active);
      const Icon = group.icon;
      return <div key={group.label} className={group.label === "Настройки" ? "organizer-settings-group" : ""}>
        <button type="button" onClick={() => onNavigate(children[0].key)} aria-current={selected ? "page" : undefined} className={`organizer-nav-item ${selected ? "is-active" : ""}`}><Icon size={19} /><span>{group.label}</span>{children.length > 1 && <ChevronDown size={13} className={`ml-auto transition-transform ${selected ? "rotate-180" : ""}`} />}</button>
        {selected && children.length > 1 && <div className="organizer-subnav">{children.map(child => <button type="button" key={child.key} onClick={() => onNavigate(child.key)} aria-current={active === child.key ? "page" : undefined} className={active === child.key ? "is-active" : ""}>{CHILD_LABELS[child.key] || child.label}</button>)}</div>}
      </div>;
    })}
  </nav>;
}
