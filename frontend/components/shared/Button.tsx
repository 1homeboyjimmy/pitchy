"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

interface ButtonProps {
    children: ReactNode;
    variant?: "primary" | "secondary" | "ghost" | "glass";
    size?: "sm" | "md" | "lg";
    fullWidth?: boolean;
    loading?: boolean;
    disabled?: boolean;
    icon?: ReactNode;
    iconPosition?: "left" | "right";
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
    className?: string;
}

const variantClasses = {
    primary: `
    bg-[#8B5CF6] text-white
    border border-[#8B5CF6]
    shadow-[0_0_20px_rgba(139,92,246,0.3)]
    hover:shadow-[0_0_30px_rgba(139,92,246,0.5)]
    hover:bg-[#7C3AED]
    active:scale-[0.98]
  `,
    secondary: `
    bg-white text-[#0A0A0F]
    border border-white
    hover:bg-white/90
    active:scale-[0.98]
  `,
    ghost: `
    bg-transparent text-white/70
    border border-white/10
    hover:bg-white/5 hover:text-white hover:border-white/20
    active:scale-[0.98]
  `,
    glass: `
    bg-white/5 text-white
    border border-white/10
    backdrop-blur-sm
    hover:bg-white/10 hover:border-white/20
    active:scale-[0.98]
  `,
};

const sizeClasses = {
    sm: "px-4 py-2 text-sm",
    md: "px-6 py-3 text-base",
    lg: "px-8 py-4 text-lg",
};

export function Button({
    children,
    variant = "primary",
    size = "md",
    fullWidth = false,
    loading = false,
    disabled = false,
    icon,
    iconPosition = "left",
    onClick,
    type = "button",
    className = "",
}: ButtonProps) {
    const isDisabled = disabled || loading;

    return (
        <motion.button
            type={type}
            onClick={onClick}
            disabled={isDisabled}
            whileHover={isDisabled ? undefined : { scale: 1.02 }}
            whileTap={isDisabled ? undefined : { scale: 0.98 }}
            className={`
        relative inline-flex items-center justify-center gap-2
        font-medium rounded-xl cursor-pointer
        transition-all duration-200 ease-out
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${fullWidth ? "w-full" : ""}
        ${className}
      `}
        >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {!loading && icon && iconPosition === "left" && (
                <span className="flex-shrink-0">{icon}</span>
            )}
            <span className="relative z-10">{children}</span>
            {!loading && icon && iconPosition === "right" && (
                <span className="flex-shrink-0">{icon}</span>
            )}
        </motion.button>
    );
}

export default Button;
