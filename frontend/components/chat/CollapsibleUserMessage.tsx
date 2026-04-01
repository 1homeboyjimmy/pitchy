"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp } from "react-feather";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface CollapsibleUserMessageProps {
  content: string;
}

export function CollapsibleUserMessage({ content }: CollapsibleUserMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Maximum height before collapsing (approx 3 lines)
  const MAX_HEIGHT_PX = 80;

  useEffect(() => {
    if (contentRef.current) {
      if (contentRef.current.scrollHeight > MAX_HEIGHT_PX) {
        setIsOverflowing(true);
      }
    }
  }, [content]);

  return (
    <div className="w-full bg-white/10 text-white rounded-2xl rounded-tr-sm px-4 pt-3 pb-3 relative">
      <motion.div
         layout
         initial={false}
         animate={{
             height: !isOverflowing || isExpanded ? "auto" : MAX_HEIGHT_PX,
         }}
         className="relative overflow-hidden"
      >
        <div 
          ref={contentRef}
          className="prose prose-invert prose-sm max-w-none text-[15px] leading-relaxed break-words text-white/90"
        >
           <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
           </ReactMarkdown>
        </div>
        
        {/* Gradient fade when collapsed */}
        {!isExpanded && isOverflowing && (
           <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#2c2b38] to-transparent pointer-events-none" />
        )}
      </motion.div>

      {isOverflowing && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-[11px] font-medium text-white/70 hover:text-white transition-all font-mono tracking-wider uppercase"
          >
            {isExpanded ? "Свернуть" : "Развернуть"}
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}
