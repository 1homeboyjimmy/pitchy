"use client";

import React, { useRef, useEffect, useState } from "react";
import { Send, Square, Maximize2, Minimize2 } from "react-feather";
import { motion, AnimatePresence } from "framer-motion";

interface ChatInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  isLoading: boolean;
  onStop?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  isLoading,
  onStop,
  placeholder = "Введите сообщение...",
  disabled = false,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Auto-expand logic based on content ONLY if not fullscreen
  useEffect(() => {
    if (textareaRef.current) {
      if (isFullscreen) {
        textareaRef.current.style.height = '100%';
      } else {
        // Reset height to calculate real auto height
        textareaRef.current.style.height = 'auto';
        // Set to scrollHeight or at least one line (e.g., 24px + padding)
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
      }
    }
  }, [value, isFullscreen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim() && !isLoading) {
        onSend();
        // optionally collapse fullscreen after send?
        // setIsFullscreen(false); 
      }
    }
  };

  const containerContent = (
    <div 
      className={`relative w-full ${isFullscreen ? 'flex flex-col h-full' : 'flex items-end'} rounded-[24px] bg-white/5 border border-white/10 backdrop-blur-md transition-all duration-300 focus-within:bg-white/10 focus-within:border-white/20 focus-within:shadow-[0_0_20px_rgba(255,255,255,0.05)] ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${isFullscreen ? 'bg-zinc-950/80 p-4 border-white/20 shadow-2xl' : ''}`}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className="w-full bg-transparent text-white placeholder-white/30 text-[15px] resize-none overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 focus:outline-none focus:ring-0 border-none !outline-none disabled:cursor-not-allowed"
        style={isFullscreen ? {
          paddingBottom: '60px',
          height: '100%'
        } : {
          paddingTop: '16px',
          paddingBottom: '16px',
          paddingLeft: '20px',
          paddingRight: '100px',
          minHeight: '56px',
          maxHeight: '200px'
        }}
      />

      {/* Action Buttons - Floating at the bottom right */}
      <div className={`absolute right-3 ${isFullscreen ? 'bottom-4' : 'bottom-[10px]'} flex gap-2 items-center`}>
         <motion.button
          onClick={() => setIsFullscreen(!isFullscreen)}
          whileTap={{ scale: 0.9 }}
          type="button"
          className="w-9 h-9 rounded-full bg-transparent hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors"
          title={isFullscreen ? "Свернуть" : "Во весь экран"}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </motion.button>
        {isLoading ? (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onStop}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
          >
            <Square className="w-4 h-4 fill-white" />
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              onSend();
            }}
            disabled={disabled || !value.trim()}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
              value.trim() && !disabled 
                ? 'bg-white text-black hover:bg-white/90' 
                : 'bg-white/5 text-white/30 cursor-not-allowed'
            }`}
          >
            <Send className="w-4 h-4" />
          </motion.button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Normal static container */}
      {!isFullscreen && (
        <div className="relative w-full max-w-4xl mx-auto">
          {containerContent}
        </div>
      )}

      {/* Fullscreen Modal Overlay */}
      <AnimatePresence>
        {isFullscreen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8 bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-6xl h-[80vh] flex flex-col"
            >
              {containerContent}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
