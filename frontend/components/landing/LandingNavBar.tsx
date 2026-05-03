"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export function LandingNavBar() {
    const pathname = usePathname();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isScrolled, setIsScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 50);
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    useEffect(() => {
        setIsMenuOpen(false);
    }, [pathname]);

    const navLinks = [
        { name: "ГЛАВНАЯ", href: "/" },
        { name: "ДАШБОРД", href: "/dashboard" },
        { name: "ТАРИФЫ", href: "/pricing" },
        { name: "FAQ", href: "/faq" },
        { name: "О НАС", href: "/about" },
    ];

    return (
        <>
            <header 
                className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-300 px-6 md:px-12 py-6 ${
                    isScrolled ? "bg-[#070b0a]/80 backdrop-blur-xl py-4 border-b border-white/5" : "bg-transparent"
                }`}
            >
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 relative z-[110]">
                        <span className="text-white font-bold text-2xl tracking-tighter" style={{ fontFamily: "'Inter', sans-serif" }}>
                            PITCHY<span className="text-[#5ed29c]">.</span>PRO
                        </span>
                    </Link>

                    {/* Desktop Nav */}
                    <nav className="hidden md:flex items-center gap-8">
                        {navLinks.map((link) => (
                            <Link 
                                key={link.name} 
                                href={link.href} 
                                className="text-[14px] font-bold tracking-widest text-white/70 hover:text-[#5ed29c] transition-colors"
                            >
                                {link.name}
                            </Link>
                        ))}
                        <Link href="/login" className="text-[14px] font-bold text-white/70 hover:text-white ml-4 tracking-widest">ВОЙТИ</Link>
                        <Link href="/signup" className="bg-[#5ed29c] text-[#070b0a] px-6 py-2.5 rounded-full text-[13px] font-black tracking-widest hover:scale-105 transition-transform shadow-[0_0_20px_-5px_#5ed29c]">
                            РЕГИСТРАЦИЯ
                        </Link>
                    </nav>

                    {/* Mobile Hamburger */}
                    <button 
                        className="md:hidden text-white relative z-[110]"
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                    >
                        {isMenuOpen ? <X size={28} /> : <Menu size={28} />}
                    </button>
                </div>
            </header>

            {/* Mobile Menu Overlay */}
            <AnimatePresence>
                {isMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[105] bg-[#070b0a] flex flex-col items-center justify-center p-8"
                    >
                        <nav className="flex flex-col items-center gap-10">
                            {navLinks.map((link) => (
                                <Link 
                                    key={link.name} 
                                    href={link.href} 
                                    className="text-4xl font-black text-white hover:text-[#5ed29c] transition-colors tracking-tighter"
                                >
                                    {link.name}
                                </Link>
                            ))}
                            <div className="flex flex-col gap-4 w-full max-w-xs mt-8">
                                <Link href="/login" className="text-center text-white/70 text-xl font-bold tracking-widest">ВОЙТИ</Link>
                                <Link href="/signup" className="bg-[#5ed29c] text-[#070b0a] text-center px-8 py-4 rounded-full text-lg font-black tracking-widest">
                                    РЕГИСТРАЦИЯ
                                </Link>
                            </div>
                        </nav>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
