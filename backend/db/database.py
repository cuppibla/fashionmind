import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool
from contextlib import asynccontextmanager
from .models import Base
from google.cloud.sql.connector import Connector, IPTypes
import asyncpg
import asyncio

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/fashionmind")

engine = None
if "/cloudsql/" in DATABASE_URL:
    # Use cloud-sql-python-connector
    def getconn():
        # Parsing DATABASE_URL is complex here; assuming standard connector pattern
        pass 
    # For now, just rely on raw URL fallback or connector logic based on env
    # Simplification for demo purposes:
    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
else:
    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)

async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

async def get_db():
    async with async_session() as session:
        yield session

@asynccontextmanager
async def get_db_context():
    async with async_session() as session:
        yield session

async def create_all_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
