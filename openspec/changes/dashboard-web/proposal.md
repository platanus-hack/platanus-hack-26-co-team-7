# Proposal: Dashboard web público ZIRO (heatmap H3 + reportes IA + realtime)

> Nota sobre DECISIONS.md: ninguna idea aquí fue rechazada. La decisión del 2026-08-22 ("dashboard web = post-hackathon") queda **superada** por esta propuesta: se adelanta el dashboard público al MVP para la demo ante jueces.

## Intención

Hoy el mundo online de ZIRO no existe: solo hay modelos SQLAlchemy (`backend/app/models/`). Sin dashboard, todo lo que la red mesh produce (celdas H3 agregadas, reportes) es invisible para rescatistas, prensa y **jueces**: la sección "para qué sirve" del pitch no tiene cara visual. Este change crea la primera superficie pública: mapa de calor en tiempo real + feed de reportes IA sobre el evento abierto más reciente.

## Alcance

### Dentro (scope fijo confirmado)

- `backend/app/main.py`: app FastAPI única (arquitectura.md Componente 2) + routers.
  - `GET /api/v1/heatmap?event_id=` — sin param usa el último evento abierto; ventana **ACUMULADA** total del evento (todas las celdas desde el inicio).
  - `GET /api/v1/reports?event_id=&limit=50` — ordenados por `generated_at` DESC.
  - `WS /ws` — broadcast anónimo tipado: `CELLS_UPDATED | REPORT_CREATED`.
  - CORS para el dominio estático de la web.
- `frontWeb/` (directorio separado del backend): Vite + React + TS · MapLibre GL + deck.gl `H3HexagonLayer` · basemap OpenFreeMap (sin API key). Consume exclusivamente los endpoints públicos del módulo web del backend.
- Seed `backend/scripts/seed_demo.py`: Event + ReceivedCells alrededor de Bogotá + Reports plausibles (única vía de datos, pues no hay ingesta).
- Nota de deploy: backend en Railway/Fly/Render (soporta WS); web estática en Vercel/Netlify.

### Fuera (explícito)

- Selector de eventos ni `GET /api/v1/events`.
- Zonas silenciosas ("vacíos") del feed.
- `POST /api/v1/telegrams`, pipeline LLM real (reports se leen de `reports`, llenos por seed), auth completa, app móvil.
- Recalcular intensidad (ya viene precalculada en `received_cells.intensity`).

## Capacidades (contrato con sdd-spec)

### Nuevas

- `public-api-readonly`: endpoints GET + WS públicos, contratos de respuesta, invariantes de privacidad (solo agregados H3, nunca coordenadas ni `sid`).
- `dashboard-web-ui`: mapa, feed (último reporte destacado + anteriores accesibles), reconexión WS con backoff + reconciliación vía REST.
- `demo-seed-data`: script reproducible de datos mock para demo.

### Modificadas

- Ninguna (`openspec/specs/` aún vacío).

## Enfoque técnico por pieza (detalles → design)

- **Heatmap**: lectura directa de `received_cells` filtrando por `event_id`; centroide server-side con `h3-py` (`cell_to_latlng`) — un solo punto de verdad; el cliente consume `h3_index` directo en `H3HexagonLayer` (evita re-binning de `HexagonLayer` clásica).
- **Reports**: `content` JSONB pasa tal cual (validado upstream); la UI solo renderiza.
- **WS**: notificación pura, sin estado; el cliente siempre reconcilia con GET (WS caído ≠ UI rota).
- **Privacidad**: el centroide de celda ~500 m deriva de datos ya agregados — respeta el invariante de architecture.md.

## Áreas afectadas

| Área | Impacto |
|---|---|
| `backend/app/main.py`, `backend/app/routers/`, `backend/app/schemas/` | Nuevo |
| `backend/scripts/seed_demo.py` | Nuevo |
| `backend/pyproject.toml` (+fastapi, uvicorn, h3) | Modificado |
| `frontWeb/` (scaffold completo) | Nuevo |

## Riesgos

| Riesgo | Prob. | Mitigación |
|---|---|---|
| Vercel/Netlify no soportan WS persistente | Alta | Backend NUNCA en serverless; deploy Railway/Fly/Render |
| CORS entre dominio web y API | Media | CORSMiddleware con orígenes explícitos; validar Origin también en WS |
| Bundle deck.gl+MapLibre (~200 KB gzip) | Media | Lazy-load del mapa; resto de la UI liviana |
| Sin framework de tests | Alta | Verificación manual/smoke documentada en verify |
| Resolución H3 inconsistente seed vs agregador futuro | Baja | Fijar res 8 (~500 m) en design como constante compartida |

## Plan de rollback

Change 100% aditivo: no toca modelos existentes. Rollback = revertir commits del change (`git revert` del rango) y borrar `frontWeb/`; la DB conserva tablas intactas (el seed solo INSERTA datos de demo, eliminables con `DELETE` por `event_id`). El deploy del backend puede desactivarse sin afectar otros módulos porque no hay consumidores internos.

## Forecast de tamaño

Backend (~300 líneas) + seed (~120) + scaffold web + mapa + feed (~700+) + config/deploy (~50) ≈ **1.100–1.300 líneas nuevas**. Supera con claridad el presupuesto de revisión de 400 líneas ⇒ disparará ask-on-risk: recomendar entrega en slices (backend API → seed → mapa → feed).

## Dependencias

- PostgreSQL accesible (local o Supabase/Neon free tier).
- Cuentas Railway/Fly/Render + Vercel/Netlify para deploy.
- h3-py, fastapi, uvicorn (nuevas en pyproject).

## Criterios de éxito

- [ ] El dashboard muestra el último evento abierto con celdas H3 pintadas por intensidad.
- [ ] Un nuevo reporte insertado aparece en el feed sin recargar (vía WS o reconexión).
- [ ] Ningún endpoint expone coordenadas crudas ni `sid`.
- [ ] Demo reproducible con un solo comando de seed.
