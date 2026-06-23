"use client";

import { useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/auth";
import {
  ConfigurableSubscription,
  SubscriptionConfig,
  createConfigurableSubscription,
  getConfigurableSubscription,
  updateConfigurableSubscription,
} from "@/lib/api";

const BASE: SubscriptionConfig = { messages: 50, roadmaps: 3, custdev: 2, grants: 0 };
const PRICE: SubscriptionConfig = { messages: 7, roadmaps: 150, custdev: 750, grants: 1000 };
const META = [
  { key: "messages" as const, label: "Сообщения в основном чате", step: 10, suffix: "сообщений" },
  { key: "roadmaps" as const, label: "Дорожные карты", step: 1, suffix: "карт" },
  { key: "custdev" as const, label: "Прогоны CustDev", step: 1, suffix: "прогонов" },
  { key: "grants" as const, label: "Генерации грантовых заявок", step: 1, suffix: "заявок" },
];

const totalPrice = (c: SubscriptionConfig) => 2490 + META.reduce(
  (sum, item) => sum + (c[item.key] - BASE[item.key]) * PRICE[item.key], 0
);

export function SubscriptionConfigurator({ account = false }: { account?: boolean }) {
  const router = useRouter();
  const [config, setConfig] = useState<SubscriptionConfig>(BASE);
  const [subscription, setSubscription] = useState<ConfigurableSubscription | null>(null);
  const [loading, setLoading] = useState(account);
  const [saving, setSaving] = useState(false);
  const [autoRenew, setAutoRenew] = useState(true);
  const [acceptedRecurring, setAcceptedRecurring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const price = useMemo(() => totalPrice(config), [config]);

  useEffect(() => {
    if (!account) return;
    const token = getToken();
    if (!token) return setLoading(false);
    getConfigurableSubscription(token)
      .then((data) => {
        setSubscription(data);
        setAutoRenew(data.auto_renew ?? true);
        if (data.mode === "custom" && data.next_config) setConfig(data.next_config);
      })
      .finally(() => setLoading(false));
  }, [account]);

  const change = (key: keyof SubscriptionConfig, direction: -1 | 1) => {
    const step = key === "messages" ? 10 : 1;
    setConfig((current) => ({
      ...current,
      [key]: Math.max(BASE[key], current[key] + step * direction),
    }));
    setMessage(null);
  };

  const submit = async () => {
    const token = getToken();
    if (!token) return router.push("/login?next=/pricing");
    setSaving(true);
    setMessage(null);
    try {
      if (account && subscription?.mode === "custom") {
        const updated = await updateConfigurableSubscription(config, autoRenew, token);
        setSubscription(updated);
        setMessage("Конфигурация следующего месяца сохранена");
      } else {
        const result = await createConfigurableSubscription(config, token);
        window.location.href = result.confirmation_url;
      }
    } catch (error) {
      console.error(error);
      setMessage("Не удалось сохранить подписку. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-44 rounded-3xl border border-white/10 bg-white/[0.02] animate-pulse" />;

  if (account && subscription?.mode === "legacy") {
    return (
      <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 sm:p-8">
        <p className="text-sm text-white/50">Текущий тариф <span className="text-white uppercase">{subscription.legacy_tier}</span> сохранён до окончания срока.</p>
        <p className="mt-2 text-sm text-white/35">После его завершения можно оформить новую настраиваемую подписку.</p>
      </section>
    );
  }

  const editable = !account || subscription?.mode === "custom";
  return (
    <section className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.015] p-6 sm:p-9">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-8">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">{account ? "Следующий платёж" : "Базовая подписка"}</p>
          <h2 className="mt-2 font-display text-3xl sm:text-5xl text-white">{price.toLocaleString("ru-RU")} ₽ <span className="text-lg text-white/35">/ месяц</span></h2>
          <p className="mt-3 text-sm text-white/45">Остатки сгорают при продлении. Выбранная конфигурация повторяется автоматически.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
          <input
            type="checkbox"
            checked={account ? autoRenew : acceptedRecurring}
            onChange={(e) => account ? setAutoRenew(e.target.checked) : setAcceptedRecurring(e.target.checked)}
            className="accent-white"
          />
          {account ? "Автопродление на следующий месяц" : "Согласен на ежемесячное автопродление и сохранение способа оплаты"}
        </label>
      </div>

      {account && subscription?.mode === "custom" && subscription.remaining && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-7">
          {META.map((item) => <div key={item.key} className="rounded-2xl bg-black/30 border border-white/5 p-4"><div className="text-2xl text-white">{subscription.remaining![item.key]}</div><div className="mt-1 text-[11px] text-white/35">осталось: {item.label.toLowerCase()}</div></div>)}
        </div>
      )}

      <div className="space-y-3">
        {META.map((item) => {
          const included = BASE[item.key];
          const extra = config[item.key] - included;
          return (
            <div key={item.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-white/5 bg-black/20 p-4 sm:px-5">
              <div>
                <div className="text-sm text-white/85">{item.label}</div>
                <div className="mt-1 text-xs text-white/35">В базе: {included}. Дополнительно: {extra} × {PRICE[item.key]} ₽</div>
              </div>
              <div className="flex items-center gap-4 self-end sm:self-auto">
                <button disabled={!editable || config[item.key] <= included} onClick={() => change(item.key, -1)} className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center disabled:opacity-20 hover:bg-white/10"><Minus size={15} /></button>
                <span className="w-14 text-center text-xl tabular-nums">{config[item.key]}</span>
                <button disabled={!editable} onClick={() => change(item.key, 1)} className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center disabled:opacity-20 hover:bg-white/10"><Plus size={15} /></button>
              </div>
            </div>
          );
        })}
      </div>

      {message && <p className="mt-5 text-sm text-white/60">{message}</p>}
      {editable && <button onClick={submit} disabled={saving || (!account && !acceptedRecurring)} className="mt-7 w-full rounded-full bg-white text-black py-4 font-semibold disabled:opacity-50 hover:scale-[1.01] transition-transform">{saving ? "Сохраняем…" : account ? "Сохранить на следующий месяц" : "Оформить подписку"}</button>}
      {account && subscription?.mode === "none" && <a href="/pricing" className="mt-7 block w-full rounded-full bg-white text-black py-4 font-semibold text-center">Настроить подписку</a>}
    </section>
  );
}
