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
                        <span className="text-white font-medium text-2xl tracking-tighter" style={{ fontFamily: "'Instrument Serif', serif" }}>
                            Pitchy
                            <span className="text-white/40 font-light italic ml-1">.pro</span>
                        </span>
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
                            <Link href="/login" className="hidden md:block text-[15px] font-medium text-white/70 hover:text-white transition-all">
                                Войти
                            </Link>
                        </motion.div>
                        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                            <Link href="/signup" className="liquid-glass-strong text-white text-[15px] font-medium px-6 py-2.5 rounded-full transition-all shadow-lg hover:shadow-white/10">
                                <span className="relative z-10">Регистрация</span>
                            </Link>
                        </motion.div>
                    </div>
                </header>
            </div>

            {/* Hero Body */}
            <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 w-full max-w-4xl mx-auto text-center pt-20 pb-12">
                <h1 
                    className="text-5xl md:text-6xl lg:text-8xl text-white mb-8 leading-[1.1] font-normal tracking-tight"
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                >
                    ИИ-экосистема <br /> для стартапов
                </h1>

                <p className="text-white/70 text-lg md:text-2xl max-w-3xl mx-auto mb-12 font-light leading-relaxed">
                    От анализа идеи и проведения синтетических CustDev интервью <br className="hidden md:block" /> до подбора и получения грантов.
                </p>

                <div className="flex justify-center w-full">
                    <Link href="/signup">
                        <button className="liquid-glass-strong text-white px-10 py-4 rounded-full text-lg font-medium hover:scale-105 transition-transform flex items-center gap-3">
                            <span className="relative z-10">Попробовать</span>
                            <Zap className="w-5 h-5 shrink-0 text-white fill-white relative z-10" />
                        </button>
                    </Link>
                </div>
            </div>

            {/* Footer */}
            <footer className="relative z-10 w-full px-6 py-8 flex justify-center md:justify-end">
                <Link href="https://t.me/pitchy_pro" target="_blank" className="liquid-glass rounded-full p-4 transition-all hover:bg-white/10 text-white flex items-center gap-2">
                    <svg className="w-5 h-5 relative z-10 fill-current" viewBox="0 0 24 24">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.87 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.458c.537-.196 1.006.128.831.953z"/>
                    </svg>
                    <span className="text-sm font-medium pr-2 relative z-10">Telegram</span>
                </Link>
            </footer>
        </section>
    );
}

export default HeroSection;
