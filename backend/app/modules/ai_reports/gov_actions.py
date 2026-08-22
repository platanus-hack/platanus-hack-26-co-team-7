"""Real government actions from Colombian open data (Socrata).

Fetches recent UNGRD emergency-response records from dataset ``rgre-6ak4``
(Emergencias UNGRD 2023-2024, www.datos.gov.co). The ``comentarios`` field
carries the official action log (who attended, what was deployed, status
ACTIVO/LIQUIDADO).

Failure policy: ANY network/parse failure returns ``[]`` — government data
must NEVER break report generation (the report still goes out with the
deterministic SQL snapshot alone).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_SOCRATA_URL = "https://www.datos.gov.co/resource/rgre-6ak4.json"
_FETCH_LIMIT = 8
_TIMEOUT_SECONDS = 10.0
# Official action log kept compact for the LLM prompt.
_ACCIONES_MAX_CHARS = 400

# Ayuda (aid) figures worth surfacing when nonzero.
_AYUDA_FIELDS = (
    "kits_de_alimento",
    "kits_de_aseo",
    "raciones_de_campa_a",
    "valor_total_apoyo",
)


def _to_float(raw: Any) -> float:
    """Socrata numeric fields arrive as strings; tolerate junk."""
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


def _parse_row(row: dict[str, Any]) -> dict[str, Any]:
    """Compact one dataset row into the prompt-friendly dict."""
    comentarios = str(row.get("comentarios") or "").strip()
    action: dict[str, Any] = {
        "fecha": str(row.get("fecha") or ""),
        "municipio": str(row.get("municipio") or ""),
        "evento": str(row.get("evento") or ""),
        "acciones": comentarios[-_ACCIONES_MAX_CHARS:] if comentarios else "",
    }
    ayuda = {
        field: _to_float(row.get(field))
        for field in _AYUDA_FIELDS
    }
    nonzero = {k: v for k, v in ayuda.items() if v != 0}
    if nonzero:
        action["ayuda"] = nonzero
    return action


async def fetch_recent_actions() -> list[dict[str, Any]]:
    """Latest UNGRD actions for the configured department, newest first.

    Returns ``[]`` on any failure (network, HTTP error, malformed payload).
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get(
                _SOCRATA_URL,
                params={
                    "$limit": _FETCH_LIMIT,
                    "$order": "fecha DESC",
                    "$where": f"departamento='{settings.gov_department}'",
                },
            )
            response.raise_for_status()
            rows = response.json()
    except Exception:  # noqa: BLE001 - gov data must never break reports
        logger.warning("Could not fetch UNGRD gov actions", exc_info=True)
        return []

    if not isinstance(rows, list):
        return []
    return [_parse_row(row) for row in rows if isinstance(row, dict)]
