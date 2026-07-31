"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/hooks/useAuth";

export function HeroSection() {
    const { isAuthenticated } = useAuth();
    const videoRef = useRef<HTMLVideoElement>(null);
    const fadingOutRef = useRef(false);
    const actions = [
        "Pitchy анализирует рынок",
        "Pitchy проверяет спрос",
        "Pitchy строит дорожную карту",
        "Pitchy готовит презентацию",
        "Pitchy подбирает финансирование",
    ];
    const [activeStage, setActiveStage] = useState(0);
    const [typedText, setTypedText] = useState("");

    useEffect(() => {
        const action = actions[activeStage];
        const isComplete = typedText.length >= action.length;
        const timeout = window.setTimeout(() => {
            if (isComplete) {
                setTypedText("");
                setActiveStage((current) => (current + 1) % actions.length);
                return;
            }

            setTypedText(action.slice(0, typedText.length + 1));
        }, isComplete ? 1200 : 42);

        return () => window.clearTimeout(timeout);
    }, [activeStage, typedText]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Уважаем prefers-reduced-motion: не проигрываем видео, оставляем
        // статичный постер (он всегда виден под видео).
        const prefersReducedMotion =
            typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (prefersReducedMotion) {
            video.removeAttribute("autoplay");
            try { video.pause(); } catch {}
            return;
        }

        let animationFrameId: number;

        const checkTime = () => {
            if (!video.duration) {
                animationFrameId = requestAnimationFrame(checkTime);
                return;
            }

            const timeLeft = video.duration - video.currentTime;

            if (timeLeft <= 0.55 && !fadingOutRef.current) {
                fadingOutRef.current = true;
                video.style.opacity = '0';
            }

            animationFrameId = requestAnimationFrame(checkTime);
        };

        const handleEnded = () => {
            video.style.opacity = '0';
            setTimeout(() => {
                video.currentTime = 0;
                video.play().catch(() => {});
                setTimeout(() => {
                    fadingOutRef.current = false;
                    video.style.opacity = '1';
                }, 50);
            }, 100);
        };

        // Проявляем видео, как только оно способно показать кадр — НЕ завязываясь
        // на то, что автоплей реально стартовал. У многих браузеров автоплей
        // заблокирован (iOS Low Power, data-saver, Brave), но кадр уже загружен;
        // раньше видео в таком случае оставалось невидимым (чёрным).
        const reveal = () => {
            video.style.opacity = '1';
            cancelAnimationFrame(animationFrameId);
            animationFrameId = requestAnimationFrame(checkTime);
        };

        video.addEventListener('ended', handleEnded);
        video.addEventListener('loadeddata', reveal);
        video.addEventListener('canplay', reveal);

        // Подтолкнуть автоплей; если заблокирован — кадр всё равно проявится
        // как статичная картинка (идентична постеру), а не чёрный экран.
        video.play().catch(() => {});

        // Видео могло забуфериться до запуска эффекта (кэш/тайминг гидрации).
        // Проявляем сразу, НЕ проверяя !paused — иначе автоплей-блок = чёрный hero.
        if (video.readyState >= 2) {
            reveal();
        }

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            video.removeEventListener('ended', handleEnded);
            video.removeEventListener('loadeddata', reveal);
            video.removeEventListener('canplay', reveal);
        };
    }, []);

    return (
        <section className="relative min-h-[calc(100svh-64px)] bg-black overflow-hidden flex flex-col selection:bg-white/20">
            {/* Background Video Engine.
                Статичный постер лежит подложкой и виден ВСЕГДА — поэтому hero
                никогда не бывает чёрным, пока грузится 20-МБ видео или если
                автоплей/загрузка заблокированы. Видео плавно проявляется поверх. */}
            <div className="absolute inset-0 pointer-events-none">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src="/hero-poster.jpg"
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full object-cover translate-y-[0%]"
                />
                <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    preload="auto"
                    poster="/hero-poster.jpg"
                    className="absolute inset-0 w-full h-full object-cover translate-y-[0%] transition-opacity duration-500 opacity-0"
                    src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_115001_bcdaa3b4-03de-47e7-ad63-ae3e392c32d4.mp4"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-transparent" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_42%,transparent_0%,rgba(0,0,0,0.04)_48%,rgba(0,0,0,0.34)_100%)]" />
                <div className="absolute inset-0 bg-black/30" />
            </div>

            {/* Hero Body */}
            <div className="relative z-10 mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-5 pb-8 pt-8 sm:px-8 md:px-12 md:pb-10 md:pt-10">
                <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.24em] text-white/45 sm:text-[10px]">
                    <span>Pitchy / Startup OS</span>
                    <span className="hidden items-center gap-2 sm:flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" /> Система активна</span>
                    <span>2026 / AI</span>
                </div>

                <div className="flex flex-1 flex-col items-center justify-center py-7 text-center md:py-9">
                    <h1 className="flex max-w-full items-center justify-center whitespace-nowrap text-[clamp(55px,10.2vw,142px)] font-normal leading-[0.78] tracking-[-0.055em] text-white drop-shadow-[0_8px_34px_rgba(0,0,0,0.6)]" style={{ fontFamily: "'Instrument Serif', serif" }}>
                        <span>Идея</span>
                        <span className="relative mx-[0.18em] flex h-[0.42em] w-[0.72em] items-center" aria-hidden="true">
                            <span className="h-px w-full bg-gradient-to-r from-white/20 via-cyan-100 to-white/20 shadow-[0_0_14px_rgba(165,243,252,0.9)]" />
                            <span className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-cyan-100 shadow-[0_0_18px_5px_rgba(165,243,252,0.7)] sm:h-2 sm:w-2" />
                        </span>
                        <span className="italic">Рост</span>
                    </h1>
                </div>

                <div className="relative mx-auto flex w-full max-w-[620px] flex-col items-center pb-1 md:pb-3">
                    <div className="flex min-h-9 items-center justify-center rounded-full border border-white/15 bg-black/45 px-4 py-2 font-mono text-[10px] tracking-[0.04em] text-white shadow-[0_12px_36px_rgba(0,0,0,0.28)] backdrop-blur-md sm:min-h-10 sm:px-6 sm:text-xs">
                        <span className="text-cyan-100/60" aria-hidden="true">›&nbsp;</span>
                        <span className="[text-shadow:0_2px_10px_#000]">{typedText}</span>
                        <span className="ml-0.5 inline-block h-[1em] w-px animate-pulse bg-cyan-100 shadow-[0_0_8px_rgba(165,243,252,0.9)]" aria-hidden="true" />
                    </div>

                    <Link href={isAuthenticated ? "/dashboard" : "/signup"} className="group mx-auto mt-5 flex w-fit items-center gap-5 rounded-full border border-white/35 bg-white/95 py-2.5 pl-6 pr-2.5 text-black shadow-[0_0_40px_rgba(255,255,255,0.18)] transition-all hover:scale-[1.02] hover:bg-cyan-50 sm:mt-6 sm:gap-8 sm:pl-8">
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
