const FORMULA_PREFIX = /^[=+\-@]/;

export type CsvCell = string | number | boolean | Date | null | undefined;

export function csvTextCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : typeof value === "boolean" ? value ? "Да" : "Нет" : String(value);
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function escapeCsvCell(value: CsvCell, delimiter: string): string {
  const text = csvTextCell(value);
  if (!text.includes(delimiter) && !/["\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function serializeCsv(rows: CsvCell[][], delimiter = ";"): string {
  return `\ufeff${rows.map((row) => row.map((value) => escapeCsvCell(value, delimiter)).join(delimiter)).join("\r\n")}\r\n`;
}

export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  const blob = new Blob([serializeCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function csvDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function datedCsvFilename(prefix: string, now = new Date()): string {
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  return `${prefix}-${date}.csv`;
}
