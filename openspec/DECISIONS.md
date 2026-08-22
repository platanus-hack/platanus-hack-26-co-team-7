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

### Aclaración arquitectónica crítica — dónde vive Nearby

**Nearby Connections vive en el teléfono, NO en el backend.** El backend es independiente y solo conoce la API HTTP/WS. El modelo correcto es:

- **Phone → Nearby → Phone** (capa radio entre pares, sin Internet).
- **Phone + Internet → Backend Render** (canal saliente clásico HTTP/WS, solo cuando un nodo tiene conectividad).

Matar cualquier versión del modelo "Backend → Nearby → teléfonos". Ver diagrama completo en `communication.md`.

### Tabla de decisiones

| Decisión | Lo elegido | Por qué | Lo rechazado |
|---|---|---|---|
| Capa radio | Google Nearby Connections | Abstrae Wi-Fi Direct + BLE, maneja discovery/auth/encriptación/re-connection | Bridgefy SDK (USENIX 2022 paper demostró MITM), Serval (abandonado desde 2016), Meshtastic (requiere hardware $30+), Wi-Fi Direct crudo (boilerplate pesado) |
| **Dónde corre Nearby** | **En el APK de cada teléfono** (módulo Kotlin) | El backend no tiene radios. Solo puede recibir JSON por HTTP. | Backend → Nearby → teléfonos (arquitectura imposible, el backend no tiene BT/Wi-Fi Direct) |
| **Stack móvil** | **React Native (UI/lógica) + Kotlin native module (radio/sensores) + Expo Dev Build** | RN acelera iteración; Kotlin expone APIs nativas que RN no tiene (Nearby, BT, GPS, cámara, mic, foreground services). Expo Dev Build genera APK con Kotlin adentro. | Expo Go (no soporta módulos nativos custom), RN puro sin Kotlin (sin acceso a Nearby), app nativa 100% Kotlin (más lento de iterar en 36h) |
| **Stack backend** | **Node.js (Express) o Python (FastAPI) en Render** | Lo que el equipo domine; Render free tier alcanza para la demo; SQLite/Postgres como storage | Go (menos familiar), serverless (cold start mata la latencia), Docker custom (overhead para 36h) |
| Tamaño telegrama | JSON ~120-200 bytes | Debug fácil, no requiere librería externa | CBOR/MessagePack (no core, complejidad extra) |
| Identificador mensaje | UUID v4 | Universal, no colisiona, clave de dedup | Hash incremental (rompe con resets) |
| Identificador persona | `user_id` separado del `id` del mensaje | Varios telegramas del mismo afectado (EMERGENCY → NEED_HELP) comparten `user_id` pero tienen `id` distinto | Mezclar ambos (rompe dedup) |
| Identificador evento | `event_id` (ej: `EARTHQUAKE001`) | Permite agrupar todos los afectados del mismo desastre en el backend | Sin event_id (no se puede hacer heatmap ni cierre de evento) |
| Sincronización entre pares | Diff de IDs primero, bytes después | Minimiza payload (~1 KB metadata vs MB) | Flood completo (saturaría), gossip puro (más complejo) |
| Límite del ledger local | TTL=0, ts>24h, LRU 5MB | Nodo no colapsa en desastre largo | Sin límite (DoS al propio nodo) |
| **Memoria del nodo** | **SQLite local** (tablas `messages` + `hops` + `delivered_peers` + `evidence_chunks`) | JSON es solo transporte; SQLite es lo que se recuerda. Permite dedup, store-and-forward, auditoría del recorrido. | JSON crudo en archivos (sin queries, sin índices), solo en memoria (se pierde al reiniciar) |
| **Encriptación local** | **SQLite plano para MVP demo, SQLCipher para producción** | Un teléfono abandonado no debe filtrar nombre, sangre ni ubicación. Migración drop-in (misma API). | Sin encriptación (riesgo privacidad), caja fuerte de Android (no aplica a SQLite de la app) |
| **Auto-wipe post-evento** | **72h después de que el backend declara el evento cerrado, se borran campos sensibles (name, blood, age, medical_note, family_contact, location, question_id, answer_hash)**; se conservan id, user_id, event_id, timestamp para estadísticas | Minimiza ventana de exposición si el teléfono cae en malas manos | Borrado inmediato (rompería re-transmisión si hay peers lentos), nunca borrar (riesgo privacidad indefinido) |
| **Auto-gateway** | **Cuando un nodo detecta Internet, flushea automáticamente su ledger sin prompt** | En emergencia, latencia mata; cada segundo cuenta | Prompt "¿querés subir?" (fricción mata conversión), backend-pull (más complejo, stateful) |
| Evidencia (video/audio) | Patrón C: telegrama rápido + upload perezoso del video | Defendible en 36h, honesto con el usuario | Patrón A (riesgo pérdida), Patrón B (complejidad brutal) |
| **Estado del nodo** | 5 estados (IDLE/ADVERTISING/SYNC/RELAY/ORPHAN) — comportamiento de red | Maneja todos los casos incluyendo abandono | Sin estado (race conditions), 3 estados (insuficiente) |
| **Estado de la persona** | **3 estados (EMERGENCY/NEED_HELP/SAFE)** — ortogonales a los del nodo | El comportamiento de la red (nodo) es independiente del estado del afectado (persona). NEED_HELP tiene prioridad sobre EMERGENCY. | Confundir ambos (rompe modelo mental, rompe lógica de prioridad en backend) |
| **Verificación SAFE** | **`question_id` + `answer_hash`** en el telegrama; **la respuesta en claro nunca viaja por la red mesh**; el backend compara el hash | Si un atacante escucha la red, no ve respuestas. Compatible con C5 (familiar responde desde otro ZIRO). | Pregunta + respuesta en claro (filtra privacidad, ataque trivial al eavesdropping), comparación local en cada nodo (inconsistente, sin fuente única de verdad) |
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

## Decisiones pendientes (TBD — no bloqueantes para arrancar, pero bloqueantes para el doc final)

- **Stack backend concreto (Node vs Python):** decidir quién lo codea. Stack ya está definido (Render + Express/FastAPI + SQLite + Emergency Orchestrator).
- **Stack dashboard familiar:** web app, SMS, o app companion
- **Filtro geográfico del ledger:** no para MVP, mejora v2
- **iOS support:** fuera de scope para 36h
- **CBOR/MessagePack para telegrama:** no core, JSON alcanza
- ✅ **Modelo de identidad (cerrado 2026-08-22):** el perfil del usuario (nombre, documento, tipo de sangre, contactos de emergencia, `question_id`/`answer_hash`) se carga en el **flujo de onboarding al instalar la app**, antes de cualquier evento. El perfil vive localmente cifrado (SQLite + SQLCipher).
- ✅ **Acceso de familiares (cerrado 2026-08-22):** los familiares **deben instalar ZIRO** para participar en flujos offline (caso C5 de `orphan-device.md` — un familiar marca SAFE desde otro dispositivo). SMS / web ligera / app companion queda fuera del MVP.
- ✅ **Rescatistas (cerrado 2026-08-22):** la visión final es un **dashboard web centralizado** (online-only, requiere backend). Para el MVP del hackathon, los rescatistas también usan la **app móvil** con una vista read-only del ledger local. El dashboard web es post-hackathon.

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
