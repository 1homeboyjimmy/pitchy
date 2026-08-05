"use client";

import { cn } from "@/lib/utils";
import Image from "next/image";

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
      <Image
        src="/icons/logotip.png"
        alt="Pitchy"
        width={32}
        height={32}
        sizes="32px"
        className={cn("h-8 w-8 object-contain shrink-0", className)}
      />
    );
  }

  return (
    <span className={cn("font-display tracking-tight text-white inline-flex items-baseline", size !== "none" && sizeClasses[size], className)}>
      {isSentence ? "Pitchy" : "Pitchy"}<span className="text-white/50 italic">.pro</span>
    </span>
  );
}
