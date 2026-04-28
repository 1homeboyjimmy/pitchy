"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, Zap } from "react-feather";
import { AnimatedButton } from "../marketing/ui-custom/AnimatedButton";
import { clearToken } from "@/lib/auth";
import { useAuth } from "@/lib/hooks/useAuth";
import { postJson } from "@/lib/api";

const navLinks = [
    { label: "ГЛАВНАЯ", href: "/" },
    { label: "ДАШБОРД", href: "/dashboard" },
    { label: "FAQ", href: "/faq" },
    { label: "О НАС", href: "/about" },
    { label: "ТАРИФЫ", href: "/pricing" },
    { label: "КОНТАКТЫ", href: "/contact" },
];

export function Header() {
    const [isScrolled, setIsScrolled] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const pathname = usePathname();
    const router = useRouter();

    const { isAuthenticated: isAuthed } = useAuth();

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const handleLogout = async () => {
        try {
            await postJson("/auth/logout", {});
        } catch { /* ignore */ }
        clearToken();
        router.push("/login");
    };

    return (
        <>
            <motion.header
                initial={{ y: -100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300
          ${isScrolled || isMobileMenuOpen ? "bg-[#131313]/90 backdrop-blur-xl border-b border-white/5" : "bg-transparent"}
        `}
            >
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-20">
                        {/* Logo */}
                        <Link href="/" className="flex items-center gap-1 group">
                            <span className="text-[15px] font-black tracking-widest text-white uppercase group-hover:opacity-80 transition-opacity">
                                PITCHY.PRO
                            </span>
                        </Link>

                        {/* Desktop Nav */}
                        <nav className="hidden md:flex items-center gap-6">
                            {navLinks.map((link) => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    className={`font-mono-label text-[10px] tracking-widest uppercase transition-colors duration-200
                    ${pathname === link.href ? "text-white" : "text-neutral-500 hover:text-white"}
                  `}
                                >
                                    {link.label}
                                </Link>
                            ))}
                        </nav>

                        {/* Desktop Actions */}
                        <div className="hidden md:flex items-center gap-4">
                            {isAuthed ? (
                                <>
                                    <Link
                                        href="/account"
                                        className="px-4 py-1.5 border border-white text-white font-mono-label text-[10px] uppercase tracking-widest hover:bg-white hover:text-black transition-colors font-bold"
                                    >
                                        АККАУНТ
                                    </Link>
                                    <button
                                        onClick={handleLogout}
                                        className="font-mono-label text-[10px] uppercase tracking-widest text-neutral-500 hover:text-white transition-colors"
                                    >
                                        ВЫЙТИ
                                    </button>
                                </>
                            ) : (
                                <>
                                    <Link href="/login" className="font-mono-label text-[10px] uppercase tracking-widest text-neutral-500 hover:text-white transition-colors">
                                        ВОЙТИ
                                    </Link>
                                    <Link href="/signup" className="bg-white text-black px-4 py-1.5 font-mono-label text-[10px] uppercase tracking-widest font-bold hover:opacity-90 transition-opacity">
                                        РЕГИСТРАЦИЯ
                                    </Link>
                                </>
                            )}
                        </div>

                        {/* Mobile Menu Button */}
                        <button
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            className="md:hidden p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors"
                        >
                            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                        </button>
                    </div>
                </div>
            </motion.header>

            {/* Mobile Menu Overlay */}
            <AnimatePresence>
                {isMobileMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.2 }}
                        className="fixed inset-x-0 top-20 z-40 md:hidden bg-[#131313]/95 backdrop-blur-xl border-b border-white/5"
                    >
                        <div className="p-4 space-y-4">
                            <nav className="space-y-1">
                                {navLinks.map((link) => (
                                    <Link
                                        key={link.href}
                                        href={link.href}
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className={`block px-4 py-3 rounded-lg text-base font-medium transition-colors
                      ${pathname === link.href ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"}
                    `}
                                    >
                                        {link.label}
                                    </Link>
                                ))}
                                {isAuthed && (
                                    <Link
                                        href="/account"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className={`block px-4 py-3 rounded-lg text-base font-medium transition-colors
                      ${pathname === "/account" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"}
                    `}
                                    >
                                        Аккаунт
                                    </Link>
                                )}
                            </nav>

                            <div className="pt-4 border-t border-zinc-800">
                                {isAuthed ? (
                                    <>
                                        <Link
                                            href="/account"
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className="block w-full px-4 text-center py-3 border border-white text-white font-mono-label text-[12px] uppercase tracking-widest hover:bg-white hover:text-black transition-colors font-bold mb-2 rounded-lg"
                                        >
                                            АККАУНТ
                                        </Link>
                                        <button
                                            onClick={() => {
                                                handleLogout();
                                                setIsMobileMenuOpen(false);
                                            }}
                                            className="w-full text-center py-2 font-mono-label text-[12px] uppercase tracking-widest text-neutral-500 hover:text-white transition-colors"
                                        >
                                            ВЫЙТИ
                                        </button>
                                    </>
                                ) : (
                                    <div className="space-y-3">
                                        <Link
                                            href="/login"
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className="block w-full px-4 text-center py-3 rounded-lg font-mono-label text-[12px] uppercase tracking-widest text-neutral-500 hover:text-white hover:bg-zinc-800/50 transition-colors"
                                        >
                                            ВОЙТИ
                                        </Link>
                                        <Link href="/signup" onClick={() => setIsMobileMenuOpen(false)} className="block">
                                            <div className="w-full text-center bg-white text-black px-4 py-3 font-mono-label text-[12px] uppercase tracking-widest font-bold hover:opacity-90 transition-opacity">
                                                РЕГИСТРАЦИЯ
                                            </div>
                                        </Link>
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
