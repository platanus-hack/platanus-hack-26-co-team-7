# dashboard-web-ui Specification

## Purpose

Dashboard web público (Vite + React + TS, desplegado como sitio estático): mapa de calor H3 en tiempo real y feed de reportes IA sobre el evento abierto más reciente. Es la cara visual de ZIRO para rescatistas, prensa y jueces. Solo renderiza: todo el cálculo vive server-side.

## Requirements

### Requirement: Mapa de calor por celdas H3 sobre basemap abierto

La UI DEBE renderizar un mapa interactivo que muestre las celdas H3 recibidas de `GET /api/v1/heatmap`, pintadas según su `intensity` (rampa de color de baja a alta), sobre un basemap OpenFreeMap sin API key. El renderizado DEBE consumir el `h3_index` directamente (capa H3), sin re-agregar posiciones en el cliente.

#### Scenario: Visualización del heatmap del evento abierto

- GIVEN el evento abierto más reciente tiene celdas con intensidades variadas
- WHEN el usuario abre el dashboard
- THEN el mapa muestra las celdas superpuestas al basemap
- AND celdas con mayor intensidad se distinguen visualmente de las de menor intensidad

#### Scenario: Actualización del mapa en tiempo real

- GIVEN el usuario está viendo el mapa
- WHEN llega un mensaje WS `CELLS_UPDATED`
- THEN la UI refresca los datos vía `GET /api/v1/heatmap` y redibuja las celdas sin recargar la página

#### Scenario: Zoom y exploración

- GIVEN el mapa renderizado
- WHEN el usuario hace zoom o paneo
- THEN el mapa responde fluidamente y las celdas permanecen alineadas geográficamente con el basemap

### Requirement: Feed de reportes IA con último reporte destacado

La UI DEBE mostrar un feed de reportes donde el último reporte (`generated_at` más reciente) aparece destacado, y los anteriores permanecen accesibles (lista/scroll consultando `GET /api/v1/reports`).

#### Scenario: Último reporte visible de inmediato

- GIVEN el evento abierto tiene reportes generados
- WHEN el usuario abre el dashboard
- THEN ve el reporte más reciente destacado con su contenido renderizado
- AND puede acceder a los reportes anteriores desde el feed sin recargar la página

#### Scenario: Nuevo reporte entra por realtime

- GIVEN el usuario está viendo el feed
- WHEN llega un mensaje WS `REPORT_CREATED`
- THEN la UI refresca vía `GET /api/v1/reports` y el nuevo reporte pasa a ser el destacado sin recargar la página

### Requirement: Reconexión WebSocket con backoff exponencial y reconciliación REST

El cliente WebSocket DEBE reintentar la conexión ante caídas usando backoff exponencial. Al reconectar (o al detectar una caída prolongada), la UI DEBE reconciliar su estado completo vía los endpoints GET. Una caída del WebSocket DEBE NO romper la UI: esta continúa mostrando los últimos datos conocidos.

#### Scenario: Caída temporal del WebSocket

- GIVEN el usuario viendo el dashboard con datos cargados
- WHEN la conexión WebSocket se interrumpe
- THEN la UI sigue siendo funcional y conserva los últimos datos conocidos sin errores visibles

#### Scenario: Recuperación y reconciliación

- GIVEN el WebSocket reconectó tras una caída durante la cual se insertaron nuevas celdas y reportes
- WHEN la conexión se restablece
- THEN la UI refresca heatmap y feed vía GET y refleja todo lo ocurrido durante la desconexión
- AND los reintentos posteriores usan intervalos crecientes (backoff exponencial)

### Requirement: Lazy-load del bundle del mapa

El bundle inicial de la UI DEBE NO incluir las librerías de mapas (MapLibre GL + deck.gl); el chunk del mapa DEBE cargarse de forma diferida para que la primera pintura sea ligera.

#### Scenario: Carga inicial liviana

- GIVEN un usuario abre el dashboard por primera vez
- WHEN se descarga y ejecuta el bundle inicial
- THEN las librerías de mapas no están en el bundle crítico y se cargan como chunk diferido
- AND el shell de la UI (encabezado, feed, estados de carga) es visible antes de que el mapa termine de cargar

### Requirement: Estados vacíos, de carga y de error sin datos

Ante base de datos vacía, carga en curso o error de red, la UI DEBE mostrar estados explícitos (mensaje "sin datos", indicador de carga, aviso de reintento) y DEBE NO fallar ni quedarse en blanco.

#### Scenario: Primer arranque sin seed

- GIVEN la base de datos está vacía (endpoints responden colecciones vacías)
- WHEN el usuario abre el dashboard
- THEN ve un estado vacío claro ("aún no hay datos del evento") en mapa y feed
- AND la aplicación permanece estable y lista para mostrar datos cuando aparezcan

#### Scenario: Error transitorio de red en la carga inicial

- GIVEN el backend no responde momentáneamente
- WHEN la UI intenta la carga inicial de datos
- THEN muestra un aviso de error con posibilidad de reintento en lugar de una pantalla rota
