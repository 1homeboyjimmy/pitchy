"use client";

import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";

interface ScoreRingProps {
    score: number;
    size?: "sm" | "md" | "lg";
    showLabel?: boolean;
    animate?: boolean;
    className?: string;
}

const sizeConfig = {
    sm: { diameter: 48, stroke: 5, fontSize: 16, subFontSize: 10 },
    md: { diameter: 80, stroke: 8, fontSize: 28, subFontSize: 12 },
    lg: { diameter: 140, stroke: 12, fontSize: 48, subFontSize: 16 },
};

const getScoreColor = (score: number): string => {
    if (score >= 90) return "#10B981";
    if (score >= 75) return "#14B8A6";
    if (score >= 60) return "#F59E0B";
    if (score >= 40) return "#F97316";
    return "#EF4444";
};

const getScoreLabel = (score: number): string => {
    if (score >= 90) return "Отлично";
    if (score >= 75) return "Сильный";
    if (score >= 60) return "Средний";
    if (score >= 40) return "Слабый";
    return "Плохой";
};

export function ScoreRing({
    score,
    size = "md",
    showLabel = true,
    animate = true,
    className = "",
}: ScoreRingProps) {
    const [displayScore, setDisplayScore] = useState(animate ? 0 : score);
    const [isAnimating, setIsAnimating] = useState(false);
    const hasAnimated = useRef(false);

    const config = sizeConfig[size];
    const radius = (config.diameter - config.stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset =
        circumference - (displayScore / 100) * circumference;
    const color = getScoreColor(score);

    useEffect(() => {
        if (!animate || hasAnimated.current) {
            setDisplayScore(score);
            return;
        }

        hasAnimated.current = true;
        setIsAnimating(true);

        const duration = 1500;
        const startTime = Date.now();

        const updateScore = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const currentScore = Math.round(score * easeOut);
            setDisplayScore(currentScore);

            if (progress < 1) {
                requestAnimationFrame(updateScore);
            } else {
                setIsAnimating(false);
            }
        };

        requestAnimationFrame(updateScore);
    }, [score, animate]);

    return (
        <div className={`flex flex-col items-center ${className}`}>
            <div
                className="relative"
                style={{ width: config.diameter, height: config.diameter }}
            >
                {/* Glow */}
                <motion.div
                    className="absolute inset-0 rounded-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: isAnimating ? 0.6 : 0.3 }}
                    transition={{ duration: 0.5 }}
                    style={{
                        background: `radial-gradient(circle, ${color}30 0%, transparent 70%)`,
                        filter: "blur(10px)",
                    }}
                />

                <svg
                    width={config.diameter}
                    height={config.diameter}
                    className="transform -rotate-90"
                >
                    <circle
                        cx={config.diameter / 2}
                        cy={config.diameter / 2}
                        r={radius}
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.08)"
                        strokeWidth={config.stroke}
                    />
                    <motion.circle
                        cx={config.diameter / 2}
                        cy={config.diameter / 2}
                        r={radius}
                        fill="none"
                        stroke={color}
                        strokeWidth={config.stroke}
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        initial={{ strokeDashoffset: circumference }}
                        animate={{ strokeDashoffset }}
                        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
                        style={{ filter: `drop-shadow(0 0 6px ${color}60)` }}
                    />
                </svg>

                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span
                        className="font-bold text-white font-mono-numbers"
                        style={{ fontSize: config.fontSize, lineHeight: 1 }}
                    >
                        {displayScore}
                    </span>
                    <span
                        className="text-white/50 font-medium"
                        style={{ fontSize: config.subFontSize, lineHeight: 1.2 }}
                    >
                        /100
                    </span>
                </div>
            </div>

            {showLabel && (
                <motion.span
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8, duration: 0.4 }}
                    className="mt-2 text-sm font-medium"
                    style={{ color }}
                >
                    {getScoreLabel(score)}
                </motion.span>
            )}
        </div>
    );
}

export default ScoreRing;
