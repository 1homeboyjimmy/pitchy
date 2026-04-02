"use client";

import React, { useRef, useEffect, useState } from "react";
import { Send, Square, Maximize2, Minimize2 } from "react-feather";
import { motion } from "framer-motion";

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
        // In expanded mode, we fix the height to a large value
        textareaRef.current.style.height = '300px';
      } else {
        // Auto adjust based on scrollHeight
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 40), 200)}px`;
      }
    }
  }, [value, isFullscreen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim() && !isLoading) {
        onSend();
      }
    }
  };

  return (
    <div className="relative w-full max-w-4xl mx-auto">
      <div 
        className={`relative w-full flex flex-col rounded-[20px] bg-[#111118] border border-white/10 transition-all duration-300 focus-within:border-white/20 focus-within:shadow-[0_0_20px_rgba(255,255,255,0.05)] ${disabled ? 'opacity-50 cursor-not-allowed' : ''} shadow-lg overflow-hidden group`}
      >
        <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-[#111118] to-transparent z-10 pointer-events-none opacity-0 transition-opacity duration-300 group-focus-within:opacity-100" />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full bg-transparent text-white placeholder-white/30 text-[15px] resize-none overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 focus:outline-none focus:ring-0 border-none !outline-none disabled:cursor-not-allowed px-5 py-4 pb-2 z-0 relative"
          style={{ minHeight: '56px' }}
        />

        {/* Action Buttons - safely placed inside the container at the bottom */}
        <div className="flex justify-between items-center w-full px-3 pb-2 pt-1 mt-auto">
          <motion.button
            onClick={() => setIsFullscreen(!isFullscreen)}
            whileTap={{ scale: 0.9 }}
            type="button"
            className="w-9 h-9 rounded-full bg-transparent hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors ml-1"
            title={isFullscreen ? "Свернуть" : "Во весь экран"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </motion.button>
          
          <div className="flex items-center">
            {isLoading ? (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={onStop}
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors mr-1"
              >
                <Square className="w-4 h-4 fill-white" />
              </motion.button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={onSend}
                disabled={disabled || !value.trim()}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors mr-1 ${
                  value.trim() && !disabled 
                    ? 'bg-white text-black hover:bg-white/90 shadow-md' 
                    : 'bg-white/5 text-white/30 cursor-not-allowed'
                }`}
              >
                <Send className="w-4 h-4 ml-[2px]" />
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
