"use client";

import React, { useRef, useEffect } from "react";
import { Send, Square } from "react-feather";
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

  // Auto-expand logic based on content
  useEffect(() => {
    if (textareaRef.current) {
      // Reset height to calculate real auto height
      textareaRef.current.style.height = 'auto';
      // Set to scrollHeight or at least one line (e.g., 24px + padding)
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

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
        className={`relative flex items-end w-full rounded-[24px] bg-white/5 border border-white/10 backdrop-blur-md transition-all duration-300 focus-within:bg-white/10 focus-within:border-white/20 focus-within:shadow-[0_0_20px_rgba(255,255,255,0.05)] ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
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
          style={{
            paddingTop: '16px',
            paddingBottom: '16px',
            paddingLeft: '20px',
            paddingRight: '60px',
            minHeight: '56px',
            maxHeight: '200px'
          }}
        />

        {/* Send / Stop Button - Floating at the bottom right */}
        <div className="absolute right-3 bottom-[10px]">
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
              onClick={onSend}
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
    </div>
  );
}
