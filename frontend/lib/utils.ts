/**
 * Utility functions for the frontend.
 */

/**
 * Strips <think> and <thought> tags from a string.
 * Used as a fallback if the backend fails to strip them.
 */
export function stripThoughts(content: string): string {
    if (!content) return "";
    
    // Remove complete tags (including ǏǏǏ and [STATUS:])
    let stripped = content.replace(/<(think|thought|tool_call|tool_thought|think_process)>[\s\S]*?<\/\1>/gi, "");
    stripped = stripped.replace(/ǏǏǏ[\s\S]*?ǏǏǏ/g, "");
    stripped = stripped.replace(/\[STATUS:[\s\S]*?\]/g, "");
    
    // Remove unclosed pure-thought tags (at the end of string)
    stripped = stripped.replace(/<(think|thought|think_process)>[\s\S]*$/gi, "");
    stripped = stripped.replace(/ǏǏǏ[\s\S]*$/g, "");
    stripped = stripped.replace(/\[STATUS:[\s\S]*$/g, "");
    
    // Handle partially present tags at the end to prevent flickering during streaming
    // Matches things like <t, <th, <think, but not <table>
    stripped = stripped.replace(/<(t|th|thi|thin|think|think_|think_p|think_pr|think_pro|think_proc|think_proce|think_proces|think_process|tho|thou|thoug|thought)?$/gi, "");
    
    // SANITIZE: Prevent prompt leakage from injecting raw CSS or JS that breaks the UI
    stripped = stripped.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    stripped = stripped.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    // Handle unclosed style/script tags
    stripped = stripped.replace(/<style[^>]*>[\s\S]*$/gi, "");
    stripped = stripped.replace(/<script[^>]*>[\s\S]*$/gi, "");
    
    return stripped.trim();
}

/** Remove forbidden model signatures from historical and streaming replies. */
export function stripPitchySignature(content: string): string {
    if (!content) return "";
    return content
        .replace(
            /(?:^|\n)\s*(?:[-—–]\s*)?[*_~]*\s*Pitchy\s*,\s*(?:(?:ведущий|старший|главный)\s+)?(?:эксперт|аналитик|советник)[^\n]*[*_~]*\s*$/gimu,
            "",
        )
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export type MessageAttachment = { name: string; kind: string };

// Attachment blocks embedded by the backend into stored user messages.
// Keep the format in sync with build_attachment_block in chat_attachments.py.
const FILE_BLOCK_RE = /<<<FILE name="([^"]*)" kind="([^"]*)">>>\n?[\s\S]*?<<<END FILE>>>/g;

/**
 * Splits a user message into visible text and attached-file chips.
 * The extracted file text itself is hidden from the bubble — only
 * name/kind are surfaced.
 */
export function parseAttachments(content: string): { text: string; attachments: MessageAttachment[] } {
    if (!content || !content.includes("<<<FILE ")) {
        return { text: content, attachments: [] };
    }
    const attachments: MessageAttachment[] = [];
    const text = content
        .replace(FILE_BLOCK_RE, (_match, name: string, kind: string) => {
            attachments.push({ name, kind });
            return "";
        })
        .trim();
    return { text, attachments };
}

export type MessageExport = { format: string; message_id?: number; name: string };

// Маркеры файлов-экспортов, встроенные бэкендом в ответ ассистента.
// Формат синхронизирован с build_export_marker в export_service.py.
// message_id есть только когда маркер указывает на ДРУГОЕ сообщение
// (экспорт прошлого ответа); без него берётся id сообщения-носителя.
const EXPORT_MARKER_RE = /<<<EXPORT format="([a-z]+)"(?: message_id="(\d+)")? name="([^"]*)">>>/g;

/**
 * Splits an assistant message into visible text and export file cards.
 */
export function parseExports(content: string): { text: string; exports: MessageExport[] } {
    if (!content || !content.includes("<<<EXPORT ")) {
        return { text: content, exports: [] };
    }
    const exports: MessageExport[] = [];
    const text = content
        .replace(EXPORT_MARKER_RE, (_match, format: string, mid: string | undefined, name: string) => {
            exports.push({ format, message_id: mid ? Number(mid) : undefined, name });
            return "";
        })
        .trim();
    return { text, exports };
}

/**
 * Combines multiple class names into a single string.
 */
export function cn(...inputs: (string | undefined | null | boolean)[]) {
    return inputs.filter(Boolean).join(" ");
}

// Достаёт домен из URL для подписи карточек-источников (как в Perplexity/Qwen).
// Возвращает "" если URL битый — карточка просто покажет заголовок.
export function hostFromUrl(url: string | undefined | null): string {
    if (!url) return "";
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
}

// Backend returns naive UTC timestamps without timezone; admin viewers in MSK expect +3h.
export function adminDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getTime() + 3 * 60 * 60 * 1000);
}
