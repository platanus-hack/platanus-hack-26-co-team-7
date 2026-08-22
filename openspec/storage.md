# storage.md — Manejo de evidencia (video/audio)

## Concepto

El **telegrama** transporta metadata (~120 bytes). El **video/audio** del evento se maneja por separado, con un patrón diferente. Aquí definimos los patrones posibles y cuál elegimos para ZIRO.

## Tres patrones posibles

### Patrón A — Solo telegrama, evidencia queda en el origen

- La app del origen sigue grabando localmente (MP4 en `/sdcard/ziro/evidence/{id}/video.mp4`).
- El telegrama salta por los nodos.
- Cuando el origen recupera Internet, hace upload del video al backend.
- Los relays **nunca reciben el video**.

**Pro:** Trivial de implementar.

**Contra:** Si el origen se pierde/rompe/muere, **el video se pierde para siempre**. El telegrama llega pero sin evidencia visual.

### Patrón B — Propagar evidencia por todos los nodos

- Cuando A manda el telegrama a B, también manda chunks del video.
- Cada relay guarda chunks localmente.
- Cuando cualquier gateway con Internet tiene suficientes chunks, sube el video al backend.
- Si el origen muere, los relays pueden reconstruir.

**Pro:** Máxima redundancia.

**Contra:** Complejidad brutal. Manejar fragmentación, resume de chunks, retries, orden de bytes, sincronización entre nodos que descargan/suben a velocidades distintas. Es prácticamente un mini-Bittorrent. **Consume ~80% del tiempo del hackatón solo en debugging.**

### Patrón C — Híbrido con upload perezoso (RECOMENDADO)

- El telegrama salta rápido por los nodos (lo crítico).
- El video queda solo en el origen.
- Cuando un gateway con Internet recibe el telegrama, lo sube al backend.
- El backend registra "persona A confirmada estar en X, Y con estado EMERGENCY" en segundos.
- Cuando el origen recupera Internet (puede ser minutos u horas después), hace POST `multipart/form-data` con el video, referenciando el `id` del telegrama.
- El backend actualiza el estado a "video adjunto recibido".

**Pro:** MVP viable en 36h. Backend recibe "alerta" en segundos, video en minutos/horas. **Honesto con el usuario** — la familia sabe que el video llegará después.

**Contra:** Si el origen nunca recupera Internet, el video se pierde. Pero el **estado** (ubicación, hora, evento) ya quedó en el servidor.

## Decisión: Patrón C

Para la hackatón, vamos con **Patrón C**. El pitch al juez es:

> "La familia ve 'Última señal: hace 5 min' en segundos, y 'Video adjunto: recibido ✅' cuando el origen recupera señal. Dos pulsos de actualización, transparencia total."

## Implementación del Patrón C

### En el origen (Emergency Mode)

```kotlin
class EvidenceRecorder(private val context: Context) {
    private var mediaRecorder: MediaRecorder? = null
    private var currentFile: File? = null
    private var currentTelegramId: String? = null

    fun start(telegramId: String) {
        currentTelegramId = telegramId
        val dir = File(context.getExternalFilesDir(null), "evidence/$telegramId")
        dir.mkdirs()
        val file = File(dir, "video.mp4")
        currentFile = file

        mediaRecorder = MediaRecorder().apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setVideoSource(MediaRecorder.VideoSource.CAMERA)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setVideoEncoder(MediaRecorder.VideoEncoder.H264)
            // Bitrate agresivo para 36h — priorizar duración sobre calidad
            setVideoEncodingBitRate(500_000)   // 500 kbps
            setVideoFrameRate(15)              // 15 fps
            setVideoSize(640, 480)             // 480p
            setOutputFile(file.absolutePath)
            prepare()
            start()
        }
    }

    fun stop() {
        mediaRecorder?.stop()
        mediaRecorder?.release()
        mediaRecorder = null
    }

    fun getFile(): File? = currentFile
    fun getTelegramId(): String? = currentTelegramId
}
```

### En el origen, cuando recupera Internet

```kotlin
suspend fun uploadPendingEvidence() {
    val pending = evidenceDao.getPending()  // archivos sin subir
    for (evidence in pending) {
        val file = evidence.file
        val requestBody = file.asRequestBody("video/mp4".toMediaType())
        val multipart = MultipartBody.Part.createFormData(
            "video", file.name, requestBody
        )

        try {
            val response = api.uploadEvidence(
                telegramId = evidence.telegramId,
                chunkIndex = 0,
                totalChunks = 1,
                sha256 = evidence.sha256,
                video = multipart
            )
            if (response.success) {
                evidenceDao.markUploaded(evidence.telegramId)
            }
        } catch (e: Exception) {
            log("Upload failed, will retry: $e")
            // queda como pending, se reintenta después
        }
    }
}
```

### En el gateway

```kotlin
suspend fun onTelegramReceivedFromPeer(t: Telegram) {
    if (hasInternet()) {
        // soy gateway, subo al backend
        api.uploadTelegram(t)
    } else {
        // soy relay, guardo y retransmito
        relayStore(t)
    }
}
```

### En el backend

```python
# FastAPI example
@app.post("/api/messages")
async def upload_telegram(t: TelegramIn, background_tasks: BackgroundTasks):
    message = await db.messages.insert(t.dict())
    background_tasks.add_task(notify_family, message.id)
    return {"id": message.id, "status": "DELIVERED"}

@app.post("/api/evidence/{telegram_id}")
async def upload_evidence(
    telegram_id: str,
    video: UploadFile = File(...),
    chunk_index: int = 0,
    total_chunks: int = 1,
    sha256: str = Form(...)
):
    # validar sha256
    # guardar en storage/{telegram_id}/video.mp4
    await db.messages.update(telegram_id, {
        "video_uploaded_at": now(),
        "video_url": f"/storage/{telegram_id}/video.mp4"
    })
    await notify_family(telegram_id, type="VIDEO_RECEIVED")
    return {"success": True}
```

## Storage local en el origen

```
/storage/emulated/0/Android/data/com.ziro.emergency/files/
└── evidence/
    ├── a8f29c3f-7b9e-4a1d-8e2f-1c5b9d6e3f4a/
    │   ├── video.mp4        ← evidencia (500 kbps, 480p, 15fps)
    │   ├── audio.aac        ← audio aislado (opcional)
    │   └── metadata.json    ← GPS, timestamps, info del device
    └── b9d6e3f4a-.../
        └── ...
```

## Compresión agresiva para 36h

Para que el video no sea enorme:

| Parámetro | Valor | Default Android | Ahorro |
|---|---|---|---|
| Bitrate | 500 kbps | 8 Mbps | 16x |
| Resolución | 640x480 | 1920x1080 | 6.75x |
| FPS | 15 | 30 | 2x |

**Resultado:** ~2 MB por minuto de grabación. 30 minutos de grabación = ~60 MB. Manejable.

## UX en la app del familiar

```
┌─────────────────────────────────┐
│      ZIRO EMERGENCY             │
├─────────────────────────────────┤
│                                 │
│  👤 Juan Pérez                  │
│                                 │
│  🟢 Última señal recibida       │
│     hace 2 minutos              │
│                                 │
│  📍 4.6097, -74.0817            │
│     Bogotá, Colombia            │
│                                 │
│  🕐 Reportado a las 14:43:12    │
│                                 │
│  📡 4 nodos atravesados         │
│     A → B → C → D               │
│                                 │
│  🎥 Video adjunto               │
│     ✅ Recibido                 │
│     [▶ Ver video]               │
│                                 │
└─────────────────────────────────┘
```

## Pendiente para v2 (NO en MVP)

- Subida fragmentada de videos largos (chunks > 1 MB).
- Compresión adaptativa según nivel de batería.
- Sincronización de evidencia entre origen y gateway (Patrón B parcial).
- Cifrado at-rest del video en el origen.
- Limpieza automática de evidencia después de N días.
