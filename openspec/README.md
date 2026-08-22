# openspec — Especificación técnica de ZIRO

> Toda la verdad técnica del proyecto vive en esta carpeta. El README es la cara pública; esto es la fuente única de decisiones de diseño, protocolos, schemas y plan de demo.

## Índice

1. **[project.md](./project.md)** — Problema, propuesta de valor, pitch de 30s.
2. **[protocol.md](./protocol.md)** — El *telegrama* (schema JSON), máquina de estados del nodo, deduplicación, TTL.
3. **[communication.md](./communication.md)** — Capa radio: Google Nearby Connections sobre Wi-Fi Direct / BLE. Flujo de descubrimiento, handshake, payload, lifecycle.
4. **[ledger.md](./ledger.md)** — Registro distribuido local + gossip entre pares. Cómo crece, cómo se sincroniza, cómo se limpia.
5. **[storage.md](./storage.md)** — Manejo de evidencia (video/audio). Tres patrones de propagación con tradeoffs.
6. **[orphan-device.md](./orphan-device.md)** — Caso "el teléfono quedó tirado en la zona". Diseño de auto-supervivencia del origen.
7. **[api.md](./api.md)** — Endpoints backend mínimos para la demo (HTTP + WebSocket).
8. **[demo-plan.md](./demo-plan.md)** — Guión de 3 minutos con 5 teléfonos para los jueces.

## TL;DR (1 minuto)

**ZIRO** es una red **store-and-forward + gossip** sobre teléfonos Android que **transporta pequeños telegramas de emergencia (~120 bytes) entre dispositivos vía Wi-Fi Direct / BLE cuando la infraestructura de red colapsa**, y va acumulando un **registro distribuido de personas afectadas en cada nodo** que crece con cada interacción. Cuando un nodo con Internet aparece, vuelca su ledger al servidor y la familia del usuario ve dónde está su ser querido en un dashboard.

El caso de uso principal es **post-terremoto en Bogotá** (Colombia, zona sísmica), donde las redes móviles se saturan justo cuando más se necesitan.
