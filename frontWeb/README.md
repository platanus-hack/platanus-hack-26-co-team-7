# ZIRO — Dashboard web público

Dashboard de estado del desastre: mapa de calor H3 en tiempo real + feed de reportes IA.
Vite + React + TypeScript, estilizado 100 % con **Tailwind CSS v4** (sin CSS propio).

## Ejecutar

```bash
npm install
npm run dev
```

Abre http://localhost:5173.

Para datos reales, levanta el backend primero (ver `backend/README` o `uvicorn app.main:app`
desde `backend/`) y ejecuta el seed demo:

```bash
cd ../backend && python -m scripts.seed_demo
```

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:8000` | Base URL de la API pública |
| `VITE_WS_URL` | `ws://localhost:8000/ws` | WebSocket para actualizaciones realtime |

## Datos de respaldo (fallback)

Si el backend no responde, la UI renderiza igual con un dataset demo embebido
(`src/lib/fallbackData.ts`, ~15 celdas H3 alrededor de Bogotá + 3 reportes) y muestra una
insignia «Datos de demostración». El mapa NUNCA queda en blanco por falta de backend.

## Estructura

```
src/
├── main.tsx / App.tsx          # shell liviano; mapa bajo React.lazy
├── components/MapView.tsx      # chunk diferido: MapLibre + deck.gl H3HexagonLayer
├── components/ReportFeed.tsx   # último reporte destacado + anteriores colapsables
├── hooks/useRealtime.ts        # WS con backoff exponencial (1 s ×2, máx 30 s, jitter ±20 %)
└── lib/{api,constants,types,fallbackData}.ts
```
