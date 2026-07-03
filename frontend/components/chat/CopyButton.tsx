"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
    /** Text placed into the clipboard on click. */
    text: string;
    className?: string;
    /** Icon size in tailwind units; actions rows use 4 (16px). */
    iconClassName?: string;
}

/**
 * Small icon button that copies `text` to the clipboard and flips to a
 * checkmark for a couple of seconds — same interaction as message copy
 * in Claude Code.
 */
export function CopyButton({ text, className, iconClassName = "w-4 h-4" }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    const handleCopy = useCallback(async () => {
        try {
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
            setCopied(true);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Copy to clipboard failed:", err);
        }
    }, [text]);

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
