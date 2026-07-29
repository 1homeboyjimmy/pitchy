from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import Payment, PromoCampaign, PromoCode, PromoRedemption, User
from subscription_service import BASE_CONFIG, calculate_price, normalize_config


PROMO_CONSENT_VERSION = "promo-renewal-v1"


@dataclass(slots=True)
class PromoDecision:
    promo: PromoCode
    campaign: PromoCampaign | None
    original_amount: float
    final_amount: float
    discount_amount: float
    discount_percent: int
    fixed_price: float | None
    target_tier: str | None
    post_promo_action: str
    renewal_config: dict | None
    renewal_amount: float | None
    renewal_notice_days: int | None
    requires_auto_renew_consent: bool
    consent_text: str | None

    def public_dict(self) -> dict:
        return {
            "valid": True,
            "discount_percent": self.discount_percent,
            "fixed_price": self.fixed_price,
            "target_tier": self.target_tier,
            "campaign_name": self.campaign.name if self.campaign else None,
            "post_promo_action": self.post_promo_action,
            "renewal_amount": self.renewal_amount,
            "renewal_notice_days": self.renewal_notice_days,
            "requires_auto_renew_consent": self.requires_auto_renew_consent,
            "consent_text": self.consent_text,
            "consent_version": PROMO_CONSENT_VERSION if self.consent_text else None,
        }

    def payment_context(self, consent: bool) -> dict:
        if not self.campaign:
            return {}
        return {
            "campaign_id": self.campaign.id,
            "campaign_name": self.campaign.name,
            "post_promo_action": self.post_promo_action,
            "renewal_config": self.renewal_config,
            "renewal_amount": self.renewal_amount,
            "renewal_price_policy": self.campaign.renewal_price_policy,
            "renewal_notice_days": self.renewal_notice_days,
            "auto_renew_consent": bool(consent),
            "consent_text": self.consent_text if consent else None,
            "consent_version": PROMO_CONSENT_VERSION if consent else None,
            "consent_at": datetime.utcnow().isoformat() if consent else None,
        }


class PromoValidationError(ValueError):
    pass


async def evaluate_promo(
    db: AsyncSession,
    *,
    code: str,
    original_amount: float,
    user: User | None = None,
    auto_renew_consent: bool = False,
    enforce_consent: bool = False,
    for_update: bool = False,
) -> PromoDecision:
    normalized_code = code.strip().upper()
    query = (
        select(PromoCode)
        .options(selectinload(PromoCode.campaign))
        .where(PromoCode.code == normalized_code)
    )
    if for_update:
        query = query.with_for_update()
    promo = (await db.execute(query)).scalar_one_or_none()
    if promo is None:
        raise PromoValidationError("Промокод не найден")
    if not promo.is_active:
        raise PromoValidationError("Промокод отключён")

    now = datetime.utcnow()
    if promo.expires_at and promo.expires_at <= now:
        raise PromoValidationError("Срок действия промокода истёк")
    if promo.assigned_user_id is not None and user is not None and promo.assigned_user_id != user.id:
        raise PromoValidationError("Промокод предназначен другому пользователю")

    campaign = promo.campaign
    if campaign is None:
        if promo.max_uses is not None and promo.current_uses >= promo.max_uses:
            raise PromoValidationError("Максимальное количество использований исчерпано")
        fixed_price = float(promo.fixed_price) if promo.fixed_price is not None else None
        final_amount = fixed_price if fixed_price is not None else round(
            original_amount * (100 - promo.discount_percent) / 100, 2
        )
        return PromoDecision(
            promo=promo,
            campaign=None,
            original_amount=original_amount,
            final_amount=max(0.0, final_amount),
            discount_amount=max(0.0, round(original_amount - final_amount, 2)),
            discount_percent=promo.discount_percent,
            fixed_price=fixed_price,
            target_tier=promo.target_tier,
            post_promo_action="standard",
            renewal_config=None,
            renewal_amount=None,
            renewal_notice_days=None,
            requires_auto_renew_consent=False,
            consent_text=None,
        )

    if for_update:
        campaign = (await db.execute(
            select(PromoCampaign).where(PromoCampaign.id == campaign.id).with_for_update()
        )).scalar_one()
    if campaign.status != "active":
        raise PromoValidationError("Промокампания сейчас не активна")
    if campaign.starts_at and campaign.starts_at > now:
        raise PromoValidationError("Промокампания ещё не началась")
    if campaign.ends_at and campaign.ends_at <= now:
        raise PromoValidationError("Промокампания завершена")

    counted_filter = or_(
        PromoRedemption.status == "succeeded",
        and_(
            PromoRedemption.status == "reserved",
            PromoRedemption.created_at >= now - timedelta(hours=24),
        ),
    )
    if campaign.max_redemptions is not None:
        campaign_uses = (await db.execute(
            select(func.count(PromoRedemption.id)).where(
                PromoRedemption.campaign_id == campaign.id,
                counted_filter,
            )
        )).scalar() or 0
        if campaign_uses >= campaign.max_redemptions:
            raise PromoValidationError("Лимит активаций промокампании исчерпан")

    if user is not None:
        user_uses = (await db.execute(
            select(func.count(PromoRedemption.id)).where(
                PromoRedemption.campaign_id == campaign.id,
                PromoRedemption.user_id == user.id,
                counted_filter,
            )
        )).scalar() or 0
        if user_uses >= campaign.per_user_limit:
            raise PromoValidationError("Вы уже использовали предложение этой кампании")
        if campaign.first_payment_only:
            has_successful_payment = (await db.execute(
                select(Payment.id).where(
                    Payment.user_id == user.id,
                    Payment.status == "succeeded",
                ).limit(1)
            )).scalar_one_or_none()
            if has_successful_payment:
                raise PromoValidationError("Промокод действует только на первую оплату")

    benefit_type = campaign.benefit_type
    if benefit_type == "fixed_price":
        if campaign.fixed_price is None:
            raise PromoValidationError("В кампании не задана фиксированная цена")
        fixed_price = float(campaign.fixed_price)
        discount_percent = 0
        final_amount = fixed_price
    elif benefit_type == "percent_discount":
        discount_percent = int(campaign.discount_percent or 0)
        if not 1 <= discount_percent <= 100:
            raise PromoValidationError("В кампании некорректно задан размер скидки")
        fixed_price = None
        final_amount = round(original_amount * (100 - discount_percent) / 100, 2)
    else:
        raise PromoValidationError("Тип предложения пока не поддерживается")

    post_action = campaign.post_promo_action
    renewal_config: dict | None = None
    renewal_amount: float | None = None
    requires_consent = post_action == "renew_base"
    consent_text: str | None = None
    if post_action in ("renew_base", "offer"):
        renewal_config = normalize_config(campaign.renewal_config or BASE_CONFIG)
        renewal_amount = (
            float(campaign.renewal_fixed_price)
            if campaign.renewal_price_policy == "fixed" and campaign.renewal_fixed_price is not None
            else float(calculate_price(renewal_config))
        )
    if requires_consent:
        consent_text = (
            f"После окончания промопериода подписка автоматически продлится "
            f"за {renewal_amount:,.0f} ₽ в месяц. Автопродление можно отключить в аккаунте."
        ).replace(",", " ")
        if enforce_consent and not auto_renew_consent:
            raise PromoValidationError("Для этого промокода необходимо согласие на автопродление")

    final_amount = max(0.0, round(final_amount, 2))
    return PromoDecision(
        promo=promo,
        campaign=campaign,
        original_amount=original_amount,
        final_amount=final_amount,
        discount_amount=max(0.0, round(original_amount - final_amount, 2)),
        discount_percent=discount_percent,
        fixed_price=fixed_price,
        target_tier=campaign.target_tier or promo.target_tier,
        post_promo_action=post_action,
        renewal_config=renewal_config,
        renewal_amount=renewal_amount,
        renewal_notice_days=campaign.renewal_notice_days,
        requires_auto_renew_consent=requires_consent,
        consent_text=consent_text,
    )


async def reserve_redemption(
    db: AsyncSession,
    *,
    decision: PromoDecision,
    user_id: int,
    payment_id: int,
    auto_renew_consent: bool,
) -> PromoRedemption:
    redemption = PromoRedemption(
        campaign_id=decision.campaign.id if decision.campaign else None,
        promo_code_id=decision.promo.id,
        user_id=user_id,
        payment_id=payment_id,
        status="reserved",
        original_amount=Decimal(str(decision.original_amount)),
        discount_amount=Decimal(str(decision.discount_amount)),
        final_amount=Decimal(str(decision.final_amount)),
        auto_renew_consent=bool(auto_renew_consent),
        consent_text=decision.consent_text if auto_renew_consent else None,
        consent_version=PROMO_CONSENT_VERSION if auto_renew_consent else None,
        consent_at=datetime.utcnow() if auto_renew_consent else None,
    )
    db.add(redemption)
    return redemption
