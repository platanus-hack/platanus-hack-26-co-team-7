# public-api-readonly Specification

## Purpose

Superficie pública de solo lectura del mundo online de ZIRO: endpoints HTTP GET y un WebSocket de broadcast anónimo que exponen celdas H3 agregadas y reportes IA del evento abierto más reciente. Es la única fuente de datos del dashboard web. Invariante de privacidad (architecture.md): coordenadas crudas e identificadores (`sid`) jamás salen por aquí.

> Decisión documentada (comportamiento sin evento): si se recibe un `event_id` explícito que no existe, la respuesta es **404** con cuerpo de error tipado; si NO se recibe `event_id` y no existe evento abierto, la respuesta es **200 con colección vacía**, para que el dashboard arranque en estado vacío sin errores.

## Requirements

### Requirement: Endpoint GET /api/v1/heatmap

El sistema DEBE exponer `GET /api/v1/heatmap` que retorne las celdas H3 del evento abierto más reciente en ventana **ACUMULADA** total (todas las ventanas desde el inicio del evento), con formato `{cells: [{h3_index, intensity, telegram_count, centroid, window_start}]}`.

- El parámetro opcional `event_id` filtra por ese evento específico.
- Sin `event_id`, el sistema DEBE usar el evento abierto más reciente.
- La intensidad DEBE leerse tal cual de `received_cells.intensity` (ya precalculada); el sistema DEBE NO recalcularla.
- El centroide (`lat`, `lng`) DEBE derivarse server-side de `h3_index`; representa una celda de ~500 m, nunca una posición individual.

#### Scenario: Heatmap con datos acumulados

- GIVEN un evento abierto con celdas en múltiples ventanas temporales
- WHEN el cliente solicita `GET /api/v1/heatmap` sin `event_id`
- THEN responde 200 con todas las celdas del evento abierto más reciente, cada una con `h3_index`, `intensity`, `telegram_count`, `centroid` y `window_start`
- AND las celdas provienen de TODAS las ventanas del evento (acumulado), no solo la última

#### Scenario: Heatmap con event_id explícito válido

- GIVEN un evento cerrado con identificador conocido E
- WHEN el cliente solicita `GET /api/v1/heatmap?event_id=E`
- THEN responde 200 con las celdas acumuladas del evento E, aunque esté cerrado

#### Scenario: Evento abierto inexistente

- GIVEN ninguna solicitud `event_id` y ningún evento abierto en la base de datos
- WHEN el cliente solicita `GET /api/v1/heatmap`
- THEN responde 200 con `cells: []` (colección vacía)

#### Scenario: event_id inexistente

- GIVEN el cliente solicita `GET /api/v1/heatmap?event_id=INEXISTENTE`
- WHEN el identificador no corresponde a ningún evento
- THEN responde 404 con un cuerpo de error estructurado

### Requirement: Endpoint GET /api/v1/reports

El sistema DEBE exponer `GET /api/v1/reports` que retorne los reportes IA del evento abierto más reciente, ordenados por `generated_at` DESC, con formato `{reports: [{id, event_id, source, generated_at, content}]}`.

- `limit` DEBE tener valor por defecto 50.
- Sin `event_id`, DEBE usar el evento abierto más reciente (misma regla que heatmap).
- `content` DEBE pasarse tal cual (JSONB ya validado upstream); el endpoint DEBE NO interpretarlo ni transformarlo.

#### Scenario: Lista de reportes ordenada y limitada

- GIVEN un evento abierto con más de 50 reportes generados en momentos distintos
- WHEN el cliente solicita `GET /api/v1/reports`
- THEN responde 200 con exactamente 50 reportes
- AND el primero es el de `generated_at` más reciente

#### Scenario: Reportes con event_id explícito y limit customizado

- GIVEN un evento con identificador E y al menos 5 reportes
- WHEN el cliente solicita `GET /api/v1/reports?event_id=E&limit=5`
- THEN responde 200 con a lo sumo 5 reportes del evento E, ordenados por `generated_at` DESC

### Requirement: WebSocket /ws de broadcast anónimo

El sistema DEBE exponer `WS /ws` como canal público único de broadcast, sin autenticación. Los mensajes DEBEN estar tipados:

- `{"type": "CELLS_UPDATED", "event_id": ...}` cuando cambian las celdas del heatmap.
- `{"type": "REPORT_CREATED", "event_id": ..., "report_id": ...}` cuando se crea un reporte.

El WebSocket ES solo notificación: DEBE NO transportar el estado completo (el cliente reconcilia vía GET).

#### Scenario: Broadcast de nueva celda a todos los clientes conectados

- GIVEN dos clientes conectados a `WS /ws`
- WHEN se insertan nuevas celdas para el evento abierto
- THEN ambos clientes reciben un mensaje `{"type": "CELLS_UPDATED", ...}` sin solicitarlo

#### Scenario: Mensaje REPORT_CREATED tras insertar un reporte

- GIVEN un cliente conectado a `WS /ws`
- WHEN se inserta un nuevo reporte en la tabla `reports`
- THEN el cliente recibe un mensaje `{"type": "REPORT_CREATED", ...}` que incluye el `report_id`

### Requirement: Invariantes de privacidad en toda respuesta pública

Ningún endpoint ni mensaje WebSocket DEBE incluir coordenadas crudas de telegramas, identificadores de persona (`sid`), contenido de telegramas ni cualquier dato individual. La única geografía permitida son celdas H3 (~500 m) con su intensidad agregada y su centroide derivado de la celda.

#### Scenario: Auditoría de privacidad sobre respuestas

- GIVEN la API respondiendo con celdas y reportes de un evento con telegramas reales
- WHEN se inspeccionan todas las respuestas de `GET /heatmap`, `GET /reports` y los mensajes de `WS /ws`
- THEN ninguna respuesta contiene campos de coordenadas crudas, `sid` ni payloads de telegramas individuales

#### Scenario: Centroide deriva solo de la celda

- GIVEN una celda H3 con múltiples telegramas de personas distintas
- WHEN la API serializa esa celda
- THEN el centroide corresponde al centro geométrico de la celda H3, no a ninguna posición individual

### Requirement: CORS para el dominio de la web estática

El backend DEBE incluir headers CORS que permitan peticiones desde los orígenes configurados de la web estática (desarrollo y producción), mediante middleware con lista explícita de orígenes. El wildcard `*` con credenciales DEBE NO usarse.

#### Scenario: Petición desde el origen de la web

- GIVEN un navegador ejecutando la web en un origen configurado
- WHEN el navegador envía `GET /api/v1/heatmap` (incluida la preflight OPTIONS)
- THEN la respuesta incluye headers CORS que autorizan ese origen

#### Scenario: Origen no autorizado

- GIVEN un origen no presente en la lista configurada
- WHEN se realiza una petición desde ese origen
- THEN la respuesta DEBE NO incluir headers CORS que lo autoricen

### Requirement: Comportamiento con base de datos vacía

Con la base de datos sin eventos, celdas ni reportes, los endpoints GET DEBEN responder 200 con colecciones vacías (sin error 500), y el WebSocket DEBE aceptar conexiones aunque no haya nada que difundir.

#### Scenario: Arranque en frío sin datos

- GIVEN una base de datos vacía (sin seed)
- WHEN el cliente solicita `GET /api/v1/heatmap` y `GET /api/v1/reports` y se conecta a `WS /ws`
- THEN ambas respuestas son 200 con `cells: []` y `reports: []`
- AND la conexión WebSocket se establece correctamente

### Requirement: Superficie de solo lectura

La API pública de este módulo DEBE ser de solo lectura: DEBE NO exponer ningún endpoint POST/PUT/DELETE (incluido `POST /api/v1/telegrams`, que queda fuera de alcance) ni mutar estado alguno.

#### Scenario: Intento de escritura rechazado

- GIVEN la API pública desplegada
- WHEN el cliente envía `POST /api/v1/telegrams` o cualquier otra escritura bajo `/api/v1`
- THEN el servidor responde con error de método/ruta no disponible (404/405) y ningún dato cambia
