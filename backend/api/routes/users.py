import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Occasion, User, WishlistItem

router = APIRouter()


# ---------- Pydantic schemas ----------

class UserCreate(BaseModel):
    name: str
    email: str
    age: Optional[int] = None
    body_type: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    body_type: Optional[str] = None


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    age: Optional[int]
    body_type: Optional[str]
    created_at: datetime
    occasion_count: Optional[int] = None
    wishlist_count: Optional[int] = None

    model_config = {"from_attributes": True}


# ---------- Routes ----------

@router.post("/users", response_model=UserResponse)
async def create_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    user = User(
        name=payload.name,
        email=payload.email,
        age=payload.age,
        body_type=payload.body_type,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        age=user.age,
        body_type=user.body_type,
        created_at=user.created_at,
    )


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    occ_count = await db.execute(
        select(func.count()).where(Occasion.user_id == user.id)
    )
    wish_count = await db.execute(
        select(func.count()).where(WishlistItem.user_id == user.id)
    )

    return UserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        age=user.age,
        body_type=user.body_type,
        created_at=user.created_at,
        occasion_count=occ_count.scalar(),
        wishlist_count=wish_count.scalar(),
    )


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str, payload: UserUpdate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.name is not None:
        user.name = payload.name
    if payload.age is not None:
        user.age = payload.age
    if payload.body_type is not None:
        user.body_type = payload.body_type

    await db.commit()
    await db.refresh(user)
    return UserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        age=user.age,
        body_type=user.body_type,
        created_at=user.created_at,
    )
