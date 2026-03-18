import uuid
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Occasion, PurchaseHistory, WishlistItem

router = APIRouter()


# ---------- Pydantic schemas ----------

class OccasionCreate(BaseModel):
    name: str
    date: Optional[date] = None
    notes: Optional[str] = None


class OccasionResponse(BaseModel):
    id: uuid.UUID
    name: str
    date: Optional[date]
    notes: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


class WishlistCreate(BaseModel):
    item_name: str
    brand: Optional[str] = None
    price: Optional[float] = None
    url: Optional[str] = None
    category: Optional[str] = None


class WishlistResponse(BaseModel):
    id: uuid.UUID
    item_name: str
    brand: Optional[str]
    price: Optional[float]
    url: Optional[str]
    category: Optional[str]
    status: str
    purchased_at: Optional[datetime]
    created_at: datetime
    model_config = {"from_attributes": True}


class WishlistStatusUpdate(BaseModel):
    status: str  # 'wishlist' | 'purchased' | 'archived'


class PurchaseCreate(BaseModel):
    item_name: str
    brand: Optional[str] = None
    price: Optional[float] = None
    category: Optional[str] = None
    purchased_at: datetime
    notes: Optional[str] = None


class PurchaseResponse(BaseModel):
    id: uuid.UUID
    item_name: str
    brand: Optional[str]
    price: Optional[float]
    category: Optional[str]
    purchased_at: datetime
    notes: Optional[str]
    model_config = {"from_attributes": True}


# ---------- Occasions ----------

@router.get("/users/{user_id}/occasions", response_model=list[OccasionResponse])
async def list_occasions(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Occasion)
        .where(Occasion.user_id == uuid.UUID(user_id))
        .order_by(Occasion.date.asc().nullslast())
    )
    return result.scalars().all()


@router.post("/users/{user_id}/occasions", response_model=OccasionResponse)
async def create_occasion(
    user_id: str, payload: OccasionCreate, db: AsyncSession = Depends(get_db)
):
    occ = Occasion(
        user_id=uuid.UUID(user_id),
        name=payload.name,
        date=payload.date,
        notes=payload.notes,
    )
    db.add(occ)
    await db.commit()
    await db.refresh(occ)
    return occ


@router.delete("/users/{user_id}/occasions/{occasion_id}", status_code=204)
async def delete_occasion(
    user_id: str, occasion_id: str, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Occasion).where(
            Occasion.id == uuid.UUID(occasion_id),
            Occasion.user_id == uuid.UUID(user_id),
        )
    )
    occ = result.scalar_one_or_none()
    if not occ:
        raise HTTPException(status_code=404, detail="Occasion not found")
    await db.delete(occ)
    await db.commit()


# ---------- Wishlist ----------

@router.get("/users/{user_id}/wishlist", response_model=list[WishlistResponse])
async def list_wishlist(
    user_id: str,
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(WishlistItem).where(WishlistItem.user_id == uuid.UUID(user_id))
    if status:
        q = q.where(WishlistItem.status == status)
    if category:
        q = q.where(WishlistItem.category == category)
    q = q.order_by(WishlistItem.created_at.desc())
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/users/{user_id}/wishlist", response_model=WishlistResponse)
async def add_wishlist_item(
    user_id: str, payload: WishlistCreate, db: AsyncSession = Depends(get_db)
):
    item = WishlistItem(
        user_id=uuid.UUID(user_id),
        item_name=payload.item_name,
        brand=payload.brand,
        price=payload.price,
        url=payload.url,
        category=payload.category,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/users/{user_id}/wishlist/{item_id}/status", response_model=WishlistResponse)
async def update_wishlist_status(
    user_id: str,
    item_id: str,
    payload: WishlistStatusUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WishlistItem).where(
            WishlistItem.id == uuid.UUID(item_id),
            WishlistItem.user_id == uuid.UUID(user_id),
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Wishlist item not found")

    item.status = payload.status
    if payload.status == "purchased":
        item.purchased_at = datetime.utcnow()
    await db.commit()
    await db.refresh(item)
    return item


# ---------- Purchases ----------

@router.get("/users/{user_id}/purchases", response_model=list[PurchaseResponse])
async def list_purchases(
    user_id: str,
    category: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(PurchaseHistory).where(PurchaseHistory.user_id == uuid.UUID(user_id))
    if category:
        q = q.where(PurchaseHistory.category == category)
    q = q.order_by(PurchaseHistory.purchased_at.desc())
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/users/{user_id}/purchases", response_model=PurchaseResponse)
async def add_purchase(
    user_id: str, payload: PurchaseCreate, db: AsyncSession = Depends(get_db)
):
    purchase = PurchaseHistory(
        user_id=uuid.UUID(user_id),
        item_name=payload.item_name,
        brand=payload.brand,
        price=payload.price,
        category=payload.category,
        purchased_at=payload.purchased_at,
        notes=payload.notes,
    )
    db.add(purchase)
    await db.commit()
    await db.refresh(purchase)
    return purchase
