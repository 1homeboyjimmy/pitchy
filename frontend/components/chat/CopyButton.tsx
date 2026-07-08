"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
    /** Text placed into the clipboard on click (text/plain flavor). */
    text: string;
    /** Lazily produces the rendered-HTML flavor. When present, the copy is
     * dual-flavor via ClipboardItem: rich editors (Word, Google Docs, Notion)
     * paste real tables/headings, plain targets still get `text`. */
    getHtml?: () => string | null;
    className?: string;
    /** Icon size in tailwind units; actions rows use 4 (16px). */
    iconClassName?: string;
}

/**
 * Serializes an already-rendered message DOM node into clipboard-friendly
 * HTML: strips UI classes/styles (dark-theme white text would paste
 * invisible), keeps semantic tags, adds minimal inline table styling so
 * tables paste with visible borders.
 */
export function serializeMessageHtml(root: HTMLElement): string {
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-export-ignore]").forEach((n) => n.remove());
    clone.querySelectorAll<HTMLElement>("*").forEach((n) => {
        n.removeAttribute("class");
        n.removeAttribute("style");
    });
    clone.querySelectorAll<HTMLElement>("table").forEach((t) => {
        t.style.borderCollapse = "collapse";
    });
    clone.querySelectorAll<HTMLElement>("th, td").forEach((c) => {
        c.style.border = "1px solid #c9c9ce";
        c.style.padding = "6px 10px";
        c.style.textAlign = "left";
        c.style.verticalAlign = "top";
    });
    clone.querySelectorAll<HTMLElement>("th").forEach((c) => {
        c.style.background = "#f2f2f5";
        c.style.fontWeight = "600";
    });
    return `<div>${clone.innerHTML}</div>`;
}

/**
 * Small icon button that copies `text` to the clipboard and flips to a
 * checkmark for a couple of seconds — same interaction as message copy
 * in Claude Code.
 */
export function CopyButton({ text, getHtml, className, iconClassName = "w-4 h-4" }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    const handleCopy = useCallback(async () => {
        try {
            let done = false;
            // Rich copy: text/html + text/plain. Secure contexts only; any
            // failure silently falls through to the plain-text paths below.
            if (
                getHtml &&
                typeof navigator !== "undefined" &&
                navigator.clipboard?.write &&
                typeof ClipboardItem !== "undefined"
            ) {
                try {
                    const html = getHtml();
                    if (html) {
                        await navigator.clipboard.write([
                            new ClipboardItem({
                                "text/html": new Blob([html], { type: "text/html" }),
                                "text/plain": new Blob([text], { type: "text/plain" }),
                            }),
                        ]);
                        done = true;
                    }
                } catch {
                    /* permissions/serialization issue — plain text below */
                }
            }
            if (!done) {
                if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    // Insecure-context fallback (plain http): hidden textarea + execCommand.
                    const ta = document.createElement("textarea");
                    ta.value = text;
                    ta.style.position = "fixed";
                    ta.style.opacity = "0";
                    document.body.appendChild(ta);
                    ta.focus();
                    ta.select();
                    document.execCommand("copy");
                    document.body.removeChild(ta);
                }
            }
            setCopied(true);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Copy to clipboard failed:", err);
        }
    }, [text, getHtml]);

    return (
        <button
            type="button"
            onClick={handleCopy}
            title={copied ? "Скопировано" : "Скопировать"}
            aria-label={copied ? "Скопировано" : "Скопировать ответ"}
            className={`p-2.5 rounded-full transition-all active:scale-90 ${
                copied
                    ? "text-emerald-400 bg-emerald-400/10 shadow-lg shadow-emerald-500/5"
                    : "text-white/20 hover:text-white hover:bg-white/5"
            } ${className || ""}`}
        >
            {copied
                ? <Check className={iconClassName} strokeWidth={1.5} />
                : <Copy className={iconClassName} strokeWidth={1.5} />}
        </button>
    );
}
