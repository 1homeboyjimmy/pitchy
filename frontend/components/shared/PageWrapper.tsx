"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface PageWrapperProps {
    children: ReactNode;
    className?: string;
    animate?: boolean;
}

export function PageWrapper({
    children,
    className = "",
    animate = true,
}: PageWrapperProps) {
    if (!animate) {
        return (
            <main className={`min-h-screen pt-20 pb-24 px-4 sm:px-6 lg:px-8 ${className}`}>
                <div className="max-w-7xl mx-auto">{children}</div>
            </main>
        );
    }

    return (
        <motion.main
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className={`min-h-screen pt-20 pb-24 px-4 sm:px-6 lg:px-8 ${className}`}
        >
            <div className="max-w-7xl mx-auto">{children}</div>
        </motion.main>
    );
}

export default PageWrapper;
