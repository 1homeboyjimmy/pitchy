"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Tag,
} from "react-feather";
import { getToken } from "@/lib/auth";
import { notifyError, notifySuccess } from "@/lib/ui";

type CampaignCode = {
  id: number;
  code: string;
  is_active: boolean;
  current_uses: number;
  max_uses: number | null;
  expires_at: string | null;
};

type PromoCampaign = {
  id: number;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused" | "ended";
  benefit_type: "percent_discount" | "fixed_price";
  discount_percent: number | null;
  fixed_price: number | null;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  per_user_limit: number;
  first_payment_only: boolean;
  code_mode: "shared" | "bulk";
  post_promo_action: "none" | "offer" | "renew_base";
  renewal_price_policy: "current" | "fixed";
  renewal_fixed_price: number | null;
  renewal_notice_days: number;
  codes_count: number;
  redemptions_count: number;
  reserved_count: number;
  revenue: number;
  discount_total: number;
  codes: CampaignCode[];
};

type CampaignDraft = {
  name: string;
  description: string;
  status: "draft" | "active";
  benefit_type: "percent_discount" | "fixed_price";
  discount_percent: number;
  fixed_price: string;
  code_mode: "shared" | "bulk";
  code: string;
  code_prefix: string;
  generate_count: number;
  starts_at: string;
  ends_at: string;
  max_redemptions: string;
  per_user_limit: number;
  first_payment_only: boolean;
  post_promo_action: "none" | "offer" | "renew_base";
  renewal_price_policy: "current" | "fixed";
  renewal_fixed_price: string;
  renewal_notice_days: number;
};

const INITIAL_DRAFT: CampaignDraft = {
  name: "",
  description: "",
  status: "active",
  benefit_type: "percent_discount",
  discount_percent: 20,
  fixed_price: "",
  code_mode: "shared",
  code: "",
  code_prefix: "PROMO",
  generate_count: 100,
  starts_at: "",
  ends_at: "",
  max_redemptions: "",
  per_user_limit: 1,
  first_payment_only: false,
  post_promo_action: "none",
  renewal_price_policy: "current",
  renewal_fixed_price: "",
  renewal_notice_days: 3,
};

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-code text-[12px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-white/30";
const labelClass = "mb-2 block font-mono-label text-[9px] uppercase tracking-[0.16em] text-white/40";

function localDate(value: string | null) {
  if (!value) return "Без ограничения";
  return new Date(value).toLocaleDateString("ru-RU");
}

function statusLabel(status: PromoCampaign["status"]) {
  return {
    draft: "Черновик",
    active: "Активна",
    paused: "На паузе",
    ended: "Завершена",
  }[status];
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("Сессия истекла");
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail || "Не удалось выполнить операцию");
  return body as T;
}

export function PromoCampaignsPanel() {
  const [campaigns, setCampaigns] = useState<PromoCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>(INITIAL_DRAFT);

  const renewalPriceHint = useMemo(() => {
    if (draft.renewal_price_policy === "fixed" && draft.renewal_fixed_price) {
      return `${Number(draft.renewal_fixed_price).toLocaleString("ru-RU")} ₽/мес.`;
    }
    return "актуальная цена базового тарифа";
  }, [draft.renewal_fixed_price, draft.renewal_price_policy]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCampaigns(await adminRequest<PromoCampaign[]>("/admin/promo-campaigns"));
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Не удалось загрузить кампании");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createCampaign = async () => {
    if (!draft.name.trim()) return notifyError("Укажите название кампании");
    if (draft.code_mode === "shared" && !draft.code.trim()) {
      return notifyError("Укажите общий промокод");
    }
    if (draft.benefit_type === "fixed_price" && draft.fixed_price === "") {
      return notifyError("Укажите фиксированную цену по промокоду");
    }
    if (
      draft.post_promo_action === "renew_base"
      && draft.renewal_price_policy === "fixed"
      && draft.renewal_fixed_price === ""
    ) {
      return notifyError("Укажите фиксированную цену продления");
    }
    setSaving(true);
    try {
      const created = await adminRequest<PromoCampaign>("/admin/promo-campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          status: draft.status,
          benefit_type: draft.benefit_type,
          discount_percent: draft.benefit_type === "percent_discount" ? draft.discount_percent : null,
          fixed_price: draft.benefit_type === "fixed_price" ? Number(draft.fixed_price) : null,
          code_mode: draft.code_mode,
          code: draft.code_mode === "shared" ? draft.code.trim().toUpperCase() : null,
          code_prefix: draft.code_mode === "bulk" ? draft.code_prefix.trim().toUpperCase() : null,
          generate_count: draft.code_mode === "bulk" ? draft.generate_count : 1,
          starts_at: draft.starts_at ? new Date(draft.starts_at).toISOString() : null,
          ends_at: draft.ends_at ? new Date(draft.ends_at).toISOString() : null,
          max_redemptions: draft.max_redemptions ? Number(draft.max_redemptions) : null,
          per_user_limit: draft.per_user_limit,
          first_payment_only: draft.first_payment_only,
          post_promo_action: draft.post_promo_action,
          renewal_config:
            draft.post_promo_action === "none"
              ? null
              : { messages: 50, roadmaps: 3, custdev: 2, grants: 0 },
          renewal_price_policy: draft.renewal_price_policy,
          renewal_fixed_price:
            draft.renewal_price_policy === "fixed" ? Number(draft.renewal_fixed_price) : null,
          renewal_notice_days: draft.renewal_notice_days,
        }),
      });
      setCampaigns((current) => [created, ...current]);
      setDraft(INITIAL_DRAFT);
      setFormOpen(false);
      notifySuccess("Промокампания создана");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Не удалось создать кампанию");
    } finally {
      setSaving(false);
    }
  };

  const setCampaignStatus = async (campaign: PromoCampaign) => {
    const nextStatus = campaign.status === "active" ? "paused" : "active";
    try {
      const updated = await adminRequest<PromoCampaign>(`/admin/promo-campaigns/${campaign.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      setCampaigns((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      notifySuccess(nextStatus === "active" ? "Кампания запущена" : "Кампания приостановлена");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Не удалось изменить статус");
    }
  };

  const generateMore = async (campaign: PromoCampaign) => {
    try {
      const updated = await adminRequest<PromoCampaign>(`/admin/promo-campaigns/${campaign.id}/codes`, {
        method: "POST",
        body: JSON.stringify({ count: 100 }),
      });
      setCampaigns((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      notifySuccess("Создано ещё 100 уникальных кодов");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Не удалось создать коды");
    }
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    notifySuccess(`Код ${code} скопирован`);
  };

  if (loading) {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-2xl border border-white/10 bg-[#111]">
        <Loader className="h-6 w-6 animate-spin text-white/50" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#111] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="font-mono-label text-[9px] uppercase tracking-[0.18em] text-white/35">Управление предложениями</p>
          <h3 className="mt-2 font-display text-2xl text-white">Промокампании</h3>
          <p className="mt-2 max-w-2xl text-sm text-white/40">
            Создавайте общий код или пул уникальных кодов и заранее задавайте, что произойдёт после промопериода.
          </p>
        </div>
        <button
          onClick={() => setFormOpen((value) => !value)}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white px-6 py-3 font-mono-label text-[10px] font-bold uppercase tracking-wider text-black transition-transform hover:scale-[1.02]"
        >
          {formOpen ? <ChevronUp size={15} /> : <Plus size={15} />}
          {formOpen ? "Скрыть форму" : "Новая кампания"}
        </button>
      </div>

      {formOpen && (
        <div className="space-y-7 rounded-2xl border border-white/10 bg-[#111] p-5 sm:p-7">
          <div>
            <h4 className="font-mono-label text-[11px] uppercase tracking-widest text-white">1. Предложение</h4>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label>
                <span className={labelClass}>Название кампании</span>
                <input className={fieldClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Например, Возврат пользователей — август" />
              </label>
              <label>
                <span className={labelClass}>Запуск</span>
                <select className={fieldClass} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as CampaignDraft["status"] })}>
                  <option value="active">Запустить сразу</option>
                  <option value="draft">Сохранить черновиком</option>
                </select>
              </label>
              <label className="md:col-span-2">
                <span className={labelClass}>Описание для команды</span>
                <textarea className={`${fieldClass} min-h-20 resize-y`} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Цель, канал распространения, партнёр или сегмент" />
              </label>
              <label>
                <span className={labelClass}>Тип предложения</span>
                <select className={fieldClass} value={draft.benefit_type} onChange={(e) => setDraft({ ...draft, benefit_type: e.target.value as CampaignDraft["benefit_type"] })}>
                  <option value="percent_discount">Скидка в процентах</option>
                  <option value="fixed_price">Фиксированная цена</option>
                </select>
              </label>
              {draft.benefit_type === "percent_discount" ? (
                <label>
                  <span className={labelClass}>Скидка, %</span>
                  <input type="number" min={1} max={100} className={fieldClass} value={draft.discount_percent} onChange={(e) => setDraft({ ...draft, discount_percent: Number(e.target.value) })} />
                </label>
              ) : (
                <label>
                  <span className={labelClass}>Цена по промокоду, ₽</span>
                  <input type="number" min={0} className={fieldClass} value={draft.fixed_price} onChange={(e) => setDraft({ ...draft, fixed_price: e.target.value })} placeholder="1" />
                </label>
              )}
            </div>
          </div>

          <div className="border-t border-white/5 pt-7">
            <h4 className="font-mono-label text-[11px] uppercase tracking-widest text-white">2. Выпуск кодов</h4>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label>
                <span className={labelClass}>Режим</span>
                <select className={fieldClass} value={draft.code_mode} onChange={(e) => setDraft({ ...draft, code_mode: e.target.value as CampaignDraft["code_mode"] })}>
                  <option value="shared">Один общий код</option>
                  <option value="bulk">Пул уникальных кодов</option>
                </select>
              </label>
              {draft.code_mode === "shared" ? (
                <label className="md:col-span-2">
                  <span className={labelClass}>Промокод</span>
                  <input className={`${fieldClass} uppercase`} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="WELCOME20" />
                </label>
              ) : (
                <>
                  <label>
                    <span className={labelClass}>Префикс</span>
                    <input className={`${fieldClass} uppercase`} value={draft.code_prefix} onChange={(e) => setDraft({ ...draft, code_prefix: e.target.value })} placeholder="PARTNER" />
                  </label>
                  <label>
                    <span className={labelClass}>Количество</span>
                    <input type="number" min={1} max={1000} className={fieldClass} value={draft.generate_count} onChange={(e) => setDraft({ ...draft, generate_count: Number(e.target.value) })} />
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="border-t border-white/5 pt-7">
            <h4 className="font-mono-label text-[11px] uppercase tracking-widest text-white">3. Период и ограничения</h4>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label>
                <span className={labelClass}>Начало</span>
                <input type="datetime-local" className={fieldClass} value={draft.starts_at} onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })} />
              </label>
              <label>
                <span className={labelClass}>Окончание</span>
                <input type="datetime-local" className={fieldClass} value={draft.ends_at} onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })} />
              </label>
              <label>
                <span className={labelClass}>Общий лимит</span>
                <input type="number" min={1} className={fieldClass} value={draft.max_redemptions} onChange={(e) => setDraft({ ...draft, max_redemptions: e.target.value })} placeholder="Без ограничений" />
              </label>
              <label>
                <span className={labelClass}>На пользователя</span>
                <input type="number" min={1} max={100} className={fieldClass} value={draft.per_user_limit} onChange={(e) => setDraft({ ...draft, per_user_limit: Number(e.target.value) })} />
              </label>
            </div>
            <label className="mt-4 flex items-center gap-3 text-sm text-white/55">
              <input type="checkbox" checked={draft.first_payment_only} onChange={(e) => setDraft({ ...draft, first_payment_only: e.target.checked })} className="accent-white" />
              Только для первой успешной оплаты пользователя
            </label>
          </div>

          <div className="border-t border-white/5 pt-7">
            <h4 className="font-mono-label text-[11px] uppercase tracking-widest text-white">4. После окончания промо</h4>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label>
                <span className={labelClass}>Сценарий</span>
                <select className={fieldClass} value={draft.post_promo_action} onChange={(e) => setDraft({ ...draft, post_promo_action: e.target.value as CampaignDraft["post_promo_action"] })}>
                  <option value="none">Отключить автопродление</option>
                  <option value="offer">Предложить продление отдельно</option>
                  <option value="renew_base">Автоматически продлить базовый тариф</option>
                </select>
              </label>
              {draft.post_promo_action !== "none" && (
                <label>
                  <span className={labelClass}>Предупредить за, дней</span>
                  <input type="number" min={0} max={30} className={fieldClass} value={draft.renewal_notice_days} onChange={(e) => setDraft({ ...draft, renewal_notice_days: Number(e.target.value) })} />
                </label>
              )}
              {draft.post_promo_action === "renew_base" && (
                <>
                  <label>
                    <span className={labelClass}>Цена продления</span>
                    <select className={fieldClass} value={draft.renewal_price_policy} onChange={(e) => setDraft({ ...draft, renewal_price_policy: e.target.value as CampaignDraft["renewal_price_policy"] })}>
                      <option value="current">Актуальная цена базового тарифа</option>
                      <option value="fixed">Зафиксировать цену</option>
                    </select>
                  </label>
                  {draft.renewal_price_policy === "fixed" && (
                    <label>
                      <span className={labelClass}>Фиксированная цена, ₽/мес.</span>
                      <input type="number" min={0} className={fieldClass} value={draft.renewal_fixed_price} onChange={(e) => setDraft({ ...draft, renewal_fixed_price: e.target.value })} placeholder="2490" />
                    </label>
                  )}
                </>
              )}
            </div>
            {draft.post_promo_action === "renew_base" && (
              <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-4 text-xs leading-relaxed text-amber-100/60">
                Пользователь увидит явное согласие: после промо базовый тариф продлится автоматически, цена — {renewalPriceHint}. Без установленной галочки платёж не будет создан.
              </div>
            )}
          </div>

          <button
            onClick={createCampaign}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-4 font-mono-label text-[10px] font-bold uppercase tracking-wider text-black disabled:opacity-50"
          >
            {saving ? <Loader size={15} className="animate-spin" /> : <Check size={15} />}
            {saving ? "Создаём кампанию" : "Создать кампанию"}
          </button>
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 px-6 py-16 text-center">
          <Tag className="mx-auto h-7 w-7 text-white/20" />
          <p className="mt-4 text-sm text-white/45">Промокампаний пока нет</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => {
            const expanded = expandedId === campaign.id;
            const mainCode = campaign.codes[0]?.code;
            return (
              <article key={campaign.id} className="overflow-hidden rounded-2xl border border-white/10 bg-[#111]">
                <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(100px,.5fr))_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 font-mono-label text-[8px] uppercase tracking-wider ${
                        campaign.status === "active"
                          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                          : "border-white/10 bg-white/5 text-white/40"
                      }`}>
                        {statusLabel(campaign.status)}
                      </span>
                      <span className="font-code text-[10px] text-white/30">
                        {campaign.benefit_type === "percent_discount"
                          ? `−${campaign.discount_percent}%`
                          : `${campaign.fixed_price?.toLocaleString("ru-RU")} ₽`}
                      </span>
                    </div>
                    <h4 className="mt-3 truncate text-lg font-semibold text-white">{campaign.name}</h4>
                    <p className="mt-1 text-xs text-white/35">
                      {campaign.code_mode === "shared" ? mainCode || "Код не создан" : `${campaign.codes_count} уникальных кодов`}
                      {" · "}
                      до {localDate(campaign.ends_at)}
                    </p>
                  </div>
                  <div>
                    <div className="font-mono text-xl text-white">{campaign.redemptions_count}</div>
                    <div className="mt-1 text-[10px] text-white/30">активаций</div>
                  </div>
                  <div>
                    <div className="font-mono text-xl text-white">{campaign.revenue.toLocaleString("ru-RU")} ₽</div>
                    <div className="mt-1 text-[10px] text-white/30">выручка</div>
                  </div>
                  <div>
                    <div className="font-mono text-xl text-white">
                      {campaign.max_redemptions ? `${campaign.redemptions_count}/${campaign.max_redemptions}` : "∞"}
                    </div>
                    <div className="mt-1 text-[10px] text-white/30">лимит</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCampaignStatus(campaign)} className="rounded-full border border-white/10 p-2.5 text-white/50 hover:bg-white/5 hover:text-white" title={campaign.status === "active" ? "Поставить на паузу" : "Запустить"}>
                      {campaign.status === "active" ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                    <button onClick={() => setExpandedId(expanded ? null : campaign.id)} className="rounded-full border border-white/10 p-2.5 text-white/50 hover:bg-white/5 hover:text-white" title="Подробнее">
                      {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-white/5 bg-black/20 p-5 sm:p-6">
                    <div className="grid gap-5 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      <div><span className="text-white/30">На пользователя</span><div className="mt-1 text-white/70">{campaign.per_user_limit}</div></div>
                      <div><span className="text-white/30">Первая оплата</span><div className="mt-1 text-white/70">{campaign.first_payment_only ? "Да" : "Нет"}</div></div>
                      <div><span className="text-white/30">После промо</span><div className="mt-1 text-white/70">{campaign.post_promo_action === "renew_base" ? "Автопродление базы" : campaign.post_promo_action === "offer" ? "Предложить продление" : "Без продления"}</div></div>
                      <div><span className="text-white/30">Зарезервировано</span><div className="mt-1 text-white/70">{campaign.reserved_count}</div></div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      {campaign.codes.slice(0, 12).map((code) => (
                        <button key={code.id} onClick={() => copyCode(code.code)} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-code text-[10px] text-white/60 hover:text-white">
                          {code.code}
                          <Copy size={11} />
                        </button>
                      ))}
                    </div>
                    {campaign.code_mode === "bulk" && (
                      <button onClick={() => generateMore(campaign)} className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 font-mono-label text-[9px] uppercase tracking-wider text-white/50 hover:bg-white/5 hover:text-white">
                        <RefreshCw size={12} />
                        Ещё 100 кодов
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
