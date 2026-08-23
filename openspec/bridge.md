# bridge.md — La frontera entre React Native y Kotlin

> El documento más importante del stack híbrido. Es la única superficie que A y B leen juntos, y la única parte del contrato que **ningún compilador verifica**.

---

## 1. La regla de diseño: motor GORDO, UI flaca

Esta es la corrección más importante respecto de la intuición habitual del híbrido ("Kotlin como motor delgado, JS decide").

**Para ZIRO es al revés. El motor es gordo y vive entero en Kotlin. JavaScript es un visor y un comandante, nunca un participante del camino de relay.**

Y esto no es preferencia de estilo. Es una restricción técnica:

> **El hilo de JavaScript de React Native no está confiablemente vivo cuando la app está en background. Un foreground service sí.**

Si el dedup, la verificación del HMAC o el ledger vivieran en JS, **cada telegrama que llegue con la pantalla apagada se pierde.** Y esa es exactamente la situación para la que ZIRO existe: el teléfono en el bolsillo, la app en background, un par pasando a 30 metros.

Entonces:

| Vive en Kotlin (abajo del bridge) | Vive en JS (arriba del bridge) |
|---|---|
| Nearby Connections | Pantallas, navegación, formularios |
| Recibir → verificar → dedup → guardar → reenviar | Renderizar el ledger |
| El ledger (fuente de verdad) | Onboarding del perfil (form) |
| `hop` / `ttl` / `Canonical` / HMAC | Mapa, visualización del path |
| Máquina de estados del nodo | Disparar comandos: "activá", "mandá" |
| Foreground service, permisos, GPS, cámara | Estados vacíos, animaciones, copy |

```
                REACT NATIVE (JS)
        pantallas · perfil · mapa · comandos
                       │
        ═══════════════╪═══════════════  ← el bridge (5 funciones, 1 evento)
                       │
                 KOTLIN (motor)
   Nearby · dedup · HMAC · ledger · state machine · service
```

---

## 2. La regla que hace el contrato barato

**El bridge habla el MISMO JSON que la radio.**

Un telegrama cruza esta frontera como el string exacto que produce `TelegramCodec`. No hay un segundo mapeo a `WritableMap` que mantener a mano, y no hay forma de que las dos representaciones se separen.

El tipo TypeScript en `modules/ziro-relay/src/ZiroRelay.types.ts` **espeja `protocol.md` directamente**, no una forma intermedia inventada para el bridge.

Esto mata el costo más grande del híbrido. Sin esta regla habría tres representaciones del telegrama (Kotlin, WritableMap, TS) y dos lugares donde derivan.

---

## 3. La superficie del bridge (mantenerla CHICA)

**5 funciones y 1 evento.** Cada línea que se agregue acá es una línea que hay que sincronizar a mano en TypeScript, sin compilador mirando.

### Funciones

| Función | Firma | Devuelve |
|---|---|---|
| `getStatus` | `() => EngineStatus` | Estado del nodo, sincrónico. Para el mount. |
| `getOriginHash` | `() => string` | Hash corto del device. |
| `start` | `() => Promise<void>` | Arranca advertising + discovery. |
| `stop` | `() => Promise<void>` | Apaga la radio. |
| `sendTelegram` | `(eventId, lat, lng, severity) => Promise<string>` | El telegrama creado, como **JSON de wire**. |
| `getLedger` | `() => Promise<string>` | El ledger completo, array JSON. |

### El evento único: `onRelayEvent`

Ocho variantes, discriminadas por `type`:

```ts
| { type: 'PEER_DISCOVERED';    peerId: string }
| { type: 'PEER_CONNECTED';     peerId: string }
| { type: 'PEER_DISCONNECTED';  peerId: string }
| { type: 'TELEGRAM_RECEIVED';  peerId: string; telegram: string }  // JSON de wire
| { type: 'TELEGRAM_SENT';      peerId: string; telegramId: string }
| { type: 'TELEGRAM_REJECTED';  peerId: string; reason: RejectReason }
| { type: 'STATUS_CHANGED';     status: EngineStatus }
| { type: 'RADIO_ERROR';        message: string }
```

**Un solo evento con un campo `type` discriminado**, no ocho eventos distintos. Así el `switch` en TS es exhaustivo y agregar una variante rompe el type-check en vez de pasar silencioso.

---

## 4. Los eventos NO son la fuente de verdad

Regla operativa, y la que más bugs evita:

> **El ledger de Kotlin es la fuente de verdad. Los eventos son solo una señal de "algo cambió".**

El motor sigue corriendo mientras el hilo de JS duerme. Los eventos emitidos en esa ventana **se perdieron para siempre**. El ledger no.

Por eso `useRelay` llama a `getLedger()` en cada evento relevante y en el mount, en vez de ir armando una lista en estado de React:

```ts
case 'TELEGRAM_RECEIVED':
case 'TELEGRAM_SENT':
  void refresh();   // relee el ledger de Kotlin
  break;
```

**No construir una lista paralela en React.** Así es como las dos vistas derivan y aparece el bug de "en mi teléfono se ven 4 y en el tuyo 3".

---

## 5. Detección de deriva del contrato

El contrato existe **dos veces**, en dos lenguajes, y nadie verifica que coincidan. Esto es el costo honesto del híbrido.

Tres cosas lo hacen manejable:

**1. Superficie chica.** Un tipo de telegrama y ocho variantes de evento. Sincronizar eso a mano es barato.

**2. Mismo JSON que la radio.** No hay una tercera representación.

**3. Validación en runtime en la frontera.** `parseTelegram()` valida los 11 campos obligatorios y tira `ContractDriftError` con un mensaje que dice exactamente qué hacer:

```
contract-drift: telegram field "severity" is missing or wrong.
Received: undefined.
Kotlin domain/Telegram.kt and ZiroRelay.types.ts are out of sync —
fix both in the same commit.
```

Eso convierte una deriva silenciosa (un `undefined` que aparece tres pantallas después) en un fallo ruidoso, en el borde, con la instrucción adentro.

### Regla dura

> **Un cambio en `domain/Telegram.kt` y el cambio correspondiente en `ZiroRelay.types.ts` van en el MISMO commit.** Nunca en commits separados, nunca en ramas distintas.

Si el commit toca uno solo de los dos archivos, está mal. Es lo primero que se mira en el checkpoint.

---

## 6. Por qué módulo local de Expo y no TurboModule

`modules/ziro-relay/` es un **módulo local de Expo** (`expo-modules-core`), no un TurboModule a mano.

| | Módulo local de Expo | TurboModule |
|---|---|---|
| Boilerplate | `ModuleDefinition { }` declarativo | Codegen, specs, JSI, C++ glue |
| Autolinking | Automático | Manual |
| Permisos y `<service>` | **En el AndroidManifest del módulo, se mergea solo** | Config plugin a mano |
| Corutinas | `AsyncFunction` acepta `suspend` | Promises a mano |

El punto de los permisos es el decisivo: `modules/ziro-relay/android/src/main/AndroidManifest.xml` se mergea al manifest de la app durante `prebuild`. **Cero config plugins.** Todos los permisos de Nearby y el `<service>` con `foregroundServiceType` viven ahí, versionados con el código que los necesita.

---

## 7. El puerto del lado JS (y por qué B trabaja en Expo Go)

`src/native/relayClient.ts` es el mismo patrón de puerto, una capa más arriba. Las pantallas dependen de la interfaz `RelayClient`, nunca del módulo nativo.

```ts
export const USE_FAKE_ENGINE = true;   // una línea, obvia
```

| Con el fake | Con el nativo |
|---|---|
| **Corre en Expo Go.** Hot reload, sin dev build, sin SDK de Android, sin emparejar teléfonos, sin código de A. | El motor real, en un dev client build. |

**Esto es la ventaja concreta del híbrido para un equipo de 2**, y es real: B construye todas las pantallas el día 1 e itera en segundos, mientras A todavía está peleando con los callbacks de Nearby.

Y es el desempate de bugs:

| Con el fake | Con el nativo | Veredicto |
|---|---|---|
| ✅ anda | ❌ no anda | Es del **motor** → A |
| ❌ no anda | ❌ no anda | Es de la **UI** → B |

`fakeRelayClient` **no es una segunda implementación del protocolo.** Deduplica por id e incrementa `hop` para que la UI vea datos realistas, y nada más. Lo que importa del protocolo se verifica en Kotlin con `TelegramContractTest`. **No dejar que ese archivo crezca hasta ser el motor en JS.**
