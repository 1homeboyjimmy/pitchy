"use client";

import { useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { downloadMessageExport, ExportFormat } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { notifyError } from "@/lib/ui";

const FORMAT_COLORS: Record<string, string> = {
    pdf: "text-red-300 bg-red-400/10 border-red-400/20",
    docx: "text-sky-300 bg-sky-400/10 border-sky-400/20",
    md: "text-white/60 bg-white/[0.06] border-white/10",
    txt: "text-white/60 bg-white/[0.06] border-white/10",
};

interface FileCardProps {
    format: string;
    name: string;
    /** Resolved message id to download from. Undefined while the carrying
     * message is optimistic (pre-reconcile) — the card renders disabled. */
    messageId?: number;
}

/**
 * Downloadable file card inside an assistant message. The file itself is
 * generated on demand by GET /chat/messages/{id}/export — the card only
 * carries format + filename (from SSE `file` events or EXPORT markers).
 */
export function FileCard({ format, name, messageId }: FileCardProps) {
    const [busy, setBusy] = useState(false);

    const handleDownload = async () => {
        if (!messageId || busy) return;
        const token = getToken();
        if (!token) {
            notifyError("Войдите, чтобы скачивать файлы.");
            return;
        }
        setBusy(true);
        try {
            await downloadMessageExport(messageId, format as ExportFormat, token);
        } catch (err) {
            notifyError(err instanceof Error ? err.message : "Не удалось скачать файл");
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            type="button"
            onClick={handleDownload}
            disabled={!messageId || busy}
            title={messageId ? name : "Файл станет доступен через секунду"}
            className="group flex items-center gap-3 pl-2 pr-4 py-2 rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] transition-all active:scale-[0.98] max-w-[340px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${FORMAT_COLORS[format] || FORMAT_COLORS.md}`}>
                <FileText className="w-4 h-4" strokeWidth={1.6} />
            </div>
            <div className="min-w-0 text-left">
                <div className="text-[13px] text-white/80 font-medium truncate">{name}</div>
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">
                    {format} · скачать
                </div>
            </div>
            {busy
                ? <Loader2 className="w-4 h-4 text-white/40 animate-spin shrink-0 ml-1" strokeWidth={1.6} />
                : <Download className="w-4 h-4 text-white/25 group-hover:text-white transition-colors shrink-0 ml-1" strokeWidth={1.6} />}
        </button>
    );
}
