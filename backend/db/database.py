import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool, StaticPool

from .models import Base

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://fashionmind_user:fashionmind_pass@localhost/fashionmind",
)

if "/cloudsql/" in DATABASE_URL:
    # Cloud SQL Python Connector path
    from google.cloud.sql.connector import Connector, create_async_connector

    # Parse the cloud sql instance from the URL query param ?host=/cloudsql/...
    import re
    match = re.search(r"host=/cloudsql/([^&]+)", DATABASE_URL)
    INSTANCE_CONNECTION_NAME = match.group(1) if match else ""

    # Parse user/pass/db from URL
    db_match = re.match(
        r"postgresql\+asyncpg://([^:]+):([^@]+)@/([^?]+)", DATABASE_URL
    )
    DB_USER = db_match.group(1) if db_match else "fashionmind_user"
    DB_PASS = db_match.group(2) if db_match else "fashionmind_pass"
    DB_NAME = db_match.group(3) if db_match else "fashionmind"

    _connector = None

    async def _getconn():
        global _connector
        if _connector is None:
            _connector = await create_async_connector()
        return await _connector.connect_async(
            INSTANCE_CONNECTION_NAME,
            "asyncpg",
            user=DB_USER,
            password=DB_PASS,
            db=DB_NAME,
        )

    engine = create_async_engine(
        "postgresql+asyncpg://",
        async_creator=_getconn,
        poolclass=NullPool,
    )
elif DATABASE_URL.startswith("sqlite"):
    engine = create_async_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
else:
    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)

async_session = async_sessionmaker(
    engine, expire_on_commit=False, class_=AsyncSession
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


@asynccontextmanager
async def get_db_context() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


async def create_all_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
