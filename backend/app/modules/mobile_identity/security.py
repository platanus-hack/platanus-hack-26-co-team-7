"""Dependency-free password, access-token, and refresh-token primitives."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.modules.mobile_identity.config import settings

bearer_scheme = HTTPBearer(auto_error=False)
JWT_ALGORITHM = "HS256"
JWT_AUDIENCE = "replica-mobile"
JWT_ISSUER = "replica-api"


def utcnow() -> datetime:
    return datetime.now(UTC)


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16_384, r=8, p=1, dklen=32)
    return f"scrypt${_b64encode(salt)}${_b64encode(digest)}"


def verify_password(password: str, password_digest: str) -> bool:
    try:
        algorithm, encoded_salt, encoded_digest = password_digest.split("$", maxsplit=2)
        if algorithm != "scrypt":
            return False
        expected = hashlib.scrypt(password.encode(), salt=_b64decode(encoded_salt), n=16_384, r=8, p=1, dklen=32)
        return hmac.compare_digest(expected, _b64decode(encoded_digest))
    except (ValueError, TypeError):
        return False


def create_access_token(user_id: str) -> str:
    now = int(time.time())
    header = _b64encode(json.dumps({"alg": JWT_ALGORITHM, "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64encode(json.dumps({"sub": user_id, "aud": JWT_AUDIENCE, "iss": JWT_ISSUER, "iat": now, "exp": now + settings.access_token_ttl_seconds, "jti": str(uuid.uuid4())}, separators=(",", ":")).encode())
    signature = _b64encode(hmac.new(settings.jwt_secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


def _claims(credentials: HTTPAuthorizationCredentials | None) -> dict[str, object]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized()
    try:
        header, payload, signature = credentials.credentials.split(".")
        expected = _b64encode(hmac.new(settings.jwt_secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
        claims = json.loads(_b64decode(payload))
        if not hmac.compare_digest(signature, expected) or claims.get("aud") != JWT_AUDIENCE or claims.get("iss") != JWT_ISSUER or not isinstance(claims.get("sub"), str) or not isinstance(claims.get("exp"), int) or claims["exp"] <= int(time.time()):
            raise ValueError
        return claims
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        raise _unauthorized() from None


def require_user_id(credentials: HTTPAuthorizationCredentials | None) -> str:
    return _claims(credentials)["sub"]  # type: ignore[return-value]


def new_refresh_token(session_id: uuid.UUID) -> str:
    return f"{session_id}.{secrets.token_urlsafe(48)}"


def hash_refresh_token(token: str) -> str:
    return hmac.new(settings.refresh_token_pepper.encode(), token.encode(), hashlib.sha256).hexdigest()


def refresh_expiry() -> datetime:
    return utcnow() + timedelta(seconds=settings.refresh_token_ttl_seconds)


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired authentication credentials.", headers={"WWW-Authenticate": "Bearer"})
