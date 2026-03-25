import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Product

router = APIRouter()


# ---------- Pydantic schemas ----------

class ProductCreate(BaseModel):
    title: str
    subtitle: Optional[str] = None
    price: float
    images: list[str] = []
    category: Optional[str] = None


class ProductResponse(BaseModel):
    id: uuid.UUID
    title: str
    subtitle: Optional[str]
    price: float
    images: list[str]
    category: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_product(cls, product: Product) -> "ProductResponse":
        images = json.loads(product.images) if product.images else []
        return cls(
            id=product.id,
            title=product.title,
            subtitle=product.subtitle,
            price=float(product.price),
            images=images,
            category=product.category,
            created_at=product.created_at,
        )


# ---------- Products ----------

@router.get("/products", response_model=list[ProductResponse])
async def list_products(
    category: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(Product)
    if category:
        q = q.where(Product.category == category)
    q = q.order_by(Product.created_at.asc())
    result = await db.execute(q)
    return [ProductResponse.from_orm_product(p) for p in result.scalars().all()]


@router.get("/products/{product_id}", response_model=ProductResponse)
async def get_product(product_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Product).where(Product.id == uuid.UUID(product_id))
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return ProductResponse.from_orm_product(product)


@router.post("/products", response_model=ProductResponse, status_code=201)
async def create_product(payload: ProductCreate, db: AsyncSession = Depends(get_db)):
    product = Product(
        title=payload.title,
        subtitle=payload.subtitle,
        price=payload.price,
        images=json.dumps(payload.images),
        category=payload.category,
    )
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return ProductResponse.from_orm_product(product)
