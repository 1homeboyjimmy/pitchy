"use client";

import { motion } from "framer-motion";
import { ArrowLeft, Home } from "lucide-react";
import Link from "next/link";
import Layout from "@/components/Layout";

export default function NotFound() {
    return (
        <Layout>
            <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-4 py-12 relative">
                <div className="absolute inset-0 bg-gradient-to-b from-violet-950/10 via-transparent to-transparent pointer-events-none" />

                <div className="relative z-10 text-center max-w-md">
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        className="text-8xl md:text-9xl font-bold bg-gradient-to-r from-violet-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-4"
                    >
                        404
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                    >
                        <h1 className="text-2xl font-bold text-white mb-3">
                            Страница не найдена
                        </h1>
                        <p className="text-zinc-400 mb-8">
                            Страница, которую вы ищете, не существует или была перемещена.
                        </p>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                        className="flex items-center justify-center gap-3"
                    >
                        <Link
                            href="/"
                            className="btn-primary px-5 py-2.5 rounded-xl flex items-center gap-2"
                        >
                            <Home className="w-4 h-4" />
                            На главную
                        </Link>
                        <button
                            onClick={() => history.back()}
                            className="px-4 py-2.5 text-sm font-medium text-zinc-400 hover:text-white transition-colors flex items-center gap-2 cursor-pointer"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Назад
                        </button>
                    </motion.div>
                </div>
            </div>
        </Layout>
    );
}
