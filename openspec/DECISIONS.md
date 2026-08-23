# DECISIONS — Memoria del proyecto Replica

> Este archivo es el sustituto de Engram para esta sesión. Centraliza las decisiones de diseño, las ideas discutidas, los tradeoffs considerados y lo que se rechazó. **Léanlo antes de empezar a codear** — está pensado para que el equipo entero entienda el "por qué" de cada decisión sin tener que repetir la conversación.

---

## Tesis central del proyecto (en una frase)

**Replica** es una red de comunicación de emergencia que convierte los teléfonos Android en una **red temporal que se auto-enriquece**: cuando la infraestructura celular colapsa, transporta telegramas de emergencia entre dispositivos mediante Nearby Connections —BLE para descubrimiento y Bluetooth/Wi-Fi Direct para datos— sin Internet, y acumula un registro distribuido en cada nodo. Es store-and-forward con gossip, no mesh routing IP.

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
No es B.A.T.M.A.N., no es cjdns, no es Yggdrasil. Es ferry de mensajes: A le pasa a B, B guarda y reenvía, y además **sincroniza su ledger completo con cada par**. Esto es lo que hace Replica diferente de cualquier mesh messenger genérico.

### 2. **Cada nodo acumula un ledger distribuido**
Cuando A se encuentra con B, NO solo le pasa sus telegramas nuevos; **sincronizan sus bases completas** (metadata primero, después bytes). Esto convierte al nodo en un repositorio activo. **Caso de uso nuevo**: un rescatista con Replica offline puede ver la lista de personas reportadas en la zona sin Internet.

### 3. **El telegrama es chico a propósito — ~550-700 bytes**
La gracia NO es transferir archivos pesados por los nodos (eso es inviable en 36h). La gracia es que el telegrama es data estructurada diminuta comparada con el handshake de Nearby (5-15 s), así que se transmite en milisegundos. El video/audio se sube después por otro canal (lazy upload desde el origen).

**Corrección:** versiones anteriores decían "~120 bytes, cabe en una sola trama BLE". Eso era doctrina, no física — un advertisement BLE son 31 bytes, así que ni 200 bytes entraban. Nearby usa BLE solo para *discovery*; los payloads van por BT Classic / Wi-Fi Direct, con límite en KB. Con el bloque `vital` completo el telegrama pesa ~550-700 bytes y no hay problema técnico alguno. **El límite real es la privacidad, no el ancho de banda.**

### 4. **El origen se auto-protege**
Si la persona tiene que irse y deja el teléfono, el origen **ya repartió los primeros 15-30 segundos del video entre los primeros 2-3 Replica que encontró** (Opción 2). Si queda solo, sigue transmitiendo un beacon BLE cada 60s (Opción 1). **La información nunca queda en un solo lugar.**

### 5. **Trigger externo, no detección propia**
Replica no detecta sismos. Usa EMSC / un endpoint propio / un botón manual como trigger. Evita reinventar la rueda y enfoca el esfuerzo en lo diferencial.

---

## Decisiones arquitectónicas tomadas

### Aclaración arquitectónica crítica — dónde vive Nearby

**Nearby Connections vive en el teléfono, NO en el backend.** El backend es independiente y solo conoce la API HTTP/WS. El modelo correcto es:

- **Phone → Nearby → Phone** (capa radio entre pares, sin Internet).
- **Phone + Internet → Backend Render** (canal saliente clásico HTTP/WS, solo cuando un nodo tiene conectividad).

Matar cualquier versión del modelo "Backend → Nearby → teléfonos". Ver diagrama completo en `communication.md`.

### Protocolo v2 — diseño pendiente de migración (2026-08-22)

Estas decisiones describen una migración futura. La implementación móvil actual mantiene `Telegram.PROTOCOL_VERSION = 1`; no se debe presentar v2 ni el backend asociado como funcionalidad entregada. Ver el contrato ejecutable en `frontend/modules/ziro-relay/android/src/main/java/com/ziro/relay/domain/Telegram.kt`.

**1. Perfil completo en onboarding (tabla `profile` del teléfono):** `user_id`, `full_name`, `doc_type` (CC|TI|CE|PA|NIT), `doc_number`, `birth_date` (la edad se DERIVA, no se guarda), `blood_type` + `blood_rh` separados (O- es donante universal, O+ no), `allergies[]`, `chronic_conditions[]`, `medications[]`, `disability` (NONE|MOBILITY|VISUAL|HEARING|COGNITIVE), `is_pregnant`, `weight_kg`, `eps`, `emergency_contacts[{name, phone, relationship}]`, `question_id`, `answer_hash`, `device_secret`.

**2. Criterio de qué VIAJA:** no es "qué es importante" sino *¿qué necesita un rescatista SIN Internet en los próximos 10 minutos?*
- **VIAJA en claro** (triage offline): name, age, blood+rh, allergies, conditions, medications, disability, pregnant → bloque `vital`.
- **NO viaja**: doc_type, doc_number, eps, teléfonos de contactos, device_secret → el backend ya los tiene del onboarding y resuelve por `user_id`. Nombre + cédula + sangre + GPS en el SQLite sin cifrar de 8 desconocidos = kit de robo de identidad en tránsito.
- **`family_contact` sale del telegrama.** El backend notifica a la familia usando los contactos del perfil. No hay razón para que el teléfono de tu papá pase por 8 celulares ajenos.

**3. `device_secret`:** se registra server-side durante el onboarding (canal TLS) para que el backend/gateway pueda verificar el HMAC. Nunca viaja por la mesh ni es expuesto por ningún endpoint.

**4. Corrección honesta de tamaño:** "~120 bytes cabe en una trama BLE" era doctrina, no física. Un advertisement BLE legacy son 31 bytes; Nearby Connections usa BLE solo para discovery y manda datos por Bluetooth Classic/Wi-Fi (`Payload.fromBytes`, límite del orden de KB). Telegrama v2 ≈ **550–700 bytes**, sin problema técnico. Ledger cap 5 MB pasa de ~25.000 a ~7.000 telegramas. **El límite real es privacidad, no ancho de banda.**

**5. Trade-off aceptado:** si alguien nunca completó onboarding con Internet antes del desastre, el backend no tiene su perfil y la notificación familiar falla. Limitación documentada del MVP.

### Dashboard web público adelantado al MVP + módulo web backend (2026-08-22)

La decisión del mismo día que dejaba el dashboard web "post-hackathon" (ver TBD cerrado más abajo) queda **SUPERADA**: se adelanta el dashboard público al MVP porque la sección "para qué sirve" del pitch ante jueces no tiene cara visual sin él. Cambio SDD `dashboard-web` (ver `openspec/changes/dashboard-web/design.md`).

**Decisiones arquitectónicamente significativas de este módulo:**

| Decisión | Lo elegido | Por qué | Lo rechazado |
|---|---|---|---|
| **Dashboard en el MVP** | Adelantado a la demo (antes: post-hackathon) | Sin dashboard, heatmap y reportes IA son invisibles para jueces/prensa/rescatistas | Mantenerlo post-hackathon (el pitch pierde su demostración visual) |
| **Resolución H3 compartida** | **res 8 (~500 m)** como constante con nombre (`backend/app/core/constants.py` y `frontWeb/src/lib/constants.ts`); fuente única de documentación = esta tabla | Seed y futuro agregador deben coincidir en granularidad; celda ~500 m respeta privacidad (nunca posición individual) | res 9 (~170 m, riesgo de reidentificación), hardcodear el número suelto (inconsistencia garantizada) |
| **Contrato `reports.content`** | Schema JSON v1 documentado en design.md `{version, title, summary, recommendations[], figures}`; backend pasa tal cual, UI renderiza defensivamente con tipo TS espejo | Sin pipeline LLM real, doble validación runtime es costo puro; un contrato escrito basta para hackathon | pydantic + zod espejados (validación doble sin productor real) |
| **Broadcast realtime** | WS `/ws` solo-notificación tipada; `ConnectionManager` en proceso; notificación interna por llamada directa (sin HTTP entre módulos) | Cumple la regla no-inter-module-HTTP; WS caído ≠ UI rota (reconciliación REST) | Pub/sub externo tipo Redis (fuera de presupuesto), WS transportando estado |
| **Limitación monoproceso del seed** | El seed CLI corre en otro proceso y NO notifica por WS; flujo de demo = seed → arrancar servidor → clientes cargan por GET al conectar | Documentar honestamente el alcance; reconciliación inicial vía GET lo cubre | Polling periódico cliente (fuera de spec), seed embebido como único modo |

Lo menor (parámetros exactos de backoff WS, estrategia idempotente del seed, estructura de routers) vive solo en `design.md`.

### Tabla de decisiones

| Decisión | Lo elegido | Por qué | Lo rechazado |
|---|---|---|---|
| Capa radio | Google Nearby Connections | Abstrae Wi-Fi Direct + BLE, maneja discovery/auth/encriptación/re-connection | Bridgefy SDK (USENIX 2022 paper demostró MITM), Serval (abandonado desde 2016), Meshtastic (requiere hardware $30+), Wi-Fi Direct crudo (boilerplate pesado) |
| **Dónde corre Nearby** | **En el APK de cada teléfono** (todo Kotlin, mismo proceso) | El backend no tiene radios. Solo puede recibir JSON por HTTP. | Backend → Nearby → teléfonos (arquitectura imposible, el backend no tiene BT/Wi-Fi Direct) |
| **Stack móvil** | **HÍBRIDO: Expo + React Native (UI) + módulo local Kotlin (motor), APK vía EAS Build** | **Fluidez del equipo, no arquitectura teórica.** El equipo ya sabe Expo y ya sabe generar la APK con EAS. En 36 h, la herramienta que ya sabés usar le gana a la teóricamente óptima: perder 3 h peleando con Gradle, `adb` y el SDK cuesta más que el impuesto del bridge. Bonus real: B trabaja en **Expo Go** con hot reload desde la hora 1, sin SDK y sin dev build. | Kotlin puro + Compose (ver reversión abajo), Expo Go solo (Nearby es nativo, no está en el cascarón), React Native puro (los wrappers de Nearby están sin mantener), Flutter, app web |
| **Reparto del híbrido** | **Motor GORDO en Kotlin, UI flaca en JS** | **Restricción técnica, no estilo.** El hilo de JS de RN no está confiablemente vivo en background; un foreground service sí. Si dedup, HMAC o el ledger vivieran en JS, cada telegrama que llegue con la pantalla apagada se pierde — que es exactamente el caso de uso de ZIRO | "Kotlin como motor delgado, JS decide" (pierde telegramas en background) |
| **Cómo se agrega el Kotlin** | **Módulo local de Expo** (`modules/ziro-relay/`, `expo-modules-core`) | Su `AndroidManifest.xml` se mergea solo durante `prebuild`, así que los permisos de Nearby y el `<service>` con `foregroundServiceType` viven versionados con el código que los necesita. **Cero config plugins.** Y `AsyncFunction` acepta `suspend` directo | TurboModule a mano (codegen, specs, JSI, glue de C++), config plugin a mano para los permisos |
| **Formato del bridge** | **El bridge habla el MISMO JSON que la radio** | Un telegrama cruza como el string exacto de `TelegramCodec`. Elimina una tercera representación (`WritableMap`) y el lugar donde derivaría. El tipo TS espeja `protocol.md` directo | Mapear a `WritableMap` campo por campo (tres representaciones, dos lugares donde derivan) |
| **Fuente de verdad en el bridge** | **El ledger de Kotlin. Los eventos son solo "algo cambió"** | El motor corre mientras JS duerme: los eventos de esa ventana se perdieron para siempre, el ledger no. `useRelay` relee `getLedger()` en vez de armar una lista en estado de React | Acumular la lista en JS (las dos vistas divergen) |
| **Stack backend** | **Node.js (Express) o Python (FastAPI) en Render** | Lo que el equipo domine; Render free tier alcanza para la demo; SQLite/Postgres como storage | Go (menos familiar), serverless (cold start mata la latencia), Docker custom (overhead para 36h) |
| Tamaño telegrama | JSON ~550-700 bytes | Debug fácil en logcat, no requiere librería externa. El límite de `Payload.fromBytes` está en KB | CBOR/MessagePack (no core, complejidad extra) |
| Identificador mensaje | UUID v4 | Universal, no colisiona, clave de dedup | Hash incremental (rompe con resets) |
| Identificador persona | `user_id` separado del `id` del mensaje | Varios telegramas del mismo afectado (EMERGENCY → NEED_HELP) comparten `user_id` pero tienen `id` distinto | Mezclar ambos (rompe dedup) |
| Identificador evento | `event_id` (ej: `EARTHQUAKE001`) | Permite agrupar todos los afectados del mismo desastre en el backend | Sin event_id (no se puede hacer heatmap ni cierre de evento) |
| Sincronización entre pares | Diff de IDs primero, bytes después | Minimiza payload (~1 KB metadata vs MB) | Flood completo (saturaría), gossip puro (más complejo) |
| Límite del ledger local | TTL=0, ts>24h, LRU 5MB | Nodo no colapsa en desastre largo | Sin límite (DoS al propio nodo) |
| **Memoria del nodo** | **SQLite local** (tablas `messages` + `hops` + `delivered_peers` + `evidence_chunks` + `profile` + `pending_wipes` + `events`) | JSON es solo transporte; SQLite es lo que se recuerda. Permite dedup, store-and-forward, auditoría del recorrido. | JSON crudo en archivos (sin queries, sin índices), solo en memoria (se pierde al reiniciar) |
| **Encriptación local** | **SQLite plano para MVP demo, SQLCipher para producción** | Un teléfono abandonado no debe filtrar nombre, sangre ni ubicación. Migración drop-in (misma API). | Sin encriptación (riesgo privacidad), caja fuerte de Android (no aplica a SQLite de la app) |
| **Auto-wipe post-evento** | **72h después de que el backend declara el evento cerrado, se borra el bloque `vital` completo (name, age, blood, allergies, conditions, medications, disability, pregnant), `location` y el bloque `verify`**; se conservan id, user_id, event_id, timestamp para estadísticas | Minimiza ventana de exposición si el teléfono cae en malas manos | Borrado inmediato (rompería re-transmisión si hay peers lentos), nunca borrar (riesgo privacidad indefinido) |
| **Auto-gateway** | **Cuando un nodo detecta Internet, flushea automáticamente su ledger sin prompt** | En emergencia, latencia mata; cada segundo cuenta | Prompt "¿querés subir?" (fricción mata conversión), backend-pull (más complejo, stateful) |
| Evidencia (video/audio) | Patrón C: telegrama rápido + upload perezoso del video | Defendible en 36h, honesto con el usuario | Patrón A (riesgo pérdida), Patrón B (complejidad brutal) |
| **Estado del nodo** | 5 estados (IDLE/ADVERTISING/SYNC/RELAY/ORPHAN) — comportamiento de red | Maneja todos los casos incluyendo abandono | Sin estado (race conditions), 3 estados (insuficiente) |
| **Estado de la persona** | **3 estados (EMERGENCY/NEED_HELP/SAFE)** — ortogonales a los del nodo | El comportamiento de la red (nodo) es independiente del estado del afectado (persona). NEED_HELP tiene prioridad sobre EMERGENCY. | Confundir ambos (rompe modelo mental, rompe lógica de prioridad en backend) |
| **Verificación SAFE** | **`question_id` + `answer_hash`** en el telegrama; **la respuesta en claro nunca viaja por la red mesh**; el backend compara el hash | Si un atacante escucha la red, no ve respuestas. Compatible con C5 (familiar responde desde otro ZIRO). | Pregunta + respuesta en claro (filtra privacidad, ataque trivial al eavesdropping), comparación local en cada nodo (inconsistente, sin fuente única de verdad) |
| Servicio de discovery | `serviceId = "ziro.relay.v1"` | Versionado, permite migración futura | Hardcoded sin versión |
| **Arquitectura de la app** | **Hexagonal-lite, un solo módulo Gradle.** `domain/` + `ports/` sin imports de Android; `adapters/` afuera | El "contrato primero" del plan de 2 personas ya era un puerto sin nombre. Formalizarlo no agrega trabajo: da un lugar a las 3 piezas huérfanas (ledger compartido, máquina de estados, transport fake) y hace que los swaps de Fase 5 sean una línea | Estructura por dueño (`sender/`+`receiver/`: no tenía dónde vivir la lógica compartida, y la Fase 4 forzaba a A a tocar el código de B), Clean multi-módulo (1-2 h de Gradle antes del primer píxel, más KSP encima) |
| **Inyección de dependencias** | **`RelayContainer` manual** (object singleton en el módulo Kotlin) | ~15 objetos no justifican KSP + plugin + 40 min de setup. Es también el único archivo que decide qué adapter es real y cuál fake. Vive como singleton de proceso, **no dentro de un `Application`**, porque el motor tiene que sobrevivir independientemente del runtime de React Native | Hilt, Koin, container atado al ciclo de vida de la Activity |
| **Punto de mutación de `hop`/`ttl`** | **El receptor, al ingestar, una vez. El reenvío es verbatim** | Mutar en ingest Y en forward hace que `hop` cuente doble. Reenviar verbatim mantiene el HMAC válido de punta a punta | Mutar al reenviar (la versión anterior de `protocol.md` Regla 2 — se corrigió) |
| **Canonical del HMAC** | **Excluye `hop`, `ttl` y `hmac`.** Orden de campos fijado a mano en `Canonical.kt` | `hop`/`ttl` cambian en cada nodo: si entran al canonical la firma solo valida en hop 0. Y delegar el canonical a un encoder JSON hace que un cambio de orden o de formato de número rompa la verificación del otro lado de la radio — y el fallo se ve como bug de transporte | Firmar el telegrama completo, usar el JSON serializado como canonical |
| **Clave del HMAC** | **Una constante app-wide para MVP** (`HmacSha256Signer.MVP_SHARED_KEY`) | HMAC es simétrico: un verificador que no tiene la clave de firma rechaza el 100% de los telegramas. Un secret por dispositivo necesita intercambio de claves real (Fase 5) | `device_secret` derivado del origin (imposible de verificar por el receptor) |
| **Campo `hmac` en v1** | **Existe desde v1, nullable en MVP** | Agregarlo después obliga a un `v=2` y rompe compatibilidad | Agregarlo cuando se implemente |
| **Qué del perfil VIAJA** | **Solo el bloque `vital`** (nombre, edad, sangre, alergias, condiciones, medicación, discapacidad, embarazo) | Criterio único: ¿lo necesita un rescatista **sin Internet** para actuar en los próximos 10 minutos? | Mandar el perfil completo |
| **Qué del perfil NO viaja** | **`doc_type`, `doc_number`, `eps`, `family_contact`, `device_secret`** | El backend ya los tiene del onboarding, indexados por `user_id`. `nombre + cédula + sangre + GPS` en el teléfono de un desconocido, en SQLite sin cifrar, es un kit de robo de identidad viajando por 8 saltos. Un rescatista no necesita la cédula para salvarte | `family_contact` en el telegrama (estaba en la versión anterior de `protocol.md` — se quitó) |
| **Tamaño del telegrama** | **~550-700 bytes, y no es un problema** | Nearby no manda payloads por advertisements BLE (31 bytes): usa BLE para discovery y BT Classic / Wi-Fi Direct para datos, con límite en KB. El "~120 bytes" era doctrina, no física. El límite real es la privacidad, no el ancho de banda | Recortar campos vitales para bajar bytes |
| **Lock de ingest** | **Un `Mutex` global del pipeline** | `Mutex.withLock(owner)` de kotlinx **no** hace locking por clave — el owner es solo tracking de propiedad. Llamarlo "lock por id" era mentira | `Map<String, Mutex>` (innecesario a estos volúmenes) |
| Seguridad | HMAC-SHA256 sobre el canonical, verificado **antes** del dedup | Blinda MITM. Verificar antes de deduplicar evita que un telegrama falsificado ocupe un `id` y deje afuera al real | Sin firma (riesgo USENIX 2022 sobre Bridgefy), verificar después del dedup |

---

## Lo que **NO** es Replica

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

**Replica específicamente** combina: registro distribuido + gossip + auto-supervivencia del origen + caso de uso de rescatistas offline en un solo producto.

---

## Decisiones pendientes (TBD — no bloqueantes para arrancar, pero bloqueantes para el doc final)

- **Stack backend concreto (Node vs Python):** decidir quién lo codea. Stack ya está definido (Render + Express/FastAPI + SQLite + Emergency Orchestrator).
- **Stack dashboard familiar:** web app, SMS, o app companion
- **Filtro geográfico del ledger:** no para MVP, mejora v2
- **iOS support:** fuera de scope para 36h
- **CBOR/MessagePack para telegrama:** no core, JSON alcanza
- ✅ **Modelo de identidad (cerrado 2026-08-22):** el perfil del usuario (nombre, documento, tipo de sangre, contactos de emergencia, `question_id`/`answer_hash`) se carga en el **flujo de onboarding al instalar la app**, antes de cualquier evento. El perfil vive localmente cifrado (SQLite + SQLCipher).
- ✅ **Acceso de familiares (cerrado 2026-08-22):** los familiares **deben instalar Replica** para participar en flujos offline (caso C5 de `orphan-device.md` — un familiar marca SAFE desde otro dispositivo). SMS / web ligera / app companion queda fuera del MVP.
- ✅ **Rescatistas (cerrado 2026-08-22):** la visión final es un **dashboard web centralizado** (online-only, requiere backend). Para el MVP del hackathon, los rescatistas también usan la **app móvil** con una vista read-only del ledger local. El dashboard web es post-hackathon.

---

## Conceptos técnicos que el equipo tiene que entender

- **TTL vs Hop**: TTL = cuántos saltos le QUEDAN al mensaje antes de morir. Hop = cuántos saltos YA hizo. Ortogonales.
- **ServiceId** `"replica.relay.v1"` — el identificador del servicio Nearby Connections. Filtra qué peers son Replica.
- **Dedup por ID** = el corazón del protocolo. Si ya tenés el UUID, no proceses de nuevo.
- **Estrategia P2P_STAR** = un nodo central con varios periféricos. Modela nuestro caso "un origen + varios relays".
- **HMAC** = firma criptográfica con clave compartida. Imposible de falsificar sin la clave.
- **Mutex por id** = evita que dos peers simultáneos disparen doble procesamiento del mismo telegrama.

---

## Trigger Engine — proveedores sísmicos (cerrado 2026-08-22)

El detonador que abre `events` y dispara la alerta usa **dos proveedores que coexisten**, ambos en `modules/` del proceso FastAPI, desactivados por defecto (`EMSC_ENABLED=false`, `SGC_ENABLED=false`):

| Proveedor | Fuente | Mecanismo | Filtro por defecto |
|---|---|---|---|
| **EMSC** (mundial) | `wss://www.seismicportal.eu/standing_order/websocket` | WebSocket near-real-time (`modules/trigger_emsc`) | mag ≥ 5.0, bbox lat 0–14 / lon −80…−66 |
| **SGC** (Colombia, prioridad para Bogotá) | `https://archive.sgc.gov.co/feed/v1.0.1/summary/five_days_all.json` | Polling HTTP c/60s (`modules/trigger_sgc`) | mag ≥ 4.5, mismo bbox |

- Ambos deduplican por su `id`/`unid` propio → `events.event_id`, abren `EARTHQUAKE` abierto y emiten `EVENT_OPENED` por WS.
- Para la demo con datos de prueba es suficiente; si el producto escala, **falta autorización escrita del SGC** para ingestión automática/caché/republicación (deuda ética documentada; contactar `datos@sgc.gov.co`). Verificar antes de activar en producción.
- **Gotcha real verificado**: el feed SGC devuelve `geometry.coordinates` en orden **`[lat, lon, depth]`** (no `[lon, lat]`). El módulo lo auto-detecta por signos del bbox (los rangos lat/lon no se solapan) para no silenciar eventos reales.

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

## Estado del código

Stack: **Expo + React Native + módulo local Kotlin**. Ver `bridge.md` para la frontera.

### El motor (Kotlin) — `modules/ziro-relay/android/src/main/java/com/ziro/relay/`
- ✅ `domain/` + `ports/` — el contrato, cero imports de Android
- ✅ `application/` — IngestTelegram, SendTelegram, ForwardPending, RelayEngine
- ✅ `adapters/` — bus, crypto, ledger (memoria), profile (hardcoded), fake (loopback)
- ✅ `RelayContainer.kt` — DI manual, swap point marcado
- ✅ `ZiroRelayModule.kt` — el bridge (5 funciones + 1 evento)
- ✅ `src/main/AndroidManifest.xml` — permisos de Nearby + `<service>` tipado
- ✅ `TelegramContractTest` — verifica que la firma sobrevive los 8 saltos
- ⏳ `adapters/nearby/NearbyTransport.kt` — scaffold con TODOs, Fase 2 (A)
- ⏳ `adapters/service/RelayForegroundService.kt` — scaffold con TODOs, Fase 2 (A)

### El contrato TS — `modules/ziro-relay/`
- ✅ `src/ZiroRelay.types.ts` — espejo del telegrama + `parseTelegram()` + `ContractDriftError`
- ✅ `index.ts` — la cara JS del bridge

### La UI (TypeScript) — `src/`
- ✅ `native/relayClient.ts` — puerto JS + `USE_FAKE_ENGINE`
- ✅ `native/fakeRelayClient.ts` — el fake que corre en Expo Go
- ✅ `hooks/useRelay.ts` — el único punto donde la UI habla con el motor
- ✅ `screens/HomeScreen.tsx` — baseline, crece en Fase 1-2 (B)

### Sin verificar
- ⚠️ **Nada está compilado ni instalado todavía.** Faltan `npm install`, `npx expo prebuild --platform android`, `npm run typecheck` y `npm run test:engine`. Las versiones de `package.json` (Expo SDK 52 / RN 0.76.5) hay que confirmarlas con `npx expo install --fix`.

### Reversión documentada (2026-08-22): SÍ hay React Native

El stack se decidió Kotlin puro, después se revirtió a híbrido. Queda escrito por qué, para que nadie lo re-discuta desde cero.

**Los argumentos contra el híbrido siguen siendo ciertos**, y son el costo que se está pagando a conciencia:

- Las 3 pantallas del MVP son ~150 líneas. La ventaja de RN aparece con 40 pantallas que iteran, no con 3.
- La lista de "lo que queda en Kotlin" (Nearby, BT, GPS, foreground, ledger) **es el producto entero**. El ~85% del código es Kotlin igual.
- **El contrato deja de estar verificado por el compilador.** En Kotlin puro, un rename rompía la build de B. En híbrido son dos declaraciones sincronizadas a mano y el fallo aparece en runtime.
- En las Fases 0-3 el ~90% del trabajo es código nativo, y **cada cambio nativo necesita un dev client nuevo**: 10-20 min de EAS más cola.
- Impuesto estimado: **+4 a 6 h** sobre una ruta crítica de ~8-10 h.

**Lo que decidió la reversión** — y es el argumento que ganó legítimamente:

> El equipo **ya sabe usar Expo y ya sabe generar la APK**. La estimación de +4-6 h asumía fluidez igual en los dos toolchains. No la hay. Si el equipo pierde 3 horas instalando el SDK, peleando con Gradle y con `adb`, la cuenta se da vuelta. **En una hackatón de 36 h, la fricción de aprender un toolchain nuevo es un costo real, no una excusa.**

**Y hay dos beneficios que la primera evaluación no le acreditó:**

1. **La frontera de lenguaje coincide con la frontera de persona.** A es dueño de todo el Kotlin, B de todo el TypeScript, y se encuentran en una API documentada de 5 funciones. Para dos personas con skills distintos, ese seam es más limpio que compartir un lenguaje y pisarse.
2. **B puede trabajar en Expo Go**, con hot reload, sin SDK, sin dev build, sin teléfono emparejado, desde la hora 1. Con `USE_FAKE_ENGINE = true` la app entera corre en JS. Eso es un desbloqueo concreto, no teórico.

**Lo que sobrevivió intacto de la etapa Kotlin puro:** todo `domain/`, `ports/`, `application/` y `adapters/`, más `TelegramContractTest`. El telegrama, `Canonical`, `RelayPolicy`, el HMAC y el ledger no cambiaron una línea — solo se movieron a `modules/ziro-relay/android/` y se les puso un bridge encima. **El trabajo fue aditivo, no un rewrite.**

**Mitigaciones obligatorias del híbrido** (ver `bridge.md`):

- Superficie del bridge chica: 5 funciones y 1 evento.
- El bridge habla el mismo JSON que la radio.
- `parseTelegram()` valida en el borde y tira `ContractDriftError` con la instrucción adentro.
- **Regla dura: `domain/Telegram.kt` y `ZiroRelay.types.ts` se cambian en el MISMO commit.** Se verifica con `git log --name-only` en cada checkpoint.
