# dev-plan.md — Plan de desarrollo para 2 personas (MVP offline, stack híbrido)

> Cómo repartimos el trabajo A y B en 36 horas para llegar al MVP: un telegrama cruzando entre dos teléfonos vía Nearby Connections. El contrato se firma en la Fase 0 y se respeta hasta el demo.

---

## 1. Stack y por qué

**Expo + React Native (UI) + módulo local Kotlin (motor).** Un solo APK, generado con EAS Build.

La decisión se tomó por **fluidez del equipo, no por arquitectura teórica**: el equipo ya sabe Expo y ya sabe generar la APK con EAS. En 36 horas, la herramienta que ya sabés usar le gana a la teóricamente óptima — perder 3 horas peleando con Gradle, `adb` y el SDK de Android cuesta más que el impuesto del bridge.

El impuesto es real y está declarado: **+4 a 6 horas** sobre la ruta crítica, casi todo en setup del bridge y en la doble declaración del contrato. Ver `DECISIONS.md`.

### La corrección de diseño que hace que funcione

El instinto habitual del híbrido es "Kotlin como motor delgado, JS decide". **Para ZIRO es al revés: motor GORDO en Kotlin, UI flaca en JS.**

Y no es estilo, es restricción técnica: **el hilo de JS de React Native no está confiablemente vivo en background; un foreground service sí.** Si el dedup o el ledger vivieran en JS, cada telegrama que llegue con la pantalla apagada se pierde — que es exactamente el caso de uso de ZIRO. Detalle completo en `bridge.md`.

---

## 2. Estructura

```
/
├── App.tsx, index.ts, app.json, package.json, eas.json
│
├── src/                                  ← B · TypeScript
│   ├── native/relayClient.ts             ← PUERTO JS (RelayClient) + USE_FAKE_ENGINE
│   ├── native/fakeRelayClient.ts         ← el fake que corre en Expo Go
│   ├── hooks/useRelay.ts                 ← el único punto donde la UI habla con el motor
│   └── screens/                          ← pantallas
│
├── modules/ziro-relay/                   ← A · el motor
│   ├── expo-module.config.json
│   ├── index.ts                          ← CONTRATO · cara JS del bridge
│   ├── src/ZiroRelay.types.ts            ← CONTRATO · espejo TS + parseTelegram()
│   └── android/
│       ├── build.gradle
│       ├── src/main/AndroidManifest.xml  ← permisos + <service> (se mergean solos)
│       └── src/main/java/com/ziro/relay/
│           ├── domain/                   ← CONTRATO · Kotlin puro, cero Android
│           ├── ports/                    ← CONTRATO · 5 interfaces
│           ├── application/              ← casos de uso
│           ├── adapters/                 ← nearby · crypto · ledger · profile · fake · bus
│           ├── RelayContainer.kt         ← DI manual, el único swap point
│           └── ZiroRelayModule.kt        ← EL BRIDGE
│
├── android/                              ← generado por `expo prebuild`, gitignored
└── openspec/
```

**Invariante:** `domain/` y `ports/` no importan NADA de Android. Verificable con un grep, y es todo el enforcement que hace falta.

---

## 3. El contrato compartido

Está escrito y vive en **cuatro lugares**, y esa es la diferencia con un stack de un solo lenguaje:

| Archivo | Lenguaje | Qué define |
|---|---|---|
| `modules/ziro-relay/android/.../domain/` | Kotlin | El telegrama, `RelayPolicy`, `Canonical`, los 5 estados |
| `modules/ziro-relay/android/.../ports/` | Kotlin | Las 5 interfaces del motor |
| `modules/ziro-relay/src/ZiroRelay.types.ts` | TypeScript | **El espejo del telegrama** + `parseTelegram()` |
| `modules/ziro-relay/index.ts` | TypeScript | La cara JS del bridge |

### ⚠️ La regla dura del híbrido

> **Un cambio en `domain/Telegram.kt` y su cambio correspondiente en `ZiroRelay.types.ts` van en el MISMO commit.**

Si un commit toca uno solo de los dos, está mal. **Es lo primero que se mira en cada checkpoint.** Ningún compilador va a avisarte: `parseTelegram()` te lo dice en runtime, con un `ContractDriftError` que trae la instrucción adentro, pero eso es una red de seguridad, no un reemplazo de la disciplina.

### Decisiones cerradas del contrato

| Decisión | Valor | Por qué |
|---|---|---|
| **Punto único de mutación** | El **receptor** aplica `hop+1`/`ttl-1` **una vez**, al ingestar. El reenvío es verbatim. | Mutar en ingest y en forward hace que `hop` cuente doble. Y reenviar verbatim mantiene el HMAC válido de punta a punta. |
| **Canonical del HMAC** | Excluye `hop`, `ttl` y `hmac` | `hop`/`ttl` cambian en cada nodo: si entran, la firma solo valida en hop 0. |
| **Clave del HMAC** | Una constante app-wide (`MVP_SHARED_KEY`) | HMAC es simétrico: un secret por dispositivo hace que el receptor rechace el 100%. |
| **Campo `hmac`** | Existe desde v1, nullable en MVP | Agregarlo después obliga a un `v=2`. |
| **`severity`** | Obligatorio, default 3 | Sin él el rescatista no puede priorizar. |
| **`family_contact`** | **Sale del telegrama** | El backend ya lo tiene del onboarding. |
| **El bridge habla JSON de wire** | El telegrama cruza como el string exacto de `TelegramCodec` | Elimina un tercer mapeo (`WritableMap`) y el lugar donde derivaría. |
| **Fuente de verdad** | El ledger de Kotlin. Los eventos son solo "algo cambió" | El motor corre mientras JS duerme: los eventos de esa ventana se perdieron, el ledger no. |
| **Lock de ingest** | Un `Mutex` global | `Mutex.withLock(owner)` no hace locking por clave. |

---

## 4. Protocolo de sincronización A ↔ B

### 4.1 Ownership

Con el híbrido el ownership es **más limpio que antes**, porque la frontera de lenguaje coincide con la frontera de persona:

| A — el motor | B — la experiencia |
|---|---|
| `modules/ziro-relay/android/` (todo Kotlin) | `src/` (todo TypeScript) |
| `ZiroRelayModule.kt` (el bridge, lado Kotlin) | `src/native/relayClient.ts` + `fakeRelayClient.ts` |
| `RelayContainer.kt` | `src/hooks/`, `src/screens/` |
| `AndroidManifest.xml` del módulo | `App.tsx` |
| `expo prebuild` + los builds de EAS | — |
| **Compartido, mismo commit:** `domain/`, `ports/`, `ZiroRelay.types.ts`, `index.ts` | |

Si ves un bug en el código del otro: **avisás, no arreglás.**

### 4.2 Ramas

```
offline          ← rama de integración
├── a/<tarea>
└── b/<tarea>
```

Ninguna rama vive más de ~3 horas sin mergear a `offline`. Los archivos del contrato se tocan **solo en checkpoints, con los dos presentes**.

### 4.3 El ritual de checkpoint (10 min, 4 veces)

Los dos juntos, en la misma mesa:

```bash
# 1. Cada uno mergea offline hacia su rama primero
git fetch origin && git merge origin/offline

# 2. Chequeo de deriva del contrato: ¿algún commit tocó UN solo lado?
git log --oneline origin/offline..HEAD --name-only | \
  grep -E "domain/Telegram.kt|ZiroRelay.types.ts"

# 3. Los dos corren los dos chequeos. Si falla en una máquina, no se avanza.
npm run typecheck
npm run test:engine        # requiere prebuild hecho

# 4. Merge a offline: primero A, después B
git checkout offline && git merge a/<tarea> && git merge b/<tarea> && git push
```

**Regla dura:** si `typecheck` o `test:engine` no pasan en las DOS máquinas, el checkpoint no está cerrado.

### 4.4 Qué entrega cada uno

| Checkpoint | A entrega | B entrega | Se verifica así |
|---|---|---|---|
| **CP0** — contrato | `npm install` + `expo prebuild` corriendo. Motor Kotlin revisado. | `npm run typecheck` limpio. App corriendo en **Expo Go** con el fake. | `test:engine` verde en ambas máquinas + `typecheck` limpio. Sin `import android` en `domain/`/`ports/`. |
| **CP1** — dev client | **Dev client de EAS instalado en 2 teléfonos.** `USE_FAKE_ENGINE = false` funciona: el bridge responde `getStatus()`. | Home renderizando status, contador de pares, lista, estados vacíos. | Los 2 teléfonos abren el dev client y muestran `IDLE`. Al tocar "Activate" pasan a `ADVERTISING`. |
| **CP2** — radio real | `NearbyTransport` + `RelayForegroundService`. Swap en `RelayContainer`. | Card de telegrama con `hop`, `severity`, `blood`, `allergies`. Muestra `TELEGRAM_REJECTED`. | Los 2 teléfonos se descubren en < 15 s. Logcat sin errores de permisos. La UI llega a `ADVERTISING` con 1 par **real**. |
| **CP3** — MVP | `sendTelegram` + `ForwardPending` sobre Nearby real. | `hop = 1` visible en el card. | A pulsa "Send test", **B ve el card con `hop = 1`**. Mismo id 2 veces → B lo ve **una sola vez**. |

### 4.5 Cómo se sincronizan sin hablar

**1. `parseTelegram()` es el árbitro.** En Kotlin puro el compilador cazaba un rename. Acá no hay compilador cruzando el bridge, así que la validación en runtime ocupa ese lugar: falla en el borde, con un mensaje que dice qué archivos arreglar y en qué commit.

**2. `TelegramContractTest` es el contrato ejecutable** del lado Kotlin. Verifica que la firma sobrevive los 8 saltos. Corre en la JVM en milisegundos.

**3. El fake es el desempate de bugs.** Cuando algo no aparece en pantalla:

| `USE_FAKE_ENGINE = true` | `= false` (nativo) | Veredicto |
|---|---|---|
| ✅ anda | ❌ no anda | Es del **motor** → A |
| ❌ no anda | ❌ no anda | Es de la **UI** → B |

**4. `git log --name-only` en cada checkpoint** caza los commits que tocaron un solo lado del contrato.

---

## 5. Fases

### Fase 0 — Contrato y arranque (1-2 h) → **CP0**

| Persona A | Persona B |
|---|---|
| `npm install`, `npx expo prebuild --platform android` | `npm install`, `npx expo start` → **abrir en Expo Go** |
| **Lanzar `eas build --profile development` YA** (tarda 10-20 min, corre en background) | Ver la Home con el fake, hot reload andando |
| Revisar `domain/`, `ports/`, `Canonical`, `RelayPolicy` | Revisar `ZiroRelay.types.ts` y `RelayClient` |
| `npm run test:engine` | `npm run typecheck` |

> **Lanzá el build de EAS lo antes posible.** Es el único paso de la Fase 0 que no depende de vos y el que bloquea CP1.

### Fase 1 — Bridge vivo (2-3 h, paralelo) → **CP1**

| Persona A | Persona B |
|---|---|
| Instalar el dev client en 2 teléfonos | Home: status, contador de pares, lista, estados vacíos |
| Permisos en runtime (BT_SCAN/ADVERTISE/CONNECT, NEARBY_WIFI_DEVICES, LOCATION, POST_NOTIFICATIONS) | Cablear el botón de "simular entrante" al fake |
| Verificar el bridge: `getStatus()` responde desde Kotlin | Mostrar el badge `FAKE ENGINE` para no confundirse nunca |
| Verificar que `getLedger()` devuelve `[]` sin explotar | Orden por timestamp, auto-scroll |

### Fase 2 — Radio real (3-4 h, paralelo) → **CP2**

| Persona A | Persona B |
|---|---|
| `NearbyTransport`: advertising + discovery + `ConnectionLifecycleCallback` | Card de telegrama: `hop`, `severity`, `blood`, `allergies` |
| Tie-break de colisión simétrica (`shouldInitiateTo`) | Reaccionar a `TELEGRAM_REJECTED` mostrando el motivo |
| `RelayForegroundService` con `foregroundServiceType` | Pantalla de perfil (lectura del `HardcodedProfileStore`) |
| Swap en `RelayContainer`: fake → `NearbyTransport` | `USE_FAKE_ENGINE = false` y probar contra el motor real |

> Cada cambio de Kotlin en esta fase necesita **rebuild del dev client**. Agrupá cambios: escribí 3 cosas, después buildeá. No buildees por cada línea.

### Fase 3 — Primer telegrama cruza (2-3 h) → **CP3 · MVP**

| Persona A | Persona B |
|---|---|
| `sendTelegram` sobre Nearby real | Verificar `hop = 1` en el card |
| `ForwardPending` cuando aparece un par | Verificar dedup: mismo id 2 veces → 1 card |
| `allowUnsigned = false` en `IngestTelegram` | Verificar que un HMAC roto se rechaza visiblemente |

### Fase 4 — Pulir (2-3 h)

A: reenvío robusto, `PeerDisconnected`, logs limpios, prueba con 3 teléfonos.
B: contador de pares, orden por severidad, estados vacíos, 5 corridas sin crash.

### Fase 5 (si sobra tiempo, en este orden)

1. `RoomLedger` reemplaza `InMemoryLedger` (una línea en `RelayContainer`).
2. Onboarding real del perfil (esto **sí** es terreno de React Native — formularios).
3. Gossip completo (diff de IDs → bytes).
4. Los 5 estados con transiciones reales + timer de ORPHAN.
5. Mapa con el path A → B → C.
6. SQLCipher.
7. Auto-gateway al backend.

**Total hasta MVP (Fases 0-3):** ~10-13 h de las 36.

---

## 6. Comandos

```bash
npm install

# Una sola vez: genera android/ y autolinkea modules/ziro-relay
npx expo prebuild --platform android

# B: UI con el fake, en Expo Go. Sin SDK, sin dev build, sin teléfono emparejado.
npx expo start

# A: el dev client (10-20 min en EAS, corre en la nube)
eas build --profile development --platform android

# Después, con el dev client instalado:
npx expo start --dev-client

# Los dos chequeos del checkpoint
npm run typecheck
npm run test:engine
```

---

## 7. Setup de los teléfonos para la demo

| Paso | Acción | Por qué |
|---|---|---|
| Cargar al 100% | Cable, 1 h antes | 36 h de hackatón, la batería es un riesgo real |
| **Bluetooth ENCENDIDO** | Settings > Bluetooth > **On** | **Nearby usa BLE para discovery. Apagado = no hay demo.** |
| **Wi-Fi ENCENDIDO, sin red** | Wi-Fi On, olvidar la red del venue | **Nearby usa Wi-Fi Direct para el canal de datos.** |
| Modo avión | Airplane On, **y después re-prender BT y Wi-Fi a mano** | Airplane apaga las dos radios de entrada. |
| Datos móviles | Solo en el teléfono gateway | El resto tiene que estar realmente offline |
| Permisos pre-otorgados | Aceptar todo en la primera instalación | La demo no puede esperar prompts |
| **`USE_FAKE_ENGINE = false`** | Verificar la línea antes de buildear el APK del demo | Demostrar con el fake sería mentirle a los jueces |

> **Corrección respecto de versiones anteriores de este doc:** decía "apagar Wi-Fi, apagar Bluetooth". Eso **mata Nearby Connections**. Lo que hay que hacer es desconectarse de la red del venue, no apagar las radios.

---

## 8. Riesgos del stack híbrido (declaración honesta)

| Riesgo | Mitigación |
|---|---|
| **El contrato deriva entre Kotlin y TS** | Superficie chica (5 fn + 1 evento), mismo JSON que la radio, `parseTelegram()` valida en el borde, y `git log --name-only` en cada checkpoint |
| **Cada cambio nativo = rebuild de EAS (10-20 min)** | Agrupar cambios de Kotlin. En Fase 2 esto es el cuello de botella real: escribir 3 cosas, después buildear |
| **Cola del free tier de EAS** | Lanzar el primer build en la Fase 0, antes de necesitarlo |
| **La UI muestra datos del fake y nadie se da cuenta** | Badge `FAKE ENGINE` visible en pantalla + chequeo de `USE_FAKE_ENGINE` en el setup del demo |
| **Telegramas perdidos con la app en background** | El motor es GORDO: ingest, dedup y ledger están en Kotlin, debajo del bridge. JS no participa del camino de relay |
| **La lista de JS y el ledger de Kotlin divergen** | `useRelay` relee `getLedger()` en cada evento. **No construir una lista paralela en estado de React** |
| B bloqueado esperando el motor | `USE_FAKE_ENGINE = true` corre en Expo Go desde la hora 1 |
| Nearby no anda en emulador | CP2 exige 2 teléfonos físicos. No hay atajo |
| Crash del foreground service en Android 14+ | `foregroundServiceType="connectedDevice"` + permiso tipado, ya en el manifest del módulo |
| `fakeRelayClient` se convierte en el motor en JS | Está documentado que no crezca. Lo que importa del protocolo se verifica en Kotlin |

---

## 9. Lo que NO entra en este MVP

- ❌ Persistencia (Room / SQLite) — todo en memoria hasta Fase 5.
- ❌ Gossip completo (diff de ledgers). En MVP: broadcast + dedup.
- ❌ Onboarding real. Perfil hardcodeado.
- ❌ Grabación de video / chunks de evidencia.
- ❌ Beacon ORPHAN, timers de los 5 estados.
- ❌ SQLCipher, auto-wipe 72 h.
- ❌ Conexión con backend (ver `api.md`).
- ❌ Mapa.
- ❌ iOS (Nearby en iOS es otra API; fuera de alcance).
- ❌ CBOR / MessagePack.
- ❌ Dashboard familiar / rescatista web.

Si sobra tiempo, la Fase 5 está priorizada. Pero **el MVP (CP3) tiene que estar andando antes** de mirar esa lista.
