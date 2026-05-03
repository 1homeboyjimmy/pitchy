"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Menu, X, Zap } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import Hls from "hls.js";

export function HeroSection() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const hlsUrl = "https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8";

        if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: false });
            hls.loadSource(hlsUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                video.play().catch(e => console.log("HLS play failed", e));
            });

            return () => {
                hls.destroy();
            };
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = hlsUrl;
            video.addEventListener("loadedmetadata", () => {
                video.play().catch(e => console.log("Native HLS play failed", e));
            });
        }
    }, []);

    const navLinks = [
        { name: "ГЛАВНАЯ", href: "/" },
        { name: "ДАШБОРД", href: "/dashboard" },
        { name: "ТАРИФЫ", href: "/pricing" },
        { name: "FAQ", href: "/faq" },
        { name: "О НАС", href: "/about" },
    ];

    return (
        <section className="relative min-h-screen bg-[#070b0a] overflow-hidden flex flex-col font-inter">
            {/* Background HLS Video */}
            <div className="absolute inset-0 z-0">
                <video
                    ref={videoRef}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-cover opacity-60"
                />
                {/* Overlays */}
                <div className="absolute inset-0 bg-gradient-to-r from-[#070b0a] via-[#070b0a]/40 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#070b0a] via-transparent to-transparent" />
            </div>

            {/* Vertical Grid Lines */}
            <div className="absolute inset-0 z-1 pointer-events-none hidden lg:block">
                <div className="absolute left-1/4 top-0 bottom-0 w-px bg-white/10" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
                <div className="absolute left-3/4 top-0 bottom-0 w-px bg-white/10" />
            </div>

            {/* Central Glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-64 pointer-events-none z-1">
                <svg className="w-full h-full opacity-40 filter blur-[25px]">
                    <ellipse cx="50%" cy="0" rx="40%" ry="60%" fill="url(#glowGradient)" />
                    <defs>
                        <radialGradient id="glowGradient" cx="50%" cy="0" r="1">
                            <stop offset="0%" stopColor="#5ed29c" stopOpacity="0.8" />
                            <stop offset="100%" stopColor="#070b0a" stopOpacity="0" />
                        </radialGradient>
                    </defs>
                </svg>
            </div>

            {/* Header */}
            <header className="relative z-50 flex items-center justify-between px-6 py-8 md:px-12">
                <Link href="/" className="flex items-center gap-2">
                    <span className="text-white font-medium text-2xl tracking-tighter" style={{ fontFamily: "'Instrument Serif', serif" }}>
                        Pitchy<span className="text-white/40 font-light italic ml-1">.pro</span>
                    </span>
                </Link>

                {/* Desktop Nav */}
                <nav className="hidden md:flex items-center gap-8">
                    {navLinks.map((link) => (
                        <Link 
                            key={link.name} 
                            href={link.href} 
                            className="text-[14px] font-medium tracking-wide text-white/70 hover:text-[#5ed29c] transition-colors"
                        >
                            {link.name}
                        </Link>
                    ))}
                    <Link href="/login" className="text-[14px] font-medium text-white/70 hover:text-white ml-4">Войти</Link>
                    <Link href="/signup" className="bg-[#5ed29c] text-[#070b0a] px-6 py-2.5 rounded-full text-[14px] font-bold hover:scale-105 transition-transform">
                        РЕГИСТРАЦИЯ
                    </Link>
                </nav>

                {/* Mobile Hamburger */}
                <button 
                    className="md:hidden text-white"
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                >
                    {isMenuOpen ? <X size={32} /> : <Menu size={32} />}
                </button>
            </header>

            {/* Hero Main Content */}
            <div className="relative z-10 flex-1 flex flex-col items-start justify-center px-6 md:px-24 max-w-7xl mx-auto w-full pt-28 pb-40">
                
                {/* Floating Liquid Glass Card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: -50 }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className="relative w-[200px] h-[200px] p-6 rounded-[24px] flex flex-col justify-between mb-8 overflow-hidden"
                    style={{
                        background: "rgba(255, 255, 255, 0.01)",
                        backgroundBlendMode: "luminosity",
                        backdropFilter: "blur(4px)",
                        WebkitBackdropFilter: "blur(4px)",
                        boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.1)",
                    }}
                >
                    {/* High-end border effect */}
                    <div className="absolute inset-0 rounded-[24px] pointer-events-none" style={{
                        padding: "1.4px",
                        background: "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.1) 100%)",
                        WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                        WebkitMaskComposite: "xor",
                        maskComposite: "exclude"
                    }} />
                    
                    <div>
                        <div className="text-[#5ed29c] text-[12px] font-bold tracking-[0.2em]">[ 2025 ]</div>
                        <h3 className="mt-2 text-white text-[18px] leading-tight font-medium">
                            AI-Driven <span className="italic font-light" style={{ fontFamily: "'Instrument Serif', serif" }}>Strategic</span> Insights
                        </h3>
                    </div>
                    <p className="text-white/40 text-[11px] leading-relaxed">
                        Real-time unit-economics, CustDev signals, and grant tracking for high-growth startups.
                    </p>
                </motion.div>

                {/* Typography Content */}
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                >
                    <div className="font-plus-jakarta text-[#5ed29c] text-[11px] font-bold tracking-[0.3em] uppercase mb-4">
                        Ecosystem for Visionaries
                    </div>
                    
                    <h1 className="text-4xl md:text-7xl font-extrabold text-white tracking-tight leading-[0.95] mb-6">
                        ИИ-ЭКОСИСТЕМА <br /> ДЛЯ СТАРТАПОВ<span className="text-[#5ed29c]">.</span>
                    </h1>

                    <p className="text-white/70 text-[14px] md:text-[16px] leading-relaxed max-w-[512px] mb-10 font-light">
                        От анализа идеи и проведения синтетических CustDev интервью до подбора и получения грантов. Полная поддержка вашего пути к росту и инвестициям.
                    </p>

                    <Link href="/signup">
                        <button className="bg-[#5ed29c] text-[#070b0a] px-10 py-5 rounded-full text-[14px] font-black uppercase tracking-widest flex items-center gap-3 hover:scale-105 transition-transform shadow-[0_0_40px_-10px_#5ed29c]">
                            ПОПРОБОВАТЬ <ArrowRight size={20} strokeWidth={3} />
                        </button>
                    </Link>
                </motion.div>
            </div>

            {/* Mobile Menu Overlay */}
            <AnimatePresence>
                {isMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0, x: "100%" }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: "100%" }}
                        transition={{ type: "spring", damping: 25, stiffness: 200 }}
                        className="fixed inset-0 z-[60] bg-[#070b0a] flex flex-col p-8"
                    >
                        <div className="flex justify-end">
                            <button onClick={() => setIsMenuOpen(false)} className="text-white">
                                <X size={40} />
                            </button>
                        </div>
                        <nav className="flex-1 flex flex-col justify-center gap-8">
                            {navLinks.map((link) => (
                                <Link 
                                    key={link.name} 
                                    href={link.href} 
                                    onClick={() => setIsMenuOpen(false)}
                                    className="text-3xl font-extrabold text-white hover:text-[#5ed29c] transition-colors"
                                >
                                    {link.name}
                                </Link>
                            ))}
                            <Link 
                                href="/signup" 
                                onClick={() => setIsMenuOpen(false)}
                                className="mt-4 text-[#5ed29c] text-2xl font-bold"
                            >
                                РЕГИСТРАЦИЯ
                            </Link>
                        </nav>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Global Styles for Fonts & Utilities */}
            <style jsx global>{`
                .font-plus-jakarta { font-family: 'Plus Jakarta Sans', sans-serif; }
                .font-inter { font-family: 'Inter', sans-serif; }
            `}</style>
        </section>
    );
}

export default HeroSection;
