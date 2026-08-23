#!/bin/sh
# Replica backend entrypoint. Runs pending Alembic migrations (idempotent) and
# then serves the FastAPI app bound to Render's injected PORT.
set -e

echo "Applying database migrations (alembic upgrade head)..."
alembic upgrade head

# Render provides $PORT; default to 8000 for local docker runs.
PORT="${PORT:-8000}"
echo "Starting uvicorn on 0.0.0.0:${PORT}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT}"