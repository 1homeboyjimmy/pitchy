"use client";

import { useEffect, useState } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export function LandingNavBar() {
    const pathname = usePathname();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    useEffect(() => {
        setIsMenuOpen(false);
    }, [pathname]);

    const navLinks = [
        { name: "Главная", href: "/" },
        { name: "Дашборд", href: "/dashboard" },
        { name: "Тарифы", href: "/pricing" },
        { name: "О нас", href: "/about" },
    ];

    return (
        <header className="fixed top-0 left-0 right-0 z-[100] w-full">
            <div className="flex flex-row justify-between items-center py-5 px-8 w-full max-w-[1440px] mx-auto">
                {/* Left: Logo */}
                <Link href="/" className="flex items-center gap-2 relative z-[110]">
                    <span className="text-foreground font-bold text-2xl tracking-tighter font-display uppercase">
                        PITCHY<span className="text-white">.</span>PRO
                    </span>
                </Link>

                {/* Center: Nav Links */}
                <nav className="hidden md:flex items-center gap-8">
                    {navLinks.map((link) => (
                        <Link 
                            key={link.name} 
                            href={link.href}
                            className="flex items-center gap-1 text-foreground/90 hover:text-white transition-colors font-bold text-[12px] uppercase tracking-widest"
                        >
                            {link.name}
                        </Link>
                    ))}
                </nav>

                {/* Right: Actions */}
                <div className="flex items-center gap-4 relative z-[110]">
                    <Link href="/login" className="text-foreground/70 hover:text-foreground text-[12px] font-bold uppercase tracking-widest mr-4">Войти</Link>
                    <Link href="/signup" className="liquid-glass-strong text-white px-6 py-2 rounded-full text-[12px] font-black uppercase tracking-widest hover:scale-105 transition-transform">
                        Регистрация
                    </Link>
                    
                    {/* Mobile Hamburger */}
                    <button 
                        className="md:hidden text-foreground ml-2"
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                    >
                        {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>
                </div>
            </div>

            {/* Divider Line with Gradient */}
            <div className="w-full h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent mt-[3px]" />

            {/* Mobile Menu Overlay */}
            <AnimatePresence>
                {isMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="absolute top-full left-0 right-0 bg-background/95 backdrop-blur-xl border-b border-foreground/10 p-8 md:hidden"
                    >
                        <nav className="flex flex-col gap-6 items-center">
                            {navLinks.map((link) => (
                                <Link 
                                    key={link.name} 
                                    href={link.href} 
                                    className="text-2xl font-bold text-foreground/80 hover:text-foreground uppercase tracking-widest"
                                >
                                    {link.name}
                                </Link>
                            ))}
                            <div className="flex flex-col gap-4 w-full mt-4">
                                <Link href="/login" className="text-center text-foreground/70 text-lg font-bold">ВОЙТИ</Link>
                                <Link href="/signup" className="liquid-glass-strong text-white text-center py-4 rounded-full font-black">РЕГИСТРАЦИЯ</Link>
                            </div>
                        </nav>
                    </motion.div>
                )}
            </AnimatePresence>
        </header>
    );
}
