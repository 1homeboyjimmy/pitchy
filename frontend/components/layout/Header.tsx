"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, Zap } from "lucide-react";
import { AnimatedButton } from "../marketing/ui-custom/AnimatedButton";
import { clearToken } from "@/lib/auth";
import { useAuth } from "@/lib/hooks/useAuth";
import { postJson } from "@/lib/api";

const navLinks = [
    { label: "Главная", href: "/" },
    { label: "Панель управления", href: "/dashboard" },
    { label: "FAQ", href: "/faq" },
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
          ${isScrolled || isMobileMenuOpen ? "bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/50" : "bg-transparent"}
        `}
            >
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-20">
                        {/* Logo */}
                        <Link href="/" className="flex items-center gap-2 group">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center transition-transform group-hover:scale-105">
                                <Zap className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-xl font-bold text-white tracking-tight">pitchy</span>
                            <span className="text-violet-400 font-medium">.pro</span>
                        </Link>

                        {/* Desktop Nav */}
                        <nav className="hidden md:flex items-center gap-1">
                            {navLinks.map((link) => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    className={`relative px-4 py-2 text-sm font-medium transition-colors duration-200
                    ${pathname === link.href ? "text-white" : "text-zinc-400 hover:text-white"}
                  `}
                                >
                                    {pathname === link.href && (
                                        <motion.div
                                            layoutId="nav-pill"
                                            className="absolute inset-0 bg-zinc-800/50 rounded-lg"
                                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                        />
                                    )}
                                    <span className="relative z-10">{link.label}</span>
                                </Link>
                            ))}
                            {isAuthed && (
                                <Link
                                    href="/account"
                                    className={`relative px-4 py-2 text-sm font-medium transition-colors duration-200
                    ${pathname === "/account" ? "text-white" : "text-zinc-400 hover:text-white"}
                  `}
                                >
                                    {pathname === "/account" && (
                                        <motion.div
                                            layoutId="nav-pill"
                                            className="absolute inset-0 bg-zinc-800/50 rounded-lg"
                                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                        />
                                    )}
                                    <span className="relative z-10">Аккаунт</span>
                                </Link>
                            )}
                        </nav>

                        {/* Desktop Actions */}
                        <div className="hidden md:flex items-center gap-4">
                            {isAuthed ? (
                                <button
                                    onClick={handleLogout}
                                    className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors"
                                >
                                    Выйти
                                </button>
                            ) : (
                                <>
                                    <Link href="/login" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">
                                        Войти
                                    </Link>
                                    <Link href="/login">
                                        <AnimatedButton size="sm">Начать</AnimatedButton>
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
                        className="fixed inset-x-0 top-20 z-40 md:hidden bg-zinc-950/95 backdrop-blur-xl border-b border-zinc-800"
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
                                    <button
                                        onClick={() => {
                                            handleLogout();
                                            setIsMobileMenuOpen(false);
                                        }}
                                        className="w-full px-4 py-3 rounded-lg text-base font-medium text-left text-red-400 hover:bg-zinc-800/50 transition-colors"
                                    >
                                        Выйти
                                    </button>
                                ) : (
                                    <div className="space-y-3">
                                        <Link
                                            href="/login"
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className="block w-full px-4 text-center py-3 rounded-lg text-base font-medium text-zinc-300 hover:text-white hover:bg-zinc-800/50 transition-colors"
                                        >
                                            Войти
                                        </Link>
                                        <Link href="/login" onClick={() => setIsMobileMenuOpen(false)} className="block">
                                            <AnimatedButton className="w-full">Начать</AnimatedButton>
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
