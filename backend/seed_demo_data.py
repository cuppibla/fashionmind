"""Seed the fixed demo user and a few structured records for live demos."""

import asyncio
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import select

load_dotenv(Path(__file__).resolve().with_name(".env"))

from db.database import create_all_tables, async_session
from db.models import Occasion, PurchaseHistory, User, WishlistItem

DEMO_USER_ID = uuid.UUID("123e4567-e89b-12d3-a456-426614174000")
DEMO_USER_EMAIL = "cloudnext-demo@example.com"


async def seed_demo_data() -> None:
    await create_all_tables()

    async with async_session() as session:
        user = (
            await session.execute(select(User).where(User.id == DEMO_USER_ID))
        ).scalar_one_or_none()
        if not user:
            user = User(
                id=DEMO_USER_ID,
                name="Demo User",
                email=DEMO_USER_EMAIL,
                age=29,
                body_type="athletic",
            )
            session.add(user)

        occasion = (
            await session.execute(
                select(Occasion).where(
                    Occasion.user_id == DEMO_USER_ID,
                    Occasion.name == "Customer Dinner",
                )
            )
        ).scalar_one_or_none()
        if not occasion:
            session.add(
                Occasion(
                    user_id=DEMO_USER_ID,
                    name="Customer Dinner",
                    date=date.today() + timedelta(days=1),
                    notes="Polished but approachable after keynote.",
                )
            )

        wishlist_item = (
            await session.execute(
                select(WishlistItem).where(
                    WishlistItem.user_id == DEMO_USER_ID,
                    WishlistItem.item_name == "Lightweight Layering Jacket",
                )
            )
        ).scalar_one_or_none()
        if not wishlist_item:
            session.add(
                WishlistItem(
                    user_id=DEMO_USER_ID,
                    item_name="Lightweight Layering Jacket",
                    brand="Conference Edit",
                    category="Outerwear",
                    price=129.0,
                    status="wishlist",
                )
            )

        purchase = (
            await session.execute(
                select(PurchaseHistory).where(
                    PurchaseHistory.user_id == DEMO_USER_ID,
                    PurchaseHistory.item_name == "Black Wide-Leg Trousers",
                )
            )
        ).scalar_one_or_none()
        if not purchase:
            session.add(
                PurchaseHistory(
                    user_id=DEMO_USER_ID,
                    item_name="Black Wide-Leg Trousers",
                    brand="Studio Line",
                    category="Bottoms",
                    price=98.0,
                    purchased_at=datetime.utcnow() - timedelta(days=14),
                    notes="Easy conference base piece.",
                )
            )

        await session.commit()
        print("Seeded demo user and structured demo data.")


if __name__ == "__main__":
    asyncio.run(seed_demo_data())
