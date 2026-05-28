import { motion, AnimatePresence } from "framer-motion";
import { X, Download, FileText, RefreshCw, ChevronDown } from "react-feather";
import { PresentationSlide } from "@/lib/api";
import { SlideRenderer } from "./SlideRenderer";
import { useRef, useState, useEffect } from "react";

interface PresentationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  slides: PresentationSlide[];
  isLoading?: boolean;
  statusText?: string | null;
  /** "inline" docks the panel beside the chat as a flex sibling (no overlay,
   *  no animation). "overlay" keeps the legacy modal behaviour for mobile.
   *  When unset the component picks per-viewport: inline on md+, overlay below. */
  mode?: "inline" | "overlay";
  /** Which provider built the current deck — surfaced as a small pill. */
  provider?: string | null;
  /** Optional re-generate handler — when supplied, a refresh button appears
   *  in the header that drops the saved z.ai conversation_id and rebuilds
   *  the deck from scratch. */
  onRegenerate?: () => void;
}

export function PresentationDrawer({
  isOpen,
  onClose,
  slides,
  isLoading,
  statusText,
  mode,
  provider,
  onRegenerate,
}: PresentationDrawerProps) {
  const [viewMode, setViewMode] = useState<"preview" | "html">("preview");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close export menu on outside-click.
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportMenuOpen]);

  const downloadBlob = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportPDF = () => {
    // Print dialog — user picks "Save as PDF". The @media print rules in
    // globals.css preserve the dark theme and put one slide per page.
    window.print();
    setExportMenuOpen(false);
  };

  const exportHTML = () => {
    // Standalone HTML: embed each rendered slide's HTML (or fall back to
    // the slide's title + bullets when only structured data is available).
    const slidesHtml = slides
      .map((s) => {
        const inner = s.html
          ? s.html
          : `<div style="padding:48px;color:#fff;font-family:Inter,sans-serif">
               <h1 style="font-size:42px;margin:0 0 16px">${(s.title || s.type || "").toString()}</h1>
               ${(s.subtitle ? `<h2 style="color:#a78bfa;font-weight:400;margin:0 0 24px">${s.subtitle}</h2>` : "")}
               <ul style="font-size:18px;line-height:1.5;list-style:none;padding:0">
                 ${(Array.isArray(s.content) ? s.content : []).map((c) => `<li style="margin:8px 0">— ${c}</li>`).join("")}
               </ul>
             </div>`;
        return `<section style="background:#0a0a0a;color:#fff;width:100vw;height:100vh;display:flex;align-items:center;page-break-after:always">${inner}</section>`;
      })
      .join("");
    const doc = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Pitchy — презентация</title><style>html,body{margin:0;background:#0a0a0a;font-family:Inter,sans-serif}@page{size:landscape;margin:0;background:#0a0a0a}</style></head><body>${slidesHtml}</body></html>`;
    downloadBlob(`pitchy-deck-${Date.now()}.html`, doc, "text/html;charset=utf-8");
    setExportMenuOpen(false);
  };

  const exportJSON = () => {
    downloadBlob(`pitchy-deck-${Date.now()}.json`, JSON.stringify(slides, null, 2), "application/json");
    setExportMenuOpen(false);
  };

  const exportMarkdown = () => {
    // Plain markdown — handy for sharing the structure without styling.
    const md = slides
      .map((s, i) => {
        const lines: string[] = [];
        lines.push(`## ${i + 1}. ${s.title || s.type || "Slide"}`);
        if (s.subtitle) lines.push(`_${s.subtitle}_`);
        if (Array.isArray(s.content)) {
          lines.push(...s.content.map((c) => `- ${c}`));
        } else if (s.content) {
          lines.push(String(s.content));
        }
        return lines.join("\n");
      })
      .join("\n\n---\n\n");
    downloadBlob(`pitchy-deck-${Date.now()}.md`, md, "text/markdown;charset=utf-8");
    setExportMenuOpen(false);
  };

  // Shared inner body so we don't duplicate markup between inline + overlay.
  const body = (
    <div className="h-full flex flex-col bg-[#131313] border-l border-white/10 print:absolute print:inset-0 print:w-full print:max-w-none print:border-none print:h-auto overflow-hidden text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 md:p-6 border-b border-white/10 print:hidden shrink-0">
        <h2 className="text-base md:text-xl font-bold text-white flex items-center gap-2 min-w-0">
          <FileText className="w-5 h-5 text-pitchy-violet shrink-0" />
          <span className="truncate">Презентация</span>
          {provider && (
            <span
              className={`ml-2 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest rounded-md border shrink-0 ${
                provider === "zai"
                  ? "bg-pitchy-violet/15 text-pitchy-violet border-pitchy-violet/30"
                  : "bg-white/5 text-white/60 border-white/10"
              }`}
              title={provider === "zai" ? "Native Z.AI slides_glm_agent" : "Fallback на Makura GLM-5"}
            >
              {provider === "zai" ? "Z.AI" : "Makura"}
            </span>
          )}
          {isLoading && slides.length > 0 && (
            <span className="ml-2 text-[10px] uppercase tracking-widest text-pitchy-violet/80 font-mono shrink-0">
              слайд {slides.length}…
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2 md:gap-4">
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={!!isLoading}
              className="flex items-center gap-2 px-3 md:px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white rounded-lg transition-colors text-xs md:text-sm font-medium border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Сгенерировать презентацию с чистого листа"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">Регенерировать</span>
            </button>
          )}
          {slides.length > 0 && (
            <div className="hidden md:flex bg-white/5 rounded-lg p-1 mr-2 border border-white/10">
              <button
                onClick={() => setViewMode("preview")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === "preview" ? "bg-pitchy-violet text-white shadow" : "text-white/60 hover:text-white"}`}
              >
                Preview
              </button>
              <button
                onClick={() => setViewMode("html")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === "html" ? "bg-pitchy-violet text-white shadow" : "text-white/60 hover:text-white"}`}
              >
                HTML
              </button>
            </div>
          )}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setExportMenuOpen((v) => !v)}
              disabled={slides.length === 0}
              className="flex items-center gap-2 px-3 md:px-4 py-2 bg-white text-black hover:bg-white/90 rounded-lg transition-colors text-xs md:text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Экспорт</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${exportMenuOpen ? "rotate-180" : ""}`} />
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-[#0f0f0f] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
                <button
                  onClick={exportPDF}
                  className="w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/5 transition-colors flex items-start gap-3"
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider text-white/40 mt-1 w-10">PDF</span>
                  <span className="flex-1">
                    <span className="block">Печать / PDF</span>
                    <span className="block text-[11px] text-white/40">Системный диалог печати</span>
                  </span>
                </button>
                <button
                  onClick={exportHTML}
                  className="w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/5 transition-colors border-t border-white/5 flex items-start gap-3"
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider text-white/40 mt-1 w-10">HTML</span>
                  <span className="flex-1">
                    <span className="block">Standalone HTML</span>
                    <span className="block text-[11px] text-white/40">Один файл с тёмной темой</span>
                  </span>
                </button>
                <button
                  onClick={exportMarkdown}
                  className="w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/5 transition-colors border-t border-white/5 flex items-start gap-3"
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider text-white/40 mt-1 w-10">MD</span>
                  <span className="flex-1">
                    <span className="block">Markdown</span>
                    <span className="block text-[11px] text-white/40">Структура и текст без стилей</span>
                  </span>
                </button>
                <button
                  onClick={exportJSON}
                  className="w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/5 transition-colors border-t border-white/5 flex items-start gap-3"
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider text-white/40 mt-1 w-10">JSON</span>
                  <span className="flex-1">
                    <span className="block">Исходные данные</span>
                    <span className="block text-[11px] text-white/40">Бэкап или импорт в другой инструмент</span>
                  </span>
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/50 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            aria-label="Закрыть превью"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div
        className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#0a0a0a] print:bg-white print:p-0 presentation-print-container"
        ref={contentRef}
      >
        <div className="max-w-3xl mx-auto space-y-6 md:space-y-8 print:space-y-0 print:max-w-none w-full">
          {isLoading && slides.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="relative mb-8">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-pitchy-violet to-pitchy-cyan animate-spin [animation-duration:3s]" />
                <div className="absolute inset-2 bg-[#0a0a0a] rounded-xl flex items-center justify-center">
                  <FileText className="w-8 h-8 text-pitchy-violet animate-pulse" />
                </div>
              </div>
              <h3 className="text-xl md:text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 mb-3">
                Pitchy создаёт презентацию
              </h3>
              <p className="text-white/40 max-w-sm text-sm leading-relaxed min-h-[40px]">
                {statusText || "Анализируем проект и собираем слайды. Они начнут появляться здесь по мере готовности."}
              </p>
            </div>
          )}

          {viewMode === "preview" ? (
            slides.map((slide, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="print:page-break-after-always shadow-2xl print:shadow-none bg-[#131313] rounded-2xl print:rounded-none"
              >
                <SlideRenderer slide={slide} />
              </motion.div>
            ))
          ) : (
            <div className="bg-black border border-white/10 p-6 rounded-2xl w-full text-pitchy-cyan-light font-mono text-xs md:text-sm overflow-x-auto shadow-inner">
              <pre>
                <code>{JSON.stringify(slides, null, 2)}</code>
              </pre>
            </div>
          )}

          {!isLoading && slides.length === 0 && (
            <div className="text-center py-20 text-white/20">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>Нет доступных слайдов</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // INLINE mode: rendered as a flex sibling beside the chat. No overlay, no
  // animation, no fixed positioning. The parent controls width.
  if (mode === "inline") {
    if (!isOpen) return null;
    return <div className="h-full w-full min-w-0">{body}</div>;
  }

  // OVERLAY mode: legacy modal slide-in from the right (mobile / explicit
  // open from the chat button).
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] print:hidden"
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-full max-w-5xl z-[101] shadow-2xl print:absolute print:inset-0 print:w-full print:max-w-none"
          >
            {body}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
