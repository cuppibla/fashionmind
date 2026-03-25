"""Seed the products table with the initial 12 catalog items."""

import asyncio
import json
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().with_name(".env"))

from db.database import create_all_tables, async_session
from db.models import Product
from sqlalchemy import select

PRODUCTS = [
    {
        "title": "Floral Summer Dress",
        "subtitle": "Summer Collection",
        "price": 49.99,
        "images": ["/images/product_1.png", "/images/prod1_var1.png", "/images/prod1_var2.png"],
        "category": "Dresses",
    },
    {
        "title": "Classic Denim Jeans",
        "subtitle": "Premium Denim",
        "price": 59.99,
        "images": ["/images/product_2.png", "/images/prod2_var1.png", "/images/prod2_var2.png"],
        "category": "Bottoms",
    },
    {
        "title": "White Cotton Tee",
        "subtitle": "Organic Cotton",
        "price": 24.99,
        "images": ["/images/product_3.png", "/images/prod3_var1.png", "/images/prod3_var2.png"],
        "category": "Tops",
    },
    {
        "title": "Leather Ankle Boots",
        "subtitle": "Genuine Leather",
        "price": 89.99,
        "images": ["/images/product_4.png", "/images/prod4_var1.png", "/images/prod4_var2.png"],
        "category": "Shoes",
    },
    {
        "title": "Red Cocktail Dress",
        "subtitle": "Evening Glam",
        "price": 129.00,
        "images": ["/images/product_1.png", "/images/prod5_var1.png", "/images/prod5_var2.png"],
        "category": "Dresses",
    },
    {
        "title": "Denim Shirt Dress",
        "subtitle": "Casual Day",
        "price": 55.99,
        "images": ["/images/product_2.png", "/images/prod6_var1.png", "/images/prod6_var2.png"],
        "category": "Dresses",
    },
    {
        "title": "Cropped Bomber",
        "subtitle": "Street Style",
        "price": 85.00,
        "images": ["/images/bomber_jacket.png", "/images/prod7_var1.png", "/images/prod7_var2.png"],
        "category": "Outerwear",
    },
    {
        "title": "Classic High Tops",
        "subtitle": "Kicks & Co.",
        "price": 95.00,
        "images": ["/images/hightop.png", "/images/prod8_var1.png", "/images/prod8_var2.png"],
        "category": "Shoes",
    },
    {
        "title": "Plaid Button Up",
        "subtitle": "Cozy Flannel",
        "price": 45.00,
        "images": ["/images/plaid_shirt.png", "/images/prod9_var1.png", "/images/prod9_var2.png"],
        "category": "Tops",
    },
    {
        "title": "Quarter-Zip Pullover",
        "subtitle": "Active Wear",
        "price": 60.00,
        "images": ["/images/quarter-zip.png", "/images/prod10_var1.png", "/images/prod10_var2.png"],
        "category": "Tops",
    },
    {
        "title": "Flutter Hat",
        "subtitle": "Headwear",
        "price": 25.00,
        "images": ["/images/flutter_hat.png", "/images/prod11_var1.png", "/images/prod11_var2.png"],
        "category": "Accessories",
    },
    {
        "title": "Letterman Jacket",
        "subtitle": "Varsity Style",
        "price": 110.00,
        "images": ["/images/flutter_letterman.png", "/images/prod12_var1.png", "/images/prod12_var2.png"],
        "category": "Outerwear",
    },
]


async def seed():
    await create_all_tables()

    async with async_session() as db:
        # Check if products already exist
        result = await db.execute(select(Product))
        existing = result.scalars().all()
        if existing:
            print(f"Products table already has {len(existing)} rows — skipping seed.")
            return

        for p in PRODUCTS:
            product = Product(
                title=p["title"],
                subtitle=p["subtitle"],
                price=p["price"],
                images=json.dumps(p["images"]),
                category=p["category"],
            )
            db.add(product)

        await db.commit()
        print(f"Seeded {len(PRODUCTS)} products.")


if __name__ == "__main__":
    asyncio.run(seed())
