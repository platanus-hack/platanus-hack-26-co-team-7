# DECISIONS — Memoria del proyecto ZIRO

> Este archivo es el sustituto de Engram para esta sesión. Centraliza las decisiones de diseño, las ideas discutidas, los tradeoffs considerados y lo que se rechazó. **Léanlo antes de empezar a codear** — está pensado para que el equipo entero entienda el "por qué" de cada decisión sin tener que repetir la conversación.

---

## Tesis central del proyecto (en una frase)

**ZIRO** es una red de comunicación de emergencia que convierte los teléfonos Android en una **red temporal que se auto-enriquece** — cuando la infraestructura celular colapsa, transporta pequeños telegramas de emergencia (~120 bytes) entre dispositivos vía Wi-Fi Direct / BLE, sin Internet, y simultáneamente **va acumulando un registro distribuido de emergencias en cada nodo** que crece orgánicamente con cada interacción.

---

## El problema que resuelve

Después de un terremoto en Colombia (zona sísmica), las redes celulares se saturan o caen en minutos. Mientras tanto:

- La persona afectada **tiene** su teléfono, su GPS, posiblemente video de lo que está ocurriendo.
- Su familia intenta llamarla, mandarle WhatsApp, localizarla.
- **Nadie puede comunicar nada.**

Es el peor momento para no tener red, y es exactamente cuando la red deja de existir.

Tres categorías necesitan comunicar:
1. **El afectado** — tiene info, no puede emitirla.
2. **La familia** — quiere saber si su ser querido está bien y dónde.
3. **Los rescatistas** — necesitan coordinar en zonas donde no llega la red.

---

## Las 5 ideas centrales que el equipo tiene que tener CLARAS

### 1. **Store-and-Forward + Gossip — NO mesh routing IP**
No es B.A.T.M.A.N., no es cjdns, no es Yggdrasil. Es ferry de mensajes: A le pasa a B, B guarda y reenvía, y además **sincroniza su ledger completo con cada par**. Esto es lo que hace ZIRO diferente de cualquier mesh messenger genérico.

### 2. **Cada nodo acumula un ledger distribuido**
Cuando A se encuentra con B, NO solo le pasa sus telegramas nuevos; **sincronizan sus bases completas** (metadata primero, después bytes). Esto convierte al nodo en un repositorio activo. **Caso de uso nuevo**: un rescatista con ZIRO offline puede ver la lista de personas reportadas en la zona sin Internet.

### 3. **El telegrama es chico a propósito — ~120 bytes**
La gracia NO es transferir archivos pesados por los nodos (eso es inviable en 36h). La gracia es que el telegrama cabe en una sola trama BLE/Wi-Fi Direct y se transmite en milisegundos. El video/audio se sube después por otro canal (lazy upload desde el origen).

### 4. **El origen se auto-protege**
Si la persona tiene que irse y deja el teléfono, el origen **ya repartió los primeros 15-30 segundos del video entre los primeros 2-3 ZIRO que encontró** (Opción 2). Si queda solo, sigue transmitiendo un beacon BLE cada 60s (Opción 1). **La información nunca queda en un solo lugar.**

### 5. **Trigger externo, no detección propia**
ZIRO no detecta sismos. Usa EMSC / un endpoint propio / un botón manual como trigger. Evita reinventar la rueda y enfoca el esfuerzo en lo diferencial.

---

## Decisiones arquitectónicas tomadas

| Decisión | Lo elegido | Por qué | Lo rechazado |
|---|---|---|---|
| Capa radio | Google Nearby Connections | Abstrae Wi-Fi Direct + BLE, maneja discovery/auth/encriptación/re-connection | Bridgefy SDK (USENIX 2022 paper demostró MITM), Serval (abandonado desde 2016), Meshtastic (requiere hardware $30+), Wi-Fi Direct crudo (boilerplate pesado) |
| Tamaño telegrama | JSON ~120 bytes | Debug fácil, no requiere librería externa | CBOR/MessagePack (no core, complejidad extra) |
| Identificador | UUID v4 | Universal, no colisiona | Hash incremental (rompe con resets) |
| Sincronización entre pares | Diff de IDs primero, bytes después | Minimiza payload (~1 KB metadata vs MB) | Flood completo (saturaría), gossip puro (más complejo) |
| Límite del ledger local | TTL=0, ts>24h, LRU 5MB | Nodo no colapsa en desastre largo | Sin límite (DoS al propio nodo) |
| Evidencia (video/audio) | Patrón C: telegrama rápido + upload perezoso del video | Defendible en 36h, honesto con el usuario | Patrón A (riesgo pérdida), Patrón B (complejidad brutal) |
| Estado del nodo | 5 estados (IDLE/ADVERTISING/SYNC/RELAY/ORPHAN) | Maneja todos los casos incluyendo abandono | Sin estado (race conditions), 3 estados (insuficiente) |
| Seguridad | HMAC-SHA256 con device_secret | Blinda MITM | Sin firma (riesgo USENIX 2022 sobre Bridgefy) |
| Servicio de discovery | `serviceId = "ziro.relay.v1"` | Versionado, permite migración futura | Hardcoded sin versión |

---

## Lo que **NO** es ZIRO

- ❌ No es detector de sismos (usa EMSC o trigger externo).
- ❌ No es messenger general (Briar, Bridgefy, Signal ya existen).
- ❌ No depende de que se instale durante el terremoto.
- ❌ No es mesh routing IP (B.A.T.M.A.N., cjdns, Yggdrasil son otro universo).
- ❌ No reemplaza redes celulares — **sobrevive cuando estas fallan**.

---

## Diferenciación vs. alternativas

| Solución | Lo que hace | Lo que le falta |
|---|---|---|
| **Briar** | Mensajería P2P cifrada sobre BT/Wi-Fi (Android) | No acumula registro distribuido, Android-only |
| **Bridgefy** | SDK de mesh BLE/Wi-Fi Direct | USENIX 2022 paper demostró MITM, sin ledger distribuido |
| **Meshtastic** | LoRa mesh de km de rango con ESP32 externo | Requiere hardware ($30+ por nodo), no es phone-native |
| **Zello** | Walkie-talkie sobre red celular | Server-mediated, si cae la red cae Zello |
| **ShakeAlert / Google EEW** | Alertas tempranas server-push | No transporta evidencia, push unidireccional |
| **Ushahidi** | Plataforma de mapeo de crisis | Requiere SMS o web, no funciona offline P2P |

**ZIRO específicamente** combina: registro distribuido + gossip + auto-supervivencia del origen + caso de uso de rescatistas offline en un solo producto.

---

## Decisiones pendientes (TBD — no bloqueantes para arrancar)

- **Stack backend:** Node/Python/Go (lo que el equipo domine)
- **Stack dashboard familiar:** web app, SMS, o app companion
- **Filtro geográfico del ledger:** no para MVP, mejora v2
- **iOS support:** fuera de scope para 36h
- **CBOR/MessagePack para telegrama:** no core, JSON alcanza

---

## Conceptos técnicos que el equipo tiene que entender

- **TTL vs Hop**: TTL = cuántos saltos le QUEDAN al mensaje antes de morir. Hop = cuántos saltos YA hizo. Ortogonales.
- **ServiceId** `"ziro.relay.v1"` — el identificador del servicio Nearby Connections. Filtra qué peers son ZIRO.
- **Dedup por ID** = el corazón del protocolo. Si ya tenés el UUID, no proceses de nuevo.
- **Estrategia P2P_STAR** = un nodo central con varios periféricos. Modela nuestro caso "un origen + varios relays".
- **HMAC** = firma criptográfica con clave compartida. Imposible de falsificar sin la clave.
- **Mutex por id** = evita que dos peers simultáneos disparen doble procesamiento del mismo telegrama.

---

## Restricciones y números que hay que recordar

- **Rango por hop:** 50-200 m (verificado, NO 1 km).
- **Tiempo por hop:** 5-15 s (handshake domina, NO el payload).
- **Máx conexiones simultáneas por nodo:** 3 (más = overload CPU/battery).
- **TTL inicial:** 8 saltos (suficiente para zona urbana densa).
- **Cap del ledger local:** 5 MB (LRU cuando se llena).
- **Ventana del ledger:** últimas 24 horas.
- **Beacon ORPHAN cada:** 60 segundos.

---

## URLs verificadas (para consultar)

- Bridgefy SDK: https://docs.bridgefy.me/sdk/start/bridgefy-sdk.md
- Briar: https://briarproject.org/how-it-works/
- Meshtastic: https://meshtastic.org/docs/overview/
- USENIX 2022 "Breaking Bridgefy, again": https://eikendev.github.io/breaking-bridgefy-again
- Wired sobre Maui 2023 (mesh en desastre real): https://www.wired.com/story/youre-not-ready-for-phone-dead-zones/

---

## Origen de estas decisiones

Estas decisiones vienen de una sesión de trabajo entre el equipo (vía OpenCode) más la documentación técnica sobre Briar, Bridgefy, Meshtastic, goTenna, Zello y el paper USENIX 2022 "Breaking Bridgefy, again".

**Si alguien propone "y si hacemos X?",** primero chequeá si X ya fue discutido en este archivo. Si no aparece, es pregunta legítima y se discute.

---

## Estado del openspec

- ✅ `README.md` — pitch público
- ✅ `openspec/README.md` — índice
- ✅ `openspec/project.md` — problema y propuesta
- ✅ `openspec/protocol.md` — telegrama + state machine
- ✅ `openspec/communication.md` — capa radio Nearby Connections
- ✅ `openspec/ledger.md` — gossip + registro distribuido
- ✅ `openspec/storage.md` — evidencia (Patrón C)
- ✅ `openspec/orphan-device.md` — teléfono abandonado
- ✅ `openspec/api.md` — backend endpoints
- ✅ `openspec/demo-plan.md` — pitch 3 min para jueces
- ✅ `openspec/DECISIONS.md` — este archivo
