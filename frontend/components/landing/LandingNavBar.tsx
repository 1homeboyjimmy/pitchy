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
        { name: "Features", href: "#", hasDropdown: true },
        { name: "Solutions", href: "#" },
        { name: "Plans", href: "/pricing" },
        { name: "Learning", href: "#", hasDropdown: true },
    ];

    return (
        <header className="fixed top-0 left-0 right-0 z-[100] w-full">
            <div className="flex flex-row justify-between items-center py-5 px-8 w-full max-w-[1440px] mx-auto">
                {/* Left: Logo */}
                <Link href="/" className="flex items-center gap-2 relative z-[110]">
                    <span className="text-foreground font-bold text-2xl tracking-tighter font-display uppercase">
                        Pitchy
                    </span>
                </Link>

                {/* Center: Nav Links */}
                <nav className="hidden md:flex items-center gap-8">
                    {navLinks.map((link) => (
                        <button 
                            key={link.name} 
                            className="flex items-center gap-1 text-foreground/90 hover:text-foreground transition-colors font-medium text-sm"
                        >
                            {link.name}
                            {link.hasDropdown && <ChevronDown size={14} className="opacity-50" />}
                        </button>
                    ))}
                </nav>

                {/* Right: Actions */}
                <div className="flex items-center gap-4 relative z-[110]">
                    <Link href="/signup" className="bg-foreground/10 text-foreground border border-foreground/20 px-6 py-2 rounded-full text-[13px] font-bold hover:bg-foreground/20 transition-colors">
                        Sign Up
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
                                    className="text-2xl font-bold text-foreground/80 hover:text-foreground"
                                >
                                    {link.name}
                                </Link>
                            ))}
                        </nav>
                    </motion.div>
                )}
            </AnimatePresence>
        </header>
    );
}
