"""AI report generator (openspec/architecture.md, "Reportes IA").

Pipeline: deterministic SQL snapshot + real UNGRD gov actions -> LLM
narration (OpenAI-compatible chat completions) -> schema v1 validation ->
persist -> WebSocket broadcast.

Hard guarantees:
- The LLM narrates ONLY the data it is given; it NEVER invents figures.
- If no API key is configured or the LLM call/validation fails, a
  deterministic Spanish template narrative is produced instead. This module
  ALWAYS yields a valid schema v1 report when there is an open event.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.models.analytics import Report, ReportSource
from app.services.gov_actions import fetch_recent_actions
from app.services.snapshot import build_snapshot
from app.ws import ConnectionManager, manager

logger = logging.getLogger(__name__)

_LLM_TIMEOUT_SECONDS = 30.0
_LLM_TEMPERATURE = 0.3

_SYSTEM_PROMPT = (
    "Eres el analista del sistema Replica (red de comunicación de emergencia). "
    "Recibes un snapshot SQL determinista y acciones gubernamentales reales de "
    "la UNGRD. Narras SOLO con los datos entregados: NUNCA inventas cifras ni "
    "acciones. Si un dato no aparece en el snapshot, no lo menciones. "
    'Responde EXCLUSIVAMENTE con JSON válido del esquema v1: '
    '{"version":1,"title":str,"summary":str,"recommendations":[str],'
    '"figures":{"cells_active":int,"people_in_danger":int,"gov_actions_count":int}}. '
    "En figures reutiliza EXACTAMENTE los números del snapshot "
    "(cells_active=totals.active_cells, people_in_danger=totals.total_persons, "
    "gov_actions_count=cantidad de gov_actions). Título y resumen en español."
)


def _fallback_content(snapshot: dict, gov_actions: list[dict[str, Any]]) -> dict:
    """Deterministic Spanish template used when the LLM is unavailable."""
    totals = snapshot["totals"]
    top_cells = snapshot["cells"][:3]
    cell_lines = "; ".join(
        f"celda {cell['h3_index']} con {cell['person_count']} personas "
        f"(intensidad {cell['intensity']:.2f})"
        for cell in top_cells
    )
    gov_summary = ""
    if gov_actions:
        first = gov_actions[0]
        gov_summary = (
            f" La UNGRD registra {len(gov_actions)} acciones recientes; la más "
            f"reciente: {first.get('evento') or 'atención de emergencia'} en "
            f"{first.get('municipio') or 'el departamento'}."
        )

    return {
        "version": 1,
        "title": f"Reporte de situación — {snapshot['event_id']}",
        "summary": (
            f"Evento abierto {snapshot['event_id']}: {totals['total_persons']} "
            f"personas en peligro distribuidas en {totals['active_cells']} celdas "
            f"activas. Zonas más críticas: {cell_lines}.{gov_summary}"
        ),
        "recommendations": [
            "Priorizar el despacho de ayuda a las celdas con mayor número de personas.",
            "Mantener la difusión por la red de nodos hasta confirmar estados SAFE.",
            "Continuar la coordinación con la UNGRD según las acciones reportadas.",
        ],
        "figures": {
            "cells_active": int(totals["active_cells"]),
            "people_in_danger": int(totals["total_persons"]),
            "gov_actions_count": len(gov_actions),
        },
    }


def _coerce_figures(raw: Any) -> dict[str, float] | None:
    """Coerce every figures value to int/float; None if unusable."""
    if not isinstance(raw, dict) or not raw:
        return None
    coerced: dict[str, float] = {}
    for key, value in raw.items():
        try:
            num = float(value)
        except (TypeError, ValueError):
            return None
        coerced[str(key)] = int(num) if num.is_integer() else num
    return coerced


def _validate_content(raw: Any) -> dict | None:
    """Schema v1 validation; returns normalized content or None."""
    if not isinstance(raw, dict):
        return None
    version = raw.get("version")
    title = raw.get("title")
    summary = raw.get("summary")
    recommendations = raw.get("recommendations")
    if version != 1 or not title or not summary:
        return None
    if not isinstance(recommendations, list) or any(
        not isinstance(item, str) for item in recommendations
    ):
        return None
    figures = _coerce_figures(raw.get("figures"))
    if figures is None:
        return None
    return {
        "version": 1,
        "title": str(title),
        "summary": str(summary),
        "recommendations": [str(item) for item in recommendations],
        "figures": figures,
    }


async def _call_llm(snapshot: dict, gov_actions: list[dict[str, Any]]) -> dict | None:
    """Ask the LLM for schema v1 JSON; None on any failure."""
    if not settings.llm_api_key:
        logger.info("LLM_API_KEY empty — using fallback template narrative")
        return None
    try:
        async with httpx.AsyncClient(timeout=_LLM_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                json={
                    "model": settings.llm_model,
                    "temperature": _LLM_TEMPERATURE,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {
                            "role": "user",
                            "content": json.dumps(
                                {"snapshot": snapshot, "gov_actions": gov_actions},
                                ensure_ascii=False,
                            ),
                        },
                    ],
                },
            )
            response.raise_for_status()
            text = response.json()["choices"][0]["message"]["content"]
    except Exception:  # noqa: BLE001 - LLM failure must never break reports
        logger.warning("LLM call failed — using fallback", exc_info=True)
        return None

    # Tolerate markdown fences some models add around JSON.
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    try:
        return _validate_content(json.loads(text))
    except (json.JSONDecodeError, TypeError):
        logger.warning("LLM output failed schema v1 validation — using fallback")
        return None


async def generate_report(
    session_factory: sessionmaker[Session],
    ws_manager: ConnectionManager,
    source: ReportSource = ReportSource.SCHEDULED,
) -> Report | None:
    """Generate, persist and broadcast one report for the latest open event.

    Returns ``None`` (caller decides) when there is no open event or no cells.
    """
    with session_factory() as session:
        snapshot = build_snapshot(session)
        if snapshot is None:
            return None

        gov_actions = await fetch_recent_actions()
        content = await _call_llm(snapshot, gov_actions)
        if content is None:
            content = _fallback_content(snapshot, gov_actions)

        report = Report(event_id=snapshot["event_id"], source=source, content=content)
        session.add(report)
        session.commit()

    await ws_manager.broadcast_report_created(report.event_id, report.id)
    return report


# Default wiring for callers that don't inject dependencies.
default_generate_report_manager = manager
