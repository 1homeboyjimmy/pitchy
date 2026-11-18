"use client";

import { useState } from "react";
import { eventLocalInput, eventTimeText, utcDate } from "@/lib/acceleratorDates";
import styles from "./ResidentEventCalendar.module.css";

type CalendarEvent = { id: number; title: string; starts_at: string; timezone?: string | null; event_type?: string; status?: string };
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const TYPES: Record<string, string> = { webinar: "Вебинары", lecture: "Лекции", workshop: "Практикумы", meetup: "Встречи", demo_day: "Демо-дни", tracker_session: "Сессии с трекером", expert_session: "Сессии с экспертом", networking: "Нетворкинг", other: "Другие мероприятия" };
const keyFor = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dayKey = (event: CalendarEvent) => eventLocalInput(event.starts_at, event.timezone || "Europe/Moscow").slice(0, 10);

export function ResidentEventCalendar({ events }: { events: CalendarEvent[] }) {
  const ordered = [...events].sort((a, b) => utcDate(a.starts_at).getTime() - utcDate(b.starts_at).getTime());
  const initial = ordered.find(event => utcDate(event.starts_at) >= new Date()) || ordered[ordered.length - 1];
  const timezone = initial?.timezone || "Europe/Moscow";
  const today = eventLocalInput(new Date().toISOString(), timezone).slice(0, 10);
  const [month, setMonth] = useState(() => initial ? dayKey(initial).slice(0, 7) : today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const types = [...new Set(ordered.map(event => event.event_type || "other"))];
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(year, monthNumber, 0).getDate();
  const totalCells = Math.ceil((offset + count) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, i) => new Date(year, monthNumber - 1, i - offset + 1));
  const monthLabel = first.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  const monthEvents = ordered.filter(event => dayKey(event).startsWith(month));
  const visible = ordered.filter(event => !hidden.includes(event.event_type || "other"));
  const occupiedDays = new Set(visible.map(dayKey));
  const emptyWeeks = Array.from({ length: totalCells / 7 }, (_, index) => !cells.slice(index * 7, index * 7 + 7).some(date => occupiedDays.has(keyFor(date))));
  const colorFor = (event: CalendarEvent) => types.indexOf(event.event_type || "other") % 4;
  const changeMonth = (delta: number) => setMonth(keyFor(new Date(year, monthNumber - 1 + delta, 1)).slice(0, 7));
  const jump = (key: string, event: CalendarEvent) => {
    setSelected(key);
    const card = document.getElementById("resident-events-" + event.id);
    card?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    card?.focus({ preventScroll: true });
  };
  return <section aria-label="Календарь мероприятий" className={styles.calendar}>
    <div className={styles.topbar}><div><h3>Календарь</h3><p>Программа вашего потока</p></div><span className={styles.viewLabel}>Месяц</span></div>
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="Фильтры календаря">
        <h4>Мероприятия</h4>
        <div className={styles.filters}>{types.map((type, index) => <label key={type} className={styles.filter}>
          <input type="checkbox" checked={!hidden.includes(type)} onChange={() => setHidden(current => current.includes(type) ? current.filter(item => item !== type) : [...current, type])} />
          <span className={styles.swatch} data-color={index % 4} />
          <span>{TYPES[type] || type}</span><small>{monthEvents.filter(event => (event.event_type || "other") === type).length}</small>
        </label>)}</div>
        <div className={styles.monthSummary}><strong>{monthEvents.length}</strong><span>мероприятий в этом месяце</span></div>
        <div className={styles.mini} aria-label="Быстрый выбор даты"><b>{monthLabel}</b><div className={styles.miniGrid}>
          {WEEKDAYS.map(day => <span key={day} className={styles.miniWeekday}>{day}</span>)}
          {cells.map(date => { const key = keyFor(date); const rows = visible.filter(event => dayKey(event) === key); return <button type="button" key={key} aria-label={`Открыть дату ${date.getDate()}`} disabled={!rows.length} data-outside={date.getMonth() !== monthNumber - 1} data-today={key === today} onClick={() => jump(key, rows[0])}>{date.getDate()}<i data-has-events={!!rows.length} /></button>; })}
        </div></div>
        <p className={styles.hint}>Выберите событие в календаре, чтобы перейти к его подробностям.</p>
      </aside>
      <div className={styles.main}>
        <header className={styles.monthHeader}><h4 aria-live="polite">{monthLabel}</h4><div><button type="button" className={styles.todayButton} onClick={() => setMonth(today.slice(0, 7))}>Сегодня</button><button type="button" aria-label="Предыдущий месяц" onClick={() => changeMonth(-1)}>←</button><button type="button" aria-label="Следующий месяц" onClick={() => changeMonth(1)}>→</button></div></header>
        <div className={styles.scroller}><div className={styles.grid}>
          {WEEKDAYS.map(day => <div key={day} className={styles.weekday}>{day}</div>)}
          {cells.map((date, index) => {
            const key = keyFor(date);
            const rows = visible.filter(event => dayKey(event) === key);
            const outside = date.getMonth() !== monthNumber - 1;
            return <div key={key} className={styles.cell} data-empty-week={emptyWeeks[Math.floor(index / 7)]} data-outside={outside} data-selected={selected === key}>
              <button type="button" className={styles.date} data-today={key === today} disabled={!rows.length} aria-pressed={selected === key} aria-label={`${date.getDate()} ${date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}${rows.length ? ": " + rows.map(row => row.title).join(", ") : ": нет мероприятий"}`} onClick={() => jump(key, rows[0])}>{date.getDate()}</button>
              <div className={styles.entries}>{rows.map(event => <button type="button" key={event.id} className={styles.entry} data-color={colorFor(event)} data-cancelled={event.status === "cancelled"} aria-label={`${event.title}, ${eventTimeText(event.starts_at, event.timezone || "Europe/Moscow")}`} onClick={() => jump(key, event)}><span className={styles.eventTime}>{eventTimeText(event.starts_at, event.timezone || "Europe/Moscow")}{event.status === "cancelled" ? " · Отменено" : ""}</span><span className={styles.eventTitle}>{event.title}</span></button>)}</div>
            </div>;
          })}
        </div></div>
        {!visible.some(event => dayKey(event).startsWith(month)) && <p className={styles.empty}>В этом месяце нет мероприятий с выбранными фильтрами.</p>}
      </div>
    </div>
  </section>;
}
