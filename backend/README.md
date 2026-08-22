# Replica Backend — Models layer

SQLAlchemy 2.0 models for the Replica emergency communication network backend.
This package currently contains **only** the database schema (config + Base + models).
No FastAPI app, endpoints, orchestrator, or Alembic migrations yet.

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

## Create tables

```python
from app.core.database import Base, engine
import app.models  # noqa: F401  (registers all tables on Base.metadata)

Base.metadata.create_all(engine)
```

Alembic migrations are a planned follow-up; `create_all` is only for early dev bootstrapping.
