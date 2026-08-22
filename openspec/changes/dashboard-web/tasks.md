# Tasks: Dashboard web público ZIRO (heatmap H3 + reportes IA + realtime)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1180 total — Slice 1 backend API ~380 · Slice 2 seed ~150 · Slice 3 frontWeb scaffold+mapa ~370 · Slice 4 feed+WS ~280 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 (work units abajo) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | API FastAPI readonly (heatmap/reports/WS/CORS) | PR 1 | `uvicorn app.main:app` + curl de endpoints | curl/wscat sobre DB local vacía y sembrada | Revert commits backend; no toca modelos existentes |
| 2 | Seed demo idempotente | PR 2 | Ejecutar `seed_demo.py` dos veces (cero duplicados) | PostgreSQL local limpia | `DELETE` por DEMO_EVENT_ID |
| 3 | frontWeb scaffold + mapa H3 | PR 3 | `npm run build` + revisión de chunks | Navegador contra backend local | Borrar `frontWeb/` completo |
| 4 | Feed + WS backoff + reconciliación | PR 4 | `npm run dev`; matar/relanzar uvicorn | wscat + navegador | Revert solo dentro de `frontWeb/src` |

## Fase 1: Backend — API pública readonly (spec public-api-readonly)

- [ ] 1.1 Modificar `backend/pyproject.toml`: añadir `fastapi`, `uvicorn[standard]`, `h3` e instalar (proposal Dependencias).
- [ ] 1.2 Crear `backend/app/constants.py`: `H3_CELL_RESOLUTION = 8` citando DECISIONS.md (D1).
- [ ] 1.3 Modificar `backend/app/config.py`: campo `cors_origins` desde env `BACKEND_CORS_ORIGINS` coma-separada; sin wildcard con credenciales (D5; spec CORS).
- [ ] 1.4 Crear `backend/app/schemas/dashboard.py`: CellOut, HeatmapResponse, ReportOut, ReportsResponse, ErrorResponse (contratos GET del spec).
- [ ] 1.5 Crear `backend/app/routers/heatmap.py` (+ `routers/__init__.py`): GET `/api/v1/heatmap` — último evento abierto (`closed_at IS NULL ORDER BY occurred_at DESC LIMIT 1`); query acumulada GROUP BY `h3_index` (SUM/MAX/MAX, D6); centroide server-side con `h3.cell_to_latlng`; sin evento ⇒ 200 `{cells: []}`; event_id inexistente ⇒ 404 tipado (escenarios: «Heatmap con datos acumulados», «Evento abierto inexistente», «event_id inexistente»).
- [ ] 1.6 Crear `backend/app/routers/reports.py`: GET `/api/v1/reports?event_id=&limit=50` — `generated_at` DESC; `content` JSONB tal cual, sin interpretar (escenarios del requirement reports).
- [ ] 1.7 Crear `backend/app/ws.py`: ConnectionManager singleton in-process; broadcast tipado CELLS_UPDATED/REPORT_CREATED; origen validado contra cors_origins (D7).
- [ ] 1.8 Crear `backend/app/routers/ws.py`: WS `/ws` anónimo; desconexión limpia try/finally (D7; escenarios de broadcast).
- [ ] 1.9 Crear `backend/app/main.py`: `create_app()` con lifespan (`Base.metadata.create_all`), CORSMiddleware con orígenes explícitos, include routers (D5; escenario «Petición desde el origen de la web»).
- [ ] 1.10 Smoke fase 1 (curl): DB vacía ⇒ ambas GET 200 con colecciones vacías («Arranque en frío»); `POST /api/v1/telegrams` ⇒ 404/405 («Intento de escritura rechazado»); ninguna respuesta expone coordenadas crudas ni `sid` («Auditoría de privacidad», «Centroide deriva solo de la celda»).

Dependencia: Fase 2 requiere 1.1 instalado; Fases 3–4 requieren endpoints de Fase 1 para verificarse contra contratos reales.

## Fase 2: Seed de demo (spec demo-seed-data)

- [ ] 2.1 Crear `backend/scripts/seed_demo.py` con argparse cuyo `--help` documente EXPLÍCITAMENTE el comportamiento idempotente elegido (reconstrucción por evento demo) — correctivo del validador; el requirement «Idempotencia o reinicio explícito» exige el comportamiento documentado en la ayuda (D3).
- [ ] 2.2 Implementar upsert por `event_id="DEMO-EARTHQUAKE001"`: si existe, borrar received_cells (FK CASCADE) y reports (DELETE explícito, FK RESTRICT) y reinsertar en una transacción (D3; escenario «Re-ejecución sin duplicados»).
- [ ] 2.3 Insertar Event abierto + ReceivedCells alrededor de Bogotá derivadas con h3-py res 8 (importar `constants.H3_CELL_RESOLUTION`), intensidades variadas, ventanas contenidas en el evento (escenarios «Seed desde base de datos vacía», «Datos plausibles»).
- [ ] 2.4 Insertar Reports plausibles: content JSON v1 `{version,title,summary,recommendations,figures}` (D2), fuente SCHEDULED/MANUAL, `generated_at` crecientes.
- [ ] 2.5 Verificar compatibilidad con la API: GET heatmap devuelve exactamente las celdas sembradas con intensidades; GET reports DESC (escenarios «Seed alimenta al heatmap público», «Seed alimenta al feed»).

Dependencia crítica: el mapa (Fase 3) solo es verificable visualmente con datos del seed.

## Fase 3: frontWeb — scaffold + mapa (spec dashboard-web-ui)

- [ ] 3.1 Scaffold Vite react-ts en `frontWeb/`; instalar maplibre-gl y deck.gl (H3HexagonLayer); definir `VITE_API_URL` (D8).
- [ ] 3.2 Crear `src/lib/constants.ts` con `H3_CELL_RESOLUTION = 8` citando DECISIONS.md — NOTA correctiva: H3HexagonLayer NO lo consume (toma `h3_index` directo); se mantiene solo como trazabilidad de D1, sin uso runtime.
- [ ] 3.3 Crear `src/lib/types.ts`: `interface ReportContent` espejo del schema v1 de D2; render defensivo (campo ausente ≠ crash).
- [ ] 3.4 Crear `src/api/client.ts`: base URL desde `VITE_API_URL`; fetch tipado de heatmap/reports.
- [ ] 3.5 Crear `src/map/MapCanvas.tsx`: MapLibre GL + estilo OpenFreeMap liberty + H3HexagonLayer por `h3_index`, rampa de color por intensity (D8; escenarios «Visualización del heatmap», «Zoom y exploración»).
- [ ] 3.6 En App.tsx: `React.lazy(() => import("./map/MapCanvas"))` + Suspense; shell visible antes del mapa (requirement «Lazy-load»; escenario «Carga inicial liviana»).
- [ ] 3.7 Estados vacío/carga/error explícitos con reintento (escenarios «Primer arranque sin seed», «Error transitorio de red»).
- [ ] 3.8 Verificar build: librerías de mapas en chunk diferido, fuera del bundle crítico.

## Fase 4: frontWeb — feed, cliente WS y reconciliación (spec dashboard-web-ui)

- [ ] 4.1 Crear `src/hooks/useWebSocket.ts`: backoff 1000 ms ×2, máx 30 000 ms, jitter ±20 %; reset a 1000 ms tras reconexión exitosa (D4; escenario «Recuperación y reconciliación»).
- [ ] 4.2 Al abrir conexión (inicial o post-caída): reconciliación REST completa (GET heatmap + GET reports) (D4).
- [ ] 4.3 CELLS_UPDATED ⇒ refrescar heatmap y redibujar sin recargar («Actualización del mapa en tiempo real»); durante caída, UI conserva últimos datos conocidos («Caída temporal del WebSocket»).
- [ ] 4.4 Crear `src/components/ReportFeed.tsx` dueño explícito del render del ÚLTIMO REPORTE DESTACADO y del acceso a anteriores (lista/scroll) sobre GET reports (correctivo del validador; escenarios «Último reporte visible de inmediato», «Nuevo reporte entra por realtime»): REPORT_CREATED ⇒ refresca y el nuevo pasa a destacado.
- [ ] 4.5 Crear `src/components/StatusBanner.tsx`: estado de conexión WS visible sin romper la UI.

## Fase 5: Verificación smoke integral (sin framework de tests — verify)

- [ ] 5.1 Checklist end-to-end mapeando los escenarios de las tres specs: seed en DB limpia → curl de ambos GET (incluidos 404 y vacíos) → wscat recibe CELLS_UPDATED/REPORT_CREATED del seed embebido (D7) → navegador: mapa con intensidades distinguibles, feed con destacado, matar/relanzar uvicorn verificando intervalos crecientes y reconciliación, estados vacío/error, chunk diferido confirmado, auditoría final sin coordenadas ni `sid`.
