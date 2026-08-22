# openspec — Especificación técnica de ZIRO

> Toda la verdad técnica del proyecto vive en esta carpeta. El README es la cara pública; esto es la fuente única de decisiones de diseño, protocolos, schemas y plan de demo.

## Índice

1. **[project.md](./project.md)** — Problema, propuesta de valor, pitch de 30s.
2. **[protocol.md](./protocol.md)** — El *telegrama* (schema JSON), máquina de estados del nodo, deduplicación, TTL.
3. **[bridge.md](./bridge.md)** — **La frontera React Native ↔ Kotlin.** Motor gordo / UI flaca, la superficie del bridge, y cómo se detecta la deriva del contrato.
4. **[communication.md](./communication.md)** — Capa radio: Google Nearby Connections sobre Wi-Fi Direct / BLE. Flujo de descubrimiento, handshake, payload, lifecycle.
5. **[ledger.md](./ledger.md)** — Registro distribuido local + gossip entre pares. Cómo crece, cómo se sincroniza, cómo se limpia.
6. **[storage.md](./storage.md)** — Manejo de evidencia (video/audio). Tres patrones de propagación con tradeoffs.
7. **[orphan-device.md](./orphan-device.md)** — Caso "el teléfono quedó tirado en la zona". Diseño de auto-supervivencia del origen.
8. **[dev-plan.md](./dev-plan.md)** — Plan de desarrollo para 2 personas: arquitectura, contrato compartido, ownership, **protocolo de sincronización A↔B**, fases y checkpoints.
9. **[api.md](./api.md)** — Endpoints backend mínimos para la demo (HTTP + WebSocket).
10. **[demo-plan.md](./demo-plan.md)** — Guión de 3 minutos con 5 teléfonos para los jueces.
11. **[DECISIONS.md](./DECISIONS.md)** — Todas las decisiones con su por qué y lo que se rechazó.

## Dónde vive el contrato ejecutable

Estos docs explican el **por qué**. El **qué** vive en código, y el código manda:

Ruta base del motor: `modules/ziro-relay/android/src/main/java/com/ziro/relay/`

| Archivo | Es la fuente de verdad de |
|---|---|
| `domain/Telegram.kt` | El schema del telegrama |
| `domain/Profile.kt` | El perfil local y **qué del perfil viaja** (`toVitalBlock`) |
| `domain/RelayPolicy.kt` | Dedup, `hop`, `ttl`, versión |
| `domain/Canonical.kt` | Los bytes que se firman |
| `ports/` | Las 5 fronteras del motor |
| `ZiroRelayModule.kt` | **El bridge** |
| `../../src/ZiroRelay.types.ts` | El espejo TypeScript del telegrama |
| `../src/test/.../TelegramContractTest.kt` | Las invariantes, verificadas |

⚠️ **`domain/Telegram.kt` y `ZiroRelay.types.ts` se cambian en el MISMO commit.** Ningún compilador cruza el bridge.

Si un doc y el código no coinciden, **gana el código** y se corrige el doc.

## TL;DR (1 minuto)

**ZIRO** es una red **store-and-forward + gossip** sobre teléfonos Android que **transporta telegramas de emergencia chicos (~550-700 bytes) entre dispositivos vía Wi-Fi Direct / BLE cuando la infraestructura de red colapsa**, y va acumulando un **registro distribuido de personas afectadas en cada nodo** que crece con cada interacción. Cuando un nodo con Internet aparece, vuelca su ledger al servidor y la familia del usuario ve dónde está su ser querido en un dashboard.

El caso de uso principal es **post-terremoto en Bogotá** (Colombia, zona sísmica), donde las redes móviles se saturan justo cuando más se necesitan.
