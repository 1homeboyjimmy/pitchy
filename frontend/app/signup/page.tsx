"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { User, Mail, Lock, Eye, EyeOff, ArrowRight, Check, Github } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { postJson } from "@/lib/api";
import { setToken } from "@/lib/auth";

export default function SignUpPage() {
    const router = useRouter();
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        password: "",
        confirmPassword: "",
    });
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [agreedToTerms, setAgreedToTerms] = useState(false);

    // New state for verification
    const [verificationStep, setVerificationStep] = useState<"signup" | "verify">("signup");
    const [verificationCode, setVerificationCode] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (formData.password !== formData.confirmPassword) {
            setError("Пароли не совпадают");
            return;
        }
        if (!agreedToTerms) {
            setError("Необходимо принять условия использования");
            return;
        }

        setLoading(true);
        setError("");

        try {
            const data = await postJson<{ status?: string; token?: string; email?: string }>(
                "/auth/register",
                {
                    name: formData.name,
                    email: formData.email,
                    password: formData.password,
                }
            );

            if (data.status === "verification_required") {
                setVerificationStep("verify");
            } else if (data.token) {
                setToken(data.token);
                window.location.href = "/dashboard";
            }
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Ошибка регистрации. Попробуйте ещё раз."
            );
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const data = await postJson<{ access_token: string }>("/auth/verify-email", {
                email: formData.email,
                code: verificationCode,
            });
            setToken(data.access_token);
            window.location.href = "/dashboard";
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Неверный код подтверждения"
            );
        } finally {
            setLoading(false);
        }
    };

    if (verificationStep === "verify") {
        return (
            <Layout>
                <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-4 py-12">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="w-full max-w-md"
                    >
                        <div className="glass-panel rounded-3xl p-8 text-center">
                            <div className="w-16 h-16 rounded-full bg-pitchy-violet/20 flex items-center justify-center mx-auto mb-6">
                                <Mail className="w-8 h-8 text-pitchy-violet" />
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-2">
                                Подтвердите Email
                            </h2>
                            <p className="text-white/60 mb-8">
                                Мы отправили код подтверждения на{" "}
                                <span className="text-white">{formData.email}</span>
                            </p>

                            <form onSubmit={handleVerify} className="space-y-6">
                                {error && (
                                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                                        {error}
                                    </div>
                                )}
                                <input
                                    type="text"
                                    value={verificationCode}
                                    onChange={(e) => setVerificationCode(e.target.value)}
                                    className="pitchy-input text-center text-3xl tracking-[0.5em] font-mono"
                                    placeholder="000000"
                                    maxLength={6}
                                    required
                                    autoFocus
                                />
                                <motion.button
                                    type="submit"
                                    disabled={loading}
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    className="w-full btn-primary py-3 rounded-xl disabled:opacity-50"
                                >
                                    {loading ? "Проверка..." : "Подтвердить"}
                                </motion.button>
                            </form>
                        </div>
                    </motion.div>
                </div>
            </Layout>
        );
    }

    return (
        <Layout>
            <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-4 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full max-w-md"
                >
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold text-white mb-2">
                            Создать аккаунт
                        </h1>
                        <p className="text-white/50">
                            Начните анализировать стартапы с Pitchy.pro
                        </p>
                    </div>

                    <div className="glass-panel rounded-3xl p-8">
                        <form onSubmit={handleSubmit} className="space-y-5">
                            {error && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400"
                                >
                                    {error}
                                </motion.div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-white/70 mb-2">
                                    Имя
                                </label>
                                <div className="relative">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) =>
                                            setFormData({ ...formData, name: e.target.value })
                                        }
                                        className="pitchy-input pl-14"
                                        placeholder="Ваше имя"
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-white/70 mb-2">
                                    Email
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) =>
                                            setFormData({ ...formData, email: e.target.value })
                                        }
                                        className="pitchy-input pl-14"
                                        placeholder="you@example.com"
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-white/70 mb-2">
                                    Пароль
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={formData.password}
                                        onChange={(e) =>
                                            setFormData({ ...formData, password: e.target.value })
                                        }
                                        className="pitchy-input pl-14 pr-11"
                                        placeholder="Минимум 8 символов"
                                        required
                                        minLength={8}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                                    >
                                        {showPassword ? (
                                            <EyeOff className="w-4 h-4" />
                                        ) : (
                                            <Eye className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-white/70 mb-2">
                                    Подтвердите пароль
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={formData.confirmPassword}
                                        onChange={(e) =>
                                            setFormData({
                                                ...formData,
                                                confirmPassword: e.target.value,
                                            })
                                        }
                                        className="pitchy-input pl-14"
                                        placeholder="Повторите пароль"
                                        required
                                    />
                                </div>
                            </div>

                            <label className="flex items-start gap-3 cursor-pointer">
                                <div
                                    onClick={() => setAgreedToTerms(!agreedToTerms)}
                                    className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 mt-0.5 transition-all cursor-pointer ${agreedToTerms
                                        ? "bg-pitchy-violet border-pitchy-violet"
                                        : "border-white/20 hover:border-white/40"
                                        }`}
                                >
                                    {agreedToTerms && <Check className="w-3 h-3 text-white" />}
                                </div>
                                <span className="text-sm text-white/50">
                                    Я согласен с{" "}
                                    <Link
                                        href="/terms"
                                        className="text-pitchy-violet hover:underline"
                                    >
                                        условиями использования
                                    </Link>{" "}
                                    и{" "}
                                    <Link
                                        href="/privacy"
                                        className="text-pitchy-violet hover:underline"
                                    >
                                        политикой конфиденциальности
                                    </Link>
                                </span>
                            </label>

                            <motion.button
                                type="submit"
                                disabled={loading}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                className="w-full btn-primary py-3 rounded-xl disabled:opacity-50 cursor-pointer"
                            >
                                {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <motion.div
                                            animate={{ rotate: 360 }}
                                            transition={{
                                                duration: 1,
                                                repeat: Infinity,
                                                ease: "linear",
                                            }}
                                            className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                                        />
                                        Регистрация...
                                    </span>
                                ) : (
                                    <span className="flex items-center justify-center gap-2">
                                        Создать аккаунт
                                        <ArrowRight className="w-4 h-4" />
                                    </span>
                                )}
                            </motion.button>


                            <div className="relative my-6">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-white/10"></div>
                                </div>
                                <div className="relative flex justify-center text-sm">
                                    <span className="px-2 bg-[#0A0A0A] text-white/40">
                                        Или зарегистрируйтесь через
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <a
                                    href={`${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/auth/yandex/login`}
                                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#FC3F1D]/10 hover:bg-[#FC3F1D]/20 border border-[#FC3F1D]/20 text-[#FC3F1D] transition-all hover:scale-[1.02]"
                                >
                                    <span className="font-bold font-sans">Ya</span>
                                    <span className="text-sm font-medium text-white/80">Yandex</span>
                                </a>
                                <a
                                    href={`${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/auth/github/login`}
                                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all hover:scale-[1.02]"
                                >
                                    <Github className="w-4 h-4" />
                                    <span className="text-sm font-medium">GitHub</span>
                                </a>
                            </div>
                        </form>
                    </div>

                    <p className="text-center text-sm text-white/40 mt-6">
                        Уже есть аккаунт?{" "}
                        <Link
                            href="/login"
                            className="text-pitchy-violet hover:text-pitchy-violet-light transition-colors"
                        >
                            Войдите
                        </Link>
                    </p>
                </motion.div>
            </div >
        </Layout >
    );
}
