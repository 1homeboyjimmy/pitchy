"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Sparkles, Zap, Crown } from "lucide-react";
import Link from "next/link";
import Layout from "@/components/Layout";

const plans = [
    {
        name: "Бесплатный",
        price: { monthly: "0", yearly: "0" },
        description: "Для знакомства с платформой",
        icon: Sparkles,
        features: [
            "1 проект (анализ) в месяц",
            "До 10 сообщений в чате",
            "Базовый текстовый скоринг",
            "Оценка по 100-балльной шкале",
        ],
        cta: "Начать бесплатно",
        popular: false,
        color: "white",
    },
    {
        name: "Профессиональный",
        price: { monthly: "499", yearly: "4 990" },
        description: "Для соло-фаундеров и ангелов",
        icon: Zap,
        features: [
            "5 проектов в месяц",
            "Безлимитные сообщения в чате",
            "Генерация структуры презентации",
            "Имитация питча со злым инвестором",
            "Бессрочная история чатов",
            "Экспорт в PDF и TXT",
        ],
        cta: "Оформить подписку",
        popular: true,
        color: "violet",
    },
    {
        name: "Премиум",
        price: { monthly: "999", yearly: "9 990" },
        description: "Для венчурных фондов и B2B",
        icon: Crown,
        features: [
            "Все функции плана Профессиональный",
            "Неограниченное число проектов",
            "Поиск в интернете и проверка юрлиц",
            "Массовый анализ до 20 проектов",
            "Динамический финансовый анализ",
            "PDF Отчёты (без лого Pitchy)",
            "Кастомные промпты",
        ],
        cta: "Оформить подписку",
        popular: false,
        color: "cyan",
    },
];

import { createPayment } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { useRouter } from "next/navigation";

export default function PricingPage() {
    const [isYearly, setIsYearly] = useState(false);
    const [isLoading, setIsLoading] = useState<string | null>(null);
    const [promoCode, setPromoCode] = useState("");
    const [appliedPromo, setAppliedPromo] = useState<{ code: string, discount: number } | null>(null);
    const [promoError, setPromoError] = useState("");
    const [isCheckingPromo, setIsCheckingPromo] = useState(false);
    const { isAuthenticated, token } = useAuth();
    const router = useRouter();

    const handleSubscribe = async (planName: string) => {
        const tierMap: Record<string, string> = {
            "Бесплатный": "free",
            "Профессиональный": "pro",
            "Премиум": "premium"
        };
        const tier = tierMap[planName];

        if (tier === "free") {
            router.push(isAuthenticated ? "/dashboard" : "/signup");
            return;
        }

        if (!isAuthenticated || !token) {
            router.push('/login?redirect=/pricing');
            return;
        }

        try {
            setIsLoading(planName);
            const res = await createPayment(tier, isYearly, appliedPromo?.code || null, token);
            if (res.confirmation_url) {
                window.location.href = res.confirmation_url;
            }
        } catch (e) {
            console.error("Payment error", e);
            alert("Ошибка при создании платежа. Попробуйте еще раз.");
        } finally {
            setIsLoading(null);
        }
    };

    const handleApplyPromo = async () => {
        if (!promoCode.trim()) return;

        setIsCheckingPromo(true);
        setPromoError("");
        setAppliedPromo(null);

        try {
            // Use explicit fetch since it might not require auth yet (we'll authorize on subscribe)
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api'}/billing/promo/validate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: promoCode.trim() })
            });
            const data = await res.json();

            if (data.valid) {
                setAppliedPromo({ code: promoCode.trim(), discount: data.discount_percent });
                setPromoCode("");
            } else {
                setPromoError(data.detail || "Неверный промокод");
            }
        } catch (err) {
            console.error(err);
            setPromoError("Ошибка проверки кода");
        } finally {
            setIsCheckingPromo(false);
        }
    };

    return (
        <Layout>
            <div className="min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8">
                <div className="max-w-6xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center mb-12"
                    >
                        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
                            Тарифы
                        </h1>
                        <p className="text-white/50 text-lg mb-8">
                            Выберите план, который подходит именно вам
                        </p>

                        {/* Toggle */}
                        <div className="flex items-center justify-center gap-3">
                            <span
                                className={`text-sm font-medium ${!isYearly ? "text-white" : "text-white/40"}`}
                            >
                                Месяц
                            </span>
                            <button
                                onClick={() => setIsYearly(!isYearly)}
                                className={`relative w-14 h-7 rounded-full transition-colors cursor-pointer ${isYearly ? "bg-pitchy-violet" : "bg-white/20"
                                    }`}
                            >
                                <motion.div
                                    animate={{ x: isYearly ? 28 : 4 }}
                                    transition={{ duration: 0.2 }}
                                    className="absolute top-1 w-5 h-5 rounded-full bg-white"
                                />
                            </button>
                            <span
                                className={`text-sm font-medium ${isYearly ? "text-white" : "text-white/40"}`}
                            >
                                Год{" "}
                                <span className="text-xs text-emerald-400 ml-1">-17%</span>
                            </span>
                        </div>

                        {/* Promo Code Input */}
                        <div className="max-w-md mx-auto mt-8 mb-12">
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    placeholder="У меня есть промокод"
                                    value={promoCode}
                                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pitchy-violet"
                                    disabled={isCheckingPromo}
                                />
                                <button
                                    onClick={handleApplyPromo}
                                    disabled={!promoCode.trim() || isCheckingPromo}
                                    className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
                                >
                                    {isCheckingPromo ? "..." : "Применить"}
                                </button>
                            </div>
                            {promoError && (
                                <p className="text-red-400 text-sm mt-2 text-left">{promoError}</p>
                            )}
                            {appliedPromo && (
                                <p className="text-emerald-400 text-sm mt-2 text-left">
                                    Промокод {appliedPromo.code} применен! Скидка {appliedPromo.discount}%
                                </p>
                            )}
                        </div>
                    </motion.div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {plans.map((plan, i) => (
                            <motion.div
                                key={plan.name}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.1 }}
                                whileHover={{ scale: 1.02, y: -4 }}
                                className={`relative glass-card-hover p-6 sm:p-8 ${plan.popular
                                    ? "border-pitchy-violet/30 shadow-glow-primary/20"
                                    : ""
                                    }`}
                            >
                                {plan.popular && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-pitchy-violet text-white text-xs font-medium">
                                        Популярный
                                    </div>
                                )}

                                <div className="mb-6">
                                    <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-4">
                                        <plan.icon
                                            className={`w-6 h-6 ${plan.color === "violet"
                                                ? "text-pitchy-violet"
                                                : plan.color === "cyan"
                                                    ? "text-pitchy-cyan"
                                                    : "text-white/60"
                                                }`}
                                        />
                                    </div>
                                    <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                                    <p className="text-sm text-white/40 mt-1">
                                        {plan.description}
                                    </p>
                                </div>

                                <div className="mb-6">
                                    {appliedPromo && plan.name !== "Бесплатный" ? (
                                        <div className="flex flex-col">
                                            <span className="text-xl font-bold text-white/40 line-through font-mono-numbers">
                                                ₽{isYearly ? plan.price.yearly : plan.price.monthly}
                                            </span>
                                            <div className="flex items-baseline">
                                                <span className="text-4xl font-bold text-emerald-400 font-mono-numbers">
                                                    ₽{Math.round(parseInt((isYearly ? plan.price.yearly : plan.price.monthly).replace(/\s/g, '')) * (100 - appliedPromo.discount) / 100)}
                                                </span>
                                                <span className="text-white/40 ml-1">
                                                    /{isYearly ? "год" : "мес"}
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <span className="text-4xl font-bold text-white font-mono-numbers">
                                                ₽{isYearly ? plan.price.yearly : plan.price.monthly}
                                            </span>
                                            <span className="text-white/40 ml-1">
                                                /{isYearly ? "год" : "мес"}
                                            </span>
                                        </>
                                    )}
                                </div>

                                <ul className="space-y-3 mb-8">
                                    {plan.features.map((feature) => (
                                        <li
                                            key={feature}
                                            className="flex items-start gap-2 text-sm text-white/70"
                                        >
                                            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <button
                                    onClick={() => handleSubscribe(plan.name)}
                                    disabled={isLoading === plan.name}
                                    className={`block w-full text-center py-3 rounded-xl font-medium transition-all bg-white/5 text-white border border-white/10 hover:bg-white/10 disabled:opacity-50`}
                                >
                                    {isLoading === plan.name ? "Загрузка..." : plan.cta}
                                </button>
                            </motion.div>
                        ))}
                    </div>

                    <div className="mt-16 text-center max-w-2xl mx-auto space-y-4">
                        <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                            <h4 className="text-lg font-semibold text-white mb-2">Получение заказа и доставка</h4>
                            <p className="text-sm text-white/70 mb-4">
                                Все услуги предоставляются в цифровом виде. После успешной оплаты доступ к выбранному тарифу активируется в личном кабинете автоматически. Физическая доставка не предусмотрена.
                            </p>
                            <p className="text-xs text-white/40">
                                Оплачивая подписку, вы соглашаетесь с{" "}
                                <Link href="/terms" className="text-pitchy-cyan hover:underline">
                                    Пользовательским соглашением и Офертой
                                </Link>.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    );
}

