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
  validatePromoCode,
  describeApiError,
  type PromoValidation,
} from "@/lib/api";
import { trackMetrikaGoal } from "@/components/analytics/YandexMetrika";

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
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promoApplied, setPromoApplied] = useState<string | null>(null);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [fixedPrice, setFixedPrice] = useState<number | null>(null);
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [promoDetails, setPromoDetails] = useState<PromoValidation | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);
  const price = useMemo(() => totalPrice(config), [config]);
  const finalPrice = useMemo(() => {
    if (fixedPrice !== null) return fixedPrice;
    if (discountPercent > 0) return Math.round(price * (100 - discountPercent) / 100);
    return price;
  }, [price, discountPercent, fixedPrice]);
  const displayedPrice = account && subscription?.next_price != null
    ? subscription.next_price
    : finalPrice;

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setCheckingPromo(true);
    setPromoMsg(null);
    try {
      const result = await validatePromoCode(code, price);
      if (!result.valid) {
        setPromoApplied(null);
        setDiscountPercent(0);
        setFixedPrice(null);
        setPromoDetails(null);
        setPromoMsg(result.detail || "Промокод недействителен");
        return;
      }
      setPromoApplied(code);
      setDiscountPercent(result.discount_percent || 0);
      setFixedPrice(result.fixed_price ?? null);
      setPromoDetails(result);
      setAcceptedRecurring(false);
      setPromoMsg(
        result.fixed_price != null
          ? `Промокод применён: фиксированная цена ${result.fixed_price.toLocaleString("ru-RU")} ₽`
          : `Промокод применён: −${result.discount_percent}%`
      );
    } catch {
      setPromoMsg("Не удалось проверить промокод. Попробуйте ещё раз.");
    } finally {
      setCheckingPromo(false);
    }
  };

  const clearPromo = () => {
    setPromoApplied(null);
    setDiscountPercent(0);
    setFixedPrice(null);
    setPromoInput("");
    setPromoMsg(null);
    setPromoDetails(null);
    setAcceptedRecurring(false);
  };

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
        const result = await createConfigurableSubscription(
          config,
          token,
          promoApplied,
          promoApplied ? acceptedRecurring : true,
        );
        trackMetrikaGoal("checkout_started", {
          price_rub: finalPrice,
          has_promo: Boolean(promoApplied),
          plan_type: "custom",
        });
        window.location.href = result.confirmation_url;
      }
    } catch (error) {
      console.error(error);
      setMessage(describeApiError(error, "Не удалось сохранить подписку. Попробуйте ещё раз."));
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

  if (account && subscription?.mode !== "custom") {
    return (
      <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 sm:p-8 text-center">
        <p className="text-sm text-white/55">У вас нет активной подписки.</p>
        <p className="mt-2 text-sm text-white/35">Оформите подписку, чтобы получить доступ к лимитам чата, дорожным картам, CustDev и грантам.</p>
        <a href="/pricing" className="mt-5 inline-block rounded-full bg-white text-black px-7 py-3 font-semibold">Оформить подписку</a>
      </section>
    );
  }

  const editable = !account || subscription?.mode === "custom";
  return (
    <section className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.015] p-6 sm:p-9">
      <div className="mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">{account ? "Следующий платёж" : "Базовая подписка"}</p>
        <h2 className="mt-2 font-display text-3xl sm:text-5xl text-white">
          {displayedPrice.toLocaleString("ru-RU")} ₽ <span className="text-lg text-white/35">/ месяц</span>
          {!account && promoApplied && finalPrice !== price && (
            <span className="ml-3 text-lg text-white/35 line-through">{price.toLocaleString("ru-RU")} ₽</span>
          )}
        </h2>
        {!account && promoApplied && (
          <div className="mt-2 space-y-1">
            <p className="text-xs text-emerald-300">
              Промокод {promoApplied} применён{discountPercent > 0 ? ` · −${discountPercent}%` : ""}
            </p>
            {promoDetails?.campaign_name && (
              <p className="text-[11px] text-white/35">Кампания: {promoDetails.campaign_name}</p>
            )}
            {promoDetails?.post_promo_action === "renew_base" && promoDetails.renewal_amount != null && (
              <p className="text-[11px] text-amber-200/70">
                После промо — базовый тариф за {promoDetails.renewal_amount.toLocaleString("ru-RU")} ₽/месяц
              </p>
            )}
            {promoDetails?.post_promo_action === "none" && (
              <p className="text-[11px] text-white/35">После промо автопродление не выполняется</p>
            )}
          </div>
        )}
        <p className="mt-3 text-sm text-white/45">
          Остатки сгорают при продлении.
          {account && subscription?.promo_post_action && subscription.promo_post_action !== "renew_base"
            ? " Автопродление для промопериода отключено."
            : " Выбранная конфигурация повторяется автоматически."}
        </p>
        {account && subscription?.promo_ends_at && (
          <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] p-4 text-xs leading-relaxed text-amber-100/65">
            <p>
              Промопериод действует до{" "}
              {new Date(subscription.promo_ends_at).toLocaleDateString("ru-RU")}.
            </p>
            <p className="mt-1">
              {subscription.promo_post_action === "renew_base" && subscription.auto_renew
                ? `Затем базовый тариф продлится автоматически за ${displayedPrice.toLocaleString("ru-RU")} ₽/месяц.`
                : subscription.promo_post_action === "offer"
                  ? "После завершения промо мы предложим продление отдельно, без автоматического списания."
                  : "После завершения промо автоматического списания не будет."}
            </p>
          </div>
        )}
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

      {!account && (
        <div className="mt-6">
          {!promoOpen && !promoApplied && (
            <button onClick={() => setPromoOpen(true)} className="text-xs text-white/45 underline underline-offset-2 hover:text-white/70">У меня есть промокод</button>
          )}
          {(promoOpen || promoApplied) && (
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <input
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyPromo()}
                disabled={!!promoApplied}
                placeholder="Промокод"
                className="flex-1 rounded-full border border-white/15 bg-black/30 px-5 py-3 text-sm uppercase tracking-wider placeholder:text-white/25 placeholder:normal-case placeholder:tracking-normal focus:border-white/40 outline-none disabled:opacity-60"
              />
              {promoApplied ? (
                <button onClick={clearPromo} className="rounded-full border border-white/15 px-6 py-3 text-sm hover:bg-white/10">Убрать</button>
              ) : (
                <button onClick={applyPromo} disabled={checkingPromo || !promoInput.trim()} className="rounded-full border border-white/15 px-6 py-3 text-sm hover:bg-white/10 disabled:opacity-40">{checkingPromo ? "Проверяем…" : "Применить"}</button>
              )}
            </div>
          )}
          {promoMsg && <p className={`mt-2 text-xs ${promoApplied ? "text-emerald-300" : "text-white/50"}`}>{promoMsg}</p>}
          <p className="mt-2 text-[11px] text-white/25">Промокод применяется ко всей сумме подписки, включая выбранные дополнительные функции.</p>
        </div>
      )}

      <label className="mt-7 flex items-start gap-3 text-sm text-white/60 cursor-pointer">
        <input
          type="checkbox"
          checked={account ? autoRenew : acceptedRecurring}
          onChange={(e) => account ? setAutoRenew(e.target.checked) : setAcceptedRecurring(e.target.checked)}
          className="accent-white mt-1 shrink-0"
        />
        {account ? (
          <span>Автопродление на следующий месяц</span>
        ) : promoApplied && promoDetails?.post_promo_action === "renew_base" ? (
          <span className="leading-relaxed">
            {promoDetails.consent_text || "Согласен на автопродление после окончания промопериода."}{" "}
            Принимаю{" "}
            <a href="/offer" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="underline underline-offset-2 hover:text-white">Оферту</a>.
          </span>
        ) : promoApplied && promoDetails?.post_promo_action === "offer" ? (
          <span className="leading-relaxed">
            Согласен с условиями промооплаты. После окончания промо автосписания не будет — мы предложим продлить базовый тариф отдельно.
          </span>
        ) : promoApplied && promoDetails?.post_promo_action === "none" ? (
          <span className="leading-relaxed">
            Согласен с условиями разовой промооплаты. После окончания промо автопродление будет отключено.
          </span>
        ) : (
          <span className="leading-relaxed">
            Согласен на ежемесячное автопродление и сохранение способа оплаты, принимаю{" "}
            <a href="/offer" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="underline underline-offset-2 hover:text-white">Оферту</a>{" "}и{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="underline underline-offset-2 hover:text-white">Политику конфиденциальности</a>
          </span>
        )}
      </label>

      {message && <p className="mt-5 text-sm text-white/60">{message}</p>}
      {editable && <button onClick={submit} disabled={saving || (!account && !acceptedRecurring)} className="mt-5 w-full rounded-full bg-white text-black py-4 font-semibold disabled:opacity-50 hover:scale-[1.01] transition-transform">{saving ? "Сохраняем…" : account ? "Сохранить на следующий месяц" : `Оформить подписку${!account ? ` · ${finalPrice.toLocaleString("ru-RU")} ₽` : ""}`}</button>}
      {account && subscription?.mode === "none" && <a href="/pricing" className="mt-7 block w-full rounded-full bg-white text-black py-4 font-semibold text-center">Настроить подписку</a>}
    </section>
  );
}
