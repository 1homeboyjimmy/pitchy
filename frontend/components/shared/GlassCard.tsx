"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface GlassCardProps {
    children: ReactNode;
    className?: string;
    hover?: boolean;
    glow?: "none" | "violet" | "cyan" | "success";
    onClick?: () => void;
    as?: "div" | "button" | "article";
}

const glowMap = {
    none: "",
    violet: "hover:shadow-[0_0_40px_rgba(139,92,246,0.15)]",
    cyan: "hover:shadow-[0_0_40px_rgba(6,182,212,0.15)]",
    success: "hover:shadow-[0_0_40px_rgba(16,185,129,0.15)]",
};

export function GlassCard({
    children,
    className = "",
    hover = true,
    glow = "none",
    onClick,
    as: Component = "div",
}: GlassCardProps) {
    const baseClasses = `
    relative overflow-hidden
    rounded-2xl
    bg-[rgba(26,26,36,0.65)]
    backdrop-blur-xl
    border border-[rgba(255,255,255,0.06)]
    transition-all duration-300 ease-out
    ${hover ? "hover:bg-[rgba(26,26,36,0.75)] hover:border-[rgba(255,255,255,0.1)]" : ""}
    ${glowMap[glow]}
    ${onClick ? "cursor-pointer" : ""}
    ${className}
  `;

    const innerGlow = (
        <div
            className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
            style={{
                background:
                    "radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.03) 0%, transparent 60%)",
            }}
        />
    );

    if (Component === "button" || onClick) {
        return (
            <motion.button
                onClick={onClick}
                whileHover={hover ? { scale: 1.01, y: -2 } : undefined}
                whileTap={{ scale: 0.99 }}
                className={`group ${baseClasses}`}
            >
                {innerGlow}
                <div className="relative z-10">{children}</div>
            </motion.button>
        );
    }

    return (
        <motion.div
            whileHover={hover ? { scale: 1.01, y: -2 } : undefined}
            className={`group ${baseClasses}`}
        >
            {innerGlow}
            <div className="relative z-10">{children}</div>
        </motion.div>
    );
}

export default GlassCard;
