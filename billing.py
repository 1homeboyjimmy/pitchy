import os
import uuid
import logging
from datetime import datetime
from dateutil.relativedelta import relativedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from yookassa import Configuration, Payment as YookassaPayment
from yookassa.domain.notification import WebhookNotificationFactory, WebhookNotificationEventType

from db import get_db
from models import User, Payment, PromoCode
from auth import get_current_user
from lockbox import lockbox

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/billing", tags=["billing"])

def setup_yookassa():
    secrets = lockbox.get_secrets()
    Configuration.account_id = secrets.get("YOOKASSA_SHOP_ID") or os.getenv("YOOKASSA_SHOP_ID", "123456")
    Configuration.secret_key = secrets.get("YOOKASSA_SECRET_KEY") or os.getenv("YOOKASSA_SECRET_KEY", "test_key")

PRICING_PLANS = {
    "pro": {
        "monthly": 499,
        "yearly": 4990
    },
    "premium": {
        "monthly": 999,
        "yearly": 9990
    }
}

from pydantic import BaseModel

class CreatePaymentRequest(BaseModel):
    tier: str # "pro" or "premium"
    is_annual: bool = False
    promo_code: str | None = None

class CreatePaymentResponse(BaseModel):
    confirmation_url: str

class ValidatePromoRequest(BaseModel):
    code: str

class ValidatePromoResponse(BaseModel):
    valid: bool
    discount_percent: int
    detail: str | None = None

@router.post("/promo/validate", response_model=ValidatePromoResponse)
async def validate_promo(request: ValidatePromoRequest, db: Session = Depends(get_db)):
    code = request.code.strip().upper()
    promo = db.query(PromoCode).filter(PromoCode.code == code).first()
    
    if not promo:
        return ValidatePromoResponse(valid=False, discount_percent=0, detail="Промокод не найден")
        
    if promo.expires_at and promo.expires_at < datetime.utcnow():
        return ValidatePromoResponse(valid=False, discount_percent=0, detail="Срок действия промокода истек")
        
    if promo.max_uses and promo.current_uses >= promo.max_uses:
        return ValidatePromoResponse(valid=False, discount_percent=0, detail="Максимальное количество использований исчерпано")
        
    return ValidatePromoResponse(valid=True, discount_percent=promo.discount_percent)


@router.post("/create-payment", response_model=CreatePaymentResponse)
async def create_payment(
    request: CreatePaymentRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if request.tier not in PRICING_PLANS:
        raise HTTPException(status_code=400, detail="Invalid subscription tier")
    
    amount = PRICING_PLANS[request.tier]["yearly" if request.is_annual else "monthly"]
    
    promo_id = None
    if request.promo_code:
        code = request.promo_code.strip().upper()
        promo = db.query(PromoCode).filter(PromoCode.code == code).first()
        if promo and (not promo.expires_at or promo.expires_at > datetime.utcnow()) and (not promo.max_uses or promo.current_uses < promo.max_uses):
            amount = amount * (100 - promo.discount_percent) / 100
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
    db.commit()
    
    return CreatePaymentResponse(confirmation_url=res.confirmation.confirmation_url)


@router.post("/webhook")
async def yookassa_webhook(request: Request, db: Session = Depends(get_db)):
    event_json = await request.json()
    
    try:
        notification_object = WebhookNotificationFactory().create(event_json)
        response_object = notification_object.object
        
        if notification_object.event == WebhookNotificationEventType.PAYMENT_SUCCEEDED:
            payment_id = response_object.id
            db_payment = db.query(Payment).filter(Payment.yookassa_payment_id == payment_id).first()
            
            if db_payment and db_payment.status != "succeeded":
                db_payment.status = "succeeded"
                
                user = db.query(User).filter(User.id == db_payment.user_id).first()
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
                    
                db.commit()
                
        elif notification_object.event == WebhookNotificationEventType.PAYMENT_CANCELED:
            payment_id = response_object.id
            db_payment = db.query(Payment).filter(Payment.yookassa_payment_id == payment_id).first()
            if db_payment and db_payment.status != "canceled":
                db_payment.status = "canceled"
                db.commit()
                
    except Exception as e:
        logger.error(f"Yookassa Webhook error: {str(e)}")
        # We must return 200 OK to Yookassa to avoid webhook retries
        return {"status": "error", "detail": str(e)}

    return {"status": "ok"}
