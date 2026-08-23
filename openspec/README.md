# openspec — Especificación técnica de Replica

> Toda la verdad técnica del proyecto vive en esta carpeta. El README es la cara pública; esto es la fuente única de decisiones de diseño, protocolos, schemas y plan de demo.

## Índice

1. **[project.md](./project.md)** — Problema, propuesta de valor, pitch de 30s.
2. **[protocol.md](./protocol.md)** — El *telegrama* (schema JSON), máquina de estados del nodo, deduplicación, TTL.
3. **[architecture.md](./architecture.md)** — Arquitectura del sistema: componentes, módulos del backend, frontera offline/online y contratos propuestos.
4. **[bridge.md](./bridge.md)** — **La frontera React Native ↔ Kotlin.** Motor gordo / UI flaca, la superficie del bridge y cómo se detecta la deriva del contrato.
4. **[communication.md](./communication.md)** — Capa radio: Google Nearby Connections sobre Wi-Fi Direct / BLE. Flujo de descubrimiento, handshake, payload, lifecycle.
5. **[ledger.md](./ledger.md)** — Registro distribuido local + gossip entre pares. Cómo crece, cómo se sincroniza, cómo se limpia.
6. **[storage.md](./storage.md)** — Manejo de evidencia (video/audio). Tres patrones de propagación con tradeoffs.
7. **[orphan-device.md](./orphan-device.md)** — Caso "el teléfono quedó tirado en la zona". Diseño de auto-supervivencia del origen.
8. **[api.md](./api.md)** — Endpoints backend mínimos para la demo (HTTP + WebSocket).
9. **[demo-plan.md](./demo-plan.md)** — Guión de 3 minutos con 5 teléfonos para los jueces.

## TL;DR (1 minuto)

**Replica** es una red **store-and-forward + gossip** sobre teléfonos Android que transporta telegramas de emergencia entre dispositivos vía Nearby Connections (BLE para descubrimiento y Bluetooth/Wi-Fi Direct para datos) cuando la infraestructura colapsa, y acumula un registro distribuido en cada nodo. No es enrutamiento IP. Un gateway puede volcar su outbox por HTTP cuando tenga Internet; el dashboard, las APIs y el procesamiento backend descritos aquí son contratos objetivo y no prueban una funcionalidad online desplegada.

## Realidad ejecutable del telegrama móvil

El contrato que emite y acepta la app móvil actualmente es **v1** (`Telegram.PROTOCOL_VERSION = 1`). Cualquier documento que describa `v2` es diseño pendiente de una migración coordinada del contrato Kotlin y su espejo TypeScript; no se debe presentar como comportamiento ya entregado.

Ruta base del motor: `frontend/modules/ziro-relay/android/src/main/java/com/ziro/relay/`. Si un doc y ese contrato no coinciden, **gana el código** y se corrige el doc.

El caso de uso principal es **post-terremoto en Bogotá** (Colombia, zona sísmica), donde las redes móviles se saturan justo cuando más se necesitan.
