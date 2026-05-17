import os
import uuid
import logging
from datetime import datetime
from dateutil.relativedelta import relativedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from yookassa import Configuration, Payment as YookassaPayment
from yookassa.domain.notification import WebhookNotificationFactory, WebhookNotificationEventType

from db_async import get_async_db
from models import User, Payment, PromoCode
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

            if db_payment and db_payment.status != "succeeded":
                db_payment.status = "succeeded"

                res_user = await db.execute(select(User).where(User.id == db_payment.user_id))
                user = res_user.scalar_one_or_none()
                if user:
                    user.subscription_tier = db_payment.tier

                    # Calculate new expiration date
                    now = datetime.utcnow()
                    if user.subscription_expires_at and user.subscription_expires_at > now:
                        start_date = user.subscription_expires_at
                    else:
                        start_date = now

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
                        await run_in_threadpool(send_email, user.email, subj, body)
                    except Exception as e:
                        logger.error(f"Failed to send payment_succeeded email to {user.email}: {e}")

        elif notification_object.event == WebhookNotificationEventType.PAYMENT_CANCELED:
            payment_id = response_object.id
            res = await db.execute(select(Payment).where(Payment.yookassa_payment_id == payment_id))
            db_payment = res.scalar_one_or_none()
            if db_payment and db_payment.status != "canceled":
                db_payment.status = "canceled"
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
                        await run_in_threadpool(send_email, user.email, subj, body)
                    except Exception as e:
                        logger.error(f"Failed to send payment_canceled email to {user.email}: {e}")
                
    except Exception as e:
        await db.rollback()
        logger.error(f"Yookassa Webhook error: {str(e)}")
        # We must return 200 OK to Yookassa to avoid webhook retries
        return {"status": "error", "detail": str(e)}

    return {"status": "ok"}
