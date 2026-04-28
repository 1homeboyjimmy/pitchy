"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";

interface PlanFeature {
  text: string;
  included: boolean;
}

interface Plan {
  name: string;
  nameDisplay: string;
  priceMonthly: string;
  priceYearly: string;
  description: string;
  features: PlanFeature[];
  popular?: boolean;
  buttonStyle: "outline" | "filled";
}

const plans: Plan[] = [
  {
    name: "Free",
    nameDisplay: "Бесплатный",
    priceMonthly: "0₽",
    priceYearly: "0₽",
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
    priceMonthly: "1 490₽",
    priceYearly: "1 192₽",
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
    priceMonthly: "3 490₽",
    priceYearly: "2 792₽",
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

export default function PricingPage() {
  const [isYearly, setIsYearly] = useState(false);

  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col font-body-sm">
      <TopNavBar />

      <main className="flex-grow flex flex-col justify-center pt-16 pb-4 px-4 md:px-8 max-w-[1440px] mx-auto w-full">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="font-display text-display text-primary mb-2 tracking-tighter">Выберите свой план</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">
            Инструменты для создания профессиональных питчей. Выберите тариф, который подходит именно вам.
          </p>

          {/* Billing Toggle */}
          <div className="mt-6 flex items-center justify-center gap-4">
            <span className={`font-mono-label text-mono-label ${!isYearly ? "text-primary" : "text-on-surface-variant"}`}>
              Месяц
            </span>
            <button
              aria-label="Toggle billing period"
              className="relative w-12 h-6 rounded-full border border-white/20 bg-[#111111] cursor-pointer"
              onClick={() => setIsYearly(!isYearly)}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                  isYearly ? "left-1 translate-x-6" : "left-1 translate-x-0"
                }`}
              />
            </button>
            <span className={`font-mono-label text-mono-label ${isYearly ? "text-primary" : "text-on-surface-variant"}`}>
              Год <span className="text-[#888888] ml-1">(Скидка 20%)</span>
            </span>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto w-full">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`bg-[#111111] rounded p-5 flex flex-col relative group transition-colors ${
                plan.popular
                  ? "border border-white/[0.2] shadow-[0_0_0_1px_rgba(255,255,255,0.1)]"
                  : "border border-white/[0.08] hover:border-white/20"
              }`}
            >
              {/* Popular Badge */}
              {plan.popular && (
                <div className="absolute top-0 right-5 -translate-y-1/2 bg-white text-black font-mono-label text-[10px] uppercase tracking-widest px-3 py-1 rounded">
                  Популярный
                </div>
              )}

              {/* Plan Header */}
              <div className="mb-4">
                <h2 className={`font-code text-code uppercase mb-1 tracking-widest ${
                  plan.popular ? "text-white" : "text-on-surface-variant"
                }`}>
                  {plan.nameDisplay}
                </h2>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-h1 text-primary">
                    {isYearly ? plan.priceYearly : plan.priceMonthly}
                  </span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">/ мес</span>
                </div>
                <p className="font-body-sm text-body-sm text-[#888888] mt-2">{plan.description}</p>
              </div>

              {/* Features List */}
              <ul className="flex flex-col gap-2 mb-6 flex-grow">
                {plan.features.map((feature) => (
                  <li
                    key={feature.text}
                    className={`flex items-start gap-3 ${!feature.included ? "opacity-50" : ""}`}
                  >
                    {feature.included ? (
                      <Check size={16} strokeWidth={2} className="text-white mt-0.5 shrink-0" />
                    ) : (
                      <X size={16} strokeWidth={2} className="text-on-surface-variant mt-0.5 shrink-0" />
                    )}
                    <span className={`font-body-sm text-body-sm ${
                      feature.included ? "text-on-surface" : "text-on-surface-variant"
                    }`}>
                      {feature.text}
                    </span>
                  </li>
                ))}
              </ul>

              {/* CTA Button */}
              {plan.buttonStyle === "filled" ? (
                <button className="w-full bg-white text-black font-mono-label text-mono-label py-2 px-4 rounded hover:opacity-90 transition-opacity cursor-pointer">
                  Выбрать {plan.name}
                </button>
              ) : (
                <button className="w-full bg-transparent border border-white/[0.1] text-white font-mono-label text-mono-label py-2 px-4 rounded hover:bg-white/[0.05] transition-colors cursor-pointer">
                  Выбрать {plan.name}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Custom Solution */}
        <div className="mt-6 max-w-3xl mx-auto border-t border-white/[0.08] pt-4 text-center">
          <p className="font-body-sm text-body-sm text-[#888888]">
            Нужно индивидуальное решение?{" "}
            <Link className="text-white hover:underline underline-offset-4 decoration-white/30" href="/contacts">
              Свяжитесь с нами
            </Link>.
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
