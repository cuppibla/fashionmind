import uuid
from datetime import datetime, date, timedelta
from typing import Optional

from sqlalchemy import select

from db.database import get_db_context
from db.models import Occasion, PurchaseHistory, User, WishlistItem


async def get_user_context(user_id: str) -> dict:
    """Fetches the user's full profile including body type, upcoming occasions
    in the next 30 days, current wishlist items, and last 5 purchases.
    Call this at the start of every session to personalize responses."""
    async with get_db_context() as db:
        result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
        user = result.scalar_one_or_none()
        if not user:
            return {"error": f"User {user_id} not found"}

        today = date.today()
        in_30 = today + timedelta(days=30)

        occ_result = await db.execute(
            select(Occasion)
            .where(
                Occasion.user_id == uuid.UUID(user_id),
                Occasion.date >= today,
                Occasion.date <= in_30,
            )
            .order_by(Occasion.date.asc())
        )
        occasions = occ_result.scalars().all()

        wish_result = await db.execute(
            select(WishlistItem)
            .where(
                WishlistItem.user_id == uuid.UUID(user_id),
                WishlistItem.status == "wishlist",
            )
            .order_by(WishlistItem.created_at.desc())
            .limit(10)
        )
        wishlist = wish_result.scalars().all()

        purch_result = await db.execute(
            select(PurchaseHistory)
            .where(PurchaseHistory.user_id == uuid.UUID(user_id))
            .order_by(PurchaseHistory.purchased_at.desc())
            .limit(5)
        )
        purchases = purch_result.scalars().all()

        return {
            "profile": {
                "id": str(user.id),
                "name": user.name,
                "email": user.email,
                "age": user.age,
                "body_type": user.body_type,
            },
            "upcoming_occasions": [
                {
                    "id": str(o.id),
                    "name": o.name,
                    "date": str(o.date) if o.date else None,
                    "notes": o.notes,
                }
                for o in occasions
            ],
            "wishlist": [
                {
                    "id": str(w.id),
                    "item_name": w.item_name,
                    "brand": w.brand,
                    "category": w.category,
                    "price": float(w.price) if w.price else None,
                }
                for w in wishlist
            ],
            "recent_purchases": [
                {
                    "id": str(p.id),
                    "item_name": p.item_name,
                    "brand": p.brand,
                    "category": p.category,
                    "purchased_at": str(p.purchased_at),
                    "notes": p.notes,
                }
                for p in purchases
            ],
        }


async def get_upcoming_occasions(user_id: str) -> list:
    """Returns all of this user's upcoming occasions with dates and notes,
    sorted nearest first. Use when user asks what events they have coming up
    or needs outfit ideas for a specific upcoming date."""
    async with get_db_context() as db:
        result = await db.execute(
            select(Occasion)
            .where(
                Occasion.user_id == uuid.UUID(user_id),
                Occasion.date >= date.today(),
            )
            .order_by(Occasion.date.asc())
        )
        occasions = result.scalars().all()
        return [
            {
                "id": str(o.id),
                "name": o.name,
                "date": str(o.date) if o.date else None,
                "notes": o.notes,
            }
            for o in occasions
        ]


async def add_to_wishlist(
    user_id: str,
    item_name: str,
    brand: str = "",
    category: str = "",
    price: float = 0.0,
    url: str = "",
) -> dict:
    """Saves an item to the user's wishlist. Call whenever the user expresses
    interest in buying something, says 'I love that', 'save that for me',
    or 'remind me to get...'."""
    async with get_db_context() as db:
        item = WishlistItem(
            user_id=uuid.UUID(user_id),
            item_name=item_name,
            brand=brand or None,
            category=category or None,
            price=price or None,
            url=url or None,
        )
        db.add(item)
        await db.commit()
        await db.refresh(item)
        return {"success": True, "item_id": str(item.id)}


async def mark_purchased(user_id: str, item_id: str, notes: str = "") -> dict:
    """Marks a wishlist item as purchased and creates a purchase history record.
    Call when user says 'I bought it', 'I got the [item]', or 'I purchased...'."""
    async with get_db_context() as db:
        result = await db.execute(
            select(WishlistItem).where(
                WishlistItem.id == uuid.UUID(item_id),
                WishlistItem.user_id == uuid.UUID(user_id),
            )
        )
        item = result.scalar_one_or_none()
        if not item:
            return {"success": False, "error": "Item not found"}

        now = datetime.utcnow()
        item.status = "purchased"
        item.purchased_at = now

        purchase = PurchaseHistory(
            user_id=uuid.UUID(user_id),
            item_name=item.item_name,
            brand=item.brand,
            price=item.price,
            category=item.category,
            purchased_at=now,
            notes=notes or None,
        )
        db.add(purchase)
        await db.commit()
        return {"success": True}


async def add_occasion(
    user_id: str, name: str, date: str = "", notes: str = ""
) -> dict:
    """Adds a new event or occasion to the user's calendar. Call whenever the
    user mentions an upcoming event, trip, meeting, wedding, interview, or date.
    date must be ISO format YYYY-MM-DD."""
    from datetime import date as date_type
    async with get_db_context() as db:
        parsed_date = None
        if date:
            try:
                parsed_date = date_type.fromisoformat(date)
            except ValueError:
                pass

        occ = Occasion(
            user_id=uuid.UUID(user_id),
            name=name,
            date=parsed_date,
            notes=notes or None,
        )
        db.add(occ)
        await db.commit()
        await db.refresh(occ)
        return {"success": True, "occasion_id": str(occ.id)}


async def get_style_summary(user_id: str) -> str:
    """Returns a plain text summary of the user's body type, color and style
    preferences inferred from purchase history, and upcoming occasions.
    Use to answer questions like 'what do you know about my style?'"""
    async with get_db_context() as db:
        result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
        user = result.scalar_one_or_none()
        if not user:
            return "No user data found."

        purch_result = await db.execute(
            select(PurchaseHistory)
            .where(PurchaseHistory.user_id == uuid.UUID(user_id))
            .order_by(PurchaseHistory.purchased_at.desc())
            .limit(3)
        )
        purchases = purch_result.scalars().all()

        occ_result = await db.execute(
            select(Occasion)
            .where(
                Occasion.user_id == uuid.UUID(user_id),
                Occasion.date >= date.today(),
            )
            .order_by(Occasion.date.asc())
            .limit(3)
        )
        occasions = occ_result.scalars().all()

        lines = [f"User: {user.name}"]
        if user.body_type:
            lines.append(f"Body type: {user.body_type}")
        if user.age:
            lines.append(f"Age: {user.age}")

        if purchases:
            lines.append("Recent purchases:")
            for p in purchases:
                brand_str = f" by {p.brand}" if p.brand else ""
                lines.append(f"  - {p.item_name}{brand_str}")

        if occasions:
            lines.append("Upcoming occasions:")
            for o in occasions:
                date_str = f" on {o.date}" if o.date else ""
                lines.append(f"  - {o.name}{date_str}")

        return "\n".join(lines)
