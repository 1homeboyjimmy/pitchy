"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export function HeroSection() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [videoOpacity, setVideoOpacity] = useState(0);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        let startTime: number | null = null;
        let fadeDuration = 500; // 0.5s
        let state: 'idle' | 'fadingIn' | 'playing' | 'fadingOut' = 'idle';

        const updateFade = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;

            if (state === 'fadingIn') {
                const opacity = Math.min(elapsed / fadeDuration, 1);
                setVideoOpacity(opacity);
                if (opacity >= 1) state = 'playing';
            } else if (state === 'fadingOut') {
                const opacity = Math.max(1 - (elapsed / fadeDuration), 0);
                setVideoOpacity(opacity);
                if (opacity <= 0) {
                    video.pause();
                    video.currentTime = 0;
                    state = 'idle';
                    setTimeout(() => {
                        video.play();
                        startTime = null;
                        state = 'fadingIn';
                    }, 100);
                }
            } else if (state === 'playing') {
                if (video.duration > 0 && video.currentTime >= video.duration - (fadeDuration / 1000)) {
                    startTime = timestamp;
                    state = 'fadingOut';
                }
            }

            requestAnimationFrame(updateFade);
        };

        const onPlay = () => {
            startTime = performance.now();
            state = 'fadingIn';
            requestAnimationFrame(updateFade);
        };

        video.addEventListener('play', onPlay);
        video.play();

        return () => {
            video.removeEventListener('play', onPlay);
        };
    }, []);

    return (
        <section className="relative min-h-screen flex flex-col bg-background text-foreground overflow-hidden">
            {/* Background Video */}
            <div className="absolute inset-0 z-0 overflow-hidden">
                <video
                    ref={videoRef}
                    src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_065045_c44942da-53c6-4804-b734-f9e07fc22e08.mp4"
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                    style={{ opacity: videoOpacity }}
                />
            </div>

            {/* Blurred Overlay Shape */}
            <div 
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[984px] h-[527px] opacity-90 bg-gray-950 blur-[82px] pointer-events-none z-1"
            />

            {/* Hero Content */}
            <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6">
                <motion.h1 
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="text-[100px] md:text-[220px] font-normal leading-[1.02] tracking-[-0.024em] font-display uppercase"
                >
                    PITCHY<span className="bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(to left, #6366f1, #a855f7, #fcd34d)" }}>.</span>PRO
                </motion.h1>

                <motion.p 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                    className="text-hero-sub text-lg md:text-xl leading-8 max-w-2xl mt-[9px] opacity-80"
                >
                    ИИ-ЭКОСИСТЕМА ДЛЯ СТАРТАПОВ: ОТ АНАЛИЗА ИДЕИ И СИНТЕТИЧЕСКИХ CUSTDEV <br className="hidden md:block" /> ДО ПОДБОРА И ПОЛУЧЕНИЯ ГРАНТОВ
                </motion.p>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.4 }}
                >
                    <Link href="/signup">
                        <button className="mt-[25px] px-[29px] py-[24px] bg-foreground text-background rounded-full font-bold text-lg hover:scale-105 transition-transform flex items-center gap-3">
                            ПОПРОБОВАТЬ <ArrowRight size={20} strokeWidth={3} />
                        </button>
                    </Link>
                </motion.div>
            </div>
        </section>
    );
}

export default HeroSection;
