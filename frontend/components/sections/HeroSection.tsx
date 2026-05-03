"use client";

import { useEffect, useRef } from "react";
import { Zap, ArrowRight, Instagram, Twitter, Linkedin } from "lucide-react";
import Link from "next/link";

import { motion } from "framer-motion";

export function HeroSection() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const fadingOutRef = useRef(false);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

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
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.catch((error: unknown) => console.log("Auto-play prevented", error));
                }
                setTimeout(() => {
                    fadingOutRef.current = false;
                    video.style.opacity = '1';
                }, 50);
            }, 100);
        };

        const handleLoadedData = () => {
            video.style.opacity = '1';
            animationFrameId = requestAnimationFrame(checkTime);
        };

        video.addEventListener('ended', handleEnded);
        video.addEventListener('loadeddata', handleLoadedData);

        if (!video.paused && video.readyState >= 2) {
            handleLoadedData();
        }

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            video.removeEventListener('ended', handleEnded);
            video.removeEventListener('loadeddata', handleLoadedData);
        };
    }, []);

    return (
        <section className="relative min-h-screen bg-black overflow-hidden flex flex-col justify-between selection:bg-white/20">
            {/* Background Video Engine */}
            <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover translate-y-[17%] transition-opacity duration-500 opacity-0 pointer-events-none"
                src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_115001_bcdaa3b4-03de-47e7-ad63-ae3e392c32d4.mp4"
            />

            {/* Top Navigation Wrapper */}
            <div className="relative z-20 w-full px-6 pt-6 flex justify-center">
                {/* Floating Pill Navbar */}
                <header className="liquid-glass rounded-full w-full max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2 relative z-10">
                        <span className="text-white font-bold text-xl tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>Pitchy <span className="text-white/60">.pro</span></span>
                    </div>

                    <nav className="hidden md:flex items-center gap-6 text-[15px] font-medium text-white/70 relative z-10">
                        <Link href="/" className="hover:text-white transition-colors">Главная</Link>
                        <Link href="/dashboard" className="bg-white/10 text-white px-4 py-2.5 rounded-full hover:bg-white/20 transition-colors">Дашборд</Link>
                        <Link href="/faq" className="hover:text-white transition-colors">FAQ</Link>
                        <Link href="/about" className="hover:text-white transition-colors">О нас</Link>
                        <Link href="/pricing" className="hover:text-white transition-colors">Тарифы</Link>
                        <Link href="/contact" className="hover:text-white transition-colors">Контакты</Link>
                    </nav>

                    <div className="flex items-center gap-6 relative z-10">
                        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                            <Link href="/login" className="hidden md:block text-[15px] font-medium text-white/70 hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.8)] transition-all">
                                Войти
                            </Link>
                        </motion.div>
                        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                            <Link href="/signup" className="liquid-glass-strong text-white text-[15px] font-medium px-6 py-2.5 rounded-full transition-colors shadow-lg">
                                <span className="relative z-10">Регистрация</span>
                            </Link>
                        </motion.div>
                    </div>
                </header>
            </div>

            {/* Hero Body */}
            <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 w-full max-w-4xl mx-auto text-center mt-[-5%]">
                <h1 
                    className="text-5xl md:text-6xl lg:text-7xl text-white mb-8 leading-[1.1] font-normal tracking-tight"
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                >
                    Built for the visionaries
                </h1>

                <p className="text-white/60 text-lg md:text-xl max-w-2xl mx-auto mb-10 font-light">
                    The AI Copilot for startups. Automate your market research and build your interactive roadmap in minutes.
                </p>

                <div className="flex flex-col items-center w-full gap-6">
                    {/* Input Group */}
                    <div className="liquid-glass rounded-full w-full max-w-md flex items-center p-2 pl-6">
                        <input 
                            type="email" 
                            placeholder="Enter your email" 
                            className="bg-transparent text-white placeholder-white/40 focus:outline-none flex-1 min-w-0 relative z-10"
                        />
                        <button className="bg-white text-black p-3 rounded-full hover:scale-105 transition-transform flex-shrink-0 relative z-10">
                            <ArrowRight className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Secondary CTA */}
                    <button className="liquid-glass rounded-full text-white/90 text-sm px-6 py-3 transition-colors flex items-center gap-2">
                        <span className="relative z-10">View Roadmap</span>
                    </button>
                </div>
            </main>

            {/* Footer */}
            <footer className="relative z-10 w-full px-6 py-8 flex justify-center md:justify-end gap-4">
                <button className="liquid-glass rounded-full p-3 transition-colors text-white">
                    <Instagram className="w-4 h-4 relative z-10" />
                </button>
                <button className="liquid-glass rounded-full p-3 transition-colors text-white">
                    <Twitter className="w-4 h-4 relative z-10" />
                </button>
                <button className="liquid-glass rounded-full p-3 transition-colors text-white">
                    <Linkedin className="w-4 h-4 relative z-10" />
                </button>
            </footer>
        </section>
    );
}

export default HeroSection;
