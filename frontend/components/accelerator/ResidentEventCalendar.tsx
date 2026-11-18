"use client";

import { useState } from "react";
import { eventLocalInput, utcDate } from "@/lib/acceleratorDates";

type CalendarEvent = { id: number; title: string; starts_at: string; timezone?: string | null };

export function ResidentEventCalendar({ events }: { events: CalendarEvent[] }) {
  const ordered = [...events].sort((a, b) => utcDate(a.starts_at).getTime() - utcDate(b.starts_at).getTime());
  const dayKey = (event: CalendarEvent) => eventLocalInput(event.starts_at, event.timezone || "Europe/Moscow").slice(0, 10);
  const initial = ordered.find(event => utcDate(event.starts_at) >= new Date()) || ordered[ordered.length - 1];
  const [month, setMonth] = useState(() => initial ? dayKey(initial).slice(0, 7) : new Date().toISOString().slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(year, monthNumber, 0).getDate();
  const changeMonth = (delta: number) => {
    const next = new Date(year, monthNumber - 1 + delta, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  };
  const jump = (key: string, event: CalendarEvent) => {
    setSelected(key);
    const card = document.getElementById("resident-events-" + event.id);
    card?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    card?.focus({ preventScroll: true });
  };
  return <div aria-label="Календарь мероприятий" className="mt-6 rounded-2xl border border-white/10 p-3 sm:p-5">
    <div className="mb-4 flex items-center justify-between gap-2">
      <button type="button" aria-label="Предыдущий месяц" onClick={() => changeMonth(-1)} className="rounded-lg px-4 py-2 hover:bg-white/10">←</button>
      <h3 aria-live="polite" className="capitalize">{first.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</h3>
      <button type="button" aria-label="Следующий месяц" onClick={() => changeMonth(1)} className="rounded-lg px-4 py-2 hover:bg-white/10">→</button>
    </div>
    <div className="grid grid-cols-7 text-center">
      {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(day => <span key={day} className="pb-2 text-xs text-white/45">{day}</span>)}
      {Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}
      {Array.from({ length: count }, (_, i) => {
        const day = i + 1;
        const key = `${month}-${String(day).padStart(2, "0")}`;
        const rows = ordered.filter(event => dayKey(event) === key);
        return <button key={key} type="button" disabled={!rows.length} aria-pressed={selected === key} aria-label={`${day} ${first.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}${rows.length ? ": " + rows.map(row => row.title).join(", ") : ": нет мероприятий"}`} onClick={() => jump(key, rows[0])} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-sm ${selected === key ? "bg-blue-400/20 ring-1 ring-blue-300" : rows.length ? "hover:bg-white/10" : "text-white/35"}`}>
          {day}<span className={`h-1.5 w-1.5 rounded-full ${rows.length ? "bg-blue-400" : "bg-transparent"}`} />
        </button>;
      })}
    </div>
    <p className="mt-4 text-xs text-white/45">Точкой отмечены дни с мероприятиями. Выберите дату, чтобы перейти к карточкам ниже.</p>
  </div>;
}
