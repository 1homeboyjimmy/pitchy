import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function ResultPages({ page, pageSize, total, onChange, children }: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  children?: ReactNode;
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1 && !children) return null;

  return <nav aria-label="Страницы результатов" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-white/60">
    <div className="flex flex-wrap items-center gap-3">
      {children}
      <span aria-live="polite">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} из {total}</span>
    </div>
    {pages > 1 && <div className="flex gap-1">
      <button type="button" className="grid size-9 place-items-center rounded-lg border border-white/10 disabled:opacity-30" disabled={page === 0} onClick={() => onChange(page - 1)} aria-label="Предыдущая страница"><ChevronLeft size={16} /></button>
      <button type="button" className="grid size-9 place-items-center rounded-lg border border-white/10 disabled:opacity-30" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)} aria-label="Следующая страница"><ChevronRight size={16} /></button>
    </div>}
  </nav>;
}
