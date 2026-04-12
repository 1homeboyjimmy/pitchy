import { motion, AnimatePresence } from "framer-motion";
import { X, Download, FileText } from "react-feather";
import { PresentationSlide } from "@/lib/api";
import { SlideRenderer } from "./SlideRenderer";
import { useRef } from "react";

interface PresentationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  slides: PresentationSlide[];
}

export function PresentationDrawer({ isOpen, onClose, slides }: PresentationDrawerProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    // Basic client-side PDF generation via print dialog
    window.print();
  };

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
            className="fixed top-0 right-0 h-full w-full max-w-5xl bg-[#131313] border-l border-white/10 z-[101] shadow-2xl flex flex-col print:absolute print:inset-0 print:w-full print:max-w-none print:border-none print:h-auto overflow-hidden text-white"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10 print:hidden shrink-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-pitchy-violet" />
                Сгенерированная презентация
              </h2>
              <div className="flex items-center gap-4">
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pitchy-violet to-purple-600 hover:opacity-90 text-white rounded-lg transition-opacity text-sm font-medium"
                >
                  <Download className="w-4 h-4" />
                  PDF / Печать
                </button>
                <button
                  onClick={onClose}
                  className="p-2 text-white/50 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content Area - Scrollable but slides are fixed height to emulate 16:9 */}
            <div 
               className="flex-1 overflow-y-auto p-4 md:p-8 bg-[#0a0a0a] print:bg-white print:p-0 presentation-print-container"
               ref={contentRef}
            >
              <div className="max-w-4xl mx-auto space-y-12 print:space-y-0 print:max-w-none w-full">
                {slides.map((slide, index) => (
                  <div key={index} className="print:page-break-after-always shadow-2xl print:shadow-none bg-[#131313] rounded-2xl print:rounded-none">
                    <SlideRenderer slide={slide} />
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
