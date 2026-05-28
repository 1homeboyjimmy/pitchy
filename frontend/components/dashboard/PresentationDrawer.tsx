import { motion, AnimatePresence } from "framer-motion";
import { X, Download, FileText } from "react-feather";
import { PresentationSlide } from "@/lib/api";
import { SlideRenderer } from "./SlideRenderer";
import { useRef, useState } from "react";

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
}

export function PresentationDrawer({
  isOpen,
  onClose,
  slides,
  isLoading,
  statusText,
  mode,
}: PresentationDrawerProps) {
  const [viewMode, setViewMode] = useState<"preview" | "html">("preview");
  const contentRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    // Basic client-side PDF generation via print dialog
    window.print();
  };

  // Shared inner body so we don't duplicate markup between inline + overlay.
  const body = (
    <div className="h-full flex flex-col bg-[#131313] border-l border-white/10 print:absolute print:inset-0 print:w-full print:max-w-none print:border-none print:h-auto overflow-hidden text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 md:p-6 border-b border-white/10 print:hidden shrink-0">
        <h2 className="text-base md:text-xl font-bold text-white flex items-center gap-2 min-w-0">
          <FileText className="w-5 h-5 text-pitchy-violet shrink-0" />
          <span className="truncate">Презентация</span>
          {isLoading && slides.length > 0 && (
            <span className="ml-2 text-[10px] uppercase tracking-widest text-pitchy-violet/80 font-mono shrink-0">
              слайд {slides.length}…
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2 md:gap-4">
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
          <button
            onClick={handlePrint}
            disabled={slides.length === 0}
            className="flex items-center gap-2 px-3 md:px-4 py-2 bg-gradient-to-r from-pitchy-violet to-purple-600 hover:opacity-90 text-white rounded-lg transition-opacity text-xs md:text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">PDF / Печать</span>
          </button>
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
