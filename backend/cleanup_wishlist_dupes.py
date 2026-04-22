"""One-time script to remove duplicate wishlist rows from CloudSQL.

Keeps the oldest row per (user_id, lower(item_name)) combination
where status='wishlist'. All newer duplicates are deleted.
"""

import asyncio
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import delete, func, select

load_dotenv(Path(__file__).resolve().with_name(".env"))

from db.database import create_all_tables, async_session
from db.models import WishlistItem


async def cleanup() -> None:
    await create_all_tables()

    async with async_session() as session:
        # Find all (user_id, item_name) groups that have duplicates
        subq = (
            select(
                WishlistItem.user_id,
                func.lower(WishlistItem.item_name).label("name_lower"),
                func.min(WishlistItem.created_at).label("oldest"),
            )
            .where(WishlistItem.status == "wishlist")
            .group_by(WishlistItem.user_id, func.lower(WishlistItem.item_name))
            .having(func.count() > 1)
            .subquery()
        )

        # Get all wishlist items that are duplicates
        all_items = await session.execute(
            select(WishlistItem).where(WishlistItem.status == "wishlist")
        )
        items = all_items.scalars().all()

        # Group by (user_id, lower(item_name))
        groups: dict[tuple, list] = {}
        for item in items:
            key = (str(item.user_id), item.item_name.strip().lower())
            groups.setdefault(key, []).append(item)

        deleted = 0
        for key, group in groups.items():
            if len(group) <= 1:
                continue
            # Sort by created_at, keep the oldest
            group.sort(key=lambda x: x.created_at or x.id)
            for dup in group[1:]:
                await session.delete(dup)
                deleted += 1
                print(f"  Deleting duplicate: {dup.item_name} (id={dup.id})")

        await session.commit()
        print(f"\nDone. Deleted {deleted} duplicate wishlist item(s).")


if __name__ == "__main__":
    asyncio.run(cleanup())
