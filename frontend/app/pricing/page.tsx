"use client";

import { Check } from "lucide-react";
import { TopNavBar } from "@/components/shared/TopNavBar";
import { SiteFooter } from "@/components/shared/SiteFooter";
import { SubscriptionConfigurator } from "@/components/billing/SubscriptionConfigurator";

const included = [
  "50 сообщений в основном чате",
  "3 дорожные карты",
  "2 прогона CustDev",
  "Грантовые заявки добавляются отдельно",
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <TopNavBar />
      <main className="flex-1 w-full max-w-5xl mx-auto px-5 pt-36 pb-24">
        <header className="text-center mb-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/35">Одна подписка — ваши лимиты</p>
          <h1 className="font-display text-5xl sm:text-7xl mt-4 tracking-tight">Соберите свой тариф</h1>
          <p className="mt-5 text-white/50 max-w-2xl mx-auto">Базовая подписка стоит 2 490 ₽ в месяц. Добавьте только те функции, которыми действительно будете пользоваться.</p>
        </header>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          {included.map((text) => (
            <div key={text} className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 flex gap-3 text-sm text-white/65">
              <Check size={17} className="text-emerald-300 shrink-0" /> {text}
            </div>
          ))}
        </div>

        <SubscriptionConfigurator />

        <div className="mt-6 text-center text-xs text-white/30 max-w-2xl mx-auto space-y-2">
          <p>
            Оформляя подписку, вы соглашаетесь на <span className="text-white/45">ежемесячное автопродление</span> и сохранение способа оплаты.
            Списание происходит раз в месяц по выбранной конфигурации. Отменить автопродление и отвязать карту можно в любой момент в профиле.
          </p>
          <p>
            Нажимая «Оформить подписку», вы принимаете{" "}
            <a href="/offer" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white/70">Оферту</a>{" "}и{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white/70">Политику конфиденциальности</a>.
            Условия возврата — в Оферте. Использование cookie описано в{" "}
            <a href="/cookies" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white/70">Политике cookie</a>.
          </p>
          <p className="text-white/25">Самозанятый Фигурняк Егор Сергеевич, ИНН 400700088347.</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
