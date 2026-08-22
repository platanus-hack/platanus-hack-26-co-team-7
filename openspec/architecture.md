# Replica — Arquitectura del sistema

> Visión de alto nivel de los componentes de Replica, sus responsabilidades, tecnologías y fronteras. Este documento es el mapa; los detalles finos viven en `protocol.md`, `communication.md`, `ledger.md` y `api.md`.

## Principio rector

Replica son **dos mundos con una sola frontera**:

- El **mundo offline** (móvil) pelea por mantener viva la información sin infraestructura.
- El **mundo online** (backend + web) convierte esa información en algo público y accionable en cuanto llega al servidor.

La única comunicación entre ambos mundos es el **vuelco del gateway**: un dispositivo con Internet sube su outbox de telegramas al backend. Nada más cruza la frontera.

## Diagrama general

```
        MUNDO OFFLINE                          MUNDO ONLINE
┌─────────────────────────────┐      ┌─────────────────────────────────┐
│                             │      │                                 │
│  📱 App Android (nodos)     │      │  ☁️ BACKEND (FastAPI, 1 proceso)│
│  ├─ UI (React Native)       │      │  ├─ Módulo Ingesta              │
│  ├─ Servicios nativos       │      │  ├─ Trigger Engine (SGC/EMSC)   │
│  │   (Kotlin):              │      │  ├─ Agregador espacial (h3-py)  │
│  │   Nearby Connections     │      │  ├─ Reportes IA (LLM)           │
│  │   Foreground services    │      │  └─ WebSocket realtime          │
│  ├─ Ledger local (Room)     │      │         │                       │
│  └─ Gateway sync            │      │         ▼                       │
│           │                 │      │  🗄️ PostgreSQL                  │
│  BLE / Wi-Fi Direct (P2P)   │      │         │                       │
│  A ──▶ B ──▶ C ──▶ D(gw)    │      │         ▼                       │
│           │                 │      │  🌐 WEB pública (MapLibre+deck.gl)│
└───────────┼─────────────────┘      └─────────────────────────────────┘
            └──── POST /api/v1/private/telegrams/batch ────▶ (única frontera)
```

## Componente 1 — App móvil (Android)

**Responsabilidad:** generar, transportar y acumular telegramas sin Internet; volcarlos cuando aparece conectividad.

| Capa | Tecnología | Responsabilidad |
|---|---|---|
| UI + estados | React Native (Expo dev build) | Pantallas, Replica Ready, dashboard familiar, configuración |
| Servicios móviles | **Kotlin** (módulos nativos en el mismo APK) | Nearby Connections, foreground services, GPS, cámara/micrófono, detección de red |
| Persistencia local | Room (SQLite on-device) | `received_messages` (dedupe), outbox pendiente, ledger 24h/5MB LRU |
| Sincronización gateway | WorkManager (`NETWORK_CONNECTED`) | Subida batch del outbox al backend |

**Punto crítico:** toda la inteligencia P2P vive dentro del APK. Cada nodo Android corre la misma app y habla con sus pares directamente. El backend NO participa en la red oportunista — es un observador que recibe cuando un gateway puede enviar.

## Componente 2 — Backend (FastAPI)

**Responsabilidad:** único proceso Python que contiene TODOS los módulos online. Los "servicios externos" (trigger sísmico, IA) son **módulos internos**, no microservicios separados — esto reduce deploy, coordinación y superficies de fallo durante el hackathon.

| Módulo interno | Responsabilidad | Detalle |
|---|---|---|
| **Gateway sync privado** | Recibir telegramas desde gateways autenticados | `POST /api/v1/private/telegrams/batch` (batch, idempotente por `ON CONFLICT(id)`); nunca es una ruta pública |
| **Trigger Engine** | Detectar sismos válidos y activar dispositivos | Polling cada 10–15s a SGC + EMSC; fast trigger vs confirmation; push FCM + polling de respaldo en la app |
| **Agregador espacial** | Calcular el mapa de calor | Agrupa coordenadas en celdas H3 (~500 m) vía `h3-py`; intensidad = f(count, recencia, hop count); `GET /api/v1/heatmap` |
| **Reportes IA** | Narrar el estado por regiones | Snapshot SQL determinista → LLM → JSON validado contra schema → tabla `reports`. La IA nunca calcula cifras, solo interpreta. Cadencia 30 min→2h + botón manual |
| **Realtime** | Empujar cambios a la web | WebSocket para nuevos telegramas y reportes |

**Regla de dependencia:** los módulos se comunican solo a través de la base de datos o llamadas internas del proceso. Ningún módulo llama a otro por HTTP.

### Estructura de carpetas (`backend/app/`)

El código organiza los módulos internos por responsabilidad de dominio, no por capa técnica (nada de `routers/` + `services/` + `schemas/` mezclando módulos distintos):

```
app/
├── core/                  # infraestructura compartida por todos los módulos
│   ├── config.py          # settings desde env vars / .env
│   ├── database.py        # engine, Session, Base declarativa
│   ├── constants.py       # H3_CELL_RESOLUTION, etc.
│   ├── ws.py              # ConnectionManager (broadcast realtime)
│   └── events.py          # get_latest_open_event, usado por dashboard y ai_reports
├── models/                # ORM SQLAlchemy — centralizado (una sola DB compartida)
├── modules/
│   ├── dashboard/         # consumo de DB para el mapa/dashboard público (solo lectura)
│   │   ├── router.py      # GET /api/v1/heatmap, GET /api/v1/reports, WS /ws
│   │   └── schemas.py     # contratos Pydantic de salida
│   ├── ai_reports/        # pipeline de reportes IA
│   │   ├── router.py      # POST /api/v1/reports/generate
│   │   ├── generator.py   # snapshot + gov actions -> LLM -> validación -> persistencia
│   │   ├── snapshot.py    # snapshot SQL determinista
│   │   └── gov_actions.py # datos abiertos UNGRD (Socrata)
│   ├── mobile_identity/   # registro, sesión y perfil privado del móvil
│   ├── gateway_sync/      # batch privado y estado canónico de telegramas
│   ├── trigger_emsc/      # listener WebSocket EMSC opcional
│   └── trigger_sgc/       # poller SGC opcional
└── main.py                # ensambla los routers de modules/*
```

Cada módulo es dueño de su router y su lógica; ningún módulo importa código interno de otro módulo — si necesitan compartir algo (como `get_latest_open_event`), ese código vive en `core/`.

## Componente 3 — Base de datos (PostgreSQL)

**Responsabilidad:** única fuente de verdad del mundo online.

| Tabla | Contenido |
|---|---|
| `events` | Eventos sísmicos detectados (dedupe por event-id de fuente) |
| `telegrams` | Telegramas crudos: `id PK, eid FK, sid, location, ts_origin, ts_received, hop, ttl` |
| `reports` | Reportes IA validados (JSON schema fijo) |
| `received_cells` | Cache de agregación H3 por ventana |

Nota: coordenadas exactas e identificadores (`sid`) **nunca salen por endpoint público** — ver Privacidad abajo.

## Componente 4 — Plataforma web pública

**Responsabilidad:** consulta pública del estado del desastre. Solo renderiza; todo el cálculo vive server-side.

| Capa | Tecnología | Responsabilidad |
|---|---|---|
| Mapa | MapLibre GL JS + deck.gl `HexagonLayer` | Heatmap por celdas H3 leído de `GET /api/v1/heatmap` |
| Feed de reportes | React (Vite) | Resumen ejecutivo, zonas por severidad, vacíos |
| Updates | WebSocket client | Re-render en tiempo real |
| Deploy | Vercel/Netlify (estático) | Gratis |

## Fronteras y contratos

```
Móvil → Backend:   POST /api/v1/private/telegrams/batch (batch autenticado)
Trigger → Backend: interno (mismo proceso)
Web ← Backend:     GET /api/v1/heatmap · GET /api/v1/reports · WebSocket
LLM ← Backend:     llamada saliente con snapshot agregado (nunca datos crudos personales)
```

## Privacidad por arquitectura

Porque la web es de consulta **pública**, la privacidad no es configuración sino diseño:

1. El público ve celdas H3 agregadas — densidad, nunca personas.
2. Datos crudos (coordenadas exactas, `sid`) existen solo server-side, sin endpoint público.
3. El LLM recibe exclusivamente agregados; jamás ve identidad ni ubicación precisa individual.
4. Los perfiles y registros de gateway son privados; ningún router público los registra ni los serializa.

## Despliegue (hackathon)

| Componente | Dónde | Costo |
|---|---|---|
| Backend FastAPI | Railway / Fly.io / Render free tier | $0 |
| PostgreSQL | Supabase o Neon free tier | $0 |
| Web estática | Vercel / Netlify | $0 |
| App móvil | APK directo (sin store) | — |
