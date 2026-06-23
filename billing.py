import os
import uuid
import logging
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import select, func as sa_func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from yookassa import Configuration, Payment as YookassaPayment
from yookassa.domain.notification import WebhookNotificationFactory, WebhookNotificationEventType

from db_async import get_async_db
from models import User, Payment, PromoCode, CustomSubscription, SubscriptionUsageEvent, Analysis
from subscription_service import (
    BASE_CONFIG,
    calculate_price,
    empty_usage,
    get_subscription,
    is_active,
    normalize_config,
    subscription_snapshot,
)
from auth import get_async_current_user
from lockbox import lockbox

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/billing", tags=["billing"])

def setup_yookassa():
    secrets = lockbox.get_secrets()
    Configuration.account_id = secrets.get("YOOKASSA_SHOP_ID") or os.getenv("YOOKASSA_SHOP_ID", "123456")
    Configuration.secret_key = secrets.get("YOOKASSA_SECRET_KEY") or os.getenv("YOOKASSA_SECRET_KEY", "test_key")

PRICING_PLANS = {
    "starter": {
        "monthly": 2490,
        "yearly": 24900
    },
    "pro": {
        "monthly": 3790,
        "yearly": 37900
    },
    "tester": {
        "monthly": 1,
        "yearly": 1
    }
}

from pydantic import BaseModel

class CreatePaymentRequest(BaseModel):
    tier: str # "starter", "pro", or "tester"
    is_annual: bool = False
    promo_code: str | None = None

class CreatePaymentResponse(BaseModel):
    confirmation_url: str


class QuotaConfigRequest(BaseModel):
    messages: int = BASE_CONFIG["messages"]
    roadmaps: int = BASE_CONFIG["roadmaps"]
    custdev: int = BASE_CONFIG["custdev"]
    grants: int = BASE_CONFIG["grants"]


class UpdateSubscriptionRequest(BaseModel):
    config: QuotaConfigRequest
    auto_renew: bool = True


class ConsumeUsageRequest(BaseModel):
    resource: str
    idempotency_key: str
    reference_id: str | None = None

class ValidatePromoRequest(BaseModel):
    code: str

class ValidatePromoResponse(BaseModel):
    valid: bool
    discount_percent: int
    target_tier: str | None = None
    fixed_price: float | None = None
    detail: str | None = None

@router.post("/promo/validate", response_model=ValidatePromoResponse)
async def validate_promo(request: ValidatePromoRequest, db: AsyncSession = Depends(get_async_db)):
    code = request.code.strip().upper()
    res = await db.execute(select(PromoCode).where(PromoCode.code == code))
    promo = res.scalar_one_or_none()
    
    if not promo:
        return ValidatePromoResponse(valid=False, discount_percent=0, detail="Промокод не найден")
        
    if promo.expires_at and promo.expires_at < datetime.utcnow():
        return ValidatePromoResponse(valid=False, discount_percent=0, detail="Срок действия промокода истек")
        
    if promo.max_uses and promo.current_uses >= promo.max_uses:
        return ValidatePromoResponse(valid=False, discount_percent=0, detail="Максимальное количество использований исчерпано")
        
    return ValidatePromoResponse(
        valid=True, 
        discount_percent=promo.discount_percent,
        target_tier=promo.target_tier,
        fixed_price=float(promo.fixed_price) if promo.fixed_price is not None else None
    )


@router.post("/create-payment", response_model=CreatePaymentResponse)
async def create_payment(
    request: CreatePaymentRequest,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_async_current_user),
):
    if request.tier not in PRICING_PLANS:
        raise HTTPException(status_code=400, detail="Invalid subscription tier")
    
    amount = PRICING_PLANS[request.tier]["yearly" if request.is_annual else "monthly"]
    
    promo_id = None
    if request.promo_code:
        code = request.promo_code.strip().upper()
        res = await db.execute(select(PromoCode).where(PromoCode.code == code))
        promo = res.scalar_one_or_none()
        if promo and (not promo.expires_at or promo.expires_at > datetime.utcnow()) and (not promo.max_uses or promo.current_uses < promo.max_uses):
            if promo.fixed_price is not None:
                amount = float(promo.fixed_price)
            else:
                amount = amount * (100 - promo.discount_percent) / 100
                
            if promo.target_tier:
                request.tier = promo.target_tier
                
            promo_id = promo.id
        else:
             raise HTTPException(status_code=400, detail="Invalid or expired promo code")
             
    setup_yookassa()
    
    # Create payment in Yookassa
    idempotence_key = str(uuid.uuid4())
    res = YookassaPayment.create({
        "amount": {
            "value": f"{amount:.2f}",
            "currency": "RUB"
        },
        "confirmation": {
            "type": "redirect",
            "return_url": os.getenv("APP_PUBLIC_URL", "http://localhost:3000") + "/account"
        },
        "capture": True,
        "description": f"Subscription: {request.tier} ({'yearly' if request.is_annual else 'monthly'})",
        "metadata": {
            "user_id": user.id,
            "tier": request.tier,
            "is_annual": "true" if request.is_annual else "false",
            "promo_id": str(promo_id) if promo_id else ""
        }
    }, idempotence_key)
    
    # Save local record
    payment_record = Payment(
        user_id=user.id,
        yookassa_payment_id=res.id,
        amount=amount,
        currency="RUB",
        status=res.status,
        tier=request.tier,
        is_annual=request.is_annual,
        promo_code_id=promo_id
    )
    db.add(payment_record)
    await db.commit()
    
    return CreatePaymentResponse(confirmation_url=res.confirmation.confirmation_url)


@router.post("/subscription/create-payment", response_model=CreatePaymentResponse)
async def create_configurable_subscription_payment(
    config: QuotaConfigRequest,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_async_current_user),
):
    """Create the first monthly payment and ask YooKassa to save the method."""
    try:
        quota_config = normalize_config(config.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    amount = calculate_price(quota_config)
    existing_subscription = await get_subscription(db, user.id, for_update=True)
    if is_active(existing_subscription):
        raise HTTPException(status_code=409, detail="Активную подписку изменяйте в профиле — новая конфигурация применится при продлении")
    setup_yookassa()
    result = YookassaPayment.create({
        "amount": {"value": f"{amount:.2f}", "currency": "RUB"},
        "confirmation": {
            "type": "redirect",
            "return_url": os.getenv("APP_PUBLIC_URL", "http://localhost:3000") + "/account?payment=return",
        },
        "capture": True,
        "save_payment_method": True,
        "description": "Pitchy: ежемесячная настраиваемая подписка",
        "metadata": {
            "user_id": str(user.id),
            "kind": "subscription_initial",
        },
    }, str(uuid.uuid4()))

    payment_method = getattr(result, "payment_method", None)
    db.add(Payment(
        user_id=user.id,
        yookassa_payment_id=result.id,
        amount=amount,
        currency="RUB",
        status=result.status,
        tier="custom",
        is_annual=False,
        kind="subscription_initial",
        quota_config=quota_config,
        payment_method_id=getattr(payment_method, "id", None),
    ))
    subscription = existing_subscription
    if subscription is None:
        subscription = CustomSubscription(
            user_id=user.id,
            status="pending",
            auto_renew=True,
            current_config=quota_config,
            next_config=quota_config,
            used=empty_usage(),
        )
        db.add(subscription)
    else:
        subscription.status = "pending" if subscription.status != "active" else subscription.status
        subscription.next_config = quota_config
    await db.commit()
    return CreatePaymentResponse(confirmation_url=result.confirmation.confirmation_url)


@router.get("/subscription")
async def get_configurable_subscription(
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_async_current_user),
):
    subscription = await get_subscription(db, user.id)
    if subscription is None:
        return {
            "mode": "legacy" if user.subscription_tier != "free" else "none",
            "legacy_tier": user.subscription_tier,
            "legacy_expires_at": user.subscription_expires_at,
            "base_config": BASE_CONFIG,
        }
    return {"mode": "custom", **subscription_snapshot(subscription), "base_config": BASE_CONFIG}


@router.patch("/subscription")
async def update_configurable_subscription(
    payload: UpdateSubscriptionRequest,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_async_current_user),
):
    subscription = await get_subscription(db, user.id, for_update=True)
    if subscription is None:
        raise HTTPException(status_code=404, detail="Настраиваемая подписка ещё не оформлена")
    try:
        subscription.next_config = normalize_config(payload.config.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    subscription.auto_renew = payload.auto_renew
    await db.commit()
    await db.refresh(subscription)
    return {"mode": "custom", **subscription_snapshot(subscription), "base_config": BASE_CONFIG}


@router.post("/subscription/cancel")
async def cancel_auto_renewal(
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_async_current_user),
):
    subscription = await get_subscription(db, user.id, for_update=True)
    if subscription is None:
        raise HTTPException(status_code=404, detail="Настраиваемая подписка не найдена")
    subscription.auto_renew = False
    await db.commit()
    return {"status": "ok", "auto_renew": False}


@router.post("/usage/consume")
async def consume_external_usage(
    payload: ConsumeUsageRequest,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_async_current_user),
):
    """Authenticated cross-service debit (currently used by CustDev)."""
    if payload.resource != "custdev":
        raise HTTPException(status_code=422, detail="External consumption is only allowed for custdev")
    from subscription_service import consume_quota
    handled = await consume_quota(
        db,
        user,
        payload.resource,
        idempotency_key=payload.idempotency_key,
        reference_type="custdev_simulation",
        reference_id=payload.reference_id,
    )
    if not handled:
        from plan_limits import UNLIMITED, get_limits_for, resolve_tier, start_of_month_utc
        tier = resolve_tier(user.subscription_tier, user.subscription_expires_at)
        limits = get_limits_for(user.subscription_tier, user.subscription_expires_at)
        if tier in ("free", "tester") or not limits.can_use_custdev:
            raise HTTPException(status_code=402, detail="CustDev недоступен без активной подписки")
        if limits.custdev != UNLIMITED:
            used = (await db.execute(
                select(sa_func.count()).select_from(Analysis).where(
                    Analysis.user_id == user.id,
                    Analysis.created_at >= start_of_month_utc(),
                )
            )).scalar() or 0
            if used >= limits.custdev:
                raise HTTPException(status_code=402, detail="Месячный лимит CustDev исчерпан")
        return {"status": "legacy", "consumed": False}
    await db.commit()
    return {"status": "ok", "consumed": True}


async def _create_renewal_payment(db: AsyncSession, subscription: CustomSubscription) -> Payment:
    config = normalize_config(subscription.next_config or subscription.current_config)
    amount = calculate_price(config)
    setup_yookassa()
    result = YookassaPayment.create({
        "amount": {"value": f"{amount:.2f}", "currency": "RUB"},
        "capture": True,
        "payment_method_id": subscription.payment_method_id,
        "description": "Pitchy: автоматическое продление подписки",
        "metadata": {
            "user_id": str(subscription.user_id),
            "kind": "subscription_renewal",
            "subscription_id": str(subscription.id),
        },
    }, str(uuid.uuid4()))
    payment = Payment(
        user_id=subscription.user_id,
        yookassa_payment_id=result.id,
        amount=amount,
        currency="RUB",
        status=result.status,
        tier="custom",
        is_annual=False,
        kind="subscription_renewal",
        quota_config=config,
        payment_method_id=subscription.payment_method_id,
        period_start=subscription.current_period_end,
        period_end=(subscription.current_period_end + relativedelta(months=1)) if subscription.current_period_end else None,
    )
    db.add(payment)
    subscription.renewal_attempted_at = datetime.utcnow()
    subscription.renewal_retry_count += 1
    await db.commit()
    return payment


@router.post("/renewals/run")
async def run_due_renewals(request: Request, db: AsyncSession = Depends(get_async_db)):
    """Cron target. Call at least daily with X-Cron-Secret."""
    expected = os.getenv("BILLING_CRON_SECRET")
    if not expected or request.headers.get("X-Cron-Secret") != expected:
        raise HTTPException(status_code=403, detail="Forbidden")
    now = datetime.utcnow()
    due = (await db.execute(
        select(CustomSubscription).where(
            CustomSubscription.status.in_(("active", "past_due")),
            CustomSubscription.auto_renew.is_(True),
            CustomSubscription.payment_method_id.isnot(None),
            CustomSubscription.current_period_end <= now,
        ).with_for_update(skip_locked=True)
    )).scalars().all()
    created = 0
    for subscription in due:
        recent = subscription.renewal_attempted_at and subscription.renewal_attempted_at > now - timedelta(hours=5)
        if recent:
            continue
        outstanding = (await db.execute(select(Payment.id).where(
            Payment.user_id == subscription.user_id,
            Payment.kind == "subscription_renewal",
            Payment.status.in_(("pending", "waiting_for_capture")),
            Payment.period_start == subscription.current_period_end,
        ).limit(1))).scalar_one_or_none()
        if outstanding:
            continue
        try:
            await _create_renewal_payment(db, subscription)
            created += 1
        except Exception as exc:
            logger.error("Renewal creation failed for subscription %s: %s", subscription.id, exc)
            subscription.status = "past_due"
            subscription.renewal_attempted_at = now
            subscription.renewal_retry_count += 1
            await db.commit()
    return {"status": "ok", "due": len(due), "created": created}


@router.post("/webhook")
async def yookassa_webhook(request: Request, db: AsyncSession = Depends(get_async_db)):
    event_json = await request.json()
    
    try:
        notification_object = WebhookNotificationFactory().create(event_json)
        response_object = notification_object.object
        
        if notification_object.event == WebhookNotificationEventType.PAYMENT_SUCCEEDED:
            payment_id = response_object.id
            res = await db.execute(select(Payment).options(selectinload(Payment.promo_code)).where(Payment.yookassa_payment_id == payment_id))
            db_payment = res.scalar_one_or_none()

            if db_payment:
                setup_yookassa()
                verified_payment = YookassaPayment.find_one(payment_id)
                verified_amount = float(verified_payment.amount.value)
                if verified_payment.status != "succeeded" or abs(verified_amount - float(db_payment.amount)) > 0.009:
                    logger.warning("Rejected unverified YooKassa notification for payment %s", payment_id)
                    return {"status": "ignored"}
                response_object = verified_payment

            if db_payment and db_payment.status != "succeeded":
                db_payment.status = "succeeded"

                res_user = await db.execute(select(User).where(User.id == db_payment.user_id))
                user = res_user.scalar_one_or_none()
                if user:
                    if db_payment.kind in ("subscription_initial", "subscription_renewal"):
                        subscription = await get_subscription(db, user.id, for_update=True)
                        if subscription is None:
                            subscription = CustomSubscription(
                                user_id=user.id,
                                current_config=db_payment.quota_config or BASE_CONFIG,
                                next_config=db_payment.quota_config or BASE_CONFIG,
                                used=empty_usage(),
                            )
                            db.add(subscription)
                        now = datetime.utcnow()
                        start_date = max(now, subscription.current_period_end or now)
                        config = normalize_config(db_payment.quota_config or subscription.next_config)
                        subscription.status = "active"
                        subscription.current_period_start = start_date
                        subscription.current_period_end = start_date + relativedelta(months=1)
                        subscription.current_config = config
                        subscription.next_config = config
                        subscription.used = empty_usage()
                        subscription.renewal_retry_count = 0
                        payment_method = getattr(response_object, "payment_method", None)
                        method_id = getattr(payment_method, "id", None) or db_payment.payment_method_id
                        if method_id:
                            subscription.payment_method_id = method_id
                            db_payment.payment_method_id = method_id
                        subscription.auto_renew = bool(subscription.payment_method_id)
                        db_payment.period_start = subscription.current_period_start
                        db_payment.period_end = subscription.current_period_end
                        user.subscription_tier = "custom"
                        user.subscription_expires_at = subscription.current_period_end
                        await db.flush()
                        db.add(SubscriptionUsageEvent(
                            user_id=user.id,
                            subscription_id=subscription.id,
                            resource="period",
                            quantity=0,
                            event_type="period_reset",
                            idempotency_key=f"period:{db_payment.yookassa_payment_id}",
                            reference_type="payment",
                            reference_id=db_payment.yookassa_payment_id,
                            event_metadata={"config": config},
                        ))
                    else:
                        # Legacy plans remain valid until their existing expiry.
                        user.subscription_tier = db_payment.tier
                        now = datetime.utcnow()
                        start_date = max(now, user.subscription_expires_at or now)
                        delta = relativedelta(years=1) if db_payment.is_annual else relativedelta(months=1)
                        user.subscription_expires_at = start_date + delta

                if db_payment.promo_code:
                    db_payment.promo_code.current_uses += 1

                await db.commit()

                # Notify user that the subscription is active.
                if user and user.email:
                    try:
                        import email_templates
                        from email_utils import send_email
                        from fastapi.concurrency import run_in_threadpool
                        subj, body = email_templates.payment_succeeded(
                            name=user.name,
                            tier=db_payment.tier,
                            amount=float(db_payment.amount),
                            is_annual=db_payment.is_annual,
                            expires_at=user.subscription_expires_at,
                            payment_id=db_payment.yookassa_payment_id or "",
                        )
                        await run_in_threadpool(send_email, user.email, subj, body, "billing")
                    except Exception as e:
                        logger.error(f"Failed to send payment_succeeded email to {user.email}: {e}")

        elif notification_object.event == WebhookNotificationEventType.PAYMENT_CANCELED:
            payment_id = response_object.id
            res = await db.execute(select(Payment).where(Payment.yookassa_payment_id == payment_id))
            db_payment = res.scalar_one_or_none()
            if db_payment and db_payment.status != "canceled":
                db_payment.status = "canceled"
                if db_payment.kind == "subscription_renewal":
                    subscription = await get_subscription(db, db_payment.user_id, for_update=True)
                    if subscription:
                        subscription.status = "past_due"
                        db_payment.failure_reason = str(getattr(response_object, "cancellation_details", "payment_canceled"))
                await db.commit()

                res_user = await db.execute(select(User).where(User.id == db_payment.user_id))
                user = res_user.scalar_one_or_none()
                if user and user.email:
                    try:
                        import email_templates
                        from email_utils import send_email
                        from fastapi.concurrency import run_in_threadpool
                        subj, body = email_templates.payment_canceled(
                            name=user.name,
                            tier=db_payment.tier,
                            amount=float(db_payment.amount),
                            payment_id=db_payment.yookassa_payment_id or "",
                        )
                        await run_in_threadpool(send_email, user.email, subj, body, "billing")
                    except Exception as e:
                        logger.error(f"Failed to send payment_canceled email to {user.email}: {e}")
                
    except Exception as e:
        await db.rollback()
        logger.error(f"Yookassa Webhook error: {str(e)}")
        # Non-2xx is intentional: YooKassa must retry transient verification
        # or database failures, otherwise a paid user can remain unactivated.
        raise HTTPException(status_code=503, detail="Webhook processing failed") from e

    return {"status": "ok"}
