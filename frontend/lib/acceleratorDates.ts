/** API legacy timestamps are UTC even when they have no explicit offset. */
export function utcDate(value: string): Date {
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
}

export function eventDateText(value: string, timeZone = "Europe/Moscow"): string {
  return utcDate(value).toLocaleString("ru-RU", { timeZone });
}

export function eventTimeText(value: string, timeZone = "Europe/Moscow"): string {
  return utcDate(value).toLocaleTimeString("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit" });
}

export function eventLocalInput(value: string, timeZone = "Europe/Moscow"): string {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(utcDate(value));
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Convert a cohort's wall-clock form input, independent of browser timezone. */
export function eventInputToUtc(value: string, timeZone = "Europe/Moscow"): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Укажите дату и время занятия");
  const wall = Date.parse(`${value}:00Z`);
  let guess = wall;
  for (let i = 0; i < 4; i++) {
    const rendered = eventLocalInput(new Date(guess).toISOString(), timeZone);
    const delta = wall - Date.parse(`${rendered}:00Z`);
    if (!delta) return new Date(guess).toISOString();
    guess += delta;
  }
  throw new Error("Такого времени нет в часовом поясе потока. Выберите другое время.");
}
