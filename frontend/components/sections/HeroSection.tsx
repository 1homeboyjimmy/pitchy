"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

const logos = [
    { name: "Vortex", icon: "V" },
    { name: "Nimbus", icon: "N" },
    { name: "Prysma", icon: "P" },
    { name: "Cirrus", icon: "C" },
    { name: "Kynder", icon: "K" },
    { name: "Halcyn", icon: "H" },
];

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
                    className="text-[120px] md:text-[220px] font-normal leading-[1.02] tracking-[-0.024em] font-display"
                >
                    Power <span className="bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(to left, #6366f1, #a855f7, #fcd34d)" }}>AI</span>
                </motion.h1>

                <motion.p 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                    className="text-hero-sub text-lg md:text-xl leading-8 max-w-md mt-[9px] opacity-80"
                >
                    The most powerful AI ever deployed <br className="hidden md:block" /> in talent acquisition
                </motion.p>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.4 }}
                >
                    <Link href="/contact">
                        <button className="mt-[25px] px-[29px] py-[24px] bg-foreground text-background rounded-full font-bold text-lg hover:scale-105 transition-transform">
                            Schedule a Consult
                        </button>
                    </Link>
                </motion.div>
            </div>

            {/* Logo Marquee */}
            <div className="relative z-10 pb-10 w-full max-w-5xl mx-auto px-6">
                <div className="flex flex-col md:flex-row items-center gap-12">
                    <div className="text-foreground/50 text-sm font-medium shrink-0 text-center md:text-left leading-tight">
                        Relied on by brands <br /> across the globe
                    </div>
                    
                    <div className="flex-1 overflow-hidden relative">
                        <div className="flex items-center gap-16 whitespace-nowrap animate-marquee">
                            {[...logos, ...logos].map((logo, i) => (
                                <div key={i} className="flex items-center gap-3">
                                    <div className="liquid-glass w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white">
                                        {logo.icon}
                                    </div>
                                    <span className="text-base font-semibold text-foreground">{logo.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <style jsx>{`
                @keyframes marquee {
                    0% { transform: translateX(0%); }
                    100% { transform: translateX(-50%); }
                }
                .animate-marquee {
                    animation: marquee 20s linear infinite;
                }
            `}</style>
        </section>
    );
}

export default HeroSection;
