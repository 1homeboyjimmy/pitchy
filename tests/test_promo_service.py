from datetime import datetime, timedelta

import pytest

from db_async import AsyncSessionLocal
from models import Payment, PromoCampaign, PromoCode, User
from promo_service import PromoValidationError, evaluate_promo, reserve_redemption


@pytest.mark.asyncio
async def test_campaign_discount_and_base_renewal_consent():
    async with AsyncSessionLocal() as db:
        user = User(email="promo-renew@example.com", name="Promo User")
        campaign = PromoCampaign(
            name="Welcome renewal",
            status="active",
            benefit_type="percent_discount",
            discount_percent=20,
            per_user_limit=1,
            code_mode="shared",
            post_promo_action="renew_base",
            renewal_config={"messages": 50, "roadmaps": 3, "custdev": 2, "grants": 0},
            renewal_price_policy="current",
            renewal_notice_days=3,
            ends_at=datetime.utcnow() + timedelta(days=30),
        )
        db.add_all([user, campaign])
        await db.flush()
        promo = PromoCode(
            code="WELCOME-RENEW-TEST",
            campaign_id=campaign.id,
            discount_percent=20,
            is_active=True,
        )
        db.add(promo)
        await db.commit()

        with pytest.raises(PromoValidationError, match="согласие"):
            await evaluate_promo(
                db,
                code=promo.code,
                original_amount=2490,
                user=user,
                enforce_consent=True,
                auto_renew_consent=False,
            )

        decision = await evaluate_promo(
            db,
            code=promo.code,
            original_amount=2490,
            user=user,
            enforce_consent=True,
            auto_renew_consent=True,
        )
        assert decision.final_amount == 1992
        assert decision.renewal_amount == 2490
        assert decision.requires_auto_renew_consent is True
        assert "автоматически продлится" in (decision.consent_text or "")


@pytest.mark.asyncio
async def test_reserved_redemption_enforces_per_user_limit():
    async with AsyncSessionLocal() as db:
        user = User(email="promo-limit@example.com", name="Promo Limit")
        campaign = PromoCampaign(
            name="One per user",
            status="active",
            benefit_type="fixed_price",
            fixed_price=1,
            per_user_limit=1,
            code_mode="shared",
            post_promo_action="none",
        )
        db.add_all([user, campaign])
        await db.flush()
        promo = PromoCode(
            code="ONE-PER-USER-TEST",
            campaign_id=campaign.id,
            discount_percent=0,
            fixed_price=1,
            is_active=True,
        )
        db.add(promo)
        await db.flush()
        payment = Payment(
            user_id=user.id,
            yookassa_payment_id="promo-limit-payment",
            amount=1,
            currency="RUB",
            status="pending",
            tier="custom",
            kind="subscription_initial",
            promo_code_id=promo.id,
        )
        db.add(payment)
        await db.flush()

        decision = await evaluate_promo(
            db,
            code=promo.code,
            original_amount=2490,
            user=user,
            for_update=True,
        )
        await reserve_redemption(
            db,
            decision=decision,
            user_id=user.id,
            payment_id=payment.id,
            auto_renew_consent=False,
        )
        await db.commit()

        with pytest.raises(PromoValidationError, match="уже использовали"):
            await evaluate_promo(
                db,
                code=promo.code,
                original_amount=2490,
                user=user,
            )
