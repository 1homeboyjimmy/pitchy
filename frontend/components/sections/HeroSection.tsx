"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Menu, X, ChevronRight } from "lucide-react";
import Link from "next/link";

const ShinyText = ({ text, disabled = false, speed = 3 }: { text: string; disabled?: boolean; speed?: number }) => {
  const animationDuration = `${speed}s`;

  return (
    <span
      className={`relative inline-block overflow-hidden bg-clip-text text-transparent ${
        disabled ? "" : "animate-shine"
      }`}
      style={{
        backgroundImage: "linear-gradient(100deg, #64CEFB 30%, #ffffff 50%, #64CEFB 70%)",
        backgroundSize: "200% 100%",
        WebkitBackgroundClip: "text",
        animationDuration: animationDuration,
        animationIterationCount: "infinite",
        animationTimingFunction: "linear",
      }}
    >
      {text}
      <style jsx>{`
        @keyframes shine {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .animate-shine {
          animation: shine var(--duration, 3s) linear infinite;
        }
      `}</style>
    </span>
  );
};

export function HeroSection() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const navLinks = [
        { name: "Home", href: "/" },
        { name: "About Us", href: "/about" },
        { name: "Features", href: "/features" },
        { name: "Solutions", href: "/solutions" },
        { name: "Insights", href: "/blog" },
        { name: "Contact us", href: "/contact", icon: true },
    ];

    return (
        <section className="relative h-screen w-full bg-black overflow-hidden font-sans">
            {/* Background Video */}
            <video
                autoPlay
                loop
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover opacity-60"
                src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_105406_16f4600d-7a92-4292-b96e-b19156c7830a.mp4"
            />
            
            {/* Background Overlay */}
            <div className="absolute inset-0 bg-black/20" />

            {/* Content Container */}
            <div className="relative z-10 flex flex-col h-full max-w-7xl mx-auto px-6 md:px-12">
                
                {/* Navigation Bar */}
                <header className="flex items-center justify-between py-8">
                    {/* Logo */}
                    <Link href="/" className="flex items-center gap-3 group">
                        <div className="relative w-8 h-8 rounded-full border-2 border-white flex items-center justify-center">
                            <div className="w-3 h-3 bg-white rounded-full group-hover:scale-125 transition-transform" />
                        </div>
                        <span className="text-white font-bold text-xl tracking-tight">Pitchy.pro</span>
                    </Link>

                    {/* Desktop Pill Nav */}
                    <nav className="hidden lg:flex items-center gap-1 p-1 bg-black/20 backdrop-blur-md rounded-full border border-gray-700/50">
                        {navLinks.map((link) => (
                            <Link 
                                key={link.name} 
                                href={link.href}
                                className="px-5 py-2 text-sm font-medium text-white/80 hover:text-white transition-colors flex items-center gap-1"
                            >
                                {link.name}
                                {link.icon && <ArrowRight size={14} className="opacity-70" />}
                            </Link>
                        ))}
                    </nav>

                    {/* Mobile Menu Icon */}
                    <button 
                        className="lg:hidden text-white p-2"
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                    >
                        {isMenuOpen ? <X size={28} /> : <Menu size={28} />}
                    </button>
                </header>

                {/* Top Text Section (Two Columns) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-12 md:mt-20">
                    <motion.p 
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.8 }}
                        className="text-white/80 text-sm md:text-base max-w-lg leading-relaxed"
                    >
                        Мы создаем ИИ-экосистему, которая дает основателям стартапов глубокую экспертизу и видение, необходимые для масштабирования на глобальном рынке.
                    </motion.p>
                    <motion.div 
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.8 }}
                        className="flex lg:justify-end items-center"
                    >
                        <p className="text-white/80 text-sm md:text-base font-medium">
                            2500+ Проектов Проанализировано !
                        </p>
                    </motion.div>
                </div>

                {/* Main Hero Content (Center) */}
                <div className="flex-1 flex flex-col items-center justify-center text-center -mt-20 md:-mt-32">
                    <motion.span 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                        className="text-white/80 text-xs md:text-sm font-bold uppercase tracking-[0.2em] mb-6"
                    >
                        Запуск новой программы Early Access скоро
                    </motion.span>

                    <motion.h1 
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, ease: "easeOut", delay: 0.4 }}
                        className="text-6xl md:text-8xl lg:text-9xl font-medium tracking-tighter leading-[0.85] text-white flex flex-col items-center"
                    >
                        <span>Стань</span>
                        <ShinyText text="AI-Лидером." speed={3} />
                    </motion.h1>

                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.8, delay: 0.8 }}
                        className="mt-12 md:mt-16"
                    >
                        <Link href="/signup" className="group relative flex items-center gap-3 bg-white text-black px-8 md:px-10 py-4 md:py-5 rounded-full font-bold text-sm md:text-base transition-all hover:bg-gray-100 shadow-[0_0_30px_-5px_rgba(255,255,255,0.4)]">
                            Подать заявку на участие
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </motion.div>
                </div>

            </div>

            {/* Mobile Menu Overlay */}
            <AnimatePresence>
                {isMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center gap-8 lg:hidden"
                    >
                        {navLinks.map((link) => (
                            <Link 
                                key={link.name} 
                                href={link.href}
                                onClick={() => setIsMenuOpen(false)}
                                className="text-3xl font-bold text-white/80 hover:text-white transition-colors"
                            >
                                {link.name}
                            </Link>
                        ))}
                        <button 
                            className="absolute top-8 right-6 text-white"
                            onClick={() => setIsMenuOpen(false)}
                        >
                            <X size={32} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
}

export default HeroSection;
