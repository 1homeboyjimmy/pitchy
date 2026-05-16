"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";
import { getToken } from "@/lib/auth";
import { createPayment, validatePromoCode } from "@/lib/api";

interface PlanFeature {
  text: string;
  included: boolean;
}

interface Plan {
  name: string;
  nameDisplay: string;
  // Backend billing tier key; null = free plan (no payment).
  tier: "starter" | "pro" | null;
  // Numeric prices so the promo discount can be applied at render time
  // without parsing display strings.
  priceMonthly: number;
  priceYearly: number;
  description: string;
  features: PlanFeature[];
  popular?: boolean;
  buttonStyle: "outline" | "filled";
}

const plans: Plan[] = [
  {
    name: "Free",
    nameDisplay: "Бесплатный",
    tier: null,
    priceMonthly: 0,
    priceYearly: 0,
    description: "Базовые функции для начала работы.",
    features: [
      { text: "1 проект", included: true },
      { text: "Базовые шаблоны", included: true },
      { text: "Экспорт в PDF (с водяным знаком)", included: true },
      { text: "Командная работа", included: false },
      { text: "Аналитика просмотров", included: false },
    ],
    buttonStyle: "outline",
  },
  {
    name: "Starter",
    nameDisplay: "Starter",
    tier: "starter",
    priceMonthly: 2490,
    priceYearly: 24900,
    description: "Оптимально для фрилансеров и небольших команд.",
    features: [
      { text: "До 10 проектов", included: true },
      { text: "Все премиум шаблоны", included: true },
      { text: "Экспорт без водяных знаков", included: true },
      { text: "Базовая аналитика", included: true },
      { text: "Приоритетная поддержка", included: false },
    ],
    popular: true,
    buttonStyle: "filled",
  },
  {
    name: "Pro",
    nameDisplay: "Pro",
    tier: "pro",
    priceMonthly: 3790,
    priceYearly: 37900,
    description: "Максимальные возможности для агентств и корпораций.",
    features: [
      { text: "Безлимитные проекты", included: true },
      { text: "Пользовательские шаблоны", included: true },
      { text: "Командная работа (до 10 чел)", included: true },
      { text: "Продвинутая аналитика", included: true },
      { text: "Приоритетная поддержка 24/7", included: true },
    ],
    buttonStyle: "outline",
  },
];

const formatPrice = (n: number): string => {
  if (n === 0) return "0₽";
  return `${n.toLocaleString("ru-RU")}₽`;
};

type PromoResult = {
  valid: boolean;
  discount_percent: number;
  target_tier?: string | null;
  fixed_price?: number | null;
  detail?: string;
};

export default function PricingPage() {
  const router = useRouter();
  const [isYearly, setIsYearly] = useState(false);
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  // Promo state
  const [showPromo, setShowPromo] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<string | null>(null);
  const [promoData, setPromoData] = useState<PromoResult | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);

  const handleValidatePromo = async () => {
    const code = promoInput.trim();
    if (!code) return;
    setPromoChecking(true);
    try {
      const result = (await validatePromoCode(code)) as PromoResult;
      setPromoData(result);
      setAppliedPromo(result.valid ? code : null);
    } catch (e) {
      console.error("Promo validation failed", e);
      setPromoData({ valid: false, discount_percent: 0, detail: "Не удалось проверить промокод" });
      setAppliedPromo(null);
    } finally {
      setPromoChecking(false);
    }
  };

  const handleClearPromo = () => {
    setPromoInput("");
    setAppliedPromo(null);
    setPromoData(null);
  };

  // Compute the displayed price for a plan, applying a valid promo only
  // when its target_tier matches (or has no target — applies to any tier).
  // fixed_price wins over discount_percent (matches backend logic).
  const getDisplayPrice = (plan: Plan): { final: number; original: number | null } => {
    const base = isYearly ? plan.priceYearly : plan.priceMonthly;
    if (!plan.tier || !promoData?.valid) return { final: base, original: null };
    if (promoData.target_tier && promoData.target_tier !== plan.tier) {
      return { final: base, original: null };
    }
    let final = base;
    if (promoData.fixed_price !== null && promoData.fixed_price !== undefined) {
      final = promoData.fixed_price;
    } else if (promoData.discount_percent) {
      final = Math.round((base * (100 - promoData.discount_percent)) / 100);
    }
    return final === base ? { final, original: null } : { final, original: base };
  };

  const handleSelectPlan = async (plan: Plan) => {
    if (!plan.tier) {
      router.push("/signup");
      return;
    }
    const token = getToken();
    if (!token) {
      router.push("/login?next=/pricing");
      return;
    }
    setPayError(null);
    setLoadingTier(plan.tier);
    try {
      const { confirmation_url } = await createPayment(plan.tier, isYearly, appliedPromo, token);
      window.location.href = confirmation_url;
    } catch (e) {
      console.error("Payment creation failed", e);
      setPayError("Не удалось создать платёж. Попробуйте ещё раз.");
      setLoadingTier(null);
    }
  };

  return (
    <div className="bg-black text-foreground min-h-screen flex flex-col relative overflow-hidden">
       {/* Decorative Orbs */}
       <div className="aurora-orb top-[-10rem] left-[-5rem] h-96 w-96 bg-white/[0.03] animate-pulse" />
       <div className="aurora-orb bottom-[-5rem] right-[-10rem] h-80 w-80 bg-white/[0.02] animate-float-slow" />

      <TopNavBar />

      <main className="flex-grow pt-48 pb-24 px-6 md:px-12 max-w-[1440px] mx-auto w-full relative z-10">
        {/* Header */}
        <div className="text-center mb-20">
          <h1 className="font-display text-6xl md:text-8xl text-white mb-8 tracking-tighter leading-none">
            Выберите свой <span className="text-white/30 italic">ритм</span>.
          </h1>
          <p className="font-body-lg text-xl text-foreground/60 max-w-2xl mx-auto leading-relaxed">
            Инструменты для создания профессиональных питчей. Выберите тариф, который подходит именно вам.
          </p>

          {/* Billing Toggle */}
          <div className="mt-12 flex items-center justify-center gap-6">
            <span className={`font-mono-label text-[12px] uppercase tracking-widest transition-colors ${!isYearly ? "text-white" : "text-white/30"}`}>
              Месяц
            </span>
            <button
              aria-label="Toggle billing period"
              className="relative w-16 h-8 rounded-full border border-white/10 bg-white/5 cursor-pointer transition-all hover:border-white/30"
              onClick={() => setIsYearly(!isYearly)}
            >
              <div
                className={`absolute top-1/2 left-1 -translate-y-1/2 w-5 h-5 rounded-full bg-white shadow-lg transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isYearly ? "translate-x-[34px]" : "translate-x-0"
                }`}
              />
            </button>
            <span className={`font-mono-label text-[12px] uppercase tracking-widest transition-colors ${isYearly ? "text-white" : "text-white/30"}`}>
              Год <span className="text-emerald-500 ml-2">(2 месяца в подарок)</span>
            </span>
          </div>

          {/* Promo code — hidden behind a small link by default since most
              visitors don't have one. Width is set inline because tailwind
              max-w-md was being squeezed to content-width by some ancestor
              in this layout (likely the .text-center parent quirk) and the
              input collapsed to a circle. Inline width overrides anything. */}
          <div
            className="mt-10 mx-auto block"
            style={{ width: "100%", maxWidth: "28rem" }}
          >
            {!showPromo ? (
              <div className="text-center">
                <button
                  onClick={() => setShowPromo(true)}
                  className="font-mono-label text-[11px] uppercase tracking-widest text-white/40 hover:text-white transition-colors underline underline-offset-4 decoration-white/10 hover:decoration-white/40 whitespace-nowrap"
                >
                  У меня есть промокод
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2 items-stretch">
                  <input
                    type="text"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === "Enter") handleValidatePromo(); }}
                    placeholder="ПРОМОКОД"
                    disabled={appliedPromo !== null}
                    autoFocus
                    className="flex-1 min-w-0 bg-white/5 border border-white/10 text-white rounded-full px-5 py-3 font-mono text-[13px] tracking-widest text-center placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors disabled:opacity-50"
                  />
                  {appliedPromo ? (
                    <button
                      onClick={handleClearPromo}
                      className="px-5 py-3 bg-white/5 border border-white/10 text-white/60 text-[11px] font-mono uppercase tracking-widest rounded-full hover:bg-white/10 hover:text-white transition-all whitespace-nowrap"
                    >
                      Сбросить
                    </button>
                  ) : (
                    <button
                      onClick={handleValidatePromo}
                      disabled={!promoInput.trim() || promoChecking}
                      className="px-5 py-3 bg-white text-black text-[11px] font-mono uppercase tracking-widest rounded-full hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {promoChecking ? "..." : "Применить"}
                    </button>
                  )}
                </div>
                {promoData && (
                  <p className={`mt-3 text-center text-[13px] leading-snug ${promoData.valid ? "text-emerald-400" : "text-red-400"}`}>
                    {promoData.valid
                      ? promoData.fixed_price !== null && promoData.fixed_price !== undefined
                        ? `Цена ${formatPrice(promoData.fixed_price)}${promoData.target_tier ? ` (тариф ${promoData.target_tier})` : ""}`
                        : `Скидка −${promoData.discount_percent}%${promoData.target_tier ? ` на тариф ${promoData.target_tier}` : ""}`
                      : (promoData.detail || "Промокод неверный")}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto w-full">
          {plans.map((plan) => {
            const { final, original } = getDisplayPrice(plan);
            return (
            <div
              key={plan.name}
              className={`lovable-glass rounded-[40px] p-10 flex flex-col relative group transition-all duration-700 hover:translate-y-[-8px] ${
                plan.popular ? "border-white/20 shadow-[0_32px_64px_-16px_rgba(255,255,255,0.05)]" : ""
              }`}
            >
              {/* Popular Badge */}
              {plan.popular && (
                <div className="absolute top-0 right-10 -translate-y-1/2 bg-white text-black font-mono-label text-[10px] uppercase tracking-[0.2em] px-4 py-1.5 rounded-full font-black">
                  Популярный
                </div>
              )}

              {/* Plan Header */}
              <div className="mb-10">
                <h2 className="font-mono-label text-[12px] text-white/40 uppercase tracking-[0.3em] mb-4">
                  {plan.nameDisplay}
                </h2>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-6xl text-white tracking-tighter">
                    {formatPrice(final)}
                  </span>
                  <span className="font-body-sm text-white/30">{isYearly ? "/ год" : "/ мес"}</span>
                </div>
                {original !== null && (
                  <p className="mt-2 font-mono-label text-[11px] uppercase tracking-widest text-white/30">
                    <span className="line-through">{formatPrice(original)}</span>
                    <span className="ml-2 text-emerald-400">по промокоду</span>
                  </p>
                )}
                <p className="font-body-sm text-foreground/50 mt-6 leading-relaxed">{plan.description}</p>
              </div>

              {/* Features List */}
              <ul className="flex flex-col gap-4 mb-12 flex-grow">
                {plan.features.map((feature) => (
                  <li
                    key={feature.text}
                    className={`flex items-start gap-4 ${!feature.included ? "opacity-20" : ""}`}
                  >
                    <div className={`mt-1 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${feature.included ? "bg-white/10 text-white" : "text-white/20"}`}>
                      {feature.included ? (
                        <Check size={12} strokeWidth={3} />
                      ) : (
                        <X size={12} strokeWidth={3} />
                      )}
                    </div>
                    <span className="font-body-sm text-[15px] text-foreground/80 tracking-tight">
                      {feature.text}
                    </span>
                  </li>
                ))}
              </ul>

              {/* CTA Button */}
              {plan.buttonStyle === "filled" ? (
                <button
                  onClick={() => handleSelectPlan(plan)}
                  disabled={loadingTier !== null}
                  className="w-full bg-white text-black font-sans text-sm font-bold py-4 rounded-full hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingTier === plan.tier ? "Загрузка…" : `Выбрать ${plan.name}`}
                </button>
              ) : (
                <button
                  onClick={() => handleSelectPlan(plan)}
                  disabled={loadingTier !== null}
                  className="w-full bg-white/5 border border-white/10 text-white font-sans text-sm font-bold py-4 rounded-full hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingTier === plan.tier ? "Загрузка…" : `Выбрать ${plan.name}`}
                </button>
              )}
              {payError && loadingTier === null && plan.popular && (
                <p className="mt-4 text-center font-body-sm text-red-400">{payError}</p>
              )}
            </div>
            );
          })}
        </div>

        {/* Custom Solution */}
        <div className="mt-20 max-w-3xl mx-auto border-t border-white/5 pt-10 text-center">
          <p className="font-body-sm text-foreground/30">
            Нужно индивидуальное решение?{" "}
            <Link className="text-white hover:text-white/80 transition-colors underline underline-offset-8 decoration-white/20" href="/contact">
              Свяжитесь с нами
            </Link>.
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
