# syntax=docker/dockerfile:1

# Replica backend — FastAPI service. Production target: Render (web service).
# Render builds this image and injects PORT + all env vars at runtime.
FROM python:3.12-slim

# Non-root user for the runtime process (Render runs containers as an
# arbitrary UID, so the app must not assume root).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Copy only the application and migration sources required at runtime.
COPY pyproject.toml ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

RUN pip install .

# Render injects PORT at runtime; the entrypoint runs migrations then serves.
EXPOSE 8000

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Normalize CRLF -> LF (Windows checkouts can corrupt the shebang line).
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
