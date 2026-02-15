"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface AnimatedButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  icon?: ReactNode;
}

export function AnimatedButton({
  children,
  onClick,
  variant = "primary",
  size = "md",
  className = "",
  disabled = false,
  type = "button",
  icon,
}: AnimatedButtonProps) {
  const baseStyles =
    "relative inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 rounded-full overflow-hidden";

  const variants = {
    primary:
      "bg-violet-600 text-white hover:bg-violet-500 hover:shadow-lg hover:shadow-violet-500/25",
    secondary: "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 hover:shadow-lg",
    outline:
      "border-2 border-violet-600 text-violet-400 hover:bg-violet-600/10 hover:shadow-lg hover:shadow-violet-500/20",
    ghost: "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50",
  };

  const sizes = {
    sm: "px-4 py-2 text-sm",
    md: "px-6 py-3 text-base",
    lg: "px-8 py-4 text-lg",
  };

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: disabled ? 1 : 1.05 }}
      whileTap={{ scale: disabled ? 1 : 0.95 }}
      className={`
        ${baseStyles}
        ${variants[variant]}
        ${sizes[size]}
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        ${className}
      `}
    >
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full"
        whileHover={{ translateX: "100%" }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
      />

      {icon ? <span className="relative z-10">{icon}</span> : null}
      <span className="relative z-10">{children}</span>
    </motion.button>
  );
}
