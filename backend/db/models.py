import uuid
from sqlalchemy import Column, String, Integer, Enum, DateTime, Date, ForeignKey, Numeric, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

Base = declarative_base()

class User(Base):
    __tablename__ = 'users'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    age = Column(Integer, nullable=True)
    body_type = Column(Enum('petite', 'straight', 'curvy', 'athletic', 'tall', name='body_type_enum'), nullable=True)
    created_at = Column(DateTime, default=func.now())
    occasions = relationship("Occasion", back_populates="user", cascade="all, delete-orphan")
    wishlist_items = relationship("WishlistItem", back_populates="user", cascade="all, delete-orphan")
    purchases = relationship("PurchaseHistory", back_populates="user", cascade="all, delete-orphan")

class Occasion(Base):
    __tablename__ = 'occasions'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'))
    name = Column(String(100))
    date = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    user = relationship("User", back_populates="occasions")

class WishlistItem(Base):
    __tablename__ = 'wishlist_items'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'))
    item_name = Column(String(200))
    brand = Column(String(100), nullable=True)
    price = Column(Numeric(10,2), nullable=True)
    url = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)
    status = Column(Enum('wishlist', 'purchased', 'archived', name='wishlist_status_enum'), default='wishlist')
    purchased_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())
    user = relationship("User", back_populates="wishlist_items")

class Product(Base):
    __tablename__ = 'products'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(200), nullable=False)
    subtitle = Column(String(200), nullable=True)
    price = Column(Numeric(10, 2), nullable=False)
    images = Column(Text, nullable=True)  # JSON array of image URL strings
    category = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=func.now())


class PurchaseHistory(Base):
    __tablename__ = 'purchase_history'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'))
    item_name = Column(String(200))
    brand = Column(String(100), nullable=True)
    price = Column(Numeric(10,2), nullable=True)
    category = Column(String(100), nullable=True)
    purchased_at = Column(DateTime, nullable=False)
    notes = Column(Text, nullable=True)
    user = relationship("User", back_populates="purchases")
