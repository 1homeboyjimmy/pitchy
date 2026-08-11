"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/lib/hooks/useAuth";

export function HeroSection() {
    const { isAuthenticated } = useAuth();
    const [videoReady, setVideoReady] = useState(false);
    const [heroPhraseIndex, setHeroPhraseIndex] = useState(0);
    const [heroPhraseVisible, setHeroPhraseVisible] = useState(true);

    useEffect(() => {
        const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (prefersReducedMotion) return;

        const fadeTimeout = window.setTimeout(() => {
            setHeroPhraseVisible(false);
        }, 2400);

        const swapTimeout = window.setTimeout(() => {
            setHeroPhraseIndex((current) => (current + 1) % 2);
            setHeroPhraseVisible(true);
        }, 3200);

        return () => {
            window.clearTimeout(fadeTimeout);
            window.clearTimeout(swapTimeout);
        };
    }, [heroPhraseIndex]);

    return (
        <section className="relative min-h-[calc(100svh-64px)] bg-black overflow-hidden flex flex-col selection:bg-white/20">
            {/* The optimized poster paints the first viewport immediately and
                remains visible until the same-origin video proxy can play. */}
            <div className="absolute inset-0 pointer-events-none">
                <Image
                    src="/hero-poster.jpg"
                    alt=""
                    aria-hidden="true"
                    fill
                    priority
                    fetchPriority="high"
                    quality={78}
                    sizes="100vw"
                    className="object-cover"
                />
                <video
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    poster="/hero-poster.jpg"
                    aria-hidden="true"
                    onCanPlay={() => setVideoReady(true)}
                    // Keep the poster visible underneath. A failed or delayed
                    // video load must never turn the hero into a black screen.
                    className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 motion-reduce:hidden ${videoReady ? "opacity-70" : "opacity-0"}`}
                    src="/media/hero.mp4"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-transparent" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_42%,transparent_0%,rgba(0,0,0,0.02)_48%,rgba(0,0,0,0.18)_100%)]" />
                <div className="absolute inset-0 bg-black/10" />
            </div>

            {/* Hero Body */}
            <div className="relative z-10 mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-5 pb-8 pt-8 sm:px-8 md:px-12 md:pb-10 md:pt-10">
                <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.24em] text-white/45 sm:text-[10px]">
                    <span>Pitchy / Startup OS</span>
                    <span className="hidden items-center gap-2 sm:flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 motion-reduce:animate-none" /> Система активна</span>
                    <span>2026 / AI</span>
                </div>

                <div className="flex flex-1 flex-col items-center justify-start pb-7 pt-[9svh] text-center sm:pt-[7svh] md:pb-9 md:pt-[5vh] lg:pt-[4vh]">
                    <h1 className="relative flex h-[78px] w-full max-w-[980px] items-center justify-center text-white drop-shadow-[0_8px_34px_rgba(0,0,0,0.65)] sm:h-[94px] md:h-[122px]" style={{ fontFamily: "var(--font-prata), Georgia, serif" }}>
                        <span className={"absolute whitespace-nowrap text-[clamp(34px,7.4vw,106px)] font-normal leading-none tracking-[-0.045em] transition-[opacity,transform] duration-700 ease-in-out motion-reduce:transform-none motion-reduce:transition-none " + (heroPhraseIndex === 0 && heroPhraseVisible ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0")}>
                            От реальной боли
                        </span>
                        <span className={"absolute whitespace-nowrap text-[clamp(22px,6vw,82px)] font-normal italic leading-none tracking-[-0.04em] transition-[opacity,transform] duration-700 ease-in-out motion-reduce:transform-none motion-reduce:transition-none " + (heroPhraseIndex === 1 && heroPhraseVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")}>
                            к востребованному продукту
                        </span>
                    </h1>
                </div>

                <div className="relative mx-auto flex w-full max-w-[620px] flex-col items-center pb-1 md:pb-3">
                    <Link href={isAuthenticated ? "/dashboard" : "/signup"} className="group mx-auto flex w-fit items-center gap-5 rounded-full border border-white/35 bg-white/95 py-2.5 pl-6 pr-2.5 text-black shadow-[0_0_40px_rgba(255,255,255,0.18)] transition-[transform,background-color] hover:scale-[1.02] hover:bg-cyan-50 sm:gap-8 sm:pl-8">
                        <span className="text-sm font-semibold">Анализ идеи</span>
                        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-black/15 bg-black text-white transition-transform group-hover:rotate-[-35deg]">
                            <ArrowRight className="h-4 w-4" />
                        </span>
                    </Link>
                </div>
            </div>

        </section>
    );
}

export default HeroSection;
