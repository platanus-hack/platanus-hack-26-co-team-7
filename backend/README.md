# Replica Backend — Models layer

SQLAlchemy 2.0 models for the Replica emergency communication network backend.
This package currently contains the database schema (config + Base + models) and Alembic migrations.
No FastAPI app, endpoints, or orchestrator yet.

Runtime target is **PostgreSQL** (driver: `psycopg` 3). See `openspec/architecture.md`.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -e .
```

## Database URL

The connection string comes from the `DATABASE_URL` environment variable.
Default (local dev):

```
postgresql+psycopg://replica:replica@localhost:5432/replica
```

PowerShell example:

```powershell
$env:DATABASE_URL = "postgresql+psycopg://user:pass@host:5432/replica"
```

## Apply database migrations

```bash
alembic upgrade head
```

Alembic is the sole authority for creating and evolving the database schema.
