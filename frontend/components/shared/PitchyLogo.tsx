"use client";

import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "none";
  isSentence?: boolean;
  isCompact?: boolean;
}

export function PitchyLogo({ className, size = "md", isSentence = false, isCompact = false }: Props) {
  const sizeClasses = {
    xs: "text-[12px]",
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
    xl: "text-xl",
    "2xl": "text-2xl",
    "3xl": "text-3xl",
    none: "",
  };

  if (isCompact) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/icons/logotip.png"
        alt="Pitchy"
        className={cn("h-8 w-8 object-contain shrink-0", className)}
      />
    );
  }

  return (
    <span className={cn("font-display tracking-tight text-white inline-flex items-baseline", size !== "none" && sizeClasses[size], className)}>
      {isSentence ? "Pitchy" : "Pitchy"}<span className="text-white/30 italic">.pro</span>
    </span>
  );
}
