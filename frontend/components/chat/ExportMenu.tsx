"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { downloadMessageExport, EXPORT_FORMAT_LABELS, ExportFormat } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { notifyError } from "@/lib/ui";

const FORMATS: ExportFormat[] = ["pdf", "docx", "md", "txt"];

interface ExportMenuProps {
    /** DB id of the assistant message; optimistic messages (id <= 0) are
     * not yet exportable — the menu is disabled until reconcile. */
    messageId: number;
    disabled?: boolean;
    className?: string;
}

/**
 * Hover-actions dropdown: exports an assistant answer as PDF / DOCX / MD / TXT
 * via GET /chat/messages/{id}/export. Opens upward so it never clips against
 * the bottom of the chat scroll area.
 */
export function ExportMenu({ messageId, disabled, className }: ExportMenuProps) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState<ExportFormat | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const isDisabled = disabled || messageId <= 0;

    const handleExport = async (format: ExportFormat) => {
        if (busy) return;
        const token = getToken();
        if (!token) {
            notifyError("Войдите, чтобы скачивать ответы.");
            return;
        }
        setBusy(format);
        try {
            await downloadMessageExport(messageId, format, token);
            setOpen(false);
        } catch (err) {
            notifyError(err instanceof Error ? err.message : "Не удалось скачать файл");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div ref={rootRef} className={`relative ${className || ""}`}>
            <button
                type="button"
                onClick={() => !isDisabled && setOpen((v) => !v)}
                disabled={isDisabled}
                title={isDisabled ? "Экспорт станет доступен через секунду" : "Скачать ответ файлом"}
                aria-label="Скачать ответ файлом"
                className={`p-2.5 rounded-full transition-all active:scale-90 ${
                    open
                        ? "text-white bg-white/10 shadow-lg shadow-white/5"
                        : "text-white/20 hover:text-white hover:bg-white/5"
                } ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
            >
                <Download className="w-4 h-4" strokeWidth={1.5} />
            </button>

            {open && (
                <div className="absolute bottom-full left-0 mb-2 z-30 min-w-[190px] rounded-2xl border border-white/10 bg-[#161618] shadow-2xl shadow-black/50 overflow-hidden">
                    <div className="px-4 pt-3 pb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-white/30 font-bold">
                        Скачать как
                    </div>
                    {FORMATS.map((fmt) => (
                        <button
                            key={fmt}
                            type="button"
                            onClick={() => handleExport(fmt)}
                            disabled={busy !== null}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[13px] text-white/70 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                        >
                            {busy === fmt
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white/40" strokeWidth={1.5} />
                                : <FileText className="w-3.5 h-3.5 text-white/25" strokeWidth={1.5} />}
                            <span className="flex-1">{EXPORT_FORMAT_LABELS[fmt]}</span>
                            <span className="font-mono text-[9px] uppercase tracking-widest text-white/20">.{fmt}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
