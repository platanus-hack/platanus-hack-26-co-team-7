# demo-seed-data Specification

## Purpose

Script de datos de demostración (`backend/scripts/seed_demo.py`): la única vía de datos para la demo, pues no hay ingesta POST en este change. Con un solo comando crea un Evento sísmico, celdas H3 recibidas alrededor de Bogotá y reportes IA plausibles, suficientes para poblar heatmap y feed del dashboard.

> Nota para design: la resolución H3 (~500 m ⇒ res 8) DEBE fijarse como constante compartida entre seed y futuro agregador, para evitar inconsistencia de granularidad. `h3_index` es `String(15)`.

## Requirements

### Requirement: Un solo comando crea el evento completo de demo

El sistema DEBE proveer un comando único que inserte, en una ejecución: un Evento abierto, múltiples `ReceivedCell` distribuidas alrededor de Bogotá (derivadas con h3-py desde coordenadas sembradas) con `intensity`, `telegram_count` y ventanas temporales plausibles dentro del evento, y varios `Report` con `content` JSONB plausible (fuente SCHEDULED/MANUAL) y `generated_at` crecientes.

#### Scenario: Seed desde base de datos vacía

- GIVEN una base de datos vacía
- WHEN el operador ejecuta el comando de seed una vez
- THEN existe exactamente un evento abierto con sus celdas H3 y reportes insertados
- AND cada celda tiene `h3_index` válido (15 caracteres), `intensity >= 0` y ventana temporal contenida en el evento

#### Scenario: Datos plausibles para la demo

- GIVEN el seed se ejecutó correctamente
- WHEN el operador inspecciona los datos sembrados
- THEN las celdas están geográficamente concentradas alrededor de Bogotá con intensidades variadas (no todas iguales)
- AND los reportes tienen contenido narrativo plausible y timestamps ordenados

### Requirement: Idempotencia o reinicio explícito

Re-ejecutar el seed DEBE NO duplicar datos: o bien el script es idempotente (reutiliza/actualiza su evento de demo), o bien ofrece un mecanismo de reset explícito que elimina primero los datos del evento de demo por `event_id`. El comportamiento elegido DEBE ser determinista y documentado en la ayuda del comando.

#### Scenario: Re-ejecución sin duplicados

- GIVEN el seed ya fue ejecutado y sus datos existen
- WHEN el operador ejecuta el comando de seed nuevamente
- THEN no se crean eventos ni celdas ni reportes duplicados (mismo conjunto lógico de datos)

#### Scenario: Reset explícito

- GIVEN el seed ya fue ejecutado y soporta reset
- WHEN el operador invoca el mecanismo de reset
- THEN todos los datos del evento de demo (celdas y reportes por `event_id`) son eliminados y la base queda como antes del primer seed

### Requirement: Compatibilidad con los endpoints públicos

Los datos sembrados DEBEN satisfacer los contratos de `public-api-readonly`: el evento queda en estado abierto, las celdas usan la resolución compartida y los reportes cumplen el modelo `Report` (FK a evento, fuente válida).

#### Scenario: Seed alimenta al heatmap público

- GIVEN el seed se ejecutó sobre una base de datos vacía y el backend está corriendo
- WHEN el cliente solicita `GET /api/v1/heatmap` sin `event_id`
- THEN la respuesta 200 contiene exactamente las celdas sembradas para el evento de demo, con sus intensidades

#### Scenario: Seed alimenta al feed de reportes

- GIVEN el seed se ejecutó con al menos dos reportes
- WHEN el cliente solicita `GET /api/v1/reports`
- THEN la respuesta incluye esos reportes ordenados por `generated_at` DESC
