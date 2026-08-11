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
from models import (
    User, Payment, PromoCode, PromoRedemption, CustomSubscription,
    SubscriptionUsageEvent, Analysis,
)
from promo_service import (
    PROMO_CONSENT_VERSION,
    PromoDecision,
    PromoValidationError,
    evaluate_promo,
    reserve_redemption,
)
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
from tbank_payment_service import TBankError, cancel_payment as tbank_cancel_payment, init_payment as tbank_init_payment, verify_notification as tbank_verify_notification

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
    promo_auto_renew_consent: bool = False

class CreatePaymentResponse(BaseModel):
    confirmation_url: str


class QuotaConfigRequest(BaseModel):
    messages: int = BASE_CONFIG["messages"]
    roadmaps: int = BASE_CONFIG["roadmaps"]
    custdev: int = BASE_CONFIG["custdev"]
    grants: int = BASE_CONFIG["grants"]


class CreateConfigurablePaymentRequest(QuotaConfigRequest):
    # Промокод применяется к итоговой сумме подписки (база + все доп-функции).
    promo_code: str | None = None
    promo_auto_renew_consent: bool = False


class UpdateSubscriptionRequest(BaseModel):
    config: QuotaConfigRequest
    auto_renew: bool = True


class ConsumeUsageRequest(BaseModel):
    resource: str
    idempotency_key: str
    reference_id: str | None = None

class ValidatePromoRequest(BaseModel):
    code: str
    original_amount: float | None = None

class ValidatePromoResponse(BaseModel):
    valid: bool
    discount_percent: int
    target_tier: str | None = None
    fixed_price: float | None = None
    detail: str | None = None
    campaign_name: str | None = None
    post_promo_action: str | None = None
    renewal_amount: float | None = None
    renewal_notice_days: int | None = None
    requires_auto_renew_consent: bool = False
    consent_text: str | None = None
    consent_version: str | None = None


class TBankRefundRequest(BaseModel):
    payment_id: int
    amount: float | None = None

@router.post("/promo/validate", response_model=ValidatePromoResponse)
async def validate_promo(request: ValidatePromoRequest, db: AsyncSession = Depends(get_async_db)):
    try:
        decision = await evaluate_promo(
            db,
            code=request.code,
            original_amount=max(0.0, request.original_amount or 2490.0),
        )
    except PromoValidationError as exc:
        return ValidatePromoResponse(valid=False, discount_percent=0, detail=str(exc))
    return ValidatePromoResponse(**decision.public_dict())


@router.post("/create-payment", response_model=CreatePaymentResponse)
async def create_payment(
    request: CreatePaymentRequest,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_async_current_user),
):
    if request.tier not in PRICING_PLANS:
        raise HTTPException(status_code=400, detail="Invalid subscription tier")
    
    original_amount = float(PRICING_PLANS[request.tier]["yearly" if request.is_annual else "monthly"])
    amount = original_amount
    promo_id = None
    promo_decision: PromoDecision | None = None
    promo_context: dict | None = None
    if request.promo_code:
        try:
            promo_decision = await evaluate_promo(
                db,
                code=request.promo_code,
                original_amount=original_amount,
                user=user,
                auto_renew_consent=request.promo_auto_renew_consent,
                enforce_consent=True,
                for_update=True,
            )
        except PromoValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        amount = promo_decision.final_amount
        promo_id = promo_decision.promo.id
        promo_context = promo_decision.payment_context(request.promo_auto_renew_consent)
        if promo_decision.target_tier:
            request.tier = promo_decision.target_tier
             
    if os.getenv("PAYMENT_PROVIDER", "yookassa").strip().lower() == "tbank":
        order_id = f"pitchy-{user.id}-{uuid.uuid4().hex[:20]}"
        try:
            result = await tbank_init_payment(
                order_id=order_id,
                amount_rub=amount,
                description=f"Pitchy: {request.tier}",
                email=user.email,
            )
        except TBankError as exc:
            raise HTTPException(status_code=502, detail="Payment provider is temporarily unavailable") from exc
        payment_record = Payment(
            user_id=user.id,
            yookassa_payment_id=f"tbank:{result.get('PaymentId') or order_id}",
            provider="tbank",
            provider_payment_id=str(result.get("PaymentId") or ""),
            provider_order_id=order_id,
            amount=amount,
            currency="RUB",
            status="pending",
            tier=request.tier,
            is_annual=request.is_annual,
            promo_code_id=promo_id,
            promo_context=promo_context,
        )
        db.add(payment_record)
        await db.flush()
        if promo_decision is not None:
            await reserve_redemption(db, decision=promo_decision, user_id=user.id, payment_id=payment_record.id, auto_renew_consent=request.promo_auto_renew_consent)
        await db.commit()
        return CreatePaymentResponse(confirmation_url=result["PaymentURL"])

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
        promo_code_id=promo_id,
        promo_context=promo_context,
    )
    db.add(payment_record)
    await db.flush()
    if promo_decision is not None:
        await reserve_redemption(
            db,
            decision=promo_decision,
            user_id=user.id,
            payment_id=payment_record.id,
            auto_renew_consent=request.promo_auto_renew_consent,
        )
    await db.commit()
    
    return CreatePaymentResponse(confirmation_url=res.confirmation.confirmation_url)


@router.post("/tbank/notification")
async def tbank_notification(request: Request, db: AsyncSession = Depends(get_async_db)):
    """Process signed T-Bank payment status notifications (dev first)."""
    payload = await request.json()
    try:
        if not tbank_verify_notification(payload):
            raise HTTPException(status_code=403, detail="Invalid notification signature")
        order_id = str(payload.get("OrderId") or "")
        payment_id = str(payload.get("PaymentId") or "")
        result = await db.execute(select(Payment).where(Payment.provider == "tbank", Payment.provider_order_id == order_id))
        payment = result.scalar_one_or_none()
        if payment is None:
            return {"status": "ignored"}
        if payment.provider_payment_id and payment.provider_payment_id != payment_id:
            raise HTTPException(status_code=400, detail="Payment identifier mismatch")
        expected_amount = int(round(float(payment.amount) * 100))
        if int(payload.get("Amount") or 0) != expected_amount:
            raise HTTPException(status_code=400, detail="Payment amount mismatch")
        status = str(payload.get("Status") or "").upper()
        success = str(payload.get("Success")).lower() == "true"
        if success and status in {"AUTHORIZED", "CONFIRMED", "COMPLETED"}:
            payment.status = "succeeded"
            now = datetime.utcnow()
            user = (await db.execute(select(User).where(User.id == payment.user_id))).scalar_one_or_none()
            if user:
                if payment.kind == "subscription_initial":
                    subscription = await get_subscription(db, user.id, for_update=True)
                    if subscription is None:
                        subscription = CustomSubscription(user_id=user.id, current_config=payment.quota_config or BASE_CONFIG, next_config=payment.quota_config or BASE_CONFIG, used=empty_usage())
                        db.add(subscription)
                    subscription.status = "active"
                    subscription.current_period_start = now
                    subscription.current_period_end = now + relativedelta(months=1)
                    subscription.current_config = normalize_config(payment.quota_config or BASE_CONFIG)
                    subscription.next_config = subscription.current_config
                    subscription.used = empty_usage()
                    subscription.auto_renew = False
                    payment.period_start = subscription.current_period_start
                    payment.period_end = subscription.current_period_end
                    user.subscription_tier = "custom"
                    user.subscription_expires_at = subscription.current_period_end
                else:
                    user.subscription_tier = payment.tier
                    user.subscription_expires_at = max(now, user.subscription_expires_at or now) + (relativedelta(years=1) if payment.is_annual else relativedelta(months=1))
            if payment.promo_code:
                payment.promo_code.current_uses += 1
                redemption = (await db.execute(select(PromoRedemption).where(PromoRedemption.payment_id == payment.id).with_for_update())).scalar_one_or_none()
                if redemption and redemption.status != "succeeded":
                    redemption.status = "succeeded"
                    redemption.redeemed_at = now
        elif not success or status in {"REJECTED", "CANCELED", "REVERSED"}:
            payment.status = "canceled"
            payment.failure_reason = str(payload.get("Message") or payload.get("ErrorCode") or "payment_failed")
        await db.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.error("T-Bank notification processing failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Notification processing failed") from exc


@router.post("/tbank/refund")
async def tbank_refund(request: TBankRefundRequest, db: AsyncSession = Depends(get_async_db), user: User = Depends(get_async_current_user)):
    """Refund a user's own successful dev payment and send a refund receipt."""
    result = await db.execute(select(Payment).where(Payment.id == request.payment_id, Payment.user_id == user.id, Payment.provider == "tbank"))
    payment = result.scalar_one_or_none()
    if payment is None or payment.status != "succeeded" or not payment.provider_payment_id:
        raise HTTPException(status_code=404, detail="Payment is not refundable")
    amount = float(request.amount if request.amount is not None else payment.amount)
    if amount <= 0 or amount > float(payment.amount):
        raise HTTPException(status_code=400, detail="Invalid refund amount")
    try:
        response = await tbank_cancel_payment(payment_id=payment.provider_payment_id, amount_rub=amount, description=f"Возврат Pitchy: {payment.tier}", email=user.email)
    except TBankError as exc:
        raise HTTPException(status_code=502, detail="Refund provider is temporarily unavailable") from exc
    if amount >= float(payment.amount):
        payment.status = "refunded"
    await db.commit()
    return {"status": "ok", "payment_id": response.get("PaymentId")}


@router.post("/subscription/create-payment", response_model=CreatePaymentResponse)
async def create_configurable_subscription_payment(
    config: CreateConfigurablePaymentRequest,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_async_current_user),
):
    """Create the first monthly payment and ask YooKassa to save the method."""
    data = config.model_dump()
    promo_code_value = data.pop("promo_code", None)
    promo_auto_renew_consent = bool(data.pop("promo_auto_renew_consent", False))
    try:
        quota_config = normalize_config(data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    original_amount = float(calculate_price(quota_config))
    amount = original_amount

    # Промокод действует на любую итоговую сумму подписки (база + доп-функции).
    promo_id = None
    promo_target_tier = None
    promo_decision: PromoDecision | None = None
    promo_context: dict | None = None
    if promo_code_value and promo_code_value.strip():
        try:
            promo_decision = await evaluate_promo(
                db,
                code=promo_code_value,
                original_amount=original_amount,
                user=user,
                auto_renew_consent=promo_auto_renew_consent,
                enforce_consent=True,
                for_update=True,
            )
        except PromoValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        amount = promo_decision.final_amount
        promo_id = promo_decision.promo.id
        promo_target_tier = promo_decision.target_tier
        promo_context = promo_decision.payment_context(promo_auto_renew_consent)

    existing_subscription = await get_subscription(db, user.id, for_update=True)
    if is_active(existing_subscription):
        raise HTTPException(status_code=409, detail="Активную подписку изменяйте в профиле — новая конфигурация применится при продлении")
    if os.getenv("PAYMENT_PROVIDER", "yookassa").strip().lower() == "tbank":
        order_id = f"pitchy-sub-{user.id}-{uuid.uuid4().hex[:18]}"
        try:
            result = await tbank_init_payment(order_id=order_id, amount_rub=amount, description="Pitchy: подписка", email=user.email)
        except TBankError as exc:
            raise HTTPException(status_code=502, detail="Payment provider is temporarily unavailable") from exc
        payment = Payment(
            user_id=user.id, yookassa_payment_id=f"tbank:{result.get('PaymentId') or order_id}",
            provider="tbank", provider_payment_id=str(result.get("PaymentId") or ""), provider_order_id=order_id,
            amount=amount, currency="RUB", status="pending", tier=promo_target_tier or "custom", is_annual=False,
            kind="subscription_initial", quota_config=quota_config, promo_code_id=promo_id, promo_context=promo_context,
        )
        db.add(payment)
        await db.flush()
        if promo_decision is not None:
            await reserve_redemption(db, decision=promo_decision, user_id=user.id, payment_id=payment.id, auto_renew_consent=promo_auto_renew_consent)
        await db.commit()
        return CreatePaymentResponse(confirmation_url=result["PaymentURL"])

    setup_yookassa()

    if promo_target_tier == "research":
        result = YookassaPayment.create({
            "amount": {"value": f"{amount:.2f}", "currency": "RUB"},
            "confirmation": {
                "type": "redirect",
                "return_url": os.getenv("APP_PUBLIC_URL", "http://localhost:3000") + "/account?payment=return",
            },
            "capture": True,
            "description": "Pitchy: тариф Research по промокоду",
            "metadata": {
                "user_id": str(user.id),
                "tier": promo_target_tier,
                "kind": "promo_tier",
                "promo_id": str(promo_id) if promo_id else "",
            },
        }, str(uuid.uuid4()))
        db.add(Payment(
            user_id=user.id,
            yookassa_payment_id=result.id,
            amount=amount,
            currency="RUB",
            status=result.status,
            tier=promo_target_tier,
            is_annual=False,
            kind="legacy",
            promo_code_id=promo_id,
            promo_context=promo_context,
        ))
        await db.flush()
        payment = (await db.execute(
            select(Payment).where(Payment.yookassa_payment_id == result.id)
        )).scalar_one()
        if promo_decision is not None:
            await reserve_redemption(
                db,
                decision=promo_decision,
                user_id=user.id,
                payment_id=payment.id,
                auto_renew_consent=promo_auto_renew_consent,
            )
        await db.commit()
        return CreatePaymentResponse(confirmation_url=result.confirmation.confirmation_url)

    # Пока YooKassa не включила рекуррентные платежи (1-2 дня на согласование),
    # держим флаг ВЫКЛ → первый платёж разовый (без save_payment_method), проходит без 403.
    # Когда включат — ставим BILLING_RECURRING_ENABLED=1, и автосписание заработает без правок кода.
    recurring_enabled = os.getenv("BILLING_RECURRING_ENABLED", "").strip().lower() in ("1", "true", "yes")
    payload = {
        "amount": {"value": f"{amount:.2f}", "currency": "RUB"},
        "confirmation": {
            "type": "redirect",
            "return_url": os.getenv("APP_PUBLIC_URL", "http://localhost:3000") + "/account?payment=return",
        },
        "capture": True,
        "description": "Pitchy: ежемесячная настраиваемая подписка",
        "metadata": {
            "user_id": str(user.id),
            "kind": "subscription_initial",
        },
    }
    wants_auto_renew = (
        promo_decision is None
        or promo_decision.campaign is None
        or (
            promo_decision.post_promo_action == "renew_base"
            and promo_auto_renew_consent
        )
    )
    if (
        promo_decision is not None
        and promo_decision.post_promo_action == "renew_base"
        and wants_auto_renew
        and not recurring_enabled
    ):
        raise HTTPException(
            status_code=503,
            detail="Автопродление для этой промокампании пока недоступно у платёжного провайдера",
        )
    if recurring_enabled and wants_auto_renew:
        payload["save_payment_method"] = True
    try:
        result = YookassaPayment.create(payload, str(uuid.uuid4()))
    except Exception as exc:
        msg = str(exc)
        logger.error("YooKassa subscription payment failed: %s", msg)
        if "recurring" in msg.lower() or "save_payment_method" in msg.lower():
            raise HTTPException(
                status_code=503,
                detail="Автоплатежи у платёжного провайдера ещё подключаются. Пожалуйста, попробуйте чуть позже.",
            ) from exc
        raise HTTPException(status_code=502, detail="Не удалось создать платёж. Попробуйте позже.") from exc

    payment_method = getattr(result, "payment_method", None)
    payment_record = Payment(
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
        promo_code_id=promo_id,
        promo_context=promo_context,
    )
    db.add(payment_record)
    await db.flush()
    if promo_decision is not None:
        await reserve_redemption(
            db,
            decision=promo_decision,
            user_id=user.id,
            payment_id=payment_record.id,
            auto_renew_consent=promo_auto_renew_consent,
        )
    subscription = existing_subscription
    if subscription is None:
        subscription = CustomSubscription(
            user_id=user.id,
            status="pending",
            auto_renew=wants_auto_renew,
            current_config=quota_config,
            next_config=quota_config,
            used=empty_usage(),
        )
        db.add(subscription)
    else:
        subscription.status = "pending" if subscription.status != "active" else subscription.status
        subscription.next_config = quota_config
        subscription.auto_renew = wants_auto_renew
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


@router.post("/subscription/detach-method")
async def detach_payment_method(
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_async_current_user),
):
    """Самостоятельная отвязка способа оплаты: пользователь удаляет сохранённую
    карту и отключает автопродление сам, без обращения в поддержку (требование YooKassa)."""
    subscription = await get_subscription(db, user.id, for_update=True)
    if subscription is None:
        # Нечего отвязывать — карты нет. Не ошибка: возвращаем спокойный статус.
        return {"status": "ok", "payment_method_saved": False, "auto_renew": False}
    subscription.payment_method_id = None
    subscription.auto_renew = False
    await db.commit()
    await db.refresh(subscription)
    return {"mode": "custom", **subscription_snapshot(subscription), "base_config": BASE_CONFIG}


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
    amount = (
        float(subscription.renewal_price_override)
        if subscription.renewal_price_override is not None
        else calculate_price(config)
    )
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
                        promo_context = db_payment.promo_context or {}
                        post_promo_action = promo_context.get("post_promo_action")
                        promo_consent = bool(promo_context.get("auto_renew_consent"))
                        renewal_config = promo_context.get("renewal_config")
                        subscription.status = "active"
                        subscription.current_period_start = start_date
                        subscription.current_period_end = start_date + relativedelta(months=1)
                        subscription.current_config = config
                        if post_promo_action == "renew_base" and promo_consent and renewal_config:
                            subscription.next_config = normalize_config(renewal_config)
                        else:
                            subscription.next_config = config
                        subscription.used = empty_usage()
                        subscription.renewal_retry_count = 0
                        payment_method = getattr(response_object, "payment_method", None)
                        method_id = getattr(payment_method, "id", None) or db_payment.payment_method_id
                        if method_id:
                            subscription.payment_method_id = method_id
                            db_payment.payment_method_id = method_id
                        if post_promo_action in ("none", "offer"):
                            subscription.auto_renew = False
                        elif post_promo_action == "renew_base":
                            subscription.auto_renew = bool(subscription.payment_method_id) and promo_consent
                        else:
                            subscription.auto_renew = bool(subscription.payment_method_id)
                        if promo_context.get("campaign_id"):
                            subscription.promo_campaign_id = int(promo_context["campaign_id"])
                            subscription.promo_ends_at = subscription.current_period_end
                            subscription.promo_post_action = post_promo_action
                            if promo_consent:
                                consent_at = promo_context.get("consent_at")
                                subscription.promo_consent_at = (
                                    datetime.fromisoformat(consent_at) if consent_at else now
                                )
                                subscription.promo_consent_version = (
                                    promo_context.get("consent_version") or PROMO_CONSENT_VERSION
                                )
                            subscription.renewal_price_override = (
                                promo_context.get("renewal_amount")
                                if promo_context.get("renewal_price_policy") == "fixed"
                                else None
                            )
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
                    redemption = (await db.execute(
                        select(PromoRedemption).where(
                            PromoRedemption.payment_id == db_payment.id
                        ).with_for_update()
                    )).scalar_one_or_none()
                    if redemption and redemption.status != "succeeded":
                        redemption.status = "succeeded"
                        redemption.redeemed_at = datetime.utcnow()

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
                redemption = (await db.execute(
                    select(PromoRedemption).where(
                        PromoRedemption.payment_id == db_payment.id
                    ).with_for_update()
                )).scalar_one_or_none()
                if redemption and redemption.status == "reserved":
                    redemption.status = "canceled"
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
