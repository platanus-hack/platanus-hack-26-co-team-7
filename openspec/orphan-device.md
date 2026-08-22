# orphan-device.md — El teléfono quedó tirado en la zona

## El problema

Después de un terremoto hay **4 escenarios** donde el teléfono del afectado queda solo en la zona:

| Caso | Descripción | Estado del teléfono |
|---|---|---|
| **C1 — Evacuación consciente** | Persona salió caminando, olvidó el teléfono | Cargado, conectado a ZIRO peers |
| **C2 — Golpe de calor / caída** | Persona herida, teléfono cayó | Batería OK, sin usuario |
| **C3 — Edificio colapsado** | Teléfono atrapado bajo escombros | Batería dura horas/días |
| **C4 — Aislado** | Sin ZIRO peers en rango | Muere solo en horas sin entregar nada |

**En todos los casos:** la responsabilidad de sacar la información del origen **pasa del dueño al sistema**.

## Diseño: Opción 2 + Opción 1 combinadas

### Opción 2 — Pre-evacuación chunks (los primeros 30 segundos)

Cuando el usuario pulsa EMERGENCY MODE, el origen **no espera** — empieza inmediatamente a repartir chunks del video entre los primeros ZIRO que encuentre.

```kotlin
class EvidenceDistributor(
    private val recorder: EvidenceRecorder,
    private val nearby: NearbyConnections,
    private val maxChunks: Int = 3       // máximo 3 peers receptores
) {
    private val distributedPeers = mutableSetOf<String>()
    
    init {
        // Cada vez que se conecta un nuevo peer:
        nearby.onPeerConnected { peerId ->
            if (peerId !in distributedPeers && distributedPeers.size < maxChunks) {
                val chunk = recorder.getFirstChunk(seconds = 15)  // primeros 15s
                nearby.sendBytes(peerId, chunk)
                distributedPeers.add(peerId)
                log("Chunk (${chunk.size} bytes) distributed to $peerId")
            }
        }
    }
}
```

**Por qué esto importa:** si la persona se va en 2 minutos, los primeros 30 segundos del video ya están en 2-3 dispositivos con gente alrededor. Si el origen muere, esos 30 segundos sobreviven.

### Opción 1 — Beacon pasivo (respaldo)

Si después de 2 minutos no hay peers en rango, el origen entra en modo **ORPHAN** y transmite un beacon BLE cada 60 segundos:

```kotlin
suspend fun enterOrphanMode() {
    state = State.ORPHAN
    log("Entering ORPHAN mode, broadcasting beacon every 60s")
    
    while (state == State.ORPHAN) {
        val beacon = Beacon(
            app = "ziro",
            v = 1,
            hasEmergency = true,
            ledgerSize = ledgerDao.count(),
            oldestTs = ledgerDao.oldestTs()
        )
        bleAdvertiser.advertise(beacon.toBytes())
        delay(60_000)  // 60 segundos entre beacons
    }
}
```

Cuando un peer ZIRO (ej. un rescatista) entra al rango, lo descubre, se conecta, y descarga el ledger + chunks del origen.

### SQLite schema adicional

```kotlin
@Entity(tableName = "evidence_chunks",
    primaryKeys = ["telegramId", "chunkIndex"])
data class EvidenceChunkEntity(
    val telegramId: String,
    val chunkIndex: Int,
    val totalChunks: Int,
    val sizeBytes: Long,
    val sha256: String,
    val storedAt: Long
)
```

## Caso especial: combinación con el ledger distribuido

Cuando un peer recibe un chunk del origen, también puede pedirle **el ledger completo** (gossip estándar). Así un rescatista que llega a la zona recibe:

1. Los chunks de evidencia del origen.
2. La lista completa de emergencias que el origen había acumulado.
3. Contactos de familiares (si el origen los tenía configurados).

```kotlin
suspend fun onRescuerConnected(peerId: String) {
    // 1. Mandar ledger completo
    gossipSync(peerId)
    
    // 2. Preguntar si tiene evidencia para los IDs que conoce
    val myIds = dao.getAllIds()
    val theirChunks = nearby.queryChunks(peerId, myIds)
    for (chunk in theirChunks) {
        evidenceDao.insert(chunk)
    }
}
```

## Tradeoffs reconocidos

| Aspecto | Opción 2 (chunks pre-evac) | Opción 3 (detección abandono) | Patrón B (todo distribuido) |
|---|---|---|---|
| Tiempo de implementación | 2-3h | 6-8h (requiere ML) | 12-16h |
| Protección si origen muere a los 2 min | ✅ alta | ❌ no protege | ✅ máxima |
| Consumo batería origen | medio-alto | bajo | alto |
| Wow factor en pitch | fuerte | wow pero frágil | overkill para demo |
| Defensibilidad técnica | sólida | requiere heurísticas sólidas | complejidad innecesaria |

**Recomendación: Opción 2 + Opción 1.** Es lo que cabe en 36h y resuelve los casos C1-C3.

## Lo que NO implementamos (declaration of honesty)

- ❌ No detectamos automáticamente que el dueño se fue (sin ML/heurísticas).
- ❌ No transferimos el video completo entre pares (solo chunks cortos).
- ❌ No hacemos store-and-forward de video entre TODOS los nodos (eso es Patrón B).
- ❌ No asumimos que el origen seguirá conectado a Internet.

## Qué decir en el pitch

> "Si la persona tiene que irse, su evidencia ya se guardó en otros teléfonos. Si el teléfono queda solo, sigue gritándole a quien pase cerca. La información no se queda nunca en un solo lugar."

Eso convierte el caso "dejó el teléfono en la construcción" **de debilidad a feature central**.

## Test cases para validar

### Test 1 — Persona se va a los 2 minutos
1. Activar Emergency Mode.
2. A los 30s, A descubre a B y le manda chunk.
3. A los 60s, A descubre a C y le manda chunk.
4. A los 90s, simular que A se va (apagar pantalla).
5. Verificar que B y C tienen los chunks en su SQLite.
6. Verificar que cuando B encuentra un gateway, el chunk llega al backend.

### Test 2 — Teléfono queda aislado
1. Activar Emergency Mode en A sin otros pares cerca.
2. Después de 2 minutos, A entra en modo ORPHAN.
3. Verificar que el beacon se transmite cada 60s.
4. Después de 10 minutos,模拟 un rescatista (F) entrando al rango.
5. Verificar que F recibe el ledger de A.

### Test 3 — Battery critical
1. Activar Emergency Mode con batería al 5%.
2. A debe seguir en modo ORPHAN pero reducir frecuencia de beacon a 5 minutos.
3. Verificar que chunks pre-distribuidos siguen disponibles en peers.
