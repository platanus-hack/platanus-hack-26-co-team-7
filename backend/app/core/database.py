"""Database engine, session factory and declarative base.

Implements the persistence layer of the FastAPI single-process backend
(openspec/architecture.md, Componente 2/3): one sync engine against
PostgreSQL using the ``psycopg`` driver.
"""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    """SQLAlchemy 2.0 declarative base for all Replica models."""


engine = create_engine(settings.database_url, pool_pre_ping=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Generator[Session, None, None]:
    """FastAPI-dependency-ready session generator.

    Yields a session per request and guarantees cleanup.
    """
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
