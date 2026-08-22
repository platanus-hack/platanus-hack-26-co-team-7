"""Application settings.

Reads the database connection string from the ``DATABASE_URL`` environment
variable with a sane local development default (PostgreSQL + psycopg driver,
per openspec/architecture.md Componente 3).
"""

from __future__ import annotations

import os

from dataclasses import dataclass

DEFAULT_DATABASE_URL = "postgresql+psycopg://ziro:ziro@localhost:5432/ziro"


@dataclass(frozen=True)
class Settings:
    database_url: str = DEFAULT_DATABASE_URL


settings = Settings(database_url=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL))
